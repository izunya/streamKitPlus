import { useUpdateStore } from '@/store/useUpdateStore'

/**
 * 업데이트 알림.
 *
 * 화면 오른쪽 아래에 조용히 떠서, 새 버전이 있거나 받는 중이거나
 * 다 받았을 때만 보입니다. 최신이거나 실패했을 때는 방해하지 않으려고
 * 여기서는 아무것도 띄우지 않습니다. (직접 확인은 설정에서 합니다.)
 */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdateStore((s) => s.state)
  const install = useUpdateStore((s) => s.install)

  const show =
    state.status === 'available' ||
    state.status === 'downloading' ||
    state.status === 'downloaded'
  if (!show) return null

  return (
    <div className="fade-up fixed bottom-4 right-4 z-50 w-[300px] rounded-xl border border-ink-500 bg-ink-800 p-3 shadow-lg">
      {state.status === 'downloaded' ? (
        <>
          <p className="text-[12.5px] font-semibold text-fg">
            새 버전{state.version ? ` ${state.version}` : ''} 준비 완료
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
            다시 시작하면 업데이트가 적용됩니다. 지금 다시 시작할까요?
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-2.5 py-1 text-[11.5px] text-fg-faint transition-colors hover:text-fg"
              onClick={() => useUpdateStore.setState({ state: { status: 'idle' } })}
            >
              나중에
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-1 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
              onClick={() => void install()}
            >
              다시 시작
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[12.5px] font-semibold text-fg">
            {state.status === 'available' ? '새 버전을 받고 있습니다' : '업데이트 내려받는 중'}
            {state.version ? ` (${state.version})` : ''}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${state.percent ?? 0}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[10.5px] text-fg-faint">{state.percent ?? 0}%</p>
        </>
      )}
    </div>
  )
}
