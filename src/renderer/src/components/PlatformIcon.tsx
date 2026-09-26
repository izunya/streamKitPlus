import type { PlatformId } from '@shared/types'
import youtubeIcon from '@/assets/platforms/youtube.png'
import chzzkIcon from '@/assets/platforms/chzzk.png'
import cimeIcon from '@/assets/platforms/cime.png'
import soopIcon from '@/assets/platforms/soop.png'

/**
 * 플랫폼 아이콘.
 *
 * ── 왜 직접 그리지 않는가 ────────────────────────────────────
 * 예전에는 각 플랫폼을 상징하는 도형을 손으로 그려 썼습니다. 보기에는 비슷해도
 * 상표를 임의로 다시 그린 것이라 쓰면 안 되는 형태입니다.
 *
 * 특히 YouTube API 정책은, 다른 출처의 내용과 같은 화면에 섞어 보여주는 경우
 * 어느 것이 YouTube 에서 왔는지 분명히 표시하라고 요구하고 그 표시에 공식
 * 브랜드 자산을 쓰도록 합니다. 이 앱은 여러 플랫폼 채팅을 한 목록에 섞으므로
 * 정확히 그 경우에 해당합니다. 할당량 심사에서 먼저 보는 자리이기도 합니다.
 *
 * 그래서 각 플랫폼이 배포하는 공식 아이콘 파일을 그대로 씁니다.
 * 파일은 assets/platforms 에 있고, 바꿀 일이 생기면 그 파일만 갈아 끼우면 됩니다.
 *
 * ── 트위치만 SVG 인 이유 ─────────────────────────────────────
 * 트위치가 배포하는 자산은 PNG 가 아니라 SVG 라 도형을 그대로 옮겨 넣었습니다.
 * 공식 브랜드 묶음(Twitch Logos / 02. Glitch / 04. White)의 glitch_flat_white.svg
 * 를 좌표 하나 바꾸지 않고 그대로 씁니다. 보라 사각형 위의 흰 Glitch 는
 * 트위치 자신이 앱 아이콘에 쓰는 조합이라, 나머지 타일과도 모양이 맞습니다.
 *
 * ── 비활성 표시 ──────────────────────────────────────────────
 * 부모가 grayscale 필터를 걸어 끄고 켠 모습을 구분합니다.
 * img 에도 그대로 먹으므로 쓰는 쪽 코드는 달라지지 않습니다.
 */

interface Props {
  id: PlatformId
  size?: number
}

/** 공식 아이콘 파일이 있는 플랫폼 */
const FILES: Partial<Record<PlatformId, string>> = {
  youtube: youtubeIcon,
  chzzk: chzzkIcon,
  cime: cimeIcon,
  soop: soopIcon
}

/**
 * 트위치 공식 Glitch — 원본 좌표계는 2400x2800 입니다.
 *
 * 숫자를 24x24 에 맞춰 다시 계산하지 않고 원본 그대로 두고,
 * 그리는 쪽에서 줄여서 얹습니다. 자산이 갱신되면 이 값만 갈아 끼우면 됩니다.
 */
const GLITCH = {
  viewBox: { w: 2400, h: 2800 },
  body: 'M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z',
  eyes: [
    { x: 1700, y: 550, w: 200, h: 600 },
    { x: 1150, y: 550, w: 200, h: 600 }
  ]
}

export function PlatformIcon({ id, size = 22 }: Props): React.JSX.Element {
  const file = FILES[id]

  if (file) {
    return (
      <img
        src={file}
        alt=""
        aria-hidden
        width={size}
        height={size}
        // 원본이 정사각형이라 비율이 틀어지지 않습니다. 모서리만 둥글려 맞춥니다.
        className="shrink-0 rounded-[22%] object-contain"
        draggable={false}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden
    >
      <rect width="24" height="24" rx="5.3" fill="#9146FF" />
      {/* 세로 14 에 맞춰 줄이고(14/2800), 남는 자리를 반씩 나눠 가운데에 둡니다. */}
      <g transform="translate(6 5) scale(0.005)">
        <path d={GLITCH.body} fill="#fff" />
        {GLITCH.eyes.map((r) => (
          <rect key={r.x} x={r.x} y={r.y} width={r.w} height={r.h} fill="#fff" />
        ))}
      </g>
    </svg>
  )
}
