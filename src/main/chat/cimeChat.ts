import { WebSocket } from 'ws'
import type { ChatMessage } from '../../shared/chat'
import { CIME_BASE_URL } from '../../shared/platformSpecs'
import { apiFetch, ApiError, type RequestOptions } from '../net'
import { getCredentials, getToken, setToken } from '../vault'
import { toExpiryMs } from '../platforms/base'
import type { ChatClient, ChatClientOptions } from './twitchChat'

/**
 * CIME 채팅 (표준 WebSocket).
 *
 *   1. GET  /open/v1/sessions/auth            -> 접속 URL 발급
 *   2. WebSocket 으로 그 URL 에 연결
 *   3. POST /open/v1/sessions/events/subscribe/chat?sessionKey=...  -> 채팅 이벤트 구독
 *
 * 문서가 "표준 WebSocket(RFC 6455)을 사용해야 합니다. Socket.IO, SockJS 등의
 * 라이브러리는 자체 프로토콜 계층을 추가하므로 호환되지 않습니다" 라고 못박고 있어
 * 치지직(Socket.IO)과 전송 계층을 공유할 수 없습니다.
 *
 * 수신 형식: { "event": "CHAT", "data": { profile: { nickname }, content, ... } }
 */

interface SessionAuth {
  url: string
}

interface ChatEventData {
  channelId?: string
  senderChannelId?: string
  profile?: { nickname?: string }
  content?: string
  messageTime?: string
}

interface TokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn?: string | number
}

/** 응답 봉투 { code, message, content } 를 벗깁니다. */
function unwrap<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'content' in res) {
    return (res as { content: T }).content
  }
  return res as T
}

export function createCimeChat(opts: ChatClientOptions): ChatClient {
  const creds = getCredentials('cime')
  const token = getToken('cime')
  if (!token?.accessToken) {
    throw new ApiError('CIME 에 로그인되어 있지 않습니다.', 401)
  }

  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let retryTimer: NodeJS.Timeout | null = null
  let seq = 0

  /** 만료가 임박했으면 갱신합니다. 소켓은 오래 붙어 있어 재연결 시점에 확인합니다. */
  const freshToken = async (): Promise<string> => {
    const t = getToken('cime')
    if (!t) throw new ApiError('CIME 에 로그인되어 있지 않습니다.', 401)

    const nearExpiry = t.expiresAt !== undefined && t.expiresAt - Date.now() < 60_000
    if (!nearExpiry || t.manual || !t.refreshToken || !creds?.clientId || !creds.clientSecret) {
      return t.accessToken
    }

    try {
      const raw = await apiFetch(`${CIME_BASE_URL}/auth/v1/token`, {
        method: 'POST',
        body: {
          grantType: 'refresh_token',
          refreshToken: t.refreshToken,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret
        }
      })
      const res = unwrap<TokenResponse>(raw)
      if (!res?.accessToken) return t.accessToken

      setToken('cime', {
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
    const raw = await apiFetch(`${CIME_BASE_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${access}` }
    })
    return unwrap<T>(raw)
  }

  /** 접속 URL 에서 sessionKey 를 뽑아냅니다. 구독 요청에 필요합니다. */
  const sessionKeyOf = (url: string): string => {
    try {
      return new URL(url).searchParams.get('sessionKey') ?? ''
    } catch {
      return ''
    }
  }

  const connect = async (): Promise<void> => {
    if (closed) return
    opts.onStatus('connecting')

    try {
      const auth = await authed<SessionAuth>('/open/v1/sessions/auth')
      if (!auth?.url) throw new ApiError('채팅 접속 주소를 받지 못했습니다.', 500)

      const sessionKey = sessionKeyOf(auth.url)
      ws = new WebSocket(auth.url)

      ws.on('open', () => {
        // 연결이 열린 뒤에 구독해야 이벤트를 놓치지 않습니다.
        void authed('/open/v1/sessions/events/subscribe/chat', {
          method: 'POST',
          query: { sessionKey }
        })
          .then(() => {
            retry = 0
            opts.onStatus('connected')
          })
          .catch((e) => {
            opts.onStatus('error', e instanceof Error ? e.message : String(e))
          })
      })

      ws.on('message', (raw) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw.toString())
        } catch {
          return // 하트비트 등 JSON 이 아닌 프레임은 무시합니다.
        }

        const env = parsed as { event?: string; data?: ChatEventData }
        if (env.event !== 'CHAT' || !env.data) return

        const d = env.data
        const text = d.content ?? ''
        if (!text) return

        opts.onMessage({
          id: `cm-${d.senderChannelId ?? ''}-${d.messageTime ?? ''}-${seq++}`,
          platform: 'cime',
          nickname: d.profile?.nickname?.trim() || '알 수 없음',
          text,
          at: d.messageTime ? Date.parse(d.messageTime) || Date.now() : Date.now()
        })
      })

      ws.on('close', () => {
        if (closed) return
        retry += 1
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(retry, 5))
        opts.onStatus('connecting', `연결이 끊겨 ${Math.round(delay / 1000)}초 후 다시 시도합니다.`)
        retryTimer = setTimeout(() => void connect(), delay)
      })

      ws.on('error', (e) => {
        opts.onStatus('error', e instanceof Error ? e.message : String(e))
      })
    } catch (e) {
      if (closed) return
      const msg = e instanceof Error ? e.message : String(e)
      opts.onStatus('error', msg)

      // 세션 발급 자체가 실패한 경우에도 다시 시도합니다.
      retry += 1
      const delay = Math.min(60_000, 2000 * 2 ** Math.min(retry, 5))
      retryTimer = setTimeout(() => void connect(), delay)
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
      ws?.close()
      ws = null
    }
  }
}
