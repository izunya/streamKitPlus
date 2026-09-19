import { useEffect, useRef, useState } from 'react'
import type { PlatformCategory, PlatformId } from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from '@/store/useAppStore'
import { matchCategory } from '@/lib/categoryMatch'
import { PlatformIcon } from './PlatformIcon'

/**
 * 요구사항 6번 — 플랫폼마다 다른 카테고리 체계를 하나로 묶는 화면.
 *
 * 사용자는 "발로란트" 한 번만 입력합니다.
 * 화면은 각 플랫폼에서 무엇으로 매핑됐는지, 애매한 건 무엇인지,
 * 못 찾은 건 무엇인지를 한눈에 보여줍니다.
 */

const SOURCE_LABEL: Record<string, { text: string; className: string }> = {
  exact: { text: '딱 맞음', className: 'text-ok' },
  high: { text: '자동으로 찾음', className: 'text-ok/80' },
  manual: { text: '직접 고름', className: 'text-accent-soft' },
  cache: { text: '전에 고른 대로', className: 'text-accent-soft' },
  twoStep: { text: '게임 자동 지정', className: 'text-ok/80' }
}

export function CategoryField(): React.JSX.Element {
  const draft = useAppStore((s) => s.draft)
  const resolved = useAppStore((s) => s.resolved)
  const pending = useAppStore((s) => s.pending)
  const resolveCategory = useAppStore((s) => s.resolveCategory)
  const pickCategory = useAppStore((s) => s.pickCategory)
  const clearCategory = useAppStore((s) => s.clearCategory)

  const catalogs = useAppStore((s) => s.catalogs)
  const catalogErrors = useAppStore((s) => s.catalogErrors)
  const resolving = useAppStore((s) => s.resolving)
  const accounts = useAppStore((s) => s.accounts)
  const enabled = useAppStore((s) => s.enabled)
  const mode = useAppStore((s) => s.mode)
  const current = useAppStore((s) => s.current)
  const loadingCurrent = useAppStore((s) => s.loadingCurrent)
  const refreshCurrent = useAppStore((s) => s.refreshCurrent)
  const categoryHint = useAppStore((s) => s.categoryHint)

  const draftRevision = useAppStore((s) => s.draftRevision)

  const [query, setQuery] = useState(draft.canonicalCategoryName)
  const [expanded, setExpanded] = useState<PlatformId | null>(null)

  /*
   * 프리셋을 불러오거나 초기화하면 draft 가 통째로 바뀝니다.
   * 이 입력칸은 로컬 상태라 그 사실을 모르기 때문에, 예전 검색어가 그대로 남아
   * "입력칸은 Beat Saber 인데 매핑은 Tarkov" 같은 어긋난 화면이 됩니다.
   *
   * 타이핑 중에 동기화하면 입력이 되돌려지므로,
   * 통째로 갈아끼운 순간(draftRevision)에만 다시 읽습니다.
   */
  useEffect(() => {
    setQuery(useAppStore.getState().draft.canonicalCategoryName)
    setExpanded(null)
  }, [draftRevision])

  // 입력이 멈춘 뒤에 검색합니다. 실제 모드에서는 플랫폼 API 를 5개 동시에 치므로
  // 타이핑 중에 계속 나가지 않도록 조금 넉넉히 기다립니다.
  useEffect(() => {
    const t = setTimeout(() => void resolveCategory(query), 350)
    return () => clearTimeout(t)
  }, [query, resolveCategory])

  const supported = PLATFORM_ORDER.filter((id) => PLATFORMS[id].capabilities.category.supported)

  /**
   * 실제 연동 모드에서 연동되지 않은 플랫폼은 카테고리 검색 자체가 불가능합니다.
   * 이걸 "찾지 못함"으로 표시하면 원인을 완전히 오해하게 됩니다 —
   * 매칭이 실패한 게 아니라 아직 로그인하지 않은 것입니다.
   */
  const isUnlinked = (id: PlatformId): boolean => mode === 'live' && !accounts[id]

  /**
   * 연동은 돼 있지만 이번 적용에서 제외한 플랫폼.
   *
   * 껐는데도 "비활성화" 경고를 내면, 적용되지도 않을 플랫폼 때문에
   * 사용자가 문제를 고치려 들게 됩니다. 조용히 비켜서 있어야 합니다.
   */
  const isExcluded = (id: PlatformId): boolean => Boolean(accounts[id]) && !enabled[id]

  // 경고 집계에서는 제외된 플랫폼을 빼야 합니다.
  const counted = supported.filter((id) => !isExcluded(id))
  const unmapped = counted.filter((id) => !resolved[id] && !pending[id] && !isUnlinked(id))
  const pendingIds = counted.filter((id) => pending[id])
  const unlinked = counted.filter(isUnlinked)

  return (
    <div className="wb-row">
      <header className="mb-2.5 flex items-center justify-between">
        <h2 className="section-bar text-[13px] font-semibold">카테고리</h2>
        <div className="flex items-center gap-3 text-[11px] text-fg-faint">
          {resolving && (
            <span className="spin block h-3 w-3 rounded-full border-[1.5px] border-ink-500 border-t-accent-soft" />
          )}
          <button
            type="button"
            disabled={loadingCurrent}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-ink-700 hover:text-fg disabled:opacity-50"
            onClick={() => void refreshCurrent()}
          >
            {loadingCurrent && (
              <span className="spin block h-2.5 w-2.5 rounded-full border border-ink-500 border-t-accent-soft" />
            )}
            현재 카테고리 다시 불러오기
          </button>
        </div>
      </header>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          // 실제 쓰고 있는 카테고리를 예시로 보여줍니다.
          categoryHint ? `예) ${categoryHint}` : '예) 발로란트 / 리그 오브 레전드 / 토크'
        }
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 py-3 text-[15px] outline-none transition-colors placeholder:text-fg-faint/60 focus:border-accent/70"
      />

      {/*
        * 검색어를 입력하기 전에도 각 플랫폼에 지금 걸려 있는 카테고리를 보여줍니다.
        * 제목·태그와 마찬가지로, 바꾸기 전에 현재 상태를 알 수 있어야 합니다.
        */}
      {!query.trim() && (
        <div className="mt-3 space-y-1.5">
          {supported
            .filter((id) => !isExcluded(id) && !isUnlinked(id))
            .map((id) => {
              const now = current[id]
              // 검색어 없이도 이 플랫폼만 따로 바꿀 수 있어야 합니다.
              // 확정해 둔 값이 있으면 그것을, 없으면 현재 값을 보여줍니다.
              const picked = resolved[id]
              const isOpen = expanded === id

              return (
                <div
                  key={id}
                  className={[
                    'rounded-xl border px-3 py-2',
                    picked && !picked.skip
                      ? 'border-accent/40 bg-ink-900/50'
                      : 'border-ink-600 bg-ink-900/50'
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2.5">
                    <PlatformIcon id={id} size={18} />
                    <span className="w-14 shrink-0 text-[11.5px] text-fg-muted">
                      {PLATFORMS[id].name}
                    </span>

                    {picked?.skip ? (
                      <span className="min-w-0 flex-1 text-[12px] text-fg-faint">
                        카테고리를 바꾸지 않습니다
                      </span>
                    ) : picked ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {picked.categoryName}
                          {picked.gameTitle && (
                            <>
                              <span className="mx-1 text-fg-faint">›</span>
                              <span className="text-accent-soft">{picked.gameTitle}</span>
                            </>
                          )}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-accent-soft">변경 예정</span>
                      </>
                    ) : now?.categoryName ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {now.categoryName}
                          {now.gameTitle && (
                            <>
                              <span className="mx-1 text-fg-faint">›</span>
                              <span className="text-accent-soft">{now.gameTitle}</span>
                            </>
                          )}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-fg-faint">현재</span>
                      </>
                    ) : (
                      <span className="min-w-0 flex-1 text-[12px] text-fg-faint">
                        설정된 카테고리 없음
                      </span>
                    )}

                    <button
                      type="button"
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
                      onClick={() => setExpanded(isOpen ? null : id)}
                    >
                      {isOpen ? '접기' : '변경'}
                    </button>
                  </div>

                  {isOpen && (
                    <CategoryChooser
                      platform={id}
                      catalog={catalogs[id] ?? []}
                      query=""
                      initialTerm={picked?.categoryName || now?.categoryName || ''}
                      onPick={(c, gameTitle) => {
                        pickCategory(id, c, gameTitle)
                        setExpanded(null)
                      }}
                      onClear={() => {
                        clearCategory(id)
                        setExpanded(null)
                      }}
                    />
                  )}
                </div>
              )
            })}
        </div>
      )}

      {query.trim() && (
        <div className="mt-3 space-y-1.5">
          {supported.map((id) => {
            const hit = resolved[id]
            const wait = pending[id]
            const searchError = catalogErrors[id]
            const unlinkedHere = isUnlinked(id)
            const excluded = isExcluded(id)
            const isOpen = expanded === id
            const badge = hit && !hit.skip ? SOURCE_LABEL[hit.source] : null

            return (
              <div
                key={id}
                className={[
                  'rounded-xl border px-3 py-2 transition-colors',
                  excluded
                    ? 'border-ink-600/60 opacity-40 grayscale'
                    : hit?.skip
                      ? 'border-ink-600 opacity-60'
                      : hit
                    ? 'border-ink-600 bg-ink-900/50'
                    : wait
                      ? 'border-warn/40 bg-warn/5'
                      : unlinkedHere
                        ? 'border-dashed border-ink-600'
                        : searchError
                          ? 'border-danger/50 bg-danger/10'
                          : 'border-danger/30 bg-danger/5'
                ].join(' ')}
              >
                <div className="flex items-center gap-2.5">
                  <PlatformIcon id={id} size={18} />
                  <span className="w-14 shrink-0 text-[11.5px] text-fg-muted">
                    {PLATFORMS[id].name}
                  </span>

                  {excluded ? (
                    <span className="min-w-0 flex-1 text-[12px] text-fg-faint">
                      이번 적용에서 제외됨
                    </span>
                  ) : hit?.skip ? (
                    <>
                      <span className="min-w-0 flex-1 text-[12px] text-fg-faint">
                        카테고리를 바꾸지 않습니다
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
                        onClick={() => setExpanded(isOpen ? null : id)}
                      >
                        다시 고르기
                      </button>
                    </>
                  ) : hit ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {hit.categoryName}
                        {hit.gameTitle && (
                          <>
                            <span className="mx-1 text-fg-faint">›</span>
                            <span className="text-accent-soft">{hit.gameTitle}</span>
                          </>
                        )}
                      </span>
                      {badge && (
                        <span className={`shrink-0 text-[10.5px] ${badge.className}`}>
                          {badge.text}
                        </span>
                      )}
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
                        onClick={() => setExpanded(isOpen ? null : id)}
                      >
                        변경
                      </button>
                    </>
                  ) : wait ? (
                    <>
                      <span className="min-w-0 flex-1 text-[12px] text-warn">
                        비슷한 게 {wait.candidates.length}개 있어요 — 하나만 골라주세요
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-warn transition-colors hover:bg-warn/15"
                        onClick={() => setExpanded(isOpen ? null : id)}
                      >
                        {isOpen ? '접기' : '선택'}
                      </button>
                    </>
                  ) : unlinkedHere ? (
                    <span className="min-w-0 flex-1 text-[12px] text-fg-faint">
                      미연동
                    </span>
                  ) : searchError ? (
                    <>
                      <span
                        className="min-w-0 flex-1 truncate text-[12px] text-danger"
                        title={searchError}
                      >
                        불러오지 못했습니다 — {searchError}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
                        onClick={() => setExpanded(isOpen ? null : id)}
                      >
                        찾아보기
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-[12px] text-danger/90">
                        없는 카테고리예요 — 이 플랫폼은 그대로 둡니다
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
                        onClick={() => setExpanded(isOpen ? null : id)}
                      >
                        찾아보기
                      </button>
                    </>
                  )}
                </div>

                {/*
                  * 지금 걸려 있는 카테고리를 함께 보여줍니다.
                  * 바뀔 값만 보이면 "이게 지금이랑 같은 건가?" 를 알 수 없습니다.
                  * 값이 같으면 굳이 표시하지 않습니다.
                  */}
                {!excluded &&
                  !hit?.skip &&
                  current[id]?.categoryName &&
                  current[id]?.categoryName !== hit?.categoryName && (
                    <p className="mt-1 pl-[46px] text-[10.5px] text-fg-faint">
                      현재: {current[id]?.categoryName}
                      {current[id]?.gameTitle ? ` › ${current[id]?.gameTitle}` : ''}
                    </p>
                  )}

                {isOpen && !excluded && (
                  <CategoryChooser
                    platform={id}
                    catalog={catalogs[id] ?? []}
                    query={query}
                    /* 이미 확정된 값이 있으면 그 이름으로 시작합니다.
                       빈 칸으로 열면 고를 것이 없어 창을 연 의미가 없습니다. */
                    initialTerm={query.trim() || hit?.categoryName || ''}
                    onPick={(c, gameTitle) => {
                      pickCategory(id, c, gameTitle)
                      setExpanded(null)
                    }}
                    onClear={() => {
                      clearCategory(id)
                      setExpanded(null)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {query.trim() && (pendingIds.length > 0 || unmapped.length > 0 || unlinked.length > 0) && (
        <p className="mt-3 rounded-lg bg-ink-900/60 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
          {[
            unlinked.length > 0 && (
              <span key="u" className="text-fg-faint">
                연동 안 함 {unlinked.length}개
              </span>
            ),
            pendingIds.length > 0 && (
              <span key="p" className="text-warn">
                골라야 함 {pendingIds.length}개
              </span>
            ),
            unmapped.length > 0 && (
              <span key="m" className="text-danger/90">
                비활성화 {unmapped.length}개
              </span>
            )
          ]
            .filter(Boolean)
            .map((node, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {node}
              </span>
            ))}
          {/* 전부 미연동일 때만 무엇을 해야 하는지 알려줍니다.
              그 외에는 위의 개수 요약만으로 충분합니다. */}
          {unlinked.length === supported.length && (
            <>
              <br />
              위쪽 아이콘을 눌러 로그인하면 카테고리를 찾아줍니다.
            </>
          )}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface ChooserProps {
  platform: PlatformId
  /** 마지막 검색에서 이 플랫폼이 돌려준 카테고리 목록 */
  catalog: PlatformCategory[]
  query: string
  /** 검색창에 처음 채워둘 단어 */
  initialTerm: string
  onPick: (c: PlatformCategory, gameTitle?: string) => void
  onClear: () => void
}

function CategoryChooser({
  platform,
  catalog,
  query,
  initialTerm,
  onPick,
  onClear
}: ChooserProps): React.JSX.Element {
  const searchOn = useAppStore((s) => s.searchOn)

  const [term, setTerm] = useState(initialTerm)

  /**
   * 창을 열 때 미리 채워둔 단어.
   *
   * 이 값 그대로면 검색하지 않습니다. 이미 알고 있는 카테고리를
   * 다시 물어보는 것이라 결과도 뻔하고 호출만 낭비됩니다.
   * 사용자가 실제로 다른 단어를 쳤을 때만 검색합니다.
   */
  const initialRef = useRef(initialTerm)
  const [picked, setPicked] = useState<PlatformCategory | null>(null)
  const [gameTitle, setGameTitle] = useState(query)
  const [results, setResults] = useState<PlatformCategory[] | null>(null)
  const [searching, setSearching] = useState(false)

  const caps = PLATFORMS[platform].capabilities.category

  /** 열었을 때 미리 채워둔 단어 그대로인지 (그러면 검색하지 않습니다) */
  const untouched = term.trim() === initialRef.current.trim()

  /**
   * 입력한 단어로 그 플랫폼에 실제로 검색을 겁니다.
   *
   * 예전에는 이미 받아둔 목록을 거르기만 해서, 처음 검색어와 다른 단어를 치면
   * 아무것도 안 나왔습니다. 화면상 검색창인데 검색이 아니었습니다.
   */
  useEffect(() => {
    // 처음 검색어 그대로이고 받아둔 목록도 있으면 그걸 씁니다 (불필요한 호출 방지).
    // 다만 매핑이 캐시된 플랫폼은 검색을 건너뛰어 목록이 비어 있으므로,
    // 그때는 여기서 한 번 검색해야 고를 것이 생깁니다.
    const useCatalog = term.trim() === query.trim() && catalog.length > 0

    if (useCatalog || untouched || !term.trim()) {
      setResults(null)
      // 검색하지 않기로 했으면 스피너도 꺼야 합니다.
      // 이걸 빠뜨리면 검색 중에 입력칸을 비웠을 때 스피너가 영영 돕니다.
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)

    const t = setTimeout(() => {
      void searchOn(platform, term)
        .then((r) => {
          if (cancelled) return
          setResults(r)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [term, query, platform, searchOn, catalog.length, untouched])

  const source = results ?? catalog
  const matches = matchCategory(term, source, 8)
  const list = matches.length > 0 ? matches.map((m) => m.category) : source

  /** 유튜브형: '게임' 대분류를 고르면 게임 제목 입력칸이 한 단계 더 나옵니다. */
  const needsGameTitle = (c: PlatformCategory): boolean =>
    Boolean(caps.gameTitle) && c.id === caps.gameTitle?.underCategoryId

  const choose = (c: PlatformCategory): void => {
    if (needsGameTitle(c)) setPicked(c)
    else onPick(c)
  }

  if (picked) {
    return (
      <div className="fade-up mt-2 border-t border-ink-600 pt-2">
        <p className="mb-2 text-[11px] text-fg-muted">
          <span className="font-medium text-fg">{picked.name}</span> 안에 표시할 게임 이름을
          적어주세요.
        </p>
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={gameTitle}
            onChange={(e) => setGameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPick(picked, gameTitle)
            }}
            placeholder="게임 이름을 적어주세요"
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/60"
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
            onClick={() => onPick(picked, gameTitle)}
          >
            확정
          </button>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] text-fg-faint hover:text-fg"
            onClick={() => setPicked(null)}
          >
            뒤로
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up mt-2 border-t border-ink-600 pt-2">
      <div className="relative mb-2">
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          // 미리 채운 단어를 전체 선택해 둡니다. 바로 타이핑하면 대체됩니다.
          onFocus={(e) => e.currentTarget.select()}
          placeholder={`${PLATFORMS[platform].name}에서 검색`}
          className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 pr-7 text-[12.5px] outline-none focus:border-accent/60"
        />
        {searching && (
          <span className="spin absolute right-2.5 top-1/2 block h-3 w-3 -translate-y-1/2 rounded-full border-[1.5px] border-ink-500 border-t-accent-soft" />
        )}
      </div>

      {!searching && (
        <p className="mb-2 text-[11px] text-fg-faint">
          {!term.trim()
            ? '찾을 카테고리 이름을 입력하세요.'
            : untouched
              ? '다른 이름을 입력하면 검색합니다.'
              : list.length === 0
                ? `"${term}" 에 해당하는 카테고리를 찾지 못했습니다.`
                : `"${term}" 검색 결과`}
        </p>
      )}

      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            className="rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-[12px] transition-colors hover:border-accent/60 hover:bg-ink-700"
            onClick={() => choose(c)}
          >
            {c.name}
            {needsGameTitle(c) && <span className="ml-1 text-fg-faint">›</span>}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mt-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-fg-faint transition-colors hover:text-danger"
        onClick={onClear}
      >
        이 플랫폼은 변경 안 함
      </button>
    </div>
  )
}
