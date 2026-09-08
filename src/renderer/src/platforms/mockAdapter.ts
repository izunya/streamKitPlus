import type {
  AuthMethod,
  ConnectedAccount,
  PlatformCategory,
  PlatformId,
  PlatformPatch,
  StreamPlatformAdapter,
  UpdateResult
} from '@shared/types'
import { MOCK_CATEGORIES, PLATFORMS } from './catalog'

/**
 * Mock 어댑터 — 실제 네트워크 호출 없이 UI를 완성하기 위한 구현체입니다.
 *
 * 실제 연동 단계에서는 이 파일을 지우지 말고, 같은 인터페이스를 구현한
 * TwitchAdapter / ChzzkAdapter ... 를 추가한 뒤 registry에서 교체하면 됩니다.
 * Mock은 그대로 두면 오프라인 개발/테스트에 계속 쓸 수 있습니다.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 실패 상황 UI를 확인할 수 있도록 일부러 실패시키는 플랫폼 */
const FAILING_PLATFORMS = new Set<PlatformId>([])

interface MockState {
  account: ConnectedAccount | null
  current: PlatformPatch
}

export function createMockAdapter(id: PlatformId): StreamPlatformAdapter {
  const meta = PLATFORMS[id]

  const state: MockState = {
    account: null,
    current: {
      platform: id,
      title: '',
      categoryId: undefined,
      categoryName: '',
      gameTitle: undefined,
      tags: []
    }
  }

  return {
    meta,

    async connect(method: AuthMethod, credentials): Promise<ConnectedAccount> {
      // 실제 구현: oauth면 메인 프로세스에 IPC로 요청 → 기본 브라우저 열기 →
      // 루프백 서버가 code 수신 → 토큰 교환 → OS 키체인 저장.
      await sleep(400 + Math.random() * 500)

      if (method === 'apiKey' && !credentials?.apiKey?.trim()) {
        throw new Error('API 키가 비어 있습니다.')
      }

      state.account = {
        platform: id,
        displayName: credentials?.channelName?.trim() || `테스트채널_${meta.name}`,
        channelId: `mock-${id}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        connectedAt: Date.now(),
        expiresAt: method === 'oauth' ? Date.now() + 3600_000 : undefined
      }
      return state.account
    },

    async disconnect() {
      await sleep(150)
      state.account = null
    },

    async fetchCurrent() {
      if (!state.account) return null
      await sleep(200)
      return { ...state.current }
    },

    async searchCategory(query: string): Promise<PlatformCategory[]> {
      await sleep(120)
      const catalog = MOCK_CATEGORIES[id]
      if (!query.trim()) return catalog.slice(0, 8)
      return catalog
    },

    async updateBroadcast(patch: PlatformPatch): Promise<UpdateResult> {
      const started = Date.now()
      const previous = { ...state.current }

      await sleep(500 + Math.random() * 900)

      // 어댑터는 절대 throw 하지 않습니다. 실패도 결과 객체로 돌려줍니다.
      if (!state.account) {
        return {
          platform: id,
          ok: false,
          durationMs: Date.now() - started,
          fields: {},
          error: '계정이 연동되어 있지 않습니다.'
        }
      }

      if (FAILING_PLATFORMS.has(id)) {
        return {
          platform: id,
          ok: false,
          durationMs: Date.now() - started,
          fields: {},
          error: 'Mock: 의도된 실패 (재시도 UI 확인용)'
        }
      }

      const fields: UpdateResult['fields'] = {}

      if (patch.title !== undefined) {
        state.current.title = patch.title
        fields.title = { outcome: 'applied', value: patch.title }
      }

      if (patch.categoryId) {
        state.current.categoryId = patch.categoryId
        state.current.categoryName = patch.categoryName
        state.current.gameTitle = patch.gameTitle
        // 유튜브형 2단 구조는 "게임 > VALORANT" 처럼 합쳐서 보여줍니다.
        fields.category = {
          outcome: 'applied',
          value: patch.gameTitle ? `${patch.categoryName} > ${patch.gameTitle}` : patch.categoryName
        }
      }

      if (patch.tags) {
        state.current.tags = patch.tags
        fields.tags = { outcome: 'applied', value: patch.tags.join(', ') }
      }

      return {
        platform: id,
        ok: true,
        durationMs: Date.now() - started,
        fields,
        previous: {
          title: previous.title,
          categoryId: previous.categoryId,
          categoryName: previous.categoryName,
          gameTitle: previous.gameTitle,
          tags: previous.tags
        }
      }
    }
  }
}
