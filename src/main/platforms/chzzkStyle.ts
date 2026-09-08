import type { PlatformCategory, PlatformId, PlatformPatch, UpdateResult } from '../../shared/types'
import { apiFetch, ApiError, type RequestOptions } from '../net'
import { startOAuthFlow } from '../oauth'
import { getCredentials, setToken, type StoredToken } from '../vault'
import { getRedirectSpec } from '../../shared/redirectUri'
import { failure, toExpiryMs, withRetryOnAuth, type ServerAdapter } from './base'

/**
 * 치지직 · CIME 공용 어댑터.
 *
 * 두 플랫폼은 경로와 필드명이 사실상 동일합니다. 베이스 URL과 인증 페이지 주소만 다릅니다.
 *   PATCH /open/v1/lives/setting     { defaultLiveTitle, categoryType, categoryId, tags }
 *   GET   /open/v1/categories/search ?query= (치지직) / ?keyword= (CIME)
 *   POST  /auth/v1/token             { grantType, clientId, clientSecret, code, state }
 *   GET   /open/v1/users/me          -> { channelId, channelName }
 *
 * 둘 다 표준 OAuth 가 아닙니다: clientId/redirectUri camelCase, response_type·scope 없음.
 */

export interface ChzzkStyleConfig {
  id: PlatformId
  /** 예: https://openapi.chzzk.naver.com */
  baseUrl: string
  /** 예: https://chzzk.naver.com/account-interlock */
  authorizeUrl: string
  /** 카테고리 검색 쿼리 파라미터 이름 — 치지직은 query, CIME 은 keyword */
  categoryQueryParam: 'query' | 'keyword'
}

interface TokenResponse {
  accessToken: string
  refreshToken?: string
  tokenType?: string
  expiresIn?: string | number
}

/** 치지직/CIME 공통 응답 봉투: { code, message, content } */
interface Envelope<T> {
  code?: number
  message?: string | null
  content?: T
}

interface UserMe {
  channelId: string
  channelName: string
}

interface CategoryItem {
  categoryId: string
  categoryType: string
  categoryValue: string
  posterImageUrl?: string | null
}

/**
 * GET /open/v1/lives/setting 응답.
 *
 * ⚠️ 카테고리는 최상위가 아니라 category 객체 안에 들어 있습니다.
 *    (PATCH 요청 바디는 평평한 구조라 헷갈리기 쉽습니다 — 읽기와 쓰기가 다릅니다.)
 */
interface LiveSetting {
  defaultLiveTitle?: string
  category?: {
    categoryType?: string
    categoryId?: string
    categoryValue?: string
    posterImageUrl?: string | null
  } | null
  tags?: string[]
}

export function createChzzkStyleAdapter(cfg: ChzzkStyleConfig): ServerAdapter {
  const { id, baseUrl } = cfg

  const requireCreds = (): { clientId: string; clientSecret: string } => {
    const c = getCredentials(id)
    if (!c?.clientId) {
      throw new ApiError('Client ID 가 설정되지 않았습니다. 설정에서 먼저 입력해 주세요.', 400)
    }
    if (!c.clientSecret) {
      // PKCE 미지원이라 secret 없이는 토큰 교환 자체가 불가능합니다.
      throw new ApiError(
        'Client Secret 이 필요합니다. 이 플랫폼은 PKCE 를 지원하지 않습니다.',
        400
      )
    }
    return { clientId: c.clientId, clientSecret: c.clientSecret }
  }

  /** 응답 봉투를 벗깁니다. 플랫폼에 따라 봉투 없이 바로 오기도 합니다. */
  const unwrap = <T>(res: Envelope<T> | T): T => {
    if (res && typeof res === 'object' && 'content' in res) {
      return (res as Envelope<T>).content as T
    }
    return res as T
  }

  /**
   * 토큰 응답을 읽습니다.
   *
   * 이 API 는 { code, message, content } 봉투로 감싸서 돌려줍니다.
   * 봉투를 벗기지 않으면 accessToken 이 undefined 가 되고,
   * 그 상태로 저장하면 이후 호출이 전부 INVALID_TOKEN 으로 실패합니다.
   * (실제로 그 문제를 겪었습니다.)
   *
   * 값이 비어 있으면 조용히 저장하지 않고 여기서 분명히 실패시킵니다.
   */
  const parseToken = (raw: unknown): TokenResponse => {
    const res = unwrap<TokenResponse>(raw as Envelope<TokenResponse>)
    if (!res?.accessToken) {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw).join(', ') : typeof raw
      throw new ApiError(`토큰 응답에서 accessToken 을 찾지 못했습니다. (응답 필드: ${keys})`, 500)
    }
    return res
  }

  const refresh = async (refreshToken: string): Promise<StoredToken> => {
    const { clientId, clientSecret } = requireCreds()
    const res = parseToken(
      await apiFetch(`${baseUrl}/auth/v1/token`, {
        method: 'POST',
        body: { grantType: 'refresh_token', refreshToken, clientId, clientSecret }
      })
    )
    return {
      accessToken: res.accessToken,
      refreshToken: res.refreshToken ?? refreshToken,
      expiresAt: toExpiryMs(res.expiresIn)
    }
  }

  const authed = <T>(path: string, init: RequestOptions = {}): Promise<T> =>
    withRetryOnAuth(id, refresh, (token) =>
      apiFetch<Envelope<T> | T>(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` }
      }).then(unwrap)
    )

  /**
   * 클라이언트 인증 전용 호출.
   *
   * 카테고리 검색 같은 일부 엔드포인트는 사용자 토큰을 받지 않습니다.
   * Authorization 헤더를 같이 보내면 "토큰 인증 API가 아닙니다" 로 거부합니다.
   * 그래서 여기서는 Bearer 를 빼고 클라이언트 자격 증명만 보냅니다.
   */
  const clientAuthed = <T>(path: string, init: RequestOptions = {}): Promise<T> => {
    const creds = getCredentials(id)
    if (!creds?.clientId) {
      throw new ApiError('Client ID 가 설정되지 않았습니다.', 400)
    }
    const headers: Record<string, string> = { ...init.headers, 'Client-Id': creds.clientId }
    if (creds.clientSecret) headers['Client-Secret'] = creds.clientSecret

    return apiFetch<Envelope<T> | T>(`${baseUrl}${path}`, { ...init, headers }).then(unwrap)
  }

  const fetchMe = async (): Promise<UserMe> => authed<UserMe>('/open/v1/users/me')

  const readSetting = async (): Promise<PlatformPatch | null> => {
    const s = await authed<LiveSetting>('/open/v1/lives/setting')
    if (!s) return null
    return {
      platform: id,
      title: s.defaultLiveTitle,
      categoryId: s.category?.categoryId,
      categoryName: s.category?.categoryValue,
      categoryType: s.category?.categoryType,
      tags: s.tags ?? []
    }
  }

  return {
    id,

    async connectOAuth(opts) {
      const { clientId, clientSecret } = requireCreds()

      // 이 플랫폼들은 "등록된 redirectUri 와 정확히 일치" 를 요구합니다.
      // 포트가 매번 바뀌면 검증을 절대 통과할 수 없으므로 고정 포트를 씁니다.
      const spec = getRedirectSpec(id)

      const { code, state } = await startOAuthFlow({
        authorizeUrl: cfg.authorizeUrl,
        clientId,
        scopes: [],
        usePkce: false,
        fixedPort: spec?.port,
        host: spec?.host,
        callbackPath: spec?.path,
        signal: opts?.signal,
        // 기본 브라우저로 엽니다. 앱 안 창은 세션이 분리돼 있어
        // 이미 로그인해 둔 계정을 못 쓰고 매번 다시 로그인해야 합니다.
        openIn: 'system',
        // 표준과 다른 파라미터 이름. response_type 과 scope 는 보내지 않습니다.
        paramNames: {
          clientId: 'clientId',
          redirectUri: 'redirectUri',
          responseType: null,
          scope: null
        }
      })

      const res = parseToken(
        await apiFetch(`${baseUrl}/auth/v1/token`, {
          method: 'POST',
          body: { grantType: 'authorization_code', clientId, clientSecret, code, state }
        })
      )

      setToken(id, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt: toExpiryMs(res.expiresIn)
      })

      // 토큰이 실제로 통하는지 여기서 확인합니다.
      // 실패하면 연결된 척하지 않고 토큰을 지웁니다.
      try {
        const me = await fetchMe()
        return { displayName: me.channelName, channelId: me.channelId }
      } catch (e) {
        setToken(id, null)
        throw e
      }
    },

    async connectToken(accessToken) {
      setToken(id, { accessToken, manual: true })
      const me = await fetchMe()
      return { displayName: me.channelName, channelId: me.channelId }
    },

    fetchCurrent: readSetting,

    async searchCategory(query) {
      // 이 엔드포인트는 클라이언트 인증만 받습니다.
      // 사용자 토큰을 같이 보내면 "토큰 인증 API가 아닙니다" 로 거부당합니다.
      const data = await clientAuthed<{ data?: CategoryItem[] } | CategoryItem[]>(
        '/open/v1/categories/search',
        { query: { [cfg.categoryQueryParam]: query, size: 20 } }
      )
      const list = Array.isArray(data) ? data : (data?.data ?? [])
      return list.map(
        (c): PlatformCategory => ({
          id: c.categoryId,
          name: c.categoryValue,
          categoryType: c.categoryType,
          isGame: c.categoryType === 'GAME'
        })
      )
    },

    async updateBroadcast(patch): Promise<UpdateResult> {
      const started = Date.now()

      // 되돌리기 기준값을 먼저 확보합니다. 실패해도 적용은 진행합니다.
      let previous: PlatformPatch | null = null
      try {
        previous = await readSetting()
      } catch {
        previous = null
      }

      const body: Record<string, unknown> = {}
      const fields: UpdateResult['fields'] = {}

      if (patch.title) {
        body.defaultLiveTitle = patch.title
        fields.title = { outcome: 'applied', value: patch.title }
      }

      if (patch.categoryId) {
        body.categoryId = patch.categoryId
        // categoryType 이 없으면 플랫폼이 카테고리를 반영하지 않습니다.
        if (patch.categoryType) {
          body.categoryType = patch.categoryType
          fields.category = { outcome: 'applied', value: patch.categoryName }
        } else {
          delete body.categoryId
          fields.category = {
            outcome: 'unmapped',
            message: 'categoryType 을 알 수 없어 카테고리를 변경하지 않았습니다.'
          }
        }
      }

      if (patch.tags) {
        body.tags = patch.tags
        fields.tags = { outcome: 'applied', value: patch.tags.join(', ') }
      }

      if (Object.keys(body).length === 0) {
        return { platform: id, ok: true, durationMs: Date.now() - started, fields }
      }

      try {
        await authed('/open/v1/lives/setting', { method: 'PATCH', body })
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
                categoryType: previous.categoryType,
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
