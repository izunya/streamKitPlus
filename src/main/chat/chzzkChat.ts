import io from 'socket.io-client'
import type { ChatMessage } from '../../shared/chat'
import { apiFetch, ApiError, type RequestOptions } from '../net'
import { getCredentials, getToken, setToken } from '../vault'
import { toExpiryMs } from '../platforms/base'
import type { ChatClient, ChatClientOptions } from './twitchChat'

/**
 * 치지직 채팅 (Socket.IO).
 *
 *   1. GET  /open/v1/sessions/auth  -> 접속 URL 발급
 *   2. Socket.IO 로 그 URL 에 연결
 *   3. SYSTEM 이벤트로 sessionKey 를 받음   ← CIME 과 다른 점
 *   4. POST /open/v1/sessions/events/subscribe/chat?sessionKey=...
 *   5. CHAT 이벤트로 메시지 수신
 *
 * ⚠️ 문서가 "Socket.IO-client 1.0.0 ~ 2.0.3" 을 지정합니다.
 *    최신 v4 는 프로토콜이 달라 붙지 않으므로 socket.io-client@2.5.0 을 씁니다.
 *    (2.5.0 은 Socket.IO v2 프로토콜입니다.)
 *
 * CIME 은 표준 WebSocket 을 요구하고 Socket.IO 를 명시적으로 금지하므로
 * 전송 계층은 공유할 수 없습니다. 메시지 형식만 거의 같습니다.
 */

const BASE_URL = 'https://openapi.chzzk.naver.com'

interface SessionAuth {
  url: string
}

interface ChatEventData {
  senderChannelId?: string
  profile?: { nickname?: string } | string
  content?: string
  messageTime?: number
}

interface TokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn?: string | number
}

function unwrap<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'content' in res) {
    return (res as { content: T }).content
  }
  return res as T
}

/** 이벤트 페이로드가 문자열로 올 수도, 객체로 올 수도 있습니다. */
export function asObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  return null
}

/**
 * SYSTEM 이벤트 어디에 sessionKey 가 들어있는지 문서에 정확한 경로가 없어,
 * 중첩된 객체를 훑어서 찾습니다. 구조가 바뀌어도 견딥니다.
 */
export function findSessionKey(node: unknown, depth = 0): string | null {
  if (depth > 4 || !node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>

  const direct = obj['sessionKey']
  if (typeof direct === 'string' && direct) return direct

  for (const v of Object.values(obj)) {
    const found = findSessionKey(v, depth + 1)
    if (found) return found
  }
  return null
}

export function createChzzkChat(opts: ChatClientOptions): ChatClient {
  const creds = getCredentials('chzzk')
  if (!getToken('chzzk')?.accessToken) {
    throw new ApiError('치지직에 로그인되어 있지 않습니다.', 401)
  }

  let socket: ReturnType<typeof io> | null = null
  let closed = false
  let retry = 0
  let retryTimer: NodeJS.Timeout | null = null
  let subscribed = false
  let seq = 0

  const freshToken = async (): Promise<string> => {
    const t = getToken('chzzk')
    if (!t) throw new ApiError('치지직에 로그인되어 있지 않습니다.', 401)

    const nearExpiry = t.expiresAt !== undefined && t.expiresAt - Date.now() < 60_000
    if (!nearExpiry || t.manual || !t.refreshToken || !creds?.clientId || !creds.clientSecret) {
      return t.accessToken
    }

    try {
      const res = unwrap<TokenResponse>(
        await apiFetch(`${BASE_URL}/auth/v1/token`, {
          method: 'POST',
          body: {
            grantType: 'refresh_token',
            refreshToken: t.refreshToken,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret
          }
        })
      )
      if (!res?.accessToken) return t.accessToken

      setToken('chzzk', {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken ?? t.refreshToken,
        expiresAt: toExpiryMs(res.expiresIn)
      })
      return res.accessToken
    } catch {
      return t.accessToken
    }
  }

  const authed = async <T>(path: string, init: RequestOptions = {}): Promise<T> => {
    const access = await freshToken()
    const raw = await apiFetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${access}` }
    })
    return unwrap<T>(raw)
  }

  const scheduleRetry = (base: number): void => {
    if (closed) return
    retry += 1
    const delay = Math.min(60_000, base * 2 ** Math.min(retry, 5))
    opts.onStatus('connecting', `연결이 끊겨 ${Math.round(delay / 1000)}초 후 다시 시도합니다.`)
    retryTimer = setTimeout(() => void connect(), delay)
  }

  const connect = async (): Promise<void> => {
    if (closed) return
    opts.onStatus('connecting')
    subscribed = false

    try {
      const auth = await authed<SessionAuth>('/open/v1/sessions/auth')
      if (!auth?.url) throw new ApiError('채팅 접속 주소를 받지 못했습니다.', 500)

      // 문서가 지정한 접속 옵션입니다. 재연결은 우리가 직접 관리합니다.
      socket = io(auth.url, {
        reconnection: false,
        forceNew: true,
        timeout: 3000,
        transports: ['websocket']
      })

      socket.on('SYSTEM', (raw: unknown) => {
        const obj = asObject(raw)
        const key = findSessionKey(obj)
        if (!key || subscribed) return

        subscribed = true
        void authed('/open/v1/sessions/events/subscribe/chat', {
          method: 'POST',
          query: { sessionKey: key }
        })
          .then(() => {
            retry = 0
            opts.onStatus('connected')
          })
          .catch((e) => {
            opts.onStatus('error', e instanceof Error ? e.message : String(e))
          })
      })

      socket.on('CHAT', (raw: unknown) => {
        const obj = asObject(raw)
        if (!obj) return

        const d = (obj['data'] ?? obj) as ChatEventData
        const text = typeof d.content === 'string' ? d.content : ''
        if (!text) return

        // profile 이 문자열(JSON)로 올 때가 있어 양쪽을 모두 처리합니다.
        const profile = typeof d.profile === 'string' ? asObject(d.profile) : d.profile
        const nickname =
          (profile && typeof profile === 'object'
            ? String((profile as Record<string, unknown>)['nickname'] ?? '')
            : ''
          ).trim() || '알 수 없음'

        opts.onMessage({
          id: `cz-${d.senderChannelId ?? ''}-${d.messageTime ?? ''}-${seq++}`,
          platform: 'chzzk',
          nickname,
          text,
          at: typeof d.messageTime === 'number' ? d.messageTime : Date.now()
        })
      })

      socket.on('disconnect', () => scheduleRetry(1000))
      socket.on('connect_error', (e: unknown) => {
        opts.onStatus('error', e instanceof Error ? e.message : '연결에 실패했습니다.')
        scheduleRetry(2000)
      })
    } catch (e) {
      if (closed) return
      opts.onStatus('error', e instanceof Error ? e.message : String(e))
      scheduleRetry(2000)
    }
  }

  void connect()

  return {
    async send(text) {
      const safe = text.trim().slice(0, 100)
      if (!safe) return
      await authed('/open/v1/chats/send', { method: 'POST', body: { message: safe } })
    },

    close() {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      socket?.close()
      socket = null
    }
  }
}
