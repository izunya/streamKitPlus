import { useState, type KeyboardEvent } from 'react'
import { PLATFORM_ORDER } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore, usePlannedPatches } from '@/store/useAppStore'
import { applyTagPolicy, rejectReasonLabel } from '@/lib/tagPolicy'
import { PlatformIcon } from './PlatformIcon'

/**
 * 요구사항 7번 — 공통 태그 입력칸 하나 + 플랫폼별 추가칸(기본 접힘).
 *
 * 핵심은 "입력하는 순간" 어느 플랫폼에서 잘리는지 보여주는 것입니다.
 * 적용을 눌러본 뒤에야 알게 되면 이미 늦습니다.
 */

export function TagField(): React.JSX.Element {
  const draft = useAppStore((s) => s.draft)
  const setTags = useAppStore((s) => s.setTags)
  const setExtraTags = useAppStore((s) => s.setExtraTags)
  const accounts = useAppStore((s) => s.accounts)
  const enabled = useAppStore((s) => s.enabled)
  const current = useAppStore((s) => s.current)
  const loadingCurrent = useAppStore((s) => s.loadingCurrent)
  const refreshCurrent = useAppStore((s) => s.refreshCurrent)
  const mode = useAppStore((s) => s.mode)
  // 실제로 전송될 내용. 경고가 전송 로직과 어긋나지 않도록 같은 값을 씁니다.
  const planned = usePlannedPatches()

  const [showPerPlatform, setShowPerPlatform] = useState(false)

  type Id = (typeof PLATFORM_ORDER)[number]

  /** 연동되지 않은 플랫폼 — 태그를 보낼 대상이 아예 아닙니다. */
  const isUnlinked = (id: Id): boolean => mode === 'live' && !accounts[id]

  /** 연동은 됐지만 이번 적용에서 제외한 플랫폼. */
  const isExcluded = (id: Id): boolean => Boolean(accounts[id]) && !enabled[id]

  /**
   * 이번 적용에서 태그가 전송되지 않는 플랫폼.
   * 미연동이든 꺼둔 것이든 결과는 같습니다.
   */
  const isInactive = (id: Id): boolean => isUnlinked(id) || isExcluded(id)

  /**
   * 이번에 태그가 실제로 나갈 플랫폼만 보여줍니다.
   *
   * 방송 제목 영역도 같은 규칙을 씁니다. 여기만 5개를 다 보여주면
   * "미연동인 SOOP 에 왜 입력칸이 있지?" 같은 혼란이 생깁니다.
   *
   * 아직 아무것도 연동하지 않았을 때는 화면이 비어버리므로,
   * 그때만 전체 목록을 보여줍니다.
   */
  const active = PLATFORM_ORDER.filter((id) => !isInactive(id))
  const visible = active.length > 0 ? active : PLATFORM_ORDER

  const supported = visible.filter((id) => PLATFORMS[id].capabilities.tags.supported)
  const unsupported = visible.filter((id) => !PLATFORMS[id].capabilities.tags.supported)

  const extraCount = Object.values(draft.extraTags).reduce((n, t) => n + (t?.length ?? 0), 0)

  return (
    <div className="wb-row">
      <header className="mb-2.5 flex items-center justify-between">
        <h2 className="section-bar text-[13px] font-semibold">태그</h2>
        {supported.length > 0 && (
          <button
            type="button"
            className="text-[11px] text-fg-faint transition-colors hover:text-accent-soft"
            onClick={() => setShowPerPlatform((v) => !v)}
          >
            플랫폼별 추가
            {extraCount > 0 && (
              <span className="ml-1 font-semibold text-accent-soft">{extraCount}</span>
            )}
          </button>
        )}
      </header>

      <TagInput
        tags={draft.tags}
        onChange={setTags}
        placeholder="태그를 입력하고 Enter 를 누르세요"
      />

      {/* 플랫폼별 반영 결과 미리보기 — 무엇이 왜 잘리는지 즉시 보여줍니다 */}
      {draft.tags.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {supported.map((id) => {
            const result = applyTagPolicy(id, draft.tags, draft.extraTags[id] ?? [])
            const caps = PLATFORMS[id].capabilities.tags
            const limit = caps.maxCount
              ? `${result.accepted.length}/${caps.maxCount}개`
              : caps.maxTotalLength
                ? `${result.accepted.join(' ').length}/${caps.maxTotalLength}자`
                : `${result.accepted.length}개`

            return (
              <div
                key={id}
                className={[
                  'flex items-start gap-2.5 rounded-xl border border-ink-600 bg-ink-900/50 px-3 py-2',
                  isInactive(id) ? 'opacity-40 grayscale' : ''
                ].join(' ')}
              >
                <PlatformIcon id={id} size={18} />
                <span className="w-14 shrink-0 pt-px text-[11.5px] text-fg-muted">
                  {PLATFORMS[id].name}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1">
                    {result.accepted.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-fg"
                      >
                        {t}
                      </span>
                    ))}
                    {result.rejected.map((r, i) => (
                      <span
                        key={`${r.tag}-${i}`}
                        className="rounded bg-danger/10 px-1.5 py-0.5 text-[11px] text-danger/80 line-through"
                        title={rejectReasonLabel(r.reason)}
                      >
                        {r.tag}
                      </span>
                    ))}
                  </div>

                  {result.rejected.length > 0 && (
                    <p className="mt-1 text-[10.5px] text-warn/90">
                      {[...new Set(result.rejected.map((r) => rejectReasonLabel(r.reason)))].join(
                        ', '
                      )}{' '}
                      때문에 {result.rejected.length}개가 빠졌습니다
                    </p>
                  )}
                </div>

                <span className="shrink-0 pt-px text-[10.5px] text-fg-faint tabular-nums">
                  {limit}
                </span>
              </div>
            )
          })}

          {unsupported.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink-600 px-3 py-2">
              {unsupported.map((id) => (
                <span key={id} className="opacity-40 grayscale">
                  <PlatformIcon id={id} size={16} />
                </span>
              ))}
              <span className="text-[11px] text-fg-faint">
                {unsupported.map((id) => PLATFORMS[id].name).join(', ')} 은 태그 기능이 없어
                건너뜁니다
              </span>
            </div>
          )}
        </div>
      )}

      {/* 플랫폼 전용 추가 태그 */}
      {showPerPlatform && (
        <div className="fade-up mt-3 space-y-2.5 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={loadingCurrent}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg disabled:opacity-50"
              onClick={() => void refreshCurrent()}
            >
              {loadingCurrent && (
                <span className="spin block h-2.5 w-2.5 rounded-full border border-ink-500 border-t-accent-soft" />
              )}
              지금 태그 다시 불러오기
            </button>
          </div>

          {supported.map((id) => {
            /**
             * 지금 그 플랫폼에 실제로 걸려 있는 태그.
             *
             * 입력칸이 비어 있으면 "설정 안 함" 인지 "지우겠다" 인지 구분이 안 됩니다.
             * 실제로는 지우는 동작이므로, 사라질 태그를 눈에 보이게 해둡니다.
             */
            const nowTags = current[id]?.tags ?? []

            /**
             * planned[id].tags 가 undefined 면 태그를 아예 보내지 않습니다.
             * 이때 플랫폼에 걸린 태그는 그대로 남습니다 (회색으로 표시).
             * 배열이면 그 내용으로 덮어쓰므로, 목록에 없는 태그는 사라집니다.
             */
            const plannedTags = planned[id]?.tags
            const sending = plannedTags !== undefined

            const has = (list: string[], t: string): boolean =>
              list.some((x) => x.toLowerCase() === t.toLowerCase())

            /** 보내는 목록에 빠져 있어 사라질 태그 */
            const disappearing = sending ? nowTags.filter((t) => !has(plannedTags, t)) : []

            return (
              <div
                key={id}
                className={['flex items-start gap-2.5', isInactive(id) ? 'opacity-40' : ''].join(
                  ' '
                )}
              >
                <PlatformIcon id={id} size={17} />
                <span className="w-14 shrink-0 pt-1.5 text-[11.5px] text-fg-muted">
                  {PLATFORMS[id].name}
                </span>
                <div className="min-w-0 flex-1">
                  <TagInput
                    compact
                    disabled={isInactive(id)}
                    tags={draft.extraTags[id] ?? []}
                    applied={nowTags}
                    onChange={(t) => setExtraTags(id, t)}
                    placeholder={
                      isUnlinked(id)
                        ? '미연동'
                        : isExcluded(id)
                          ? '이번 적용에서 제외됨'
                          : '이 플랫폼에만 붙일 태그'
                    }
                  />

                  {!isInactive(id) && !sending && nowTags.length > 0 && (
                    /* 태그를 보내지 않으므로 플랫폼에 걸린 값이 그대로 남습니다. */
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="text-[10.5px] text-fg-faint">그대로 남음</span>
                      {nowTags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-ink-800 px-1.5 py-0.5 text-[10.5px] text-fg-faint"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {!isInactive(id) && disappearing.length > 0 && (
                    /* 보내는 목록에 없어서 실제로 사라질 태그 */
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="text-[10.5px] text-danger">사라짐</span>
                      {disappearing.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-danger/10 px-1.5 py-0.5 text-[10.5px] text-danger/80 line-through"
                        >
                          {t}
                        </span>
                      ))}
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-[10.5px] text-accent-soft transition-colors hover:bg-ink-700"
                        onClick={() =>
                          setExtraTags(id, [...(draft.extraTags[id] ?? []), ...disappearing])
                        }
                      >
                        유지하기
                      </button>
                    </div>
                  )}

                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  compact?: boolean
  /** 적용 대상이 아닌 플랫폼은 입력을 막습니다 */
  disabled?: boolean
  /** 이미 그 플랫폼에 걸려 있는 태그 — 새로 추가한 것과 색으로 구분합니다 */
  applied?: string[]
}

function TagInput({
  tags,
  onChange,
  placeholder,
  compact,
  disabled,
  applied
}: TagInputProps): React.JSX.Element {
  const [value, setValue] = useState('')

  const commit = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) return

    const next = [...tags]
    for (const p of parts) {
      if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p)
    }
    onChange(next)
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(value)
    } else if (e.key === 'Backspace' && value === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div
      className={[
        'flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-600 bg-ink-900 transition-colors',
        disabled ? 'cursor-not-allowed opacity-70' : 'focus-within:border-accent/70',
        compact ? 'px-2 py-1.5' : 'px-3 py-2.5'
      ].join(' ')}
    >
      {tags.map((t) => (
        <span
          key={t}
          className={[
            'flex items-center gap-1 rounded-lg py-0.5 pl-2 pr-1 text-[12px]',
            // 이미 적용돼 있는 태그와 이번에 새로 넣는 태그를 구분합니다.
            applied?.some((a) => a.toLowerCase() === t.toLowerCase())
              ? 'bg-ink-700 text-fg-muted'
              : 'bg-accent/20 text-accent-soft'
          ].join(' ')}
        >
          {t}
          {!disabled && (
            <button
              type="button"
              className="rounded px-1 text-fg-faint transition-colors hover:text-danger"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              aria-label={`${t} 삭제`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(value)}
        placeholder={tags.length === 0 ? placeholder : ''}
        className={[
          'min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-fg-faint/60',
          compact ? 'text-[12px]' : 'text-[13.5px]'
        ].join(' ')}
      />
    </div>
  )
}
