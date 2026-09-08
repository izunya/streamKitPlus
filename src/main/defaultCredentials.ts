import type { PlatformId } from '../shared/types'
import type { AppCredentials } from './vault'

/**
 * 앱에 내장하는 기본 자격 증명.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────
 * OAuth 는 "어떤 앱이 요청하는지"를 식별하는 client_id 없이는 시작할 수 없습니다.
 * 등록되지 않은 앱에는 플랫폼이 동의 화면조차 띄우지 않습니다.
 * 여기를 채워두면 사용자는 아무것도 입력하지 않고 로그인 버튼만 누르면 됩니다.
 *
 * ── secret 을 넣어도 되는가 ──────────────────────────────────
 *   YouTube : 넣지 않아도 됩니다. Google 문서가 "installed apps cannot keep secrets"
 *             라고 명시하고 client_secret 을 Optional 로 둡니다. PKCE 로 대체합니다.
 *   Twitch  : 넣지 않아도 됩니다. Device Code Flow 는 public client 를 전제로 하며
 *             "public clients do not need to maintain a client secret" 입니다.
 *   치지직/CIME : secret 이 반드시 필요합니다. PKCE 도 device flow 도 없습니다.
 *
 *             ⚠️ 여기에 secret 을 넣으면 배포된 앱에서 추출할 수 있습니다.
 *                토큰 자체는 각 사용자 PC 에만 있으므로 다른 사람 계정이 털리지는 않지만,
 *                제3자가 이 앱을 사칭할 수 있고 그 결과 앱 등록이 정지될 수 있습니다.
 *                그럼에도 사용자 편의를 위해 넣는 것은 흔한 선택입니다.
 *                더 안전한 대안은 토큰 교환만 대행하는 작은 서버를 두는 것입니다.
 *
 * ── 채우는 방법 ──────────────────────────────────────────────
 * 1. 각 플랫폼 개발자 콘솔에서 앱을 등록합니다.
 * 2. 아래 상수에 client_id 를 적거나, 빌드 시 환경 변수로 넘깁니다.
 *      SKP_YOUTUBE_CLIENT_ID, SKP_TWITCH_CLIENT_ID
 * 3. YouTube 는 'youtube' 스코프가 민감 범주라 OAuth 확인(verification)을 받지 않으면
 *    "확인되지 않은 앱" 경고가 뜨고 테스트 사용자 100명 제한이 걸립니다.
 *
 * 비워두면 사용자가 설정에서 직접 입력해야 합니다 (지금 상태).
 */

interface DefaultEntry {
  clientId: string
  clientSecret?: string
}

const BUILT_IN: Partial<Record<PlatformId, DefaultEntry>> = {
  // ── 여기를 채우면 사용자는 로그인 버튼만 누르면 됩니다 ──

  // Secret 불필요 (PKCE)
  youtube: { clientId: '' },

  // Secret 불필요 (Device Code Flow)
  twitch: { clientId: '' },

  // Secret 필요 — 위 경고를 읽고 판단해서 채우세요
  chzzk: { clientId: '', clientSecret: '' },
  cime: { clientId: '', clientSecret: '' }

  // SOOP 은 어댑터가 아직 없습니다.
}

/** 환경 변수로도 덮어쓸 수 있게 해서, 키를 소스에 커밋하지 않아도 되게 합니다. */
const ENV_KEYS: Partial<Record<PlatformId, { id: string; secret: string }>> = {
  youtube: { id: 'SKP_YOUTUBE_CLIENT_ID', secret: 'SKP_YOUTUBE_CLIENT_SECRET' },
  twitch: { id: 'SKP_TWITCH_CLIENT_ID', secret: 'SKP_TWITCH_CLIENT_SECRET' },
  chzzk: { id: 'SKP_CHZZK_CLIENT_ID', secret: 'SKP_CHZZK_CLIENT_SECRET' },
  cime: { id: 'SKP_CIME_CLIENT_ID', secret: 'SKP_CIME_CLIENT_SECRET' }
}

export function getDefaultCredentials(id: PlatformId): AppCredentials | undefined {
  const env = ENV_KEYS[id]
  const envId = env ? process.env[env.id]?.trim() : undefined
  const envSecret = env ? process.env[env.secret]?.trim() : undefined

  if (envId) return { clientId: envId, clientSecret: envSecret || undefined }

  const built = BUILT_IN[id]
  if (built?.clientId) {
    return { clientId: built.clientId, clientSecret: built.clientSecret || undefined }
  }

  return undefined
}

/** 이 플랫폼이 기본 자격 증명을 갖고 있는지 (설정 화면 안내용) */
export function hasDefaultCredentials(id: PlatformId): boolean {
  return getDefaultCredentials(id) !== undefined
}
