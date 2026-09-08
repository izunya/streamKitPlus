import type { PlatformId } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'

/**
 * 플랫폼 아이콘.
 *
 * ⚠️ 지금은 각 플랫폼을 상징하는 단순 도형으로 그려 둔 자리표시자입니다.
 * 배포 전에 각 플랫폼의 공식 브랜드 가이드에 맞는 로고 자산으로 교체해야 합니다
 * (로고 사용 규정이 플랫폼마다 다르므로 확인이 필요합니다).
 *
 * 색상은 currentColor 를 쓰므로, 부모가 회색조 필터만 걸면
 * 활성/비활성 전환이 그대로 동작합니다.
 */

interface Props {
  id: PlatformId
  size?: number
}

export function PlatformIcon({ id, size = 22 }: Props): React.JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    xmlns: 'http://www.w3.org/2000/svg'
  }
  const color = PLATFORMS[id].color

  switch (id) {
    case 'youtube':
      return (
        <svg {...common} aria-hidden>
          <rect x="1.5" y="4.5" width="21" height="15" rx="5" fill={color} />
          <path d="M10 8.8l6 3.2-6 3.2V8.8z" fill="#fff" />
        </svg>
      )

    case 'twitch':
      return (
        <svg {...common} aria-hidden>
          <path
            d="M4 2h16v12.5L15.5 19H12l-3 3H7v-3H4V2z"
            fill={color}
          />
          <path d="M11 6.5h1.8v5H11v-5zm4.2 0H17v5h-1.8v-5z" fill="#fff" />
        </svg>
      )

    case 'chzzk':
      return (
        <svg {...common} aria-hidden>
          <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill={color} />
          <path
            d="M14.5 6l-6.2 7h3.4l-1.2 5 6.2-7h-3.4l1.2-5z"
            fill="#0b0d11"
          />
        </svg>
      )

    case 'soop':
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="12" r="9.5" fill={color} />
          <path
            d="M12 6.5c2.4 2 3.6 3.7 3.6 5.5A3.6 3.6 0 0112 15.6 3.6 3.6 0 018.4 12c0-1.8 1.2-3.5 3.6-5.5z"
            fill="#fff"
          />
        </svg>
      )

    case 'cime':
      return (
        <svg {...common} aria-hidden>
          <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill={color} />
          <path
            d="M15.6 9.2a4.2 4.2 0 100 5.6"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
