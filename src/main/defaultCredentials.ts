import type { PlatformId } from '../shared/types'
import type { AppCredentials } from './vault'

/**
 * 앱에 내장하는 기본 자격 증명.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────
 * OAuth 는 "어떤 앱이 요청하는지"를 식별하는 client_id 없이는 시작할 수 없습니다.
 * 등록되지 않은 앱에는 플랫폼이 동의 화면조차 띄우지 않습니다.
 * 여기가 비어 있으면 사용자는 로그인 자체를 못 합니다. 개발자 설정 화면은
 * 배포본에서 감췄으니, 배포하려면 반드시 값이 들어가 있어야 합니다.
 *
 * ── 어디에 적는가 ────────────────────────────────────────────
 * 프로젝트 루트의 .env 에 적습니다. 이 파일은 저장소에 올라가지 않습니다.
 * 형식은 .env.example 을 그대로 복사해서 쓰면 됩니다.
 *
 *     SKP_YOUTUBE_CLIENT_ID=...
 *     SKP_CHZZK_CLIENT_SECRET=...
 *
 * 빌드할 때 이 값들이 코드 안에 글자 그대로 박힙니다. .env 없이 빌드하면
 * 값이 빈 채로 나가고, 사용자는 로그인 버튼을 눌러도 아무 일도 일어나지 않습니다.
 * 빌드 전에 값이 들어갔는지 꼭 확인하세요.
 *
 * ── secret 을 넣어도 되는가 ──────────────────────────────────
 *   YouTube : 넣지 않아도 됩니다. Google 문서가 "installed apps cannot keep secrets"
 *             라고 명시하고 client_secret 을 Optional 로 둡니다. PKCE 로 대체합니다.
 *   Twitch  : 넣지 않아도 됩니다. Device Code Flow 는 public client 를 전제로 하며
 *             "public clients do not need to maintain a client secret" 입니다.
 *   치지직/CIME : secret 이 반드시 필요합니다. PKCE 도 device flow 도 없습니다.
 *
 *             ⚠️ 배포된 앱에서 secret 을 꺼내볼 수 있습니다. .env 에 적든 아래
 *                BUILT_IN 에 적든 마찬가지입니다 — 결국 같은 자리에 박힙니다.
 *                토큰 자체는 각 사용자 PC 에만 있으므로 다른 사람 계정이 털리지는
 *                않지만, 제3자가 이 앱을 사칭할 수 있고 그 결과 앱 등록이 정지될
 *                수 있습니다. 그럼에도 사용자 편의를 위해 넣는 것은 흔한 선택입니다.
 *                더 안전한 대안은 토큰 교환만 대행하는 작은 서버를 두는 것입니다.
 *
 * ── 그 외 ────────────────────────────────────────────────────
 * YouTube 는 'youtube' 스코프가 민감 범주라 OAuth 확인(verification)을 받지 않으면
 * "확인되지 않은 앱" 경고가 뜨고 테스트 사용자 100명 제한이 걸립니다.
 */

interface DefaultEntry {
  clientId: string
  clientSecret?: string
}

/**
 * 빌드할 때 .env 에서 끼워 넣는 값.
 *
 * 플랫폼마다 한 줄씩 직접 늘어놓은 데에는 이유가 있습니다. process.env[변수이름]
 * 처럼 키를 변수로 넘기면 빌드 도구가 값을 채워 넣지 못합니다. 소스에 적힌 글자를
 * 그대로 찾아 바꾸는 방식이라, 글자가 완성된 형태로 있어야 하기 때문입니다.
 *
 * 값을 안 넣은 항목은 undefined 로 남고, 아래에서 빈 값으로 취급합니다.
 */
const FROM_ENV: Partial<Record<PlatformId, DefaultEntry>> = {
  youtube: {
    clientId: process.env.SKP_YOUTUBE_CLIENT_ID ?? '',
    clientSecret: process.env.SKP_YOUTUBE_CLIENT_SECRET ?? ''
  },
  twitch: {
    clientId: process.env.SKP_TWITCH_CLIENT_ID ?? '',
    clientSecret: process.env.SKP_TWITCH_CLIENT_SECRET ?? ''
  },
  chzzk: {
    clientId: process.env.SKP_CHZZK_CLIENT_ID ?? '',
    clientSecret: process.env.SKP_CHZZK_CLIENT_SECRET ?? ''
  },
  cime: {
    clientId: process.env.SKP_CIME_CLIENT_ID ?? '',
    clientSecret: process.env.SKP_CIME_CLIENT_SECRET ?? ''
  },

  // 환경변수 이름만 SOOPLIVE 입니다 — 개발자 콘솔 도메인을 따라 그렇게 발급받았고,
  // 이름을 바꾸면 이미 채워둔 .env 가 조용히 무시되므로 그대로 둡니다.
  soop: {
    clientId: process.env.SKP_SOOPLIVE_CLIENT_ID ?? '',
    clientSecret: process.env.SKP_SOOPLIVE_CLIENT_SECRET ?? ''
  }
}

/**
 * 소스에 직접 적어 두는 값. .env 가 비어 있을 때만 씁니다.
 *
 * 저장소에 그대로 올라가므로 평소에는 비워 두고 .env 를 쓰세요.
 * 여기는 포크해서 각자 쓰는 사람들을 위한 자리입니다.
 */
const BUILT_IN: Partial<Record<PlatformId, DefaultEntry>> = {
  youtube: { clientId: '' },
  twitch: { clientId: '' },
  chzzk: { clientId: '', clientSecret: '' },
  cime: { clientId: '', clientSecret: '' },
  soop: { clientId: '', clientSecret: '' }
}

export function getDefaultCredentials(id: PlatformId): AppCredentials | undefined {
  // .env 가 먼저입니다. 소스에 적힌 값은 .env 가 비었을 때만 씁니다.
  for (const entry of [FROM_ENV[id], BUILT_IN[id]]) {
    const clientId = entry?.clientId?.trim()
    if (!clientId) continue

    const clientSecret = entry?.clientSecret?.trim()
    return { clientId, clientSecret: clientSecret || undefined }
  }
  return undefined
}

/** 이 플랫폼이 기본 자격 증명을 갖고 있는지 (설정 화면 안내용) */
export function hasDefaultCredentials(id: PlatformId): boolean {
  return getDefaultCredentials(id) !== undefined
}
