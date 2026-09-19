import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { PLATFORMS } from '@/platforms/catalog'
import { PlatformIcon } from './PlatformIcon'
import { ChatPanel } from './ChatPanel'

const ACCENTS = ['#7c5cff', '#3ddc97', '#ffb347', '#ff5f6d', '#4aa8ff', '#ff7ad9']

export function SidePanel(): React.JSX.Element {
  const [tab, setTab] = useState<'presets' | 'chat' | 'history'>('presets')

  return (
    <aside className="panel flex min-h-0 w-[340px] shrink-0 flex-col rounded-2xl">
      <div className="flex shrink-0 gap-1 border-b border-ink-600 p-2">
        {(
          [
            ['presets', '프리셋'],
            ['chat', '채팅'],
            ['history', '이전 기록']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={[
              'flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              tab === key ? 'bg-ink-700 text-fg' : 'text-fg-faint hover:text-fg'
            ].join(' ')}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 채팅은 자체 스크롤과 입력창을 가지므로 바깥 여백·스크롤을 주지 않습니다 */}
      {tab === 'chat' ? (
        <div className="min-h-0 flex-1">
          <ChatPanel />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === 'presets' ? <PresetList /> : <HistoryList />}
        </div>
      )}
    </aside>
  )
}

/* ------------------------------------------------------------------ */

function PresetList(): React.JSX.Element {
  const presets = useAppStore((s) => s.presets)
  const savePreset = useAppStore((s) => s.savePreset)
  const loadPreset = useAppStore((s) => s.loadPreset)
  const deletePreset = useAppStore((s) => s.deletePreset)
  const draft = useAppStore((s) => s.draft)

  const [name, setName] = useState('')

  const canSave = name.trim() && (draft.title.trim() || draft.canonicalCategoryName.trim())

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-ink-600 bg-ink-900/50 p-2.5">
        <p className="mb-2 text-[11px] text-fg-faint">
          지금 입력한 제목·카테고리·태그·플랫폼 선택을 통째로 저장합니다.
        </p>
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                savePreset(name.trim(), ACCENTS[Math.floor(Math.random() * ACCENTS.length)])
                setName('')
              }
            }}
            placeholder="프리셋 이름을 지어주세요"
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/60"
          />
          <button
            type="button"
            disabled={!canSave}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-30"
            onClick={() => {
              savePreset(name.trim(), ACCENTS[Math.floor(Math.random() * ACCENTS.length)])
              setName('')
            }}
          >
            저장
          </button>
        </div>
      </div>

      {presets.length === 0 ? (
        <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-fg-faint">
          저장된 프리셋이 없습니다.
          <br />
          자주 켜는 방송을 프리셋으로 만들어두면
          <br />
          클릭 한 번으로 5개 플랫폼이 한 번에 바뀝니다.
        </p>
      ) : (
        <div className="space-y-1.5">
          {presets.map((p) => (
            <div
              key={p.id}
              className="group rounded-xl border border-ink-600 bg-ink-900/50 p-2.5 transition-colors hover:border-ink-500"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-7 w-1 shrink-0 rounded-full"
                  style={{ background: p.accent }}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => loadPreset(p.id)}
                >
                  <div className="truncate text-[13px] font-medium">{p.name}</div>

                  {/* 무엇이 저장돼 있는지 보여줍니다.
                      비어 있는 항목은 "그 값은 안 바꾼다" 는 뜻이라 명시해야 합니다. */}
                  <div className="truncate text-[11px] text-fg-muted">
                    {p.draft.title || (
                      <span className="text-fg-faint">제목은 바뀌지 않습니다</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-fg-faint">
                    {p.draft.canonicalCategoryName || '카테고리 없음'}
                    {p.draft.tags.length > 0 && ` · 태그 ${p.draft.tags.length}개`}
                    {Object.keys(p.draft.titleOverride).length > 0 &&
                      ` · 플랫폼별 제목 ${Object.keys(p.draft.titleOverride).length}개`}
                    {p.usedCount > 0 && ` · ${p.usedCount}회 사용`}
                  </div>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-faint opacity-0 transition-all hover:text-danger group-hover:opacity-100"
                  onClick={() => deletePreset(p.id)}
                  aria-label="프리셋 삭제"
                >
                  삭제
                </button>
              </div>
              <div className="mt-1.5 flex gap-1 pl-3">
                {p.targets.map((id) => (
                  <PlatformIcon key={id} id={id} size={14} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HistoryList(): React.JSX.Element {
  const history = useAppStore((s) => s.history)
  const revert = useAppStore((s) => s.revert)
  const deleteHistory = useAppStore((s) => s.deleteHistory)
  const applying = useAppStore((s) => s.applying)

  if (history.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-fg-faint">
        아직 적용된 기록이 없습니다.
        <br />
        적용할 때마다 직전 값이 함께 저장되어
        <br />
        언제든 되돌릴 수 있습니다.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {history.map((h) => {
        const ok = h.results.filter((r) => r.ok).length
        const failed = h.results.length - ok
        const revertable = h.results.some((r) => r.ok && r.previous)

        return (
          <div
            key={h.id}
            className="group rounded-xl border border-ink-600 bg-ink-900/50 p-2.5 transition-colors hover:border-ink-500"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px]">
                  {h.draft.title || '(제목 없음)'}
                </div>
                <div className="mt-0.5 text-[10.5px] text-fg-faint">
                  {new Date(h.at).toLocaleString('ko-KR', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                  {' · '}
                  <span className="text-ok">{ok}</span>
                  {failed > 0 && (
                    <>
                      {' / '}
                      <span className="text-danger">{failed}</span>
                    </>
                  )}
                  {h.revertedAt && <span className="ml-1 text-accent-soft">되돌림</span>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {revertable && !h.revertedAt && (
                  <button
                    type="button"
                    disabled={applying}
                    className="rounded-md border border-ink-600 px-2 py-1 text-[10.5px] text-fg-muted transition-colors hover:border-accent/60 hover:text-accent-soft disabled:opacity-40"
                    onClick={() => void revert(h.id)}
                  >
                    되돌리기
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md px-1.5 py-1 text-[10.5px] text-fg-faint opacity-0 transition-all hover:text-danger group-hover:opacity-100"
                  onClick={() => deleteHistory(h.id)}
                  aria-label="기록 삭제"
                  title="기록만 지웁니다. 방송 정보는 그대로 남습니다"
                >
                  삭제
                </button>
              </div>
            </div>

            <div className="mt-1.5 flex gap-1">
              {h.results.map((r) => (
                <span
                  key={r.platform}
                  className={r.ok ? '' : 'opacity-35 grayscale'}
                  title={`${PLATFORMS[r.platform].name} ${r.ok ? '성공' : `실패: ${r.error ?? ''}`}`}
                >
                  <PlatformIcon id={r.platform} size={14} />
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
