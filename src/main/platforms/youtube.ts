import type { PlatformCategory, PlatformPatch, UpdateResult } from '../../shared/types'
import { apiFetch, ApiError, type RequestOptions } from '../net'
import { startOAuthFlow } from '../oauth'
import { getCredentials, setToken, type StoredToken } from '../vault'
import { getRedirectSpec } from '../../shared/redirectUri'
import { failure, toExpiryMs, withRetryOnAuth, type ServerAdapter } from './base'

/**
 * YouTube Data API v3 어댑터.
 *
 * 방송 정보 수정 절차가 다른 플랫폼보다 한 단계 깁니다:
 *   1. liveBroadcasts.list 로 현재 진행 중(active)인 방송을 찾는다
 *      - 없으면 upcoming(예약된 방송)을 찾는다
 *   2. 그 방송의 videoId 로 videos.list 를 호출해 현재 snippet 을 읽는다
 *   3. snippet 을 통째로 다시 보내야 하므로(부분 업데이트 불가) 병합해서 videos.update
 *
 * ⚠️ 게임 제목: Data API v3 에는 라이브의 "게임 제목" 필드가 없습니다.
 *    (liveBroadcast.snippet 에도, video.snippet 에도 없습니다.)
 *    대분류(categoryId=20 게임)까지는 설정되지만 게임 제목은 API 로 지정할 수 없어,
 *    적용 결과에 unsupported 로 명시합니다. 조용히 버리면 안 되는 정보입니다.
 */

const API = 'https://www.googleapis.com/youtube/v3'
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

const SCOPES = ['https://www.googleapis.com/auth/youtube']

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

interface VideoSnippet {
  title?: string
  description?: string
  categoryId?: string
  tags?: string[]
  defaultLanguage?: string
}

interface ListResponse<T> {
  items?: T[]
}

interface BroadcastItem {
  id: string
  snippet?: { title?: string; channelId?: string }
  status?: { lifeCycleStatus?: string }
}

interface VideoItem {
  id: string
  snippet?: VideoSnippet
}

interface ChannelItem {
  id: string
  snippet?: { title?: string }
}

export function createYouTubeAdapter(): ServerAdapter {
  const id = 'youtube' as const

  /**
   * Client ID 만 필수입니다.
   *
   * Google 문서가 "installed apps cannot keep secrets" 라고 명시하고
   * client_secret 을 설치형 앱 토큰 교환에서 Optional 로 둡니다.
   * PKCE(필수로 켜둠)가 secret 역할을 대신합니다.
   * 콘솔에서 secret 이 함께 발급되는 유형이면 넣어도 되고, 없어도 동작합니다.
   */
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
    const res = await apiFetch<GoogleTokenResponse>(TOKEN, {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        ...(secret ? { client_secret: secret } : {})
      }
    })
    return {
      accessToken: res.access_token,
      // Google 은 갱신 시 refresh_token 을 다시 주지 않습니다. 기존 값을 유지합니다.
      refreshToken: res.refresh_token ?? refreshToken,
      expiresAt: toExpiryMs(res.expires_in)
    }
  }

  const authed = <T>(path: string, init: RequestOptions = {}): Promise<T> =>
    withRetryOnAuth(id, refresh, (token) =>
      apiFetch<T>(`${API}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` }
      })
    )

  const fetchMyChannel = async (): Promise<ChannelItem> => {
    const res = await authed<ListResponse<ChannelItem>>('/channels', {
      query: { part: 'snippet', mine: 'true' }
    })
    const ch = res.items?.[0]
    if (!ch) throw new ApiError('채널 정보를 가져오지 못했습니다.', 404)
    return ch
  }

  /** 지금 방송 중인 라이브를 찾습니다. 없으면 예약된 방송을 찾습니다. */
  const findBroadcast = async (): Promise<BroadcastItem | null> => {
    for (const status of ['active', 'upcoming'] as const) {
      const res = await authed<ListResponse<BroadcastItem>>('/liveBroadcasts', {
        query: {
          part: 'id,snippet,status',
          broadcastStatus: status,
          broadcastType: 'all',
          maxResults: 1
        }
      })
      const item = res.items?.[0]
      if (item) return item
    }
    return null
  }

  const readVideoSnippet = async (videoId: string): Promise<VideoSnippet> => {
    const res = await authed<ListResponse<VideoItem>>('/videos', {
      query: { part: 'snippet', id: videoId }
    })

    return res.items?.[0]?.snippet ?? {}
  }

  const readCurrent = async (): Promise<PlatformPatch | null> => {
    const broadcast = await findBroadcast()
    if (!broadcast) return null
    const snippet = await readVideoSnippet(broadcast.id)
    return {
      platform: id,
      title: snippet.title,
      categoryId: snippet.categoryId ? `yt-${snippet.categoryId}` : undefined,
      tags: snippet.tags ?? []
    }
  }

  /** 우리 카탈로그의 'yt-20' 형태를 API 가 쓰는 '20' 으로 되돌립니다. */
  const toApiCategoryId = (v?: string): string | undefined =>
    v?.startsWith('yt-') ? v.slice(3) : v

  return {
    id,

    async connectOAuth(opts) {
      const clientId = requireClientId()
      const secret = clientSecretOrNull()

      // Google 은 루프백에 임의 포트를 허용하지만, 사용자가 콘솔에 무엇을 넣어야 할지
      // 안내할 수 있도록 고정해 둡니다.
      const spec = getRedirectSpec(id)

      const { code, redirectUri, codeVerifier } = await startOAuthFlow({
        authorizeUrl: AUTHORIZE,
        clientId,
        scopes: SCOPES,
        fixedPort: spec?.port,
        host: spec?.host,
        callbackPath: spec?.path,
        signal: opts?.signal,
        // Google 은 임베디드 브라우저 로그인을 차단합니다(disallowed_useragent).
        // 그래서 여기만 기본 브라우저를 쓰고, 창 닫힘은 감지하지 못합니다.
        openIn: 'system',
        // PKCE 를 반드시 켭니다 — secret 없이 안전하게 교환하기 위한 핵심입니다.
        usePkce: true,
        extraParams: {
          // refresh_token 을 받으려면 이 두 개가 필요합니다.
          access_type: 'offline',
          prompt: 'consent'
        }
      })

      const res = await apiFetch<GoogleTokenResponse>(TOKEN, {
        method: 'POST',
        form: {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          ...(secret ? { client_secret: secret } : {}),
          ...(codeVerifier ? { code_verifier: codeVerifier } : {})
        }
      })

      setToken(id, {
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        expiresAt: toExpiryMs(res.expires_in)
      })

      const ch = await fetchMyChannel()
      return { displayName: ch.snippet?.title ?? 'YouTube 채널', channelId: ch.id }
    },

    async connectToken(accessToken) {
      setToken(id, { accessToken, manual: true })
      const ch = await fetchMyChannel()
      return { displayName: ch.snippet?.title ?? 'YouTube 채널', channelId: ch.id }
    },

    fetchCurrent: readCurrent,

    /** 유튜브 대분류는 고정 목록이라 지역 API 로 전체를 받아 필터링합니다. */
    async searchCategory(query) {
      const res = await authed<ListResponse<{ id: string; snippet?: { title?: string; assignable?: boolean } }>>(
        '/videoCategories',
        { query: { part: 'snippet', regionCode: 'KR', hl: 'ko' } }
      )
      const all = (res.items ?? [])
        .filter((c) => c.snippet?.assignable !== false)
        .map(
          (c): PlatformCategory => ({
            id: `yt-${c.id}`,
            name: c.snippet?.title ?? c.id
          })
        )
      if (!query.trim()) return all
      const q = query.toLowerCase()
      const hit = all.filter((c) => c.name.toLowerCase().includes(q))
      return hit.length > 0 ? hit : all
    },

    async updateBroadcast(patch): Promise<UpdateResult> {
      const started = Date.now()
      const fields: UpdateResult['fields'] = {}

      try {
        const broadcast = await findBroadcast()
        if (!broadcast) {
          return {
            platform: id,
            ok: false,
            durationMs: Date.now() - started,
            fields,
            error: '진행 중이거나 예약된 방송을 찾지 못했습니다. YouTube 스튜디오에서 방송을 먼저 만들어 주세요.'
          }
        }

        // videos.update 는 부분 업데이트를 지원하지 않습니다.
        // 기존 snippet 을 읽어 병합하지 않으면 설명·태그가 통째로 지워집니다.
        const current = await readVideoSnippet(broadcast.id)
        const next: VideoSnippet = { ...current }

        if (patch.title) {
          next.title = patch.title
          fields.title = { outcome: 'applied', value: patch.title }
        }

        const apiCategoryId = toApiCategoryId(patch.categoryId)
        if (apiCategoryId) {
          next.categoryId = apiCategoryId
          fields.category = { outcome: 'applied', value: patch.categoryName }
        }

        if (patch.tags) {
          next.tags = patch.tags
          fields.tags = { outcome: 'applied', value: patch.tags.join(', ') }
        }

        // categoryId 와 title 은 videos.update 의 필수 항목입니다.
        if (!next.title) {
          return {
            platform: id,
            ok: false,
            durationMs: Date.now() - started,
            fields,
            error: '유튜브는 제목이 반드시 있어야 합니다.'
          }
        }
        if (!next.categoryId) next.categoryId = '20' // 기존 값이 없으면 게임으로 둡니다

        await authed('/videos', {
          method: 'PUT',
          query: { part: 'snippet' },
          body: { id: broadcast.id, snippet: next }
        })

        /*
         * 게임 제목은 API 로 지정할 수 없습니다.
         *
         * videos 와 liveBroadcasts 어느 쪽 snippet 에도 게임을 넣을 자리가 없습니다
         * (categoryId 는 '게임' 이라는 대분류까지만 나타냅니다). 스튜디오 화면의
         * 게임 선택은 공개 API 로 열려 있지 않습니다.
         *
         * 그래서 대분류만 들어가고 세부 게임은 비어 있게 됩니다. 조용히 버리면
         * 사용자는 앱이 다 해준 줄 알고 넘어가므로, 무엇이 남았는지 분명히 적습니다.
         */
        if (patch.gameTitle) {
          fields.category = {
            ...(fields.category ?? { outcome: 'trimmed' }),
            outcome: 'trimmed',
            message:
              `게임 제목 "${patch.gameTitle}" 은 유튜브 API 로 넣을 수 없어 대분류까지만 적용했습니다. ` +
              '유튜브 스튜디오에서 직접 골라주세요.'
          }
        }

        return {
          platform: id,
          ok: true,
          durationMs: Date.now() - started,
          fields,
          previous: {
            title: current.title,
            categoryId: current.categoryId ? `yt-${current.categoryId}` : undefined,
            tags: current.tags
          }
        }
      } catch (e) {
        return failure(id, started, e)
      }
    }
  }
}
