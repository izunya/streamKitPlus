import type { ChatMessage } from '../../shared/chat'
import { apiFetch, ApiError, type RequestOptions } from '../net'
import { getCredentials, getToken, setToken } from '../vault'
import { toExpiryMs } from '../platforms/base'
import type { ChatClient, ChatClientOptions } from './twitchChat'

/**
 * YouTube 채팅 (liveChatMessages 폴링).
 *
 * 다른 플랫폼은 소켓이라 유지 비용이 거의 0 인데, 유튜브만 주기적으로 조회해야 합니다.
 * 그래서 할당량을 아끼는 데 신경을 썼습니다:
 *
 *   1. 서버가 알려주는 pollingIntervalMillis 를 그대로 따릅니다.
 *      (임의로 더 자주 부르면 할당량만 태우고 결과는 같습니다)
 *   2. 그래도 최소 간격을 5초로 강제합니다.
 *   3. nextPageToken 을 넘겨 새 메시지만 받습니다.
 *   4. 처음 응답은 과거 기록이라 화면에 넣지 않습니다.
 *      "앱을 켠 뒤부터" 라는 요구사항에 맞추고, 한꺼번에 쏟아지는 것도 막습니다.
 *   5. 연속 실패 시 간격을 늘려 조용히 물러납니다.
 */

const API = 'https://www.googleapis.com/youtube/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** 서버가 더 짧은 값을 줘도 이보다 자주 부르지 않습니다. */
const MIN_INTERVAL_MS = 5000
/** 응답에 값이 없을 때 쓸 기본 간격 */
const DEFAULT_INTERVAL_MS = 10_000

interface ListResponse<T> {
  items?: T[]
}

interface BroadcastItem {
  id: string
  snippet?: { liveChatId?: string }
}

interface ChatItem {
  id: string
  snippet?: { displayMessage?: string; publishedAt?: string }
  authorDetails?: { displayName?: string }
}

interface ChatListResponse {
  items?: ChatItem[]
  nextPageToken?: string
  pollingIntervalMillis?: number
}

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export function createYouTubeChat(opts: ChatClientOptions): ChatClient {
  const creds = getCredentials('youtube')
  if (!getToken('youtube')?.accessToken) {
    throw new ApiError('유튜브에 로그인되어 있지 않습니다.', 401)
  }

  let closed = false
  let timer: NodeJS.Timeout | null = null
  let liveChatId: string | null = null
  let pageToken: string | undefined
  /** 첫 응답은 과거 기록이므로 버립니다. */
  let primed = false
  let failures = 0

  const freshToken = async (): Promise<string> => {
    const t = getToken('youtube')
    if (!t) throw new ApiError('유튜브에 로그인되어 있지 않습니다.', 401)

    const nearExpiry = t.expiresAt !== undefined && t.expiresAt - Date.now() < 60_000
    if (!nearExpiry || t.manual || !t.refreshToken || !creds?.clientId) return t.accessToken

    try {
      const res = await apiFetch<GoogleTokenResponse>(TOKEN_URL, {
        method: 'POST',
        form: {
          grant_type: 'refresh_token',
          refresh_token: t.refreshToken,
          client_id: creds.clientId,
          ...(creds.clientSecret ? { client_secret: creds.clientSecret } : {})
        }
      })
      setToken('youtube', {
        accessToken: res.access_token,
        refreshToken: res.refresh_token ?? t.refreshToken,
        expiresAt: toExpiryMs(res.expires_in)
      })
      return res.access_token
    } catch {
      return t.accessToken
    }
  }

  const authed = async <T>(path: string, init: RequestOptions = {}): Promise<T> => {
    const access = await freshToken()
    return apiFetch<T>(`${API}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${access}` }
    })
  }

  /** 진행 중인 방송의 채팅방 ID 를 찾습니다. 없으면 채팅을 켤 수 없습니다. */
  const findLiveChatId = async (): Promise<string | null> => {
    for (const status of ['active', 'upcoming'] as const) {
      const res = await authed<ListResponse<BroadcastItem>>('/liveBroadcasts', {
        query: { part: 'snippet', broadcastStatus: status, broadcastType: 'all', maxResults: 1 }
      })
      const id = res.items?.[0]?.snippet?.liveChatId
      if (id) return id
    }
    return null
  }

  const schedule = (ms: number): void => {
    if (closed) return
    timer = setTimeout(() => void poll(), Math.max(MIN_INTERVAL_MS, ms))
  }

  const poll = async (): Promise<void> => {
    if (closed) return

    try {
      if (!liveChatId) {
        liveChatId = await findLiveChatId()
        if (!liveChatId) {
          opts.onStatus(
            'error',
            '진행 중인 방송이 없습니다. 방송을 시작한 뒤 다시 켜주세요.'
          )
          closed = true
          return
        }
        opts.onStatus('connected')
      }

      const res = await authed<ChatListResponse>('/liveChatMessages', {
        query: {
          liveChatId,
          part: 'snippet,authorDetails',
          pageToken,
          maxResults: 200
        }
      })

      pageToken = res.nextPageToken
      failures = 0

      // 첫 응답은 앱을 켜기 전의 기록이라 흘려보냅니다.
      if (!primed) {
        primed = true
      } else {
        for (const item of res.items ?? []) {
          const text = item.snippet?.displayMessage
          if (!text) continue

          opts.onMessage({
            id: item.id,
            platform: 'youtube',
            nickname: item.authorDetails?.displayName?.trim() || '알 수 없음',
            text,
            at: item.snippet?.publishedAt
              ? Date.parse(item.snippet.publishedAt) || Date.now()
              : Date.now()
          })
        }
      }

      // 서버가 알려준 간격을 따릅니다. 더 자주 불러도 얻는 게 없습니다.
      schedule(res.pollingIntervalMillis ?? DEFAULT_INTERVAL_MS)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures += 1

      // 할당량 초과는 기다린다고 풀리지 않으므로 멈춥니다.
      if (msg.includes('quota') || msg.includes('Quota')) {
        opts.onStatus('error', '유튜브 하루 사용량을 모두 썼습니다. 내일 다시 시도해 주세요.')
        closed = true
        return
      }

      if (failures >= 5) {
        opts.onStatus('error', `채팅을 불러오지 못했습니다. ${msg}`)
        closed = true
        return
      }

      opts.onStatus('connecting', `잠시 후 다시 시도합니다. ${msg}`)
      schedule(DEFAULT_INTERVAL_MS * failures)
    }
  }

  opts.onStatus('connecting')
  void poll()

  return {
    async send(text) {
      if (!liveChatId) throw new ApiError('채팅방을 찾지 못했습니다.', 503)
      const safe = text.trim()
      if (!safe) return

      await authed('/liveChatMessages', {
        method: 'POST',
        query: { part: 'snippet' },
        body: {
          snippet: {
            liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: { messageText: safe }
          }
        }
      })
    },

    close() {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}
