import type { PlatformId } from './types'

/**
 * 플랫폼별 리다이렉트 URI 규칙.
 *
 * ── 왜 고정 포트가 필요한가 ──────────────────────────────────
 * 치지직 문서: "요청의 redirectUri 는 앱 등록 시 입력한 로그인 리다이렉트 URL 과
 * 일치해야 합니다." 즉 매번 바뀌는 랜덤 포트로는 절대 통과할 수 없습니다.
 * 등록해 둔 주소와 글자 하나까지 같아야 하므로 포트를 고정합니다.
 *
 * 반면 Google 은 루프백 주소에 대해 임의 포트를 허용합니다.
 * 그래도 사용자가 콘솔에 무엇을 넣어야 할지 알려줄 수 있도록 고정해 둡니다.
 *
 * Twitch 는 Device Code Flow 라 리다이렉트 URI 자체가 필요 없습니다.
 *
 * ── 포트 선택 ────────────────────────────────────────────────
 * 등록된 서비스가 거의 없는 대역(49152~65535, 동적/사설 포트)에서 골랐습니다.
 * 다른 프로그램이 이미 쓰고 있으면 연동이 실패하므로, 그때는 여기 숫자를 바꾸고
 * 개발자 콘솔의 등록 주소도 함께 바꿔야 합니다.
 */

export interface RedirectSpec {
  host: string
  port: number
  path: string
}

const SPECS: Partial<Record<PlatformId, RedirectSpec>> = {
  // 아래 값은 개발자 콘솔에 실제로 등록된 주소와 일치해야 합니다.
  // 바꾸려면 콘솔의 등록 주소도 함께 고쳐야 합니다.
  twitch: { host: 'localhost', port: 12478, path: '/callback' },
  chzzk: { host: 'localhost', port: 12479, path: '/callback' },
  cime: { host: 'localhost', port: 12480, path: '/callback' },
  soop: { host: 'localhost', port: 12482, path: '/callback' },

  // YouTube 는 콘솔에서 "데스크톱 앱" 유형으로 만들면 루프백 주소가 자동 허용되어
  // 리다이렉트 URI 를 따로 등록하지 않습니다. 그래도 포트를 고정해 두면
  // "웹 애플리케이션" 유형으로 등록한 경우에도 그대로 쓸 수 있습니다.
  youtube: { host: '127.0.0.1', port: 12477, path: '/callback' }
}

/**
 * 자격 증명 용도.
 *
 *   broadcast  방송 정보(제목·카테고리·태그) 수정용
 *   chat       채팅 읽기·쓰기용
 *
 * 슬롯을 나눈 건 앱을 두 개 써야 해서가 아닙니다. 트위치 스코프는 앱이 아니라
 * 로그인할 때 요청하는 값이라, 앱 하나로 방송 권한과 채팅 권한을 같이 받습니다.
 *
 * 나눈 이유는 IRC 입니다. 채널에 들어갈 때 쓰는 이름이 표시 이름이 아니라
 * 소문자 login 이라, 표시 이름이 들어 있는 방송 슬롯과 같은 자리에 둘 수 없습니다.
 * 채팅만 다른 계정으로 쓰려고 앱을 하나 더 등록한 경우에도 이 슬롯에 담깁니다.
 */
export type CredentialSlot = 'broadcast' | 'chat'

/**
 * 채팅용 앱을 따로 등록했을 때만 쓰는 주소입니다. 등록은 선택입니다 —
 * 보통은 방송 로그인 한 번으로 채팅까지 끝납니다.
 */
const CHAT_SPECS: Partial<Record<PlatformId, RedirectSpec>> = {
  twitch: { host: 'localhost', port: 12481, path: '/callback' }
}

export function getRedirectSpec(
  id: PlatformId,
  slot: CredentialSlot = 'broadcast'
): RedirectSpec | undefined {
  return slot === 'chat' ? CHAT_SPECS[id] : SPECS[id]
}

/** 이 플랫폼이 채팅용 앱을 따로 등록하는 길을 열어두는지 (필수가 아닙니다) */
export function needsSeparateChatApp(id: PlatformId): boolean {
  return CHAT_SPECS[id] !== undefined
}

/** 개발자 콘솔에 등록해야 하는 주소. 이 문자열 그대로 넣어야 합니다. */
export function getRedirectUri(id: PlatformId, slot: CredentialSlot = 'broadcast'): string | null {
  const s = getRedirectSpec(id, slot)
  return s ? `http://${s.host}:${s.port}${s.path}` : null
}
