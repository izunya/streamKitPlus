import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type {
  AuthMethod,
  PlatformCategory as PlatformCategoryType,
  BroadcastDraft,
  ConnectedAccount,
  HistoryEntry,
  PlatformCategory,
  PlatformId,
  PlatformPatch,
  Preset,
  UpdateResult
} from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { getAdapter, getMode, setMode, liveAvailable, type AdapterMode } from '@/platforms/registry'
import { expandAliases, matchCategory, normalize, type CategoryMatch } from '@/lib/categoryMatch'
import { applyTagPolicy, applyTitlePolicy } from '@/lib/tagPolicy'
import { renderTitle, usesCounter } from '@/lib/variables'

const uid = (): string => globalThis.crypto.randomUUID()

const emptyDraft = (): BroadcastDraft => ({
  title: '',
  canonicalCategoryId: null,
  canonicalCategoryName: '',
  tags: [],
  extraTags: {},
  titleOverride: {}
})

/** 카테고리 검색 응답 경쟁 방지 — 마지막 요청의 결과만 반영합니다. */
let resolveSeq = 0

/* ------------------------------------------------------------------ */
/* 검색 결과 캐시                                                       */
/*                                                                     */
/* 카테고리 검색은 한 글자 칠 때마다 플랫폼 수만큼 나가고, 별칭 재시도까지  */
/* 더해지면 검색어 하나에 수십 번 호출됩니다. 게다가 카탈로그는 몇 초 만에  */
/* 바뀌는 것이 아니므로 대부분이 낭비입니다.                              */
/*                                                                     */
/* 같은 단어에 대한 응답을 저장해두고 재사용합니다. 앱을 껐다 켜도 남습니다. */
/* ------------------------------------------------------------------ */

interface CachedSearch {
  at: number
  data: PlatformCategoryType[]
}

/** 카탈로그가 그날그날 바뀌지는 않으므로 넉넉히 잡습니다. */
const SEARCH_TTL_MS = 12 * 60 * 60 * 1000
/** 무한정 쌓이지 않도록 상한을 둡니다 (넘으면 오래된 것부터 버립니다). */
const SEARCH_CACHE_MAX = 400

/**
 * 검색 캐시 키.
 *
 * 매칭용 normalize 는 공백과 기호를 다 지우지만, 여기서는 그러면 안 됩니다.
 * 플랫폼 검색 API 는 공백 유무로 결과가 갈립니다 —
 * 치지직은 "Beat Saber" 로는 못 찾고 "비트 세이버" 로는 찾습니다.
 * 키에서 공백을 지우면 서로 다른 검색이 한 칸을 나눠 쓰면서,
 * 먼저 실패한 결과가 나중의 올바른 검색어까지 막아버립니다.
 */
const searchKey = (id: PlatformId, term: string): string =>
  `${id}:${term.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')}`

function readSearchCache(id: PlatformId, term: string): PlatformCategoryType[] | null {
  const hit = useAppStore.getState().searchCache[searchKey(id, term)]
  if (!hit) return null
  if (Date.now() - hit.at > SEARCH_TTL_MS) return null
  return hit.data
}

function writeSearchCache(id: PlatformId, term: string, data: PlatformCategoryType[]): void {
  useAppStore.setState((s) => {
    const next: Record<string, CachedSearch> = {
      ...s.searchCache,
      [searchKey(id, term)]: { at: Date.now(), data }
    }

    const keys = Object.keys(next)
    if (keys.length > SEARCH_CACHE_MAX) {
      keys.sort((a, b) => next[a].at - next[b].at)
      for (const k of keys.slice(0, keys.length - SEARCH_CACHE_MAX)) delete next[k]
    }
    return { searchCache: next }
  })
}

/** 캐시를 거친 검색. 없을 때만 실제로 호출합니다. */
async function searchOnce(id: PlatformId, term: string): Promise<PlatformCategoryType[]> {
  const cached = readSearchCache(id, term)
  if (cached) return cached

  const data = await getAdapter(id).searchCategory(term)
  writeSearchCache(id, term, data)
  return data
}

/**
 * 별칭까지 동원해 카테고리를 검색합니다.
 *
 * 플랫폼 검색 API 는 대개 "이름에 이 문자열이 들어있는가" 로만 찾습니다.
 * 그래서 두 가지 문제가 생깁니다:
 *
 *   1. 표기가 다르면 못 찾음
 *      "league of legends" -> 치지직의 "리그 오브 레전드" 를 못 찾습니다.
 *
 *   2. 결과는 나오는데 엉뚱한 것만 나옴  ← 이게 더 까다롭습니다
 *      "talk" -> 트위치는 TalkMan, Talking Dogs 같은 게임을 돌려줍니다.
 *      정작 찾던 "Just Chatting" 은 이름에 talk 이 없어서 안 나옵니다.
 *      결과가 0건이 아니라서 "찾았다" 고 착각하기 쉽습니다.
 *
 * 그래서 결과 개수가 아니라 "쓸 만한 매칭이 있는가" 로 판단합니다.
 * 확실한 매칭이 없으면 별칭으로 더 찾아 결과를 합칩니다.
 */
const MAX_ALIAS_RETRIES = 6

function isConfident(m: CategoryMatch | undefined): boolean {
  return !!m && (m.confidence === 'exact' || m.confidence === 'high')
}

async function searchWithAliases(
  id: PlatformId,
  query: string
): Promise<PlatformCategoryType[]> {
  const merged = [...(await searchOnce(id, query))]
  if (isConfident(matchCategory(query, merged)[0])) return merged

  const seenIds = new Set(merged.map((c) => c.id))

  /*
   * 이미 보낸 검색어인지 판단할 때 공백을 지우면 안 됩니다.
   *
   * 매칭용 normalize 로 비교하면 "비트 세이버" 와 "비트세이버" 가 같은 말이 되어
   * 둘 중 하나만 시도합니다. 그런데 플랫폼 검색은 그 한 칸으로 결과가 갈립니다 —
   * 치지직은 "비트세이버" 는 찾고 "Beat Saber" 는 0건입니다.
   * 띄어쓰기가 다른 표기는 서로 다른 시도로 취급해야 합니다.
   */
  const termKey = (t: string): string =>
    t.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')

  const seenTerms = new Set([termKey(query)])
  let tried = 0

  for (const alias of expandAliases(query)) {
    if (tried >= MAX_ALIAS_RETRIES) break

    const key = termKey(alias)
    if (seenTerms.has(key)) continue
    seenTerms.add(key)
    tried++

    const hit = await searchOnce(id, alias)
    for (const c of hit) {
      if (seenIds.has(c.id)) continue
      seenIds.add(c.id)
      merged.push(c)
    }

    // 원래 검색어 기준으로 확실한 매칭이 생겼으면 멈춥니다.
    if (isConfident(matchCategory(query, merged)[0])) break
  }

  return merged
}

/** 한 플랫폼에 대해 확정된 카테고리 매핑 */
export interface ResolvedCategory {
  categoryId: string
  categoryName: string
  /**
   * 이 플랫폼만 카테고리를 바꾸지 않겠다는 사용자의 결정.
   *
   * 단순히 매핑을 지우면 다음 검색에서 다시 "후보 3개" 로 되살아납니다.
   * "안 바꾸기로 했다" 는 것도 하나의 결정이므로 명시적으로 남기고 캐시합니다.
   */
  skip?: boolean
  /** 치지직/CIME 은 categoryId 만으로 부족해 이 값도 함께 보내야 합니다 */
  categoryType?: string
  /** 유튜브형 2단 구조: 대분류 '게임' 아래에 들어가는 게임 제목 */
  gameTitle?: string
  /**
   * exact/high 는 자동 확정, manual 은 사용자가 직접 고른 것,
   * cache 는 과거 확정값 재사용, twoStep 은 게임 판별로 대분류가 자동 결정된 것
   */
  source: 'exact' | 'high' | 'manual' | 'cache' | 'twoStep'
}

/**
 * 사용자가 입력한 값이 개별 게임 타이틀인지 판별합니다.
 *
 * 게임 카탈로그를 가진 플랫폼(트위치·치지직·SOOP)에서 확실하게 매칭되고
 * 그 항목이 isGame 이면 게임으로 봅니다.
 * 게임이면 유튜브는 물어볼 것 없이 대분류 '게임' + 게임 제목으로 확정됩니다.
 */
function detectGameTitle(
  query: string,
  catalogs: Partial<Record<PlatformId, PlatformCategoryType[]>>
): string | null {
  for (const id of PLATFORM_ORDER) {
    if (!PLATFORMS[id].capabilities.category.searchable) continue

    const list = catalogs[id]
    if (!list || list.length === 0) continue

    const top = matchCategory(query, list)[0]
    if (!top || (top.confidence !== 'exact' && top.confidence !== 'high')) continue
    /*
     * isGame 이 아예 없으면 그 플랫폼은 게임 여부를 모른다는 뜻입니다.
     * CIME 처럼 분류 체계가 없는 곳이 그렇습니다. 모르는 것을 "아니다" 로
     * 읽으면 발로란트를 게임이 아니라고 단정하게 되므로, 다음 플랫폼에 넘깁니다.
     */
    if (top.category.isGame === undefined) continue
    if (!top.category.isGame) return null // 게임이 아님이 확실해짐 (토크/음악 등)

    // PLATFORM_ORDER 상 트위치가 가장 먼저 검사되므로 보통 공식 영문 타이틀이 잡힙니다.
    // 유튜브 게임 제목 칸도 공식 타이틀로 검색되기 때문에 이 표기가 가장 잘 맞습니다.
    return top.category.name
  }
  return null
}

/** 아직 확정되지 않아 사용자에게 물어봐야 하는 후보들 */
export interface PendingCategory {
  candidates: CategoryMatch[]
}

interface AppState {
  /* 연동 */
  accounts: Partial<Record<PlatformId, ConnectedAccount>>
  enabled: Record<PlatformId, boolean>
  connecting: PlatformId | null

  /* 입력 */
  draft: BroadcastDraft
  counter: number
  /**
   * draft 를 통째로 갈아끼운 횟수 (프리셋 불러오기·초기화).
   *
   * 입력칸을 로컬 상태로 들고 있는 화면은 스토어가 밖에서 바뀌어도 모릅니다.
   * 타이핑 중에는 동기화하면 안 되고, 통째로 바뀔 때만 다시 읽어야 하므로
   * "언제 갈아끼웠는지" 를 신호로 남깁니다.
   */
  draftRevision: number

  /**
   * 각 플랫폼에 지금 적용돼 있는 방송 정보.
   *
   * 입력칸을 비워두면 무엇이 유지되는지 사용자가 알 수 있어야 하므로,
   * 현재 값을 읽어와 placeholder 로 보여줍니다.
   */
  current: Partial<Record<PlatformId, PlatformPatch>>
  loadingCurrent: boolean
  /**
   * 제목 입력칸에 보여줄 예시.
   *
   * 실제로 쓰고 있는 제목을 보여주면 "여기에 뭘 쓰는 칸인지" 가 훨씬 잘 전달됩니다.
   * 연동·활성화된 플랫폼의 현재 제목 중 하나를 앱 실행마다 한 번만 고릅니다.
   * (매 렌더마다 바뀌면 눈이 어지럽고, 저장하면 매번 같은 것만 나옵니다.)
   */
  titleHint: string | null
  /** 카테고리 입력칸 예시. 제목과 같은 방식으로 실행마다 한 번만 고릅니다. */
  categoryHint: string | null

  /* 동작 모드 */
  mode: AdapterMode
  liveAvailable: boolean

  /* 카테고리 매핑 */
  resolved: Partial<Record<PlatformId, ResolvedCategory>>
  pending: Partial<Record<PlatformId, PendingCategory>>
  /** 마지막 검색에서 각 플랫폼이 돌려준 카테고리 목록 (수동 선택 UI 가 씁니다) */
  catalogs: Partial<Record<PlatformId, PlatformCategoryType[]>>
  /**
   * 카테고리 검색이 오류로 실패한 플랫폼과 그 사유.
   *
   * "결과 없음" 과 "호출 실패" 는 사용자가 해야 할 일이 완전히 다릅니다.
   * 전자는 직접 고르면 되지만, 후자는 연동이나 권한 문제라 손댈 곳이 다릅니다.
   */
  catalogErrors: Partial<Record<PlatformId, string>>
  /** 카테고리 검색이 진행 중인지 */
  resolving: boolean
  /** 사용자가 한 번 확정한 매핑을 영구 보관 — 다음부터는 묻지 않습니다 */
  mappingCache: Record<string, Partial<Record<PlatformId, ResolvedCategory>>>
  /** 검색 결과 캐시 — 같은 단어를 다시 쳐도 API 를 부르지 않습니다 */
  searchCache: Record<string, CachedSearch>

  /* 실행 */
  applying: boolean
  results: UpdateResult[]

  /* 저장물 */
  presets: Preset[]
  history: HistoryEntry[]

  /* actions */
  setMode: (m: AdapterMode) => void
  syncAccounts: () => Promise<void>
  refreshCurrent: () => Promise<void>
  toggleEnabled: (id: PlatformId) => void
  connect: (id: PlatformId, method: AuthMethod, creds?: Record<string, string>) => Promise<void>
  cancelConnect: (id: PlatformId) => Promise<void>
  disconnect: (id: PlatformId) => Promise<void>

  setTitle: (v: string) => void
  setTitleOverride: (id: PlatformId, v: string | undefined) => void
  setTags: (tags: string[]) => void
  setExtraTags: (id: PlatformId, tags: string[]) => void

  resolveCategory: (query: string) => Promise<void>
  /** 검색 결과 캐시를 비웁니다 (플랫폼에 새 카테고리가 생겼을 때) */
  clearSearchCache: () => void
  /** 특정 플랫폼에서만 카테고리를 검색합니다 (직접 찾기 화면용) */
  searchOn: (id: PlatformId, query: string) => Promise<PlatformCategoryType[]>
  pickCategory: (id: PlatformId, category: PlatformCategory, gameTitle?: string) => void
  clearCategory: (id: PlatformId) => void

  apply: () => Promise<void>
  retryFailed: () => Promise<void>

  savePreset: (name: string, accent: string) => void
  loadPreset: (id: string) => void
  /**
   * 프리셋을 불러오고 카테고리 매칭이 끝날 때까지 기다린 뒤 곧바로 적용합니다.
   * OBS 씬 전환처럼 사람이 버튼을 누르지 않는 경로에서 씁니다.
   */
  applyPreset: (id: string) => Promise<{ ok: boolean; error?: string }>
  deletePreset: (id: string) => void

  revert: (historyId: string) => Promise<void>
  /** 기록 한 건 삭제 */
  deleteHistory: (historyId: string) => void
  resetDraft: () => void
}

/** 활성 + 연동된 플랫폼만 실제 적용 대상입니다 */
function activeTargets(s: Pick<AppState, 'enabled' | 'accounts'>): PlatformId[] {
  return PLATFORM_ORDER.filter((id) => s.enabled[id] && Boolean(s.accounts[id]))
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      accounts: {},
      enabled: Object.fromEntries(PLATFORM_ORDER.map((id) => [id, true])) as Record<
        PlatformId,
        boolean
      >,
      connecting: null,

      current: {},
      loadingCurrent: false,
      titleHint: null,
      categoryHint: null,

      mode: getMode(),
      liveAvailable: liveAvailable(),

      draft: emptyDraft(),
      counter: 1,
      draftRevision: 0,

      resolved: {},
      pending: {},
      catalogs: {},
      catalogErrors: {},
      resolving: false,
      mappingCache: {},
      searchCache: {},

      applying: false,
      results: [],

      presets: [],
      history: [],

      setMode: (m) => {
        setMode(m)
        // 모드가 바뀌면 연동 상태와 카테고리 매칭 결과가 달라집니다.
        set({
          mode: getMode(),
          accounts: {},
          resolved: {},
          pending: {},
          catalogs: {},
          catalogErrors: {},
          results: []
        })
        void get().syncAccounts()
      },

      /**
       * 메인 프로세스에 저장된 연동 상태를 읽어옵니다.
       * 앱을 껐다 켜도 연동이 유지되어야 하므로 시작할 때 한 번 호출합니다.
       */
      syncAccounts: async () => {
        if (getMode() !== 'live' || !liveAvailable()) return

        const entries = await Promise.all(
          PLATFORM_ORDER.map(async (id) => {
            try {
              const status = await window.skp.credentials.status(id)
              if (!status.connected || !status.account) return null
              return [
                id,
                {
                  platform: id,
                  displayName: status.account.displayName,
                  channelId: status.account.channelId,
                  method: 'oauth' as const,
                  connectedAt: status.account.connectedAt
                }
              ] as const
            } catch {
              return null
            }
          })
        )

        const accounts: Partial<Record<PlatformId, ConnectedAccount>> = {}
        for (const e of entries) if (e) accounts[e[0]] = e[1]
        set({ accounts })

        void get().refreshCurrent()
      },

      /**
       * 연동된 플랫폼의 현재 방송 정보를 읽어옵니다.
       *
       * 앱을 켰을 때와 적용 직후에 부릅니다.
       * 실패한 플랫폼은 조용히 건너뜁니다 — 이건 참고용 표시일 뿐이라
       * 여기서 오류를 띄우면 방해만 됩니다.
       */
      refreshCurrent: async () => {
        const s = get()
        const targets = PLATFORM_ORDER.filter((id) => s.accounts[id])
        if (targets.length === 0) {
          set({ current: {} })
          return
        }

        set({ loadingCurrent: true })

        const entries = await Promise.all(
          targets.map(async (id) => {
            try {
              return [id, await getAdapter(id).fetchCurrent()] as const
            } catch {
              return [id, null] as const
            }
          })
        )

        const current: Partial<Record<PlatformId, PlatformPatch>> = {}
        for (const [id, info] of entries) if (info) current[id] = info

        /*
         * 현재 걸려 있는 태그를 플랫폼별 입력칸에 자동으로 채웁니다.
         *
         * 단, 사용자가 이미 손댄 칸은 건드리지 않습니다.
         * 새로고침할 때마다 덮어쓰면 방금 지운 태그가 되살아나 버립니다.
         * 아직 비어 있는 칸만 채웁니다.
         */
        const extraTags = { ...get().draft.extraTags }
        for (const [id, info] of entries) {
          if (!info?.tags?.length) continue
          if (extraTags[id] !== undefined) continue
          extraTags[id] = info.tags
        }

        /*
         * 현재 제목과 똑같아진 오버라이드는 정리합니다.
         *
         * "고쳤다가 원래대로 되돌리면 해제" 는 타이핑할 때만 검사됩니다.
         * 적용을 하고 나면 현재 제목이 그 값으로 바뀌므로,
         * 손댄 적 없는 것과 다를 바 없는데도 "수정함" 표시가 계속 남습니다.
         *
         * 공통 제목이 있을 때는 기준이 공통 제목이므로 건드리지 않습니다.
         */
        const titleOverride = { ...get().draft.titleOverride }
        if (!get().draft.title.trim()) {
          for (const [id, info] of entries) {
            if (!info) continue
            if (titleOverride[id] !== undefined && titleOverride[id] === info.title) {
              delete titleOverride[id]
            }
          }
        }

        /*
         * 예시 문구는 실행마다 한 번만 정합니다.
         * 새로고침할 때마다 바뀌면 산만하고, 저장하면 매번 같은 것만 나옵니다.
         */
        const pickHint = (values: (string | undefined)[]): string | null => {
          const candidates = values
            .map((v) => v?.trim())
            .filter((v): v is string => Boolean(v))
          if (candidates.length === 0) return null
          return candidates[Math.floor(Math.random() * candidates.length)]
        }

        const targetIds = activeTargets(get())

        let titleHint = get().titleHint
        if (titleHint === null) {
          titleHint = pickHint(targetIds.map((id) => current[id]?.title))
        }

        let categoryHint = get().categoryHint
        if (categoryHint === null) {
          // 게임 제목이 따로 있으면(유튜브형) 그쪽이 더 구체적이라 먼저 씁니다.
          categoryHint = pickHint(
            targetIds.map((id) => current[id]?.gameTitle || current[id]?.categoryName)
          )
        }

        set((prev) => ({
          current,
          loadingCurrent: false,
          titleHint,
          categoryHint,
          draft: { ...prev.draft, extraTags, titleOverride }
        }))
      },

      toggleEnabled: (id) => set((s) => ({ enabled: { ...s.enabled, [id]: !s.enabled[id] } })),

      connect: async (id, method, creds) => {
        set({ connecting: id })
        try {
          const account = await getAdapter(id).connect(method, creds)
          set((s) => ({ accounts: { ...s.accounts, [id]: account } }))
        } finally {
          set({ connecting: null })
        }
      },

      /**
       * 진행 중인 브라우저 로그인을 중단합니다.
       *
       * 사용자가 브라우저를 그냥 닫으면 콜백이 오지 않아 앱이 계속 기다립니다.
       * 취소 버튼이나 창 닫기로 여기를 불러 즉시 빠져나옵니다.
       */
      cancelConnect: async (id) => {
        if (getMode() === 'live' && liveAvailable()) {
          await window.skp.platform.cancelConnect(id)
        }
        set({ connecting: null })
      },

      disconnect: async (id) => {
        await getAdapter(id).disconnect()
        set((s) => {
          const accounts = { ...s.accounts }
          delete accounts[id]
          return { accounts }
        })
      },

      setTitle: (v) => set((s) => ({ draft: { ...s.draft, title: v } })),

      setTitleOverride: (id, v) =>
        set((s) => {
          const titleOverride = { ...s.draft.titleOverride }
          if (v === undefined || v === '') delete titleOverride[id]
          else titleOverride[id] = v
          return { draft: { ...s.draft, titleOverride } }
        }),

      setTags: (tags) => set((s) => ({ draft: { ...s.draft, tags } })),

      setExtraTags: (id, tags) =>
        set((s) => ({
          draft: { ...s.draft, extraTags: { ...s.draft.extraTags, [id]: tags } }
        })),

      /**
       * 카테고리 통합 해결의 진입점.
       *
       * 1) 각 플랫폼의 검색 API 를 동시에 호출해 후보 목록을 받는다
       *    (Mock 모드에서는 Mock 카탈로그가 그대로 돌아옵니다)
       * 2) 캐시에 확정된 매핑이 있으면 그걸 쓴다
       * 3) 게임이면 유튜브형 2단 구조를 자동 확정
       * 4) exact/high 는 자동 확정, 애매하면 사용자에게 후보 제시
       */
      resolveCategory: async (query) => {
        const key = normalize(query)
        const seq = ++resolveSeq

        set((s) => ({
          draft: { ...s.draft, canonicalCategoryName: query, canonicalCategoryId: key || null }
        }))

        if (!key) {
          set({ resolved: {}, pending: {}, catalogs: {}, catalogErrors: {}, resolving: false })
          return
        }

        const cachedMapping = get().mappingCache[key]

        set({ resolving: true })

        /*
         * 이미 확정된 매핑이 있는 플랫폼은 검색하지 않습니다.
         *
         * 어차피 캐시 값을 쓸 것이므로 결과가 필요 없습니다.
         * 자주 켜는 방송이라면 대부분 캐시에 있어서 호출이 거의 0 이 됩니다.
         * (직접 찾기 화면을 열면 그때 따로 검색합니다.)
         */
        const fetched = await Promise.all(
          PLATFORM_ORDER.map(async (id) => {
            const empty: PlatformCategoryType[] = []
            if (!PLATFORMS[id].capabilities.category.supported) {
              return [id, empty, undefined] as const
            }
            if (cachedMapping?.[id]) return [id, empty, undefined] as const

            try {
              return [id, await searchWithAliases(id, query), undefined] as const
            } catch (e) {
              // 실패 사유를 남깁니다 — "결과 없음" 과 구분해서 보여줘야 합니다.
              return [id, empty, e instanceof Error ? e.message : String(e)] as const
            }
          })
        )

        // 입력이 더 진행됐다면 오래된 응답은 버립니다.
        if (seq !== resolveSeq) return

        const catalogs: Partial<Record<PlatformId, PlatformCategoryType[]>> = {}
        const catalogErrors: Partial<Record<PlatformId, string>> = {}
        for (const [id, list, err] of fetched) {
          catalogs[id] = list
          if (err) catalogErrors[id] = err
        }

        /*
         * 2차 시도: 다른 플랫폼이 찾아낸 정식 이름으로 다시 검색합니다.
         *
         * 사용자가 "BEATSABER" 라고 쳤을 때 트위치는 "Beat Saber" 를 찾아내지만
         * 치지직은 0건입니다. 이때 트위치가 알아낸 정식 표기로 다시 물어보면
         * 찾을 가능성이 생깁니다. 별칭 사전에 없는 게임도 이 방법이 통합니다.
         *
         * 한계: 카탈로그가 한글 이름만 가진 플랫폼은 영문 표기로 여전히 못 찾습니다.
         * 그런 경우는 사용자가 한 번 직접 고르고, 그 매핑이 캐시에 남습니다.
         */
        const foundNames = [
          ...new Set(
            PLATFORM_ORDER.flatMap((id) => {
              const top = matchCategory(query, catalogs[id] ?? [])[0]
              return top && (top.confidence === 'exact' || top.confidence === 'high')
                ? [top.category.name]
                : []
            })
          )
        ].filter((n) => normalize(n) !== normalize(query))

        if (foundNames.length > 0) {
          const retryTargets = PLATFORM_ORDER.filter(
            (id) =>
              PLATFORMS[id].capabilities.category.supported &&
              !catalogErrors[id] &&
              (catalogs[id]?.length ?? 0) === 0
          )

          await Promise.all(
            retryTargets.map(async (id) => {
              for (const name of foundNames) {
                try {
                  const hit = await getAdapter(id).searchCategory(name)
                  if (hit.length > 0) {
                    catalogs[id] = hit
                    return
                  }
                } catch {
                  return // 실패하면 이 플랫폼은 포기합니다
                }
              }
            })
          )

          if (seq !== resolveSeq) return
        }

        const cached = cachedMapping
        const resolved: Partial<Record<PlatformId, ResolvedCategory>> = {}
        const pending: Partial<Record<PlatformId, PendingCategory>> = {}

        // 입력값이 개별 게임 타이틀인지 먼저 판별합니다.
        // 게임이면 유튜브형 2단 구조 플랫폼은 물어볼 것이 없어집니다.
        const gameTitle = detectGameTitle(query, catalogs)

        for (const id of PLATFORM_ORDER) {
          const caps = PLATFORMS[id].capabilities.category
          if (!caps.supported) continue

          const hit = cached ? cached[id] : undefined
          if (hit) {
            resolved[id] = { ...hit, source: 'cache' }
            continue
          }

          // 유튜브형: 게임 방송이면 대분류 '게임' + 게임 제목으로 자동 확정.
          // "발로란트"는 대분류가 아니라 대분류 아래의 게임 제목이기 때문입니다.
          if (caps.gameTitle && gameTitle) {
            const parent = (catalogs[id] ?? []).find((c) => c.id === caps.gameTitle!.underCategoryId)
            if (parent) {
              resolved[id] = {
                categoryId: parent.id,
                categoryName: parent.name,
                gameTitle,
                source: 'twoStep'
              }
              continue
            }
          }

          const catalog = catalogs[id] ?? []
          // 원래 검색어로 먼저 맞춰보고, 안 되면 다른 플랫폼이 찾아낸 이름으로도 맞춰봅니다.
          let matches = matchCategory(query, catalog)
          if (matches.length === 0) {
            for (const name of foundNames) {
              matches = matchCategory(name, catalog)
              if (matches.length > 0) break
            }
          }

          if (matches.length === 0) {
            // 유튜브처럼 고정 대분류만 있는 플랫폼은 게임 이름으로 검색해도 당연히 안 잡힙니다.
            // 이런 곳은 "실패"가 아니라 "한 번만 골라주세요"가 맞습니다.
            if (!caps.searchable && catalog.length > 0) {
              pending[id] = {
                candidates: catalog.map((category) => ({
                  category,
                  score: 0,
                  byName: false,
                  confidence: 'low' as const
                }))
              }
            }
            continue
          }

          const top = matches[0]
          if (top.confidence === 'exact' || top.confidence === 'high') {
            resolved[id] = {
              categoryId: top.category.id,
              categoryName: top.category.name,
              categoryType: top.category.categoryType,
              source: top.confidence
            }
          } else {
            pending[id] = { candidates: matches }
          }
        }

        set({ resolved, pending, catalogs, catalogErrors, resolving: false })
      },

      clearSearchCache: () => set({ searchCache: {} }),

      /**
       * 한 플랫폼에서만 검색합니다.
       *
       * 직접 찾기 화면은 이미 받아둔 목록을 거르기만 하고 있었습니다.
       * 그러면 다른 단어를 치는 순간 결과가 사라져 "검색이 안 된다" 고 느끼게 됩니다.
       * 실제로 플랫폼에 다시 물어봐야 합니다.
       */
      searchOn: async (id, query) => {
        if (!query.trim()) return []
        try {
          return await searchWithAliases(id, query)
        } catch {
          return []
        }
      },

      /** 사용자가 후보 중 하나를 고르면 확정하고 캐시에 영구 저장합니다 */
      pickCategory: (id, category, gameTitle) =>
        set((s) => {
          const key = s.draft.canonicalCategoryId
          const entry: ResolvedCategory = {
            categoryId: category.id,
            categoryName: category.name,
            categoryType: category.categoryType,
            gameTitle: gameTitle?.trim() || undefined,
            source: 'manual'
          }

          const pending = { ...s.pending }
          delete pending[id]

          const mappingCache = key
            ? {
                ...s.mappingCache,
                [key]: { ...(s.mappingCache[key] ?? {}), [id]: entry }
              }
            : s.mappingCache

          return { resolved: { ...s.resolved, [id]: entry }, pending, mappingCache }
        }),

      /**
       * 이 플랫폼은 카테고리를 바꾸지 않겠다고 표시합니다.
       *
       * pending 까지 지우지 않으면 "후보 N개" 경고가 노란색으로 그대로 남습니다.
       * 결정을 캐시에도 남겨서 다음에 같은 카테고리를 입력해도 다시 묻지 않습니다.
       */
      clearCategory: (id) =>
        set((s) => {
          const key = s.draft.canonicalCategoryId
          const entry: ResolvedCategory = {
            categoryId: '',
            categoryName: '',
            source: 'manual',
            skip: true
          }

          const pending = { ...s.pending }
          delete pending[id]

          const mappingCache = key
            ? { ...s.mappingCache, [key]: { ...(s.mappingCache[key] ?? {}), [id]: entry } }
            : s.mappingCache

          return { resolved: { ...s.resolved, [id]: entry }, pending, mappingCache }
        }),

      apply: async () => {
        const s = get()
        const targets = activeTargets(s)
        if (targets.length === 0 || s.applying) return

        set({ applying: true, results: [] })

        const renderedTitle = renderTitle(s.draft.title, {
          counter: s.counter,
          categoryName: s.draft.canonicalCategoryName
        })

        // 플랫폼을 동시에 호출합니다. 하나가 느려도 나머지를 막지 않습니다.
        const results = await Promise.all(
          targets.map(async (id): Promise<UpdateResult> => {
            const patch = buildPatch(id, s, renderedTitle)
            try {
              return await getAdapter(id).updateBroadcast(patch)
            } catch (e) {
              // 어댑터가 계약을 어기고 throw 하더라도 여기서 흡수합니다.
              return {
                platform: id,
                ok: false,
                durationMs: 0,
                fields: {},
                error: e instanceof Error ? e.message : String(e)
              }
            }
          })
        )

        const entry: HistoryEntry = {
          id: uid(),
          at: Date.now(),
          draft: structuredClone(s.draft),
          targets,
          results
        }

        set((prev) => ({
          applying: false,
          results,
          history: [entry, ...prev.history].slice(0, 100),
          counter: usesCounter(prev.draft.title) ? prev.counter + 1 : prev.counter
        }))

        // 적용 후 실제로 반영된 값을 다시 읽어옵니다.
        void get().refreshCurrent()
      },

      retryFailed: async () => {
        const s = get()
        const failed = s.results.filter((r) => !r.ok).map((r) => r.platform)
        if (failed.length === 0 || s.applying) return

        set({ applying: true })

        // 재시도는 회차를 다시 올리지 않으므로 직전 카운터 값을 씁니다.
        const renderedTitle = renderTitle(s.draft.title, {
          counter: Math.max(1, s.counter - 1),
          categoryName: s.draft.canonicalCategoryName
        })

        const retried = await Promise.all(
          failed.map((id) => getAdapter(id).updateBroadcast(buildPatch(id, s, renderedTitle)))
        )

        set((prev) => ({
          applying: false,
          results: prev.results.map((r) => retried.find((x) => x.platform === r.platform) ?? r)
        }))
      },

      /**
       * 지금 화면 상태를 그대로 프리셋으로 저장합니다.
       *
       * 주의할 점: 플랫폼별 제목칸은 화면에만 채워지고 draft 에는 저장되지 않습니다.
       * (그래야 손대지 않은 칸 때문에 공통 제목이 무시되는 일이 없습니다.)
       * 그래서 draft 를 그대로 복사하면 "보이는 제목" 이 빠져버립니다.
       *
       * 프리셋은 "이 상태로 되돌아가고 싶다" 는 뜻이므로,
       * 저장할 때는 화면에 보이는 값을 실제로 담아둡니다.
       */
      savePreset: (name, accent) =>
        set((s) => {
          const rendered = renderTitle(s.draft.title, {
            counter: s.counter,
            categoryName: s.draft.canonicalCategoryName
          })

          const titleOverride = { ...s.draft.titleOverride }
          for (const id of activeTargets(s)) {
            if (titleOverride[id] !== undefined) continue

            // 화면에 보이던 값 = 공통 제목, 없으면 그 플랫폼의 현재 제목
            const shown = rendered || s.current[id]?.title || ''

            // 공통 제목과 같은 값은 담지 않습니다 — 중복이고,
            // 공통 제목의 변수({date} 등)가 다시 계산되지 못하게 막습니다.
            if (!shown || shown === rendered) continue
            titleOverride[id] = shown
          }

          return {
            presets: [
              {
                id: uid(),
                name,
                accent,
                draft: { ...structuredClone(s.draft), titleOverride },
                targets: activeTargets(s),
                createdAt: Date.now(),
                usedCount: 0
              },
              ...s.presets
            ]
          }
        }),

      loadPreset: (id) => {
        const preset = get().presets.find((p) => p.id === id)
        if (!preset) return

        set((s) => ({
          draft: structuredClone(preset.draft),
          draftRevision: s.draftRevision + 1,
          enabled: Object.fromEntries(
            PLATFORM_ORDER.map((p) => [p, preset.targets.includes(p)])
          ) as Record<PlatformId, boolean>,
          presets: s.presets.map((p) => (p.id === id ? { ...p, usedCount: p.usedCount + 1 } : p)),
          results: []
        }))

        void get().resolveCategory(preset.draft.canonicalCategoryName)
      },

      applyPreset: async (id) => {
        const preset = get().presets.find((p) => p.id === id)
        if (!preset) return { ok: false, error: '프리셋을 찾지 못했습니다.' }
        if (get().applying) return { ok: false, error: '적용이 아직 끝나지 않았습니다.' }

        get().loadPreset(id)

        /*
         * 프리셋이 켜는 플랫폼 중 실제로 로그인된 곳이 없으면 apply 는 조용히 아무것도
         * 하지 않습니다. 그대로 두면 "적용했습니다" 라고 알리면서 실제로는 아무 데도
         * 안 보낸 상태가 되므로, 여기서 먼저 걸러 사실대로 알립니다.
         */
        if (activeTargets(get()).length === 0) {
          return { ok: false, error: '이 프리셋이 켜는 방송 플랫폼 중 로그인된 곳이 없습니다.' }
        }

        /*
         * loadPreset 이 이미 매칭을 시작했지만 기다려주지는 않습니다.
         * 매칭이 끝나기 전에 적용하면 카테고리가 빠진 채 나가므로 여기서 한 번 더 기다립니다.
         * 같은 검색어라 캐시에 걸려 API 를 다시 부르지는 않습니다.
         */
        await get().resolveCategory(preset.draft.canonicalCategoryName)
        await get().apply()

        const failed = get().results.filter((r) => !r.ok)
        if (failed.length > 0) {
          return { ok: false, error: `${failed.map((r) => r.platform).join(', ')} 적용 실패` }
        }
        return { ok: true }
      },

      deletePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

      deleteHistory: (historyId) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== historyId) })),

      /** 이력의 previous 값을 그대로 다시 전송해 직전 상태로 되돌립니다 */
      revert: async (historyId) => {
        const entry = get().history.find((h) => h.id === historyId)
        if (!entry || entry.revertedAt) return

        set({ applying: true })

        const revertable = entry.results.filter((r) => r.ok && r.previous)
        const results = await Promise.all(
          revertable.map((r) =>
            getAdapter(r.platform).updateBroadcast({
              platform: r.platform,
              title: r.previous?.title,
              categoryId: r.previous?.categoryId,
              categoryName: r.previous?.categoryName,
              gameTitle: r.previous?.gameTitle,
              tags: r.previous?.tags
            })
          )
        )

        set((s) => ({
          applying: false,
          results,
          history: s.history.map((h) => (h.id === historyId ? { ...h, revertedAt: Date.now() } : h))
        }))

        // 되돌린 값이 실제로 반영됐는지 다시 읽어옵니다.
        // 그러지 않으면 화면의 "현재 제목/태그" 가 옛날 값으로 남습니다.
        void get().refreshCurrent()
      },

      /**
       * 입력을 비우고, 지금 방송에 걸려 있는 값을 다시 불러옵니다.
       *
       * 그냥 비우기만 하면 태그칸이 전부 비어 사라질 태그처럼 보입니다.
       * "초기화" 는 "손댄 것을 취소하고 현재 상태로 돌아간다" 는 뜻이므로,
       * 비운 뒤 현재 값을 다시 채워주는 것이 맞습니다.
       */
      resetDraft: () => {
        set((s) => ({
          draft: emptyDraft(),
          draftRevision: s.draftRevision + 1,
          resolved: {},
          pending: {},
          results: []
        }))
        void get().refreshCurrent()
      }
    }),
    {
      name: 'streamkit-plus',
      // 실제 배포 단계에서는 localStorage 대신 메인 프로세스의 SQLite로 옮깁니다.
      // 토큰은 절대 여기에 저장하지 않습니다 (OS 키체인 사용).
      partialize: (s) => ({
        enabled: s.enabled,
        draft: s.draft,
        counter: s.counter,
        mappingCache: s.mappingCache,
        searchCache: s.searchCache,
        presets: s.presets,
        history: s.history
      })
    }
  )
)

/** 통합 입력값 -> 특정 플랫폼용 최종 페이로드 변환 */
/** buildPatch 가 실제로 보는 것만 받습니다 (테스트와 메모이제이션이 쉬워집니다) */
type PatchInputs = Pick<AppState, 'draft' | 'resolved'>

function buildPatch(id: PlatformId, s: PatchInputs, renderedTitle: string): PlatformPatch {
  const caps = PLATFORMS[id].capabilities
  const patch: PlatformPatch = { platform: id }

  const rawTitle = s.draft.titleOverride[id] ?? renderedTitle
  if (caps.title.supported && rawTitle.trim()) {
    patch.title = applyTitlePolicy(id, rawTitle).value
  }

  const cat = s.resolved[id]
  if (caps.category.supported && cat && !cat.skip) {
    patch.categoryId = cat.categoryId
    patch.categoryName = cat.categoryName
    // 치지직/CIME 은 categoryType 을 함께 보내야 카테고리가 반영됩니다.
    if (caps.category.requiresCategoryType && cat.categoryType) {
      patch.categoryType = cat.categoryType
    }
    // 유튜브형 2단 구조에서만 채워집니다.
    if (caps.category.gameTitle && cat.gameTitle) patch.gameTitle = cat.gameTitle
  }

  /*
   * 태그는 "건드린 적이 있을 때만" 보냅니다.
   *
   * 그러지 않으면 사용자가 태그를 전혀 손대지 않아도 빈 배열이 전송되어
   * 그 플랫폼에 걸려 있던 태그가 전부 지워집니다.
   *
   *   extraTags[id] === undefined  아직 불러오지도, 손대지도 않음 -> 보내지 않음
   *   extraTags[id] === []         사용자가 비운 것 -> 빈 배열을 보내 실제로 지움
   */
  const extra = s.draft.extraTags[id]
  const touchedTags = s.draft.tags.length > 0 || extra !== undefined

  if (touchedTags) {
    const tagResult = applyTagPolicy(id, s.draft.tags, extra ?? [])
    if (!tagResult.unsupported) {
      patch.tags = tagResult.accepted
    }
  }

  return patch
}

/**
 * 적용 대상 플랫폼 목록.
 *
 * 매번 새 배열을 만들기 때문에 useShallow 로 감싸야 합니다.
 * 그냥 useAppStore(selector) 로 쓰면 참조가 매번 달라져 무한 렌더에 빠집니다.
 */
export const useActiveTargets = (): PlatformId[] =>
  useAppStore(useShallow((s) => activeTargets(s)))

/** 태그는 순서가 달라도 같은 것으로 봅니다 (플랫폼이 순서를 보장하지 않습니다) */
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b.map((t) => t.toLowerCase()))
  return a.every((t) => setB.has(t.toLowerCase()))
}

export type ChangedField = '제목' | '카테고리' | '태그'

export interface PlatformChange {
  platform: PlatformId
  fields: ChangedField[]
}

/**
 * 지금 적용하면 실제로 바뀌는 것들.
 *
 * "입력칸에 뭔가 있는가" 가 아니라 "현재 값과 다른가" 로 판단합니다.
 * 그래야 고쳤다가 원래대로 되돌렸을 때 적용 버튼이 다시 잠깁니다.
 *
 * 어느 항목이 바뀌는지까지 돌려주는 이유:
 * "1개 플랫폼이 바뀝니다" 만 보여주면, 접혀 있는 영역 때문에
 * 무엇이 바뀌는지 알 수 없어 불안합니다.
 *
 * 현재 값을 못 읽어온 플랫폼(방송이 없거나 조회 실패)은 비교 기준이 없으므로
 * 보낼 값이 있으면 바뀌는 것으로 봅니다.
 */
type ChangeInputs = Pick<
  AppState,
  'draft' | 'resolved' | 'current' | 'enabled' | 'accounts' | 'counter'
>

function changeSummary(s: ChangeInputs): PlatformChange[] {
  const rendered = renderTitle(s.draft.title, {
    counter: s.counter,
    categoryName: s.draft.canonicalCategoryName
  })

  const out: PlatformChange[] = []

  for (const id of activeTargets(s)) {
    const patch = buildPatch(id, s, rendered)
    const now = s.current[id]
    const fields: ChangedField[] = []

    if (patch.title !== undefined && patch.title !== (now?.title ?? '')) fields.push('제목')
    if (patch.categoryId !== undefined && patch.categoryId !== (now?.categoryId ?? '')) {
      fields.push('카테고리')
    }
    if (patch.tags !== undefined && !sameTags(patch.tags, now?.tags ?? [])) fields.push('태그')

    if (fields.length > 0) out.push({ platform: id, fields })
  }

  return out
}

/**
 * 변경 요약을 구독합니다.
 *
 * useShallow 로 감싸면 안 됩니다 — 매번 새 객체 배열을 만들기 때문에
 * 한 겹만 비교하는 useShallow 는 항상 "달라졌다" 로 판정하고,
 * 그 결과 무한 렌더 루프에 빠집니다. (실제로 그렇게 만들었다가 겪었습니다.)
 *
 * 대신 결과에 영향을 주는 조각들만 각각 구독하고, 계산은 useMemo 로 합니다.
 * 각 조각은 store 가 갱신할 때만 참조가 바뀌므로 안정적입니다.
 */
/**
 * 지금 적용을 누르면 각 플랫폼에 실제로 전송될 내용.
 *
 * 화면 경고와 실제 전송이 따로 계산되면 서로 어긋납니다.
 * ("지워짐" 이라고 경고하면서 하단은 "바뀌는 내용 없음" 이라고 하는 상태를 겪었습니다.)
 * 그래서 같은 함수 하나가 만든 결과를 양쪽이 함께 씁니다.
 */
export function usePlannedPatches(): Partial<Record<PlatformId, PlatformPatch>> {
  const draft = useAppStore((s) => s.draft)
  const resolved = useAppStore((s) => s.resolved)
  const enabled = useAppStore((s) => s.enabled)
  const accounts = useAppStore((s) => s.accounts)
  const counter = useAppStore((s) => s.counter)

  return useMemo(() => {
    const rendered = renderTitle(draft.title, {
      counter,
      categoryName: draft.canonicalCategoryName
    })
    const out: Partial<Record<PlatformId, PlatformPatch>> = {}
    for (const id of activeTargets({ enabled, accounts })) {
      out[id] = buildPatch(id, { draft, resolved }, rendered)
    }
    return out
  }, [draft, resolved, enabled, accounts, counter])
}

export function useChangeSummary(): PlatformChange[] {
  const draft = useAppStore((s) => s.draft)
  const resolved = useAppStore((s) => s.resolved)
  const current = useAppStore((s) => s.current)
  const enabled = useAppStore((s) => s.enabled)
  const accounts = useAppStore((s) => s.accounts)
  const counter = useAppStore((s) => s.counter)

  return useMemo(
    () => changeSummary({ draft, resolved, current, enabled, accounts, counter }),
    [draft, resolved, current, enabled, accounts, counter]
  )
}
