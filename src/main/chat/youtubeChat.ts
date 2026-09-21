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

/*
 * 채팅 메시지 경로는 /liveChat/messages 입니다.
 *
 * 문서에 적힌 리소스 이름은 liveChatMessages 인데 실제 URL 은 그게 아닙니다.
 * 리소스 이름을 그대로 경로에 붙이면 구글이 본문 없는 404 를 돌려주는데,
 * API 오류가 아니라 '그런 주소 없음' 이라 원인이 잘 드러나지 않습니다.
 * 바로 옆의 liveBroadcasts 는 이름과 경로가 같아서 더 헷갈립니다.
 */
const CHAT_PATH = '/liveChat/messages'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** 서버가 더 짧은 값을 줘도 이보다 자주 부르지 않습니다. */
const MIN_INTERVAL_MS = 5000
/** 응답에 값이 없을 때 쓸 기본 간격 */
const DEFAULT_INTERVAL_MS = 10_000

/**
 * 방송을 기다리는 간격. 오래 기다릴수록 뜸하게 봅니다.
 *
 * 채팅을 켜두고 방송을 나중에 시작하는 순서가 흔하고, 방송을 껐다 다시 켜는
 * 일도 흔합니다. 그래서 붙을 때까지 계속 찾습니다 — 시간 제한은 두지 않습니다.
 *
 * 대신 간격을 늘려 할당량을 아낍니다. 조회 한 번이 1~2 유닛이라, 처음 1분은
 * 촘촘히 보다가 2분 간격으로 벌어지면 시간당 60 유닛 안팎으로 내려갑니다.
 * 방금 방송을 켠 사람은 15초 안에 붙고, 몇 시간째 안 켠 사람은 싸게 기다립니다.
 */
function waitInterval(attempts: number): number {
  if (attempts <= 4) return 15_000
  if (attempts <= 10) return 30_000
  if (attempts <= 20) return 60_000
  return 120_000
}

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

/**
 * Google 오류 응답에서 사유 코드를 꺼냅니다.
 *
 *   { error: { code, message, errors: [ { reason: "quotaExceeded" } ] } }
 *
 * 메시지 문구로 판단하면 표현이 바뀌거나 번역될 때 조용히 깨집니다.
 * reason 코드는 고정이라 이쪽을 봅니다. 없으면 빈 문자열입니다.
 */
function googleReason(e: unknown): string {
  if (!(e instanceof ApiError)) return ''
  const body = e.body as
    | { error?: { errors?: { reason?: string }[]; status?: string } }
    | undefined
  return body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? ''
}

export function createYouTubeChat(opts: ChatClientOptions): ChatClient {
  const creds = getCredentials('youtube')
  if (!getToken('youtube')?.accessToken) {
    throw new ApiError('유튜브에 로그인되어 있지 않습니다.', 401)
  }

  let closed = false
  let timer: NodeJS.Timeout | null = null
  let liveChatId: string | null = null
  /** 그 채팅방 ID 를 어느 상태의 방송에서 가져왔는지 (404 처리에 씁니다) */
  let chatFrom = ''
  let pageToken: string | undefined
  /** 첫 응답은 과거 기록이므로 버립니다. */
  let primed = false
  let failures = 0
  /** 방송을 못 찾고 되돌아간 횟수 — 기다리는 간격을 정하는 데 씁니다. */
  let waitAttempts = 0
  /**
   * 예약된 방송은 건너뜁니다.
   *
   * 아직 시작하지 않은 방송에도 채팅방 ID 는 붙어 있는데, 그 방은 열려 있지
   * 않아서 조회하면 404 가 돌아옵니다. 한 번 겪고 나면 다음부터는 진행 중인
   * 방송만 찾습니다 — 안 그러면 같은 ID 를 계속 집어서 404 만 반복합니다.
   */
  let skipUpcoming = false

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
  const findLiveChatId = async (): Promise<{ id: string; from: string } | null> => {
    const targets = skipUpcoming ? (['active'] as const) : (['active', 'upcoming'] as const)

    for (const status of targets) {
      const res = await authed<ListResponse<BroadcastItem>>('/liveBroadcasts', {
        query: { part: 'snippet', broadcastStatus: status, broadcastType: 'all', maxResults: 1 }
      })
      const id = res.items?.[0]?.snippet?.liveChatId
      if (id) return { id, from: status }
    }
    return null
  }

  const schedule = (ms: number): void => {
    if (closed) return
    timer = setTimeout(() => void poll(), Math.max(MIN_INTERVAL_MS, ms))
  }

  /**
   * 채팅방을 놓아주고 다음 방송을 기다립니다.
   *
   * 붙어 있던 방송이 끝났을 때 쓰는 길입니다. 그 방송의 채팅방은 다시 열리지
   * 않으므로 급히 다시 찾을 이유가 없습니다. 그렇다고 아주 끄면, 방송인이
   * 방송을 다시 켰을 때 채팅이 안 붙습니다. 그래서 끄지 않고 처음 상태로
   * 되돌려 놓고, 새 방송이 뜰 때까지 뜸하게 살핍니다.
   *
   * waitAttempts 를 그대로 두는 게 중요합니다. 0 으로 되돌리면 방송이 끝날
   * 때마다 다시 15초 간격으로 촘촘히 돌아가서 할당량을 먹습니다.
   */
  const waitForNextBroadcast = (message: string): void => {
    liveChatId = null
    chatFrom = ''
    pageToken = undefined
    primed = false
    failures = 0
    waitAttempts += 1

    opts.onStatus('connecting', message)
    schedule(waitInterval(waitAttempts))
  }

  const poll = async (): Promise<void> => {
    if (closed) return

    try {
      if (!liveChatId) {
        const found = await findLiveChatId()

        if (!found) {
          waitAttempts += 1
          opts.onStatus('connecting', '방송을 기다리는 중입니다. 시작하면 자동으로 붙습니다.')
          schedule(waitInterval(waitAttempts))
          return
        }

        liveChatId = found.id
        chatFrom = found.from
        waitAttempts = 0
        failures = 0
        // 다른 방송일 수 있으니 이어받던 자리를 버리고 처음부터 시작합니다.
        pageToken = undefined
        primed = false
        opts.onStatus('connected')
      }

      const res = await authed<ChatListResponse>(CHAT_PATH, {
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
      const reason = googleReason(e)

      /*
       * 404 = 그 채팅방이 없습니다.
       *
       * 예약만 해둔 방송의 채팅방은 아직 열리지 않았는데도 ID 는 붙어 있어서
       * 여기로 들어옵니다. 같은 ID 를 계속 두드려봐야 결과가 달라지지 않으니
       * 놓아주고 다음 방송을 기다립니다.
       */
      if (e instanceof ApiError && e.status === 404) {
        // 예약 방송에서 가져온 ID 였다면, 다음부터는 진행 중인 방송만 봅니다.
        if (chatFrom === 'upcoming') skipUpcoming = true
        waitForNextBroadcast('채팅방을 다시 찾는 중입니다.')
        return
      }

      failures += 1

      /*
       * 다시 시도해도 소용없는 오류는 즉시 멈춥니다.
       *
       * 특히 할당량 초과는 재시도가 해롭습니다 — 실패한 호출도 할당량을 먹기 때문에
       * 두드릴수록 상황이 나빠집니다. 문구 매칭 대신 Google 이 주는 reason 코드로
       * 판단합니다. 메시지는 번역·표현이 바뀔 수 있지만 코드는 고정입니다.
       */
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        opts.onStatus('error', '유튜브 하루 사용량을 모두 썼습니다. 내일 다시 시도해 주세요.')
        closed = true
        return
      }

      /*
       * 방송이 끝났습니다.
       *
       * 그 채팅방은 다시 열리지 않으니 같은 ID 로 매달릴 이유가 없습니다.
       * 그렇다고 여기서 끝내면 방송을 다시 켰을 때 채팅이 안 붙어서,
       * 사용자가 채팅 버튼을 껐다 켜야 합니다. 그래서 기다리는 상태로 돌립니다.
       */
      if (reason === 'liveChatEnded') {
        waitForNextBroadcast('방송이 끝났습니다. 다시 켜면 자동으로 붙습니다.')
        return
      }

      /*
       * 이 방송은 채팅이 꺼져 있습니다 (아동용으로 표시하면 유튜브가 끕니다).
       * 다음 방송은 켜져 있을 수 있으니 이것도 기다리는 상태로 돌립니다.
       */
      if (reason === 'liveChatDisabled') {
        waitForNextBroadcast(
          '이 방송은 채팅이 꺼져 있습니다. 아동용으로 표시하면 유튜브가 채팅을 끕니다.'
        )
        return
      }

      // 권한 문제는 기다려도 달라지지 않습니다. 여기서 멈추고 사유를 보여줍니다.
      if (reason === 'forbidden') {
        opts.onStatus('error', `채팅을 읽을 수 없습니다. ${msg}`)
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

      await authed(CHAT_PATH, {
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
