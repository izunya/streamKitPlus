import { useState } from 'react'
import type { PlatformId } from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from '@/store/useAppStore'
import { PlatformIcon } from './PlatformIcon'

/**
 * 요구사항 5번 — 플랫폼 아이콘 클릭으로 활성/비활성 전환.
 *
 * 상태를 2가지가 아니라 3가지로 나눕니다:
 *   on       원본 색상   — 연동됨 + 이번 적용 대상
 *   off      회색        — 연동됐지만 이번엔 제외
 *   unlinked 회색 + 자물쇠 — 계정 연결 안 됨 (클릭하면 연동 창)
 *
 * "연동 안 됨"과 "일부러 껐음"을 구분하지 않으면
 * 사용자가 왜 방송 정보가 안 바뀌는지 알 수 없습니다.
 */

type ChipState = 'on' | 'off' | 'unlinked'

interface Props {
  onRequestConnect: (id: PlatformId) => void
}

export function PlatformToggleBar({ onRequestConnect }: Props): React.JSX.Element {
  const enabled = useAppStore((s) => s.enabled)
  const accounts = useAppStore((s) => s.accounts)
  const connecting = useAppStore((s) => s.connecting)
  const toggleEnabled = useAppStore((s) => s.toggleEnabled)

  const [hovered, setHovered] = useState<PlatformId | null>(null)

  const activeCount = PLATFORM_ORDER.filter((id) => enabled[id] && accounts[id]).length

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-fg-faint">송출 플랫폼</span>
        <span className="text-xs text-fg-faint">
          <span className="font-semibold text-ok">{activeCount}</span>
          <span className="mx-1">/</span>
          {PLATFORM_ORDER.length} 곳에 적용
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {PLATFORM_ORDER.map((id) => {
          const meta = PLATFORMS[id]
          const account = accounts[id]
          const state: ChipState = !account ? 'unlinked' : enabled[id] ? 'on' : 'off'
          const busy = connecting === id

          return (
            <button
              key={id}
              type="button"
              data-state={state}
              className={[
                'platform-chip group relative flex items-center gap-2 rounded-xl border px-3 py-2.5',
                state === 'on'
                  ? 'border-ink-500 bg-ink-700'
                  : state === 'off'
                    ? 'border-ink-600 bg-ink-850'
                    : 'border-dashed border-ink-600 bg-ink-850'
              ].join(' ')}
              onClick={() => (account ? toggleEnabled(id) : onRequestConnect(id))}
              onContextMenu={(e) => {
                // 우클릭 = 연동 관리 (해제/재연결)
                e.preventDefault()
                onRequestConnect(id)
              }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              title={
                account
                  ? `${meta.name} · ${account.displayName}\n클릭: ${enabled[id] ? '제외' : '포함'} / 우클릭: 연동 관리`
                  : `${meta.name} — 연동되지 않음. 클릭해서 연동하세요.`
              }
            >
              {busy ? (
                <span className="spin block h-[22px] w-[22px] rounded-full border-2 border-ink-500 border-t-accent-soft" />
              ) : (
                <PlatformIcon id={id} />
              )}

              <span className="flex flex-col items-start leading-tight">
                <span className="text-[13px] font-semibold">{meta.name}</span>
                <span className="text-[10.5px] text-fg-faint">
                  {account ? account.displayName : '미연동'}
                </span>
              </span>

              {state === 'unlinked' && (
                <svg
                  className="ml-0.5 opacity-70"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <rect
                    x="4"
                    y="10"
                    width="16"
                    height="11"
                    rx="2.5"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}

              {/* 활성 표시 점 */}
              {state === 'on' && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-ink-900"
                  style={{ background: meta.color }}
                />
              )}
            </button>
          )
        })}
      </div>

      {hovered && PLATFORMS[hovered].caution && (
        <p className="fade-up flex items-start gap-1.5 text-[11px] leading-relaxed text-warn/80">
          <span>⚠</span>
          <span>{PLATFORMS[hovered].caution}</span>
        </p>
      )}
    </div>
  )
}
