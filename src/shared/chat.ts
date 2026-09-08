import type { PlatformId } from './types'

/**
 * 채팅 도메인 타입.
 *
 * 플랫폼마다 전송 방식이 완전히 다릅니다:
 *   Twitch  IRC over WebSocket
 *   치지직   Socket.IO (세션 발급 -> 연결 -> 이벤트 구독)
 *   CIME    표준 WebSocket (문서가 Socket.IO 를 명시적으로 금지)
 *   YouTube liveChatMessages 폴링 (할당량 소모가 큼)
 *
 * 화면은 이 차이를 알 필요가 없어야 하므로, 여기서 하나의 모양으로 맞춥니다.
 */
export interface ChatMessage {
  /** 중복 렌더링 방지용. 플랫폼이 주는 ID 가 없으면 직접 만듭니다. */
  id: string
  platform: PlatformId
  /** 화면에 보일 이름 */
  nickname: string
  text: string
  /** 받은 시각 (epoch ms) */
  at: number
}

export type ChatStatus =
  | 'idle' // 연결 안 함
  | 'connecting'
  | 'connected'
  | 'error'

export interface ChatState {
  platform: PlatformId
  status: ChatStatus
  /** 실패 사유. 사용자에게 그대로 보여줍니다. */
  error?: string
}

/** 채팅을 지원하는 플랫폼과, 그 이유를 한곳에 모아둡니다. */
export interface ChatCapability {
  /** 수신 가능한가 */
  read: boolean
  /** 전송 가능한가 */
  write: boolean
  /**
   * 켜기 전에 사용자에게 알려야 할 비용.
   * YouTube 처럼 폴링이라 할당량을 태우는 경우가 있습니다.
   */
  warning?: string
  /** 아직 구현되지 않았다면 그 사유 */
  unavailable?: string
}

export const CHAT_CAPABILITIES: Record<PlatformId, ChatCapability> = {
  twitch: { read: true, write: true },

  chzzk: { read: true, write: true },

  cime: { read: true, write: true },

  youtube: {
    read: true,
    write: true,
    warning:
      '유튜브 채팅을 켜두면 하루 사용량이 빠르게 소진됩니다. ' +
      '다 쓰면 제목과 카테고리 변경까지 함께 막히니 주의해 주세요.'
  },

  soop: { read: false, write: false, unavailable: 'SOOP 은 아직 연동되지 않았습니다' }
}

/** 화면에 보관할 최대 메시지 수 — 오래된 것부터 버립니다. */
export const CHAT_BUFFER_MAX = 400
