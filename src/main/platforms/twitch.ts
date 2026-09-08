import type { PlatformCategory, PlatformPatch, UpdateResult } from '../../shared/types'
import { apiFetch, ApiError, type RequestOptions } from '../net'
import { startOAuthFlow } from '../oauth'
import { getAccount, getCredentials, setAccount, setToken, type StoredToken } from '../vault'
import { getRedirectSpec } from '../../shared/redirectUri'
import { failure, toExpiryMs, withRetryOnAuth, type DeviceCodeInfo, type ServerAdapter } from './base'
import { shell } from 'electron'

/**
 * Twitch Helix 어댑터.
 *
 *   PATCH /helix/channels?broadcaster_id=..   scope: channel:manage:broadcast
 *     { title(<=140), game_id, tags(<=10, 각 <=25, 공백·특수문자 불가) }
 *   GET   /helix/channels?broadcaster_id=..   현재 설정 조회
 *   GET   /helix/search/categories?query=..   카테고리(게임) 검색
 *   GET   /helix/users                        내 채널 정보
 *
 * ── 인증 방식 ──────────────────────────────────────────────
 * Twitch 는 PKCE 를 지원하지 않지만 Device Code Flow 를 지원하며,
 * 문서가 "public clients do not need to maintain a client secret" 이라고 명시합니다.
 * 그래서 기본은 Device Code Flow 를 씁니다 — Client Secret 이 필요 없습니다.
 *
 * Secret 이 설정되어 있으면 기존 authorization_code 방식을 씁니다
 * (리프레시 토큰 수명 등에서 유리할 수 있어 선택지로 남겨둡니다).
 */

const API = 'https://api.twitch.tv/helix'
const AUTHORIZE = 'https://id.twitch.tv/oauth2/authorize'
const TOKEN = 'https://id.twitch.tv/oauth2/token'
const DEVICE = 'https://id.twitch.tv/oauth2/device'

/**
 * 한 번의 로그인으로 방송 정보와 채팅을 모두 처리합니다.
 *
 * 스코프는 앱이 아니라 "인증할 때" 요청하는 것이라 한 토큰에 같이 담을 수 있습니다.
 * 채팅 IRC 는 접속할 때 토큰만 쓰고 Client ID 를 요구하지 않으므로,
 * 채팅용 앱을 따로 등록할 필요가 없습니다.
 */
const SCOPES = ['channel:manage:broadcast', 'user:read:email', 'chat:read', 'chat:edit']

interface TwitchTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

interface TwitchUser {
  id: string
  login: string
  display_name: string
}

interface TwitchChannel {
  broadcaster_id: string
  broadcaster_name: string
  game_id: string
  game_name: string
  title: string
  tags?: string[]
}

interface TwitchCategory {
  id: string
  name: string
}

interface DeviceStartResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval?: number
}

/**
 * Secret 이 있을 때 쓰는 표준 인증 코드 흐름.
 *
 * Twitch 는 등록된 OAuth 리디렉션 URL 과 정확히 일치하는 주소만 허용하므로
 * 포트를 고정해서 씁니다.
 */
export async function authCodeFlow(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal,
  scopes: string[] = SCOPES,
  slot: 'broadcast' | 'chat' = 'broadcast'
): Promise<StoredToken> {
  const spec = getRedirectSpec('twitch', slot)

  const { code, redirectUri } = await startOAuthFlow({
    authorizeUrl: AUTHORIZE,
    clientId,
    scopes,
    usePkce: false, // Twitch 는 PKCE 를 지원하지 않습니다.
    fixedPort: spec?.port,
    host: spec?.host,
    callbackPath: spec?.path,
    signal,
    // 기본 브라우저로 엽니다 (이미 로그인된 세션을 그대로 활용).
    openIn: 'system'
  })

  const res = await apiFetch<TwitchTokenResponse>(TOKEN, {
    method: 'POST',
    form: {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }
  })
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: toExpiryMs(res.expires_in)
  }
}

/**
 * Device Code Flow — Client Secret 이 필요 없습니다.
 *
 *   1. /oauth2/device 로 device_code 와 user_code 를 받는다
 *   2. 사용자를 verification_uri 로 보낸다 (브라우저 자동 실행)
 *   3. 사용자가 승인할 때까지 /oauth2/token 을 주기적으로 두드린다
 *
 * 승인 전에는 authorization_pending 오류가 계속 돌아오는 것이 정상입니다.
 */
export async function deviceCodeFlow(
  clientId: string,
  notify?: (info: DeviceCodeInfo) => void,
  signal?: AbortSignal,
  scopeList: string[] = SCOPES
): Promise<StoredToken> {
  const scopes = scopeList.join(' ')

  const start = await apiFetch<DeviceStartResponse>(DEVICE, {
    method: 'POST',
    form: { client_id: clientId, scopes }
  })

  notify?.({
    userCode: start.user_code,
    verificationUri: start.verification_uri,
    expiresInSec: start.expires_in
  })

  // verification_uri 에 코드가 포함되어 있으면 사용자는 확인만 누르면 됩니다.
  void shell.openExternal(start.verification_uri)

  const intervalMs = Math.max(1, start.interval ?? 5) * 1000
  const deadline = Date.now() + start.expires_in * 1000

  /** 취소되면 즉시 깨어나는 대기 */
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve, rejectWait) => {
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      function onAbort(): void {
        clearTimeout(t)
        rejectWait(new ApiError('연동을 취소했습니다.', 499))
      }
      if (signal?.aborted) {
        clearTimeout(t)
        rejectWait(new ApiError('연동을 취소했습니다.', 499))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })

  while (Date.now() < deadline) {
    await wait(intervalMs)

    try {
      const res = await apiFetch<TwitchTokenResponse>(TOKEN, {
        method: 'POST',
        form: {
          client_id: clientId,
          scopes,
          device_code: start.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }
      })
      return {
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        expiresAt: toExpiryMs(res.expires_in)
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message.toLowerCase() : ''
      // 아직 승인 전 — 계속 기다립니다.
      if (msg.includes('authorization_pending') || msg.includes('pending')) continue
      // 너무 자주 물어봄 — 간격을 늘려야 하지만, 다음 주기에 자연히 해결됩니다.
      if (msg.includes('slow_down')) continue
      throw e
    }
  }

  throw new ApiError('인증 대기 시간이 초과되었습니다. 다시 시도해 주세요.', 408)
}

export function createTwitchAdapter(): ServerAdapter {
  const id = 'twitch' as const

  /** Client ID 만 필수입니다. Secret 은 있으면 쓰고 없으면 device flow 로 갑니다. */
  const requireClientId = (): string => {
    const c = getCredentials(id)
    if (!c?.clientId) {
      throw new ApiError('Client ID 가 설정되지 않았습니다. 설정에서 먼저 입력해 주세요.', 400)
    }
    return c.clientId
  }

  const clientSecretOrNull = (): string | null => getCredentials(id)?.clientSecret ?? null

  const refresh = async (refreshToken: string): Promise<StoredToken> => {
    const clientId = requireClientId()
    const secret = clientSecretOrNull()
    const res = await apiFetch<TwitchTokenResponse>(TOKEN, {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        // public client 는 secret 없이 갱신합니다.
        ...(secret ? { client_secret: secret } : {})
      }
    })
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? refreshToken,
      expiresAt: toExpiryMs(res.expires_in)
    }
  }

  const authed = <T>(path: string, init: RequestOptions = {}): Promise<T> =>
    withRetryOnAuth(id, refresh, (token) => {
      const clientId = requireClientId()
      return apiFetch<T>(`${API}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
          'Client-Id': clientId
        }
      })
    })

  const fetchMe = async (): Promise<TwitchUser> => {
    const res = await authed<{ data: TwitchUser[] }>('/users')
    const me = res.data?.[0]
    if (!me) throw new ApiError('채널 정보를 가져오지 못했습니다.', 404)
    return me
  }

  /** 저장된 계정에서 broadcaster_id 를 얻습니다. 없으면 조회합니다. */
  const broadcasterId = async (): Promise<string> => {
    const saved = getAccount(id)?.channelId
    if (saved) return saved
    return (await fetchMe()).id
  }

  const readChannel = async (): Promise<PlatformPatch | null> => {
    const res = await authed<{ data: TwitchChannel[] }>('/channels', {
      query: { broadcaster_id: await broadcasterId() }
    })
    const ch = res.data?.[0]
    if (!ch) return null
    return {
      platform: id,
      title: ch.title,
      categoryId: ch.game_id,
      categoryName: ch.game_name,
      tags: ch.tags ?? []
    }
  }

  return {
    id,

    async connectOAuth(opts) {
      const clientId = requireClientId()
      const secret = clientSecretOrNull()

      // Secret 이 있으면 표준 authorization_code, 없으면 Device Code Flow.
      const token = secret
        ? await authCodeFlow(clientId, secret, opts?.signal)
        : await deviceCodeFlow(clientId, opts?.notify, opts?.signal)

      setToken(id, token)
      const me = await fetchMe()

      /*
       * 채팅도 같은 토큰으로 붙습니다.
       * IRC 는 표시 이름이 아니라 소문자 login 으로 채널에 들어가야 하므로
       * 채팅 슬롯에는 login 을 저장합니다.
       */
      setToken(id, token, 'chat')
      setAccount(id, { displayName: me.login, channelId: me.id, connectedAt: Date.now() }, 'chat')

      return { displayName: me.display_name || me.login, channelId: me.id }
    },

    async connectToken(accessToken) {
      setToken(id, { accessToken, manual: true })
      const me = await fetchMe()
      return { displayName: me.display_name || me.login, channelId: me.id }
    },

    fetchCurrent: readChannel,

    async searchCategory(query) {
      if (!query.trim()) return []
      const res = await authed<{ data: TwitchCategory[] }>('/search/categories', {
        query: { query, first: 20 }
      })
      return (res.data ?? []).map(
        (c): PlatformCategory => ({
          id: c.id,
          name: c.name,
          // Twitch 카탈로그는 대부분 게임이지만 Just Chatting 등 비게임 항목도 있습니다.
          isGame: !NON_GAME_CATEGORIES.has(c.name)
        })
      )
    },

    async updateBroadcast(patch): Promise<UpdateResult> {
      const started = Date.now()

      let previous: PlatformPatch | null = null
      try {
        previous = await readChannel()
      } catch {
        previous = null
      }

      const body: Record<string, unknown> = {}
      const fields: UpdateResult['fields'] = {}

      // 빈 문자열은 허용되지 않으므로 값이 있을 때만 넣습니다.
      if (patch.title) {
        body.title = patch.title
        fields.title = { outcome: 'applied', value: patch.title }
      }
      if (patch.categoryId) {
        body.game_id = patch.categoryId
        fields.category = { outcome: 'applied', value: patch.categoryName }
      }
      if (patch.tags) {
        body.tags = patch.tags
        fields.tags = { outcome: 'applied', value: patch.tags.join(', ') }
      }

      if (Object.keys(body).length === 0) {
        return { platform: id, ok: true, durationMs: Date.now() - started, fields }
      }

      try {
        await authed('/channels', {
          method: 'PATCH',
          query: { broadcaster_id: await broadcasterId() },
          body
        })
        return {
          platform: id,
          ok: true,
          durationMs: Date.now() - started,
          fields,
          previous: previous
            ? {
                title: previous.title,
                categoryId: previous.categoryId,
                categoryName: previous.categoryName,
                tags: previous.tags
              }
            : undefined
        }
      } catch (e) {
        return failure(id, started, e)
      }
    }
  }
}

/** Twitch 카탈로그에서 게임이 아닌 항목들 */
const NON_GAME_CATEGORIES = new Set([
  'Just Chatting',
  'Music',
  'Art',
  'Sports',
  'Travel & Outdoors',
  'Talk Shows & Podcasts',
  'Special Events',
  'ASMR',
  'Makers & Crafting',
  'Food & Drink',
  'Science & Technology',
  'Fitness & Health',
  'Beauty & Body Art',
  'Software and Game Development',
  'Politics',
  'Animals, Aquariums, and Zoos'
])
