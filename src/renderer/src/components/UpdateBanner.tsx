import { useEffect, useState } from 'react'
import { useUpdateStore } from '@/store/useUpdateStore'

/**
 * 업데이트 알림.
 *
 * 묻지 않습니다. 새 버전은 알아서 받고, 앱을 끌 때 알아서 설치됩니다.
 * 여기서는 "지금 받는 중" 과 "다 받았다" 를 잠깐 알려주기만 합니다.
 *
 * 받자마자 재시작하지 않는 이유는 방송 도구이기 때문입니다 —
 * 송출 중에 창이 꺼지는 것보다, 다음에 끌 때 조용히 갈아끼우는 편이 낫습니다.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdateStore((s) => s.state)
  const [dismissed, setDismissed] = useState(false)

  // 다 받았다는 알림은 잠깐만 보여주고 스스로 사라집니다.
  useEffect(() => {
    if (state.status !== 'downloaded') {
      setDismissed(false)
      return
    }
    const t = setTimeout(() => setDismissed(true), 8000)
    return () => clearTimeout(t)
  }, [state.status])

  const show =
    state.status === 'available' ||
    state.status === 'downloading' ||
    (state.status === 'downloaded' && !dismissed)
  if (!show) return null

  return (
    <div className="fade-up fixed bottom-4 right-4 z-50 w-[300px] rounded-xl border border-ink-500 bg-ink-800 p-3 shadow-lg">
      {state.status === 'downloaded' ? (
        <>
          <p className="text-[12.5px] font-semibold text-fg">
            새 버전{state.version ? ` ${state.version}` : ''} 준비 완료
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
            앱을 끄면 자동으로 적용됩니다. 지금 하실 일은 없습니다.
          </p>
        </>
      ) : (
        <>
          <p className="text-[12.5px] font-semibold text-fg">
            새 버전을 받고 있습니다{state.version ? ` (${state.version})` : ''}
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
