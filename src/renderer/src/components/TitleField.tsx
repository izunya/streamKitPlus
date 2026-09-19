import { useMemo, useState } from 'react'
import { PLATFORM_ORDER } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore, useActiveTargets } from '@/store/useAppStore'
import { renderTitle, unknownVariables, VARIABLES } from '@/lib/variables'
import { PlatformIcon } from './PlatformIcon'

export function TitleField(): React.JSX.Element {
  const draft = useAppStore((s) => s.draft)
  const counter = useAppStore((s) => s.counter)
  const setTitle = useAppStore((s) => s.setTitle)
  const setTitleOverride = useAppStore((s) => s.setTitleOverride)
  const targets = useActiveTargets()
  const current = useAppStore((s) => s.current)
  const loadingCurrent = useAppStore((s) => s.loadingCurrent)
  const refreshCurrent = useAppStore((s) => s.refreshCurrent)
  const titleHint = useAppStore((s) => s.titleHint)

  const [showVars, setShowVars] = useState(false)
  // 기본은 접어둡니다. 대부분은 공통 제목 하나로 끝나고,
  // 따로 손볼 때만 펼치면 화면이 짧아집니다.
  const [showOverrides, setShowOverrides] = useState(false)

  const preview = useMemo(
    () =>
      renderTitle(draft.title, {
        counter,
        categoryName: draft.canonicalCategoryName
      }),
    [draft.title, draft.canonicalCategoryName, counter]
  )

  const unknown = useMemo(() => unknownVariables(draft.title), [draft.title])
  const hasVariables = preview !== draft.title
  const overrideCount = PLATFORM_ORDER.filter(
    (id) => draft.titleOverride[id] !== undefined && draft.titleOverride[id] !== (preview || current[id]?.title || '')
  ).length

  /**
   * 그 플랫폼에 실제로 들어갈 제목.
   *
   *   1. 직접 고친 값이 있으면 그것
   *   2. 없으면 공통 제목
   *   3. 공통 제목도 비어 있으면 지금 걸려 있는 제목 (= 바뀌지 않음)
   *
   * 화면에는 이 값을 그대로 보여줍니다. 입력칸이 늘 채워져 있어야
   * "적용하면 뭐가 될지" 를 읽을 수 있습니다.
   *
   * 다만 이 값을 draft 에 미리 저장하지는 않습니다.
   * titleOverride 가 채워져 있으면 공통 제목이 무시되기 때문에,
   * 손대지도 않은 플랫폼 때문에 공통 제목이 안 먹는 일이 생깁니다.
   * 그래서 "보여주기" 와 "저장" 을 분리했습니다 — 고쳐야 저장됩니다.
   */
  /** 오버라이드가 없을 때 그 칸에 들어갈 값 */
  const baseTitle = (id: (typeof PLATFORM_ORDER)[number]): string =>
    preview || current[id]?.title || ''

  const effectiveTitle = (id: (typeof PLATFORM_ORDER)[number]): string =>
    draft.titleOverride[id] ?? baseTitle(id)

  /**
   * "따로 지정한 상태" 인지.
   *
   * 저장된 값이 있어도 기준값과 같으면 수정한 것이 아닙니다.
   * 값이 같은데 "수정함" 표시만 남으면 사용자가 자기가 뭘 고쳤는지 오해합니다.
   */
  const isOverridden = (id: (typeof PLATFORM_ORDER)[number]): boolean => {
    const v = draft.titleOverride[id]
    return v !== undefined && v !== baseTitle(id)
  }

  // 어떤 플랫폼에서 제목이 잘리는지 미리 계산합니다.
  // maxLength 가 없는 플랫폼(문서에 제한이 없는 곳)은 자르지 않으므로 대상에서 뺍니다.
  const overflow = PLATFORM_ORDER.filter((id) => {
    const max = PLATFORMS[id].capabilities.title.maxLength
    if (max === undefined) return false
    return effectiveTitle(id).length > max
  })

  return (
    <div className="wb-row">
      <header className="mb-2.5 flex items-center justify-between">
        <h2 className="section-bar text-[13px] font-semibold">방송 제목</h2>
        <div className="flex items-center gap-3 text-[11px]">
          <button
            type="button"
            className="text-fg-faint transition-colors hover:text-accent-soft"
            onClick={() => setShowVars((v) => !v)}
          >
            {'{ } 변수'}
          </button>
          <button
            type="button"
            className="text-fg-faint transition-colors hover:text-accent-soft"
            onClick={() => setShowOverrides((v) => !v)}
          >
            플랫폼별 제목
            {overrideCount > 0 && (
              <span className="ml-1 font-semibold text-accent-soft">{overrideCount}</span>
            )}
          </button>
        </div>
      </header>

      <input
        value={draft.title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={
          // 실제 쓰고 있는 제목을 예시로 보여줍니다.
          // 아직 못 읽어왔거나 연동 전이면 기본 예시를 씁니다.
          titleHint ? `예) ${titleHint}` : '예) [{date}] 발로란트 {n}일차 — 오늘은 랭크 갑니다'
        }
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 py-3 text-[15px] outline-none transition-colors placeholder:text-fg-faint/60 focus:border-accent/70"
      />

      {/* 변수 치환 결과 미리보기 */}
      {hasVariables && (
        <div className="fade-up mt-2.5 flex items-start gap-2 rounded-lg bg-ink-900/70 px-3 py-2">
          <span className="mt-px shrink-0 text-[10px] font-semibold text-accent-soft">
            미리보기
          </span>
          <span className="text-[13px] leading-snug">{preview}</span>
        </div>
      )}

      {unknown.length > 0 && (
        <p className="mt-2 text-[11px] text-warn">
          모르는 변수예요: {unknown.join(', ')} — 글자 그대로 들어갑니다.
        </p>
      )}

      {overflow.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-warn">
          <span>너무 길어서 잘립니다:</span>
          {overflow.map((id) => (
            <span key={id} className="rounded bg-warn/15 px-1.5 py-0.5">
              {PLATFORMS[id].name} {PLATFORMS[id].capabilities.title.maxLength}자
            </span>
          ))}
        </p>
      )}

      {/* 변수 도움말 */}
      {showVars && (
        <div className="fade-up mt-3 grid grid-cols-2 gap-1.5 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
          {VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-700"
              onClick={() => setTitle(draft.title + v.token)}
            >
              <code className="text-[12px] font-semibold text-accent-soft">{v.token}</code>
              <span className="text-[11px] text-fg-muted">{v.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 플랫폼별 제목 덮어쓰기 */}
      {showOverrides && (
        <div className="fade-up mt-3 space-y-2 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={loadingCurrent}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg disabled:opacity-50"
              onClick={() => void refreshCurrent()}
            >
              {loadingCurrent && (
                <span className="spin block h-2.5 w-2.5 rounded-full border border-ink-500 border-t-accent-soft" />
              )}
              지금 제목 다시 불러오기
            </button>
          </div>
          {(targets.length > 0 ? targets : PLATFORM_ORDER).map((id) => (
            <label key={id} className="flex items-center gap-2.5">
              <PlatformIcon id={id} size={17} />
              <span className="w-14 shrink-0 text-[11.5px] text-fg-muted">
                {PLATFORMS[id].name}
              </span>
              <input
                value={effectiveTitle(id)}
                onChange={(e) => {
                  const v = e.target.value
                  // 고쳤다가 원래 값으로 되돌아오면 오버라이드를 해제합니다.
                  // 그러지 않으면 내용은 같은데 "수정함" 표시만 남습니다.
                  setTitleOverride(id, v === baseTitle(id) ? undefined : v)
                }}
                placeholder="제목 없음"
                className={[
                  'min-w-0 flex-1 rounded-lg border bg-ink-900 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-fg-faint/50 focus:border-accent/60',
                  // 직접 고친 칸은 테두리로 구분해, 어디를 손댔는지 한눈에 보이게 합니다.
                  isOverridden(id) ? 'border-accent/50' : 'border-ink-600'
                ].join(' ')}
              />
              {isOverridden(id) && (
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[10.5px] text-fg-faint transition-colors hover:text-danger"
                  onClick={() => setTitleOverride(id, undefined)}
                  title="공통 제목으로 되돌리기"
                >
                  되돌리기
                </button>
              )}
              <span className="w-12 shrink-0 text-right text-[10.5px] text-fg-faint tabular-nums">
                {effectiveTitle(id).length}
                {PLATFORMS[id].capabilities.title.maxLength !== undefined &&
                  `/${PLATFORMS[id].capabilities.title.maxLength}`}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
