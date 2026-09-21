import type { WebContents } from 'electron'
import type { PlatformId } from '../../shared/types'
import { CHAT_CAPABILITIES, type ChatMessage, type ChatStatus } from '../../shared/chat'
import { createTwitchChat, loginTwitchChat, type ChatClient } from './twitchChat'
import { createChzzkChat } from './chzzkChat'
import { createCimeChat } from './cimeChat'
import { createYouTubeChat } from './youtubeChat'
import type { DeviceCodeInfo } from '../platforms/base'

/**
 * 채팅 연결 관리자.
 *
 * 연결은 전부 메인 프로세스가 들고, 메시지는 IPC 로 화면에 밀어줍니다.
 * 토큰이 렌더러로 나가지 않는다는 기존 원칙을 그대로 지킵니다.
 *
 * 끄면 "숨기기" 가 아니라 실제로 연결을 끊습니다.
 * 화면에서만 감추면 트래픽과 토큰은 계속 나가기 때문입니다.
 */

const clients = new Map<PlatformId, ChatClient>()

/** 화면이 아직 준비되지 않았을 때 대비해 마지막 상태를 들고 있습니다. */
const statuses = new Map<PlatformId, { status: ChatStatus; error?: string }>()

let target: WebContents | null = null

export function setChatTarget(wc: WebContents | null): void {
  target = wc
}

function push(channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload)
}

function emitStatus(platform: PlatformId, status: ChatStatus, error?: string): void {
  statuses.set(platform, { status, error })
  push('chat:status', { platform, status, error })
}

export function getChatStatuses(): { platform: PlatformId; status: ChatStatus; error?: string }[] {
  return [...statuses.entries()].map(([platform, s]) => ({ platform, ...s }))
}

/** 플랫폼 하나를 연결합니다. 이미 연결돼 있으면 아무것도 하지 않습니다. */
export function connectChat(platform: PlatformId): { ok: boolean; error?: string } {
  if (clients.has(platform)) return { ok: true }

  const cap = CHAT_CAPABILITIES[platform]
  if (!cap.read) {
    const msg = cap.unavailable ?? '이 플랫폼은 채팅을 지원하지 않습니다.'
    emitStatus(platform, 'error', msg)
    return { ok: false, error: msg }
  }

  try {
    const handlers = {
      onMessage: (msg: ChatMessage) => push('chat:message', msg),
      onStatus: (status: 'connecting' | 'connected' | 'error', error?: string) =>
        emitStatus(platform, status, error)
    }

    let client: ChatClient
    switch (platform) {
      case 'twitch':
        client = createTwitchChat(handlers)
        break
      case 'chzzk':
        client = createChzzkChat(handlers)
        break
      case 'cime':
        client = createCimeChat(handlers)
        break
      case 'youtube':
        client = createYouTubeChat(handlers)
        break
      default: {
        // 아직 붙이지 않은 플랫폼은 조용히 실패하지 않고 이유를 알립니다.
        const msg = cap.unavailable ?? '아직 지원하지 않습니다.'
        emitStatus(platform, 'error', msg)
        return { ok: false, error: msg }
      }
    }

    clients.set(platform, client)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitStatus(platform, 'error', msg)
    return { ok: false, error: msg }
  }
}

/**
 * 연동이 끝난 뒤 채팅을 다시 붙여봅니다.
 *
 * 앱을 켜면 저장해 둔 on/off 를 따라 채팅부터 연결하는데, 그 시점에는 아직
 * 로그인 전일 수 있습니다. 그러면 "로그인되어 있지 않습니다" 로 실패하고,
 * 그 뒤에 로그인을 마쳐도 다시 시도하는 곳이 없었습니다. 그래서 화면에는
 * 연동 완료로 뜨는데 채팅만 안 붙은 상태로 남았고, 사용자가 채팅 버튼을
 * 껐다 켜야 풀렸습니다.
 *
 * 실패한 채로 남아 있던 것만 다시 붙입니다. 사용자가 일부러 꺼둔 채팅을
 * 로그인했다는 이유로 켜면 안 되기 때문입니다 — 끈 것은 'idle' 로 남고
 * 'error' 로는 남지 않으므로 이 조건으로 구분됩니다.
 */
export function retryChatAfterLogin(platform: PlatformId): void {
  if (statuses.get(platform)?.status !== 'error' || clients.has(platform)) return
  connectChat(platform)
}

/**
 * 연동이 해제되면 채팅도 끊습니다.
 *
 * 토큰만 지우고 채팅을 살려두면, 죽은 토큰으로 계속 서버를 두드립니다.
 * 유튜브는 그게 할당량까지 갉아먹습니다.
 *
 * 상태는 'idle' 이 아니라 'error' 로 남깁니다. 'idle' 은 "사용자가 껐다" 는
 * 뜻이라, 나중에 다시 로그인해도 자동으로 붙이면 안 되는 상태입니다.
 * 여기는 반대로 다시 붙여야 하는 경우라 구분이 필요합니다.
 */
export function dropChatOnLogout(platform: PlatformId): void {
  const last = statuses.get(platform)
  const wasOn = clients.has(platform) || (last !== undefined && last.status !== 'idle')
  if (!wasOn) return

  clients.get(platform)?.close()
  clients.delete(platform)
  emitStatus(platform, 'error', '연동이 해제되었습니다. 다시 로그인하면 채팅도 함께 붙습니다.')
}

export function disconnectChat(platform: PlatformId): void {
  clients.get(platform)?.close()
  clients.delete(platform)
  emitStatus(platform, 'idle')
}

export function disconnectAllChat(): void {
  for (const id of [...clients.keys()]) disconnectChat(id)
}

export async function sendChat(
  platform: PlatformId,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const client = clients.get(platform)
  if (!client) return { ok: false, error: '연결되어 있지 않습니다.' }

  if (!CHAT_CAPABILITIES[platform].write) {
    return { ok: false, error: '이 플랫폼은 채팅 전송을 지원하지 않습니다.' }
  }

  try {
    await client.send(text)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 채팅 전용 로그인. 평소에는 쓰지 않습니다.
 *
 * 어느 플랫폼이든 방송 로그인 한 번으로 채팅까지 됩니다. 이건 트위치에서
 * 채팅만 다른 계정으로 쓰려고 앱을 하나 더 등록했을 때를 위한 길입니다.
 */
export async function loginChat(
  platform: PlatformId,
  notify?: (info: DeviceCodeInfo) => void
): Promise<{ ok: boolean; displayName?: string; error?: string }> {
  try {
    if (platform !== 'twitch') {
      return { ok: false, error: '이 플랫폼은 채팅 전용 로그인이 필요 없습니다.' }
    }
    const account = await loginTwitchChat(notify)
    return { ok: true, displayName: account.displayName }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 내가 보낸 메시지는 플랫폼이 되돌려주지 않을 수 있어, 화면에 직접 넣어줍니다. */
export function echoOwnMessage(msg: ChatMessage): void {
  push('chat:message', msg)
}
