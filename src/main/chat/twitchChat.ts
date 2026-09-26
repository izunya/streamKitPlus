import { WebSocket } from 'ws'
import type { ChatMessage } from '../../shared/chat'
import { getAccount, getCredentials, getToken, setAccount, setToken } from '../vault'
import { ApiError, apiFetch } from '../net'
import { authCodeFlow, deviceCodeFlow, refreshTwitchToken } from '../platforms/twitch'
import type { CredentialSlot } from '../../shared/redirectUri'
import type { DeviceCodeInfo } from '../platforms/base'

/**
 * Twitch 채팅 (IRC over WebSocket).
 *
 *   wss://irc-ws.chat.twitch.tv:443
 *   PASS oauth:<token> / NICK <login> / JOIN #<channel>
 *   보내기: PRIVMSG #channel :내용
 *
 * 필요한 스코프는 chat:read (읽기), chat:edit (쓰기) 입니다. 방송 로그인에서
 * 이 둘까지 같이 받아 두므로 채팅용 앱을 따로 등록하지 않아도 됩니다.
 *
 * 자격 증명 슬롯이 'chat' 으로 나뉜 건 IRC 가 소문자 login 을 요구하기 때문입니다.
 * 방송 슬롯에는 표시 이름이 들어 있어서 그 자리를 같이 쓸 수 없습니다.
 */

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'

/** 서버가 PING 을 보내면 반드시 PONG 해야 연결이 유지됩니다. */
const PING_PREFIX = 'PING'

export interface ChatClient {
  send(text: string): Promise<void>
  close(): void
}

export interface ChatClientOptions {
  onMessage: (msg: ChatMessage) => void
  onStatus: (status: 'connecting' | 'connected' | 'error', error?: string) => void
}

/**
 * IRCv3 태그를 파싱합니다.
 *   @display-name=Ronni;color=#0D4200 :ronni!ronni@... PRIVMSG #ch :message
 */
function parseTags(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=')
    if (i < 0) continue
    // IRC 태그는 일부 문자를 이스케이프합니다.
    out[pair.slice(0, i)] = pair
      .slice(i + 1)
      .replace(/\\s/g, ' ')
      .replace(/\\:/g, ';')
      .replace(/\\\\/g, '\\')
  }
  return out
}

interface ParsedLine {
  tags: Record<string, string>
  prefix: string
  command: string
  params: string[]
  trailing: string
}

function parseLine(line: string): ParsedLine {
  let rest = line
  let tags: Record<string, string> = {}

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ')
    tags = parseTags(rest.slice(1, sp))
    rest = rest.slice(sp + 1)
  }

  let prefix = ''
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ')
    prefix = rest.slice(1, sp)
    rest = rest.slice(sp + 1)
  }

  // 마지막 파라미터는 ' :' 뒤에 오고 공백을 포함할 수 있습니다.
  const ti = rest.indexOf(' :')
  const trailing = ti >= 0 ? rest.slice(ti + 2) : ''
  const head = ti >= 0 ? rest.slice(0, ti) : rest
  const parts = head.split(' ').filter(Boolean)

  return { tags, prefix, command: parts[0] ?? '', params: parts.slice(1), trailing }
}

export function createTwitchChat(opts: ChatClientOptions): ChatClient {
  /*
   * IRC 는 접속할 때 토큰만 씁니다 (PASS oauth:...). Client ID 는 필요 없습니다.
   * 그래서 방송 로그인에서 받은 토큰을 그대로 씁니다 — 채팅용 앱이 따로 없어도 됩니다.
   * 채팅 전용 앱을 등록해 둔 경우에는 그쪽 토큰을 우선합니다.
   */
  const slot: CredentialSlot = getToken('twitch', 'chat') ? 'chat' : 'broadcast'
  if (!getToken('twitch', slot)?.accessToken) {
    throw new ApiError('Twitch 에 로그인되어 있지 않습니다.', 401)
  }

  // 채널명은 로그인 이름(소문자)이어야 합니다. 표시 이름과 다를 수 있습니다.
  const account = getAccount('twitch', 'chat') ?? getAccount('twitch')
  const login = (account?.displayName ?? '').toLowerCase()
  if (!login) {
    throw new ApiError('Twitch 채널 이름을 알 수 없습니다. 다시 로그인해 주세요.', 400)
  }

  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let retryTimer: NodeJS.Timeout | null = null
  let seq = 0
  /** 토큰을 갱신하고 다시 붙어본 적이 있는지 (무한 반복 방지) */
  let authRetried = false
  /** 우리가 일부러 끊는 중인지 — close 핸들러가 재연결을 또 걸지 않도록 */
  let reconnecting = false

  /**
   * 붙기 직전에 토큰을 확인합니다.
   *
   * 트위치 액세스 토큰은 네 시간쯤이면 만료됩니다. 예전에는 채팅을 켤 때 한 번
   * 읽은 토큰을 계속 들고 있어서, 만료된 뒤에는 재접속을 해도 같은 죽은 토큰을
   * 보내 "Login authentication failed" 만 반복했습니다. IRC 는 HTTP 가 아니라
   * 401 을 받을 자리가 없으니, 붙기 전에 직접 챙겨야 합니다.
   */
  const freshToken = async (force = false): Promise<string> => {
    const t = getToken('twitch', slot)
    if (!t?.accessToken) throw new ApiError('Twitch 에 로그인되어 있지 않습니다.', 401)

    const nearExpiry = t.expiresAt !== undefined && t.expiresAt - Date.now() < 60_000
    if (!force && !nearExpiry) return t.accessToken

    // 직접 붙여넣은 토큰이나 갱신 수단이 없는 토큰은 그대로 써보는 수밖에 없습니다.
    if (t.manual || !t.refreshToken) return t.accessToken

    const next = await refreshTwitchToken(t.refreshToken, slot)
    setToken('twitch', next, slot)
    return next.accessToken
  }

  const connect = async (): Promise<void> => {
    if (closed) return
    opts.onStatus('connecting')

    let token: string
    try {
      token = await freshToken()
    } catch (e) {
      opts.onStatus('error', e instanceof Error ? e.message : String(e))
      closed = true
      return
    }

    ws = new WebSocket(IRC_URL)

    ws.on('open', () => {
      // 태그를 요청해야 display-name 을 받을 수 있습니다.
      ws?.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws?.send(`PASS oauth:${token}`)
      ws?.send(`NICK ${login}`)
      ws?.send(`JOIN #${login}`)
    })

    ws.on('message', (data) => {
      // 한 프레임에 여러 줄이 올 수 있습니다.
      for (const line of data.toString().split('\r\n')) {
        if (!line) continue

        if (line.startsWith(PING_PREFIX)) {
          ws?.send(line.replace(PING_PREFIX, 'PONG'))
          continue
        }

        const p = parseLine(line)

        if (p.command === '001') {
          // 001 = 로그인 성공
          retry = 0
          authRetried = false
          opts.onStatus('connected')
          continue
        }

        if (p.command === 'NOTICE' && p.trailing.toLowerCase().includes('login authentication')) {
          /*
           * 토큰이 거부됐습니다. 대부분은 만료입니다.
           *
           * 한 번은 강제로 갱신하고 다시 붙어봅니다. 갱신까지 실패하면 그때는
           * 정말 다시 연동해야 하는 상황이라 사용자에게 넘깁니다.
           */
          if (authRetried) {
            opts.onStatus('error', '로그인에 실패했습니다. 채팅 권한으로 다시 로그인해 주세요.')
            closed = true
            ws?.close()
            continue
          }

          authRetried = true
          reconnecting = true
          opts.onStatus('connecting', '토큰을 갱신하고 다시 붙습니다.')
          ws?.close()

          void freshToken(true)
            .then(() => connect())
            .catch(() => {
              opts.onStatus('error', '로그인에 실패했습니다. 채팅 권한으로 다시 로그인해 주세요.')
              closed = true
            })
          continue
        }

        if (p.command !== 'PRIVMSG') continue

        const nickname =
          p.tags['display-name']?.trim() || p.prefix.split('!')[0] || '알 수 없음'

        opts.onMessage({
          id: p.tags['id'] || `tw-${Date.now()}-${seq++}`,
          platform: 'twitch',
          nickname,
          text: p.trailing,
          at: Number(p.tags['tmi-sent-ts']) || Date.now()
        })
      }
    })

    ws.on('close', () => {
      if (closed) return

      // 토큰 갱신 때문에 우리가 끊은 경우입니다. 재연결은 그쪽에서 이어갑니다.
      if (reconnecting) {
        reconnecting = false
        return
      }

      // 끊기면 점점 간격을 늘리며 다시 붙습니다 (최대 30초).
      retry += 1
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(retry, 5))
      opts.onStatus('connecting', `연결이 끊겨 ${Math.round(delay / 1000)}초 후 재시도합니다.`)
      retryTimer = setTimeout(() => void connect(), delay)
    })

    ws.on('error', (e) => {
      opts.onStatus('error', e instanceof Error ? e.message : String(e))
    })
  }

  void connect()

  return {
    async send(text) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new ApiError('채팅 서버에 연결되어 있지 않습니다.', 503)
      }
      // 줄바꿈은 IRC 프로토콜을 깨뜨리므로 공백으로 바꿉니다.
      const safe = text.replace(/[\r\n]+/g, ' ').trim()
      if (!safe) return
      ws.send(`PRIVMSG #${login} :${safe}`)
    },

    close() {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
      ws = null
    }
  }
}

/* ------------------------------------------------------------------ */
/* 채팅 전용 로그인                                                     */
/* ------------------------------------------------------------------ */

/**
 * 채팅용 앱을 따로 등록해 둔 경우에만 쓰는 로그인입니다.
 *
 * 보통은 쓸 일이 없습니다 — 방송 로그인이 채팅 권한까지 받아오고 그 토큰을
 * 채팅 슬롯에도 넣어 둡니다. 채팅만 다른 계정으로 쓰고 싶을 때의 선택지입니다.
 *
 * IRC 에 붙으려면 채널명이 필요한데, 이때 쓰는 이름은 표시 이름이 아니라
 * 소문자 login 입니다. 그래서 여기서 login 을 저장해 둡니다.
 */
const CHAT_SCOPES = ['chat:read', 'chat:edit']

export async function loginTwitchChat(
  notify?: (info: DeviceCodeInfo) => void,
  signal?: AbortSignal
): Promise<{ displayName: string; channelId: string }> {
  const creds = getCredentials('twitch', 'chat')
  if (!creds?.clientId) {
    throw new ApiError('Twitch 채팅용 Client ID 가 없습니다. 설정에서 등록해 주세요.', 400)
  }

  // Secret 이 없으면 Device Code Flow (public client) 로 갑니다.
  const token = creds.clientSecret
    ? await authCodeFlow(creds.clientId, creds.clientSecret, signal, CHAT_SCOPES, 'chat')
    : await deviceCodeFlow(creds.clientId, notify, signal, CHAT_SCOPES)

  setToken('twitch', token, 'chat')

  try {
    const res = await apiFetch<{ data: { id: string; login: string; display_name: string }[] }>(
      'https://api.twitch.tv/helix/users',
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Client-Id': creds.clientId
        }
      }
    )
    const me = res.data?.[0]
    if (!me) throw new ApiError('채널 정보를 가져오지 못했습니다.', 404)

    // IRC 는 소문자 login 을 씁니다. 표시 이름을 쓰면 JOIN 이 실패합니다.
    const account = { displayName: me.login, channelId: me.id }
    setAccount('twitch', { ...account, connectedAt: Date.now() }, 'chat')
    return account
  } catch (e) {
    // 토큰만 남고 계정 정보가 없으면 다음 연결에서 채널명을 못 찾습니다.
    setToken('twitch', null, 'chat')
    throw e
  }
}
