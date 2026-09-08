/**
 * OBS 연동 도메인 타입.
 *
 * OBS 씬을 바꾸면 방송 제목·카테고리·태그가 저절로 따라가게 하는 기능입니다.
 * "잡담 씬 -> 잡담 프리셋", "게임 씬 -> 게임 프리셋" 처럼 씬에 프리셋을 걸어둡니다.
 *
 * 프로토콜은 obs-websocket 5.x 공식 문서에서 확인한 것만 사용합니다.
 * https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 */

/** obs-websocket 5.x 기본 포트 (OBS 도구 > WebSocket 서버 설정에서 바꿀 수 있습니다) */
export const OBS_DEFAULT_PORT = 4455
export const OBS_DEFAULT_HOST = '127.0.0.1'

/** 문서 기준 현재 프로토콜 버전 */
export const OBS_RPC_VERSION = 1

/** 메시지 종류 (op 값) */
export const OBS_OP = {
  hello: 0,
  identify: 1,
  identified: 2,
  reidentify: 3,
  event: 5,
  request: 6,
  requestResponse: 7
} as const

/**
 * 받을 이벤트 종류를 비트로 고릅니다.
 * 씬 전환만 필요하므로 Scenes 하나만 켭니다 — 나머지는 받아봐야 버리는 트래픽입니다.
 */
export const OBS_EVENT_SUB = {
  none: 0,
  general: 1 << 0,
  scenes: 1 << 2
} as const

/**
 * OBS 가 연결을 끊을 때 주는 코드 중, 다시 붙어봐야 소용없는 것들.
 * 이런 이유로 끊겼으면 재시도를 멈추고 사용자에게 무엇을 고쳐야 하는지 알립니다.
 */
export const OBS_FATAL_CLOSE: Record<number, string> = {
  4009: 'OBS 서버 비밀번호가 맞지 않습니다. 설정에서 다시 입력해 주세요.',
  4010: 'OBS 버전이 너무 낮습니다. OBS 를 최신 버전으로 올려주세요.',
  4011: 'OBS 가 연결을 끊었습니다. OBS 의 WebSocket 서버 설정을 확인해 주세요.'
}

export type ObsStatus =
  | 'off' // 사용 안 함
  | 'connecting'
  | 'connected'
  | 'error'

export interface ObsState {
  status: ObsStatus
  /** 실패 사유. 사용자에게 그대로 보여줍니다. */
  error?: string
  /** 지금 켜져 있는 씬 이름 */
  currentScene?: string
  /** OBS 가 알려준 씬 목록 — 매핑 화면에서 고르게 씁니다 */
  scenes?: string[]
  /** OBS 스튜디오 버전 — 연결됐다는 걸 눈으로 확인시켜 줍니다 */
  obsVersion?: string
}

/** 사용자가 설정에서 입력하는 값 */
export interface ObsSettings {
  /** 기능 자체를 쓸지 */
  enabled: boolean
  host: string
  port: number
  /** OBS 에서 인증을 켠 경우에만 필요합니다 */
  password: string
  /**
   * 씬이 바뀌면 곧바로 방송에 적용할지.
   *
   * 끄면 프리셋을 화면에 불러오기만 하고, 적용은 사용자가 누릅니다.
   * 실수로 씬을 왔다 갔다 할 때 방송 정보가 계속 바뀌는 걸 막고 싶을 때 씁니다.
   */
  autoApply: boolean
}

export const OBS_DEFAULT_SETTINGS: ObsSettings = {
  enabled: false,
  host: OBS_DEFAULT_HOST,
  port: OBS_DEFAULT_PORT,
  password: '',
  autoApply: true
}

/** 씬 이름 -> 프리셋 id. 걸어두지 않은 씬은 아무 일도 일어나지 않습니다. */
export type SceneBindings = Record<string, string>
