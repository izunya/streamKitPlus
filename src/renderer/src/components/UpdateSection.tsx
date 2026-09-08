import { useEffect, useState } from 'react'
import { useUpdateStore } from '@/store/useUpdateStore'

/**
 * 설정 안의 업데이트 영역.
 *
 * 현재 버전을 보여주고, 직접 새 버전을 확인할 수 있습니다.
 * 배너는 좋은 소식일 때만 뜨므로, "최신입니다"·실패 사유는 여기서 봅니다.
 */
export function UpdateSection(): React.JSX.Element {
  const state = useUpdateStore((s) => s.state)
  const check = useUpdateStore((s) => s.check)
  const install = useUpdateStore((s) => s.install)
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (typeof window.skp !== 'undefined') void window.skp.update.version().then(setVersion)
  }, [])

  const busy = state.status === 'checking' || state.status === 'downloading'

  const label = ((): string => {
    switch (state.status) {
      case 'checking':
        return '확인하는 중...'
      case 'available':
        return `새 버전 ${state.version ?? ''} 을 받고 있습니다`
      case 'downloading':
        return `내려받는 중 ${state.percent ?? 0}%`
      case 'downloaded':
        return `새 버전 ${state.version ?? ''} 준비 완료`
      case 'not-available':
        return '최신 버전입니다.'
      case 'error':
        return state.error ?? '업데이트를 확인하지 못했습니다.'
      default:
        return ''
    }
  })()

  const labelColor =
    state.status === 'error'
      ? 'text-danger'
      : state.status === 'downloaded' || state.status === 'not-available'
        ? 'text-ok'
        : 'text-fg-faint'

  return (
    <section className="flex items-center justify-between gap-3 border-t border-ink-600 pt-3.5">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold">업데이트</h3>
        <p className="text-[11px] text-fg-faint">
          현재 버전 {version || '...'}
          {label && <span className={`ml-2 ${labelColor}`}>· {label}</span>}
        </p>
      </div>

      {state.status === 'downloaded' ? (
        <button
          type="button"
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          onClick={() => void install()}
        >
          다시 시작
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] text-fg-muted transition-colors enabled:hover:border-accent enabled:hover:text-fg disabled:opacity-40"
          onClick={() => void check()}
        >
          {busy ? '확인 중' : '업데이트 확인'}
        </button>
      )}
    </section>
  )
}
