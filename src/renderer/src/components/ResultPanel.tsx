import type { FieldOutcome, FieldResult, UpdateResult } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from '@/store/useAppStore'
import { PlatformIcon } from './PlatformIcon'

/**
 * 적용 결과 리포트.
 *
 * 5개 중 4개 성공 / 1개 실패가 실제로 가장 흔한 상황입니다.
 * "어디가, 왜 실패했는지"와 "실패한 것만 재시도"가 이 패널의 존재 이유입니다.
 */

const OUTCOME: Record<FieldOutcome, { label: string; className: string }> = {
  applied: { label: '적용', className: 'text-ok' },
  trimmed: { label: '일부만', className: 'text-warn' },
  skipped: { label: '안 바꿈', className: 'text-fg-faint' },
  unsupported: { label: '기능 없음', className: 'text-fg-faint' },
  unmapped: { label: '비활성화', className: 'text-warn' },
  failed: { label: '실패', className: 'text-danger' }
}

export function ResultPanel(): React.JSX.Element | null {
  const results = useAppStore((s) => s.results)
  const applying = useAppStore((s) => s.applying)
  const retryFailed = useAppStore((s) => s.retryFailed)

  if (results.length === 0) return null

  const ok = results.filter((r) => r.ok).length
  const failed = results.length - ok

  return (
    <section className="panel fade-up shrink-0 rounded-2xl p-4">
      <header className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">
          적용 결과
          <span className="ml-2 text-[11px] font-normal text-fg-faint">
            <span className="text-ok">{ok}곳 성공</span>
            {failed > 0 && <span className="ml-1.5 text-danger">{failed}곳 실패</span>}
          </span>
        </h2>
        {failed > 0 && (
          <button
            type="button"
            disabled={applying}
            className="rounded-lg border border-danger/50 px-2.5 py-1 text-[11.5px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            onClick={() => void retryFailed()}
          >
            실패한 {failed}곳만 다시
          </button>
        )}
      </header>

      <div className="space-y-1.5">
        {results.map((r) => (
          <ResultRow key={r.platform} result={r} />
        ))}
      </div>
    </section>
  )
}

function ResultRow({ result }: { result: UpdateResult }): React.JSX.Element {
  const meta = PLATFORMS[result.platform]

  const notes = [result.fields.title, result.fields.category, result.fields.tags]
    .map((f) => f?.message)
    .filter((m): m is string => Boolean(m))

  return (
    <div
      className={[
        'rounded-xl border px-3 py-2',
        result.ok ? 'border-ink-600 bg-ink-900/50' : 'border-danger/40 bg-danger/5'
      ].join(' ')}
    >
      <div className="flex items-center gap-2.5">
        <PlatformIcon id={result.platform} size={18} />
        <span className="w-14 shrink-0 text-[11.5px] text-fg-muted">{meta.name}</span>

        {result.ok ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <FieldChip name="제목" field={result.fields.title} />
            <FieldChip name="카테고리" field={result.fields.category} />
            <FieldChip name="태그" field={result.fields.tags} />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] text-danger/90">
            {result.error ?? '알 수 없는 오류'}
          </span>
        )}

        <span className="shrink-0 text-[10.5px] text-fg-faint tabular-nums">
          {result.durationMs}ms
        </span>
      </div>

      {/*
        사유를 접어두지 않고 그대로 보여줍니다.
        "일부만 적용" 이라고만 뜨고 왜인지 안 적히면, 사용자는 무엇을 더 해야
        하는지 알 수 없습니다. 실제로 유튜브 게임 제목이 그 상태였습니다.
      */}
      {notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-[26px]">
          {notes.map((n) => (
            <li key={n} className="text-[11px] leading-relaxed text-warn/90">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FieldChip({
  name,
  field
}: {
  name: string
  field?: FieldResult
}): React.JSX.Element | null {
  if (!field) return null
  const o = OUTCOME[field.outcome]

  return (
    <span className="flex min-w-0 items-baseline gap-1 text-[11.5px]">
      <span className="text-fg-faint">{name}</span>
      <span className={o.className}>{o.label}</span>
      {field.value && <span className="min-w-0 truncate text-fg-muted">· {field.value}</span>}
    </span>
  )
}
