import type { PlatformCategory, PlatformPatch, UpdateResult } from '../../shared/types'
import { apiFetch, ApiError } from '../net'
import { startOAuthFlow } from '../oauth'
import { getCredentials, setToken, type StoredToken } from '../vault'
import { getRedirectSpec } from '../../shared/redirectUri'
import { failure, toExpiryMs, withRetryOnAuth, type ServerAdapter } from './base'

/**
 * SOOP 어댑터.
 *
 *   GET  auth/code              ?client_id=&scope=   -> 등록된 Redirect URI 로 code
 *   POST auth/token             grant_type/client_id/client_secret/code|refresh_token
 *   POST user/stationinfo       access_token         -> 방송국 닉네임
 *   POST validate/live/status   access_token         -> 현재 방송 상태·제목·카테고리
 *   POST broad/info/update      access_token/title/category/hashtags
 *   GET  broad/category/list    ?client_id=&locale=  -> 카테고리 트리
 *
 * ── 다른 플랫폼과 다른 점 ────────────────────────────────────
 * 1. 토큰을 Authorization 헤더가 아니라 폼 본문의 access_token 으로 보냅니다.
 * 2. 실패해도 HTTP 200 으로 옵니다. 본문의 result 가 1 이면 성공, 음수면 실패라
 *    상태 코드만 보면 전부 성공으로 읽힙니다.
 * 3. 카테고리 번호 표기가 두 가지입니다. 목록은 "00040066" 처럼 8자리 문자열로
 *    주는데, 방송 상태 조회는 40066 처럼 앞의 0 을 떼고 숫자로 돌려줍니다.
 *    같은 카테고리인데 글자가 달라서, 맞춰보려면 한쪽으로 모아야 합니다.
 */

const BASE_URL = 'https://openapi.sooplive.com'

/**
 * 요청하는 권한.
 *
 * 쓰지 않는 권한은 넣지 않습니다. 채팅(broad_access_chatinfo)은 아직 붙이지
 * 않았으므로 빠져 있고, 나중에 채팅을 지원할 때 추가하면서 재인증을 받습니다.
 *
 *   broad_info_update    제목·카테고리·해시태그 변경
 *   validate_live_status 현재 방송 상태와 상세 정보 조회
 *   user_stationinfo     연동한 계정이 누구인지 확인 (화면에 이름 표시)
 */
const SCOPES = ['broad_info_update', 'validate_live_status', 'user_stationinfo']

/** 제목 길이 제한 (문서 기준) */
const TITLE_MAX = 75
/** 해시태그 개수 제한 (문서 기준) */
const TAGS_MAX = 5

/** SOOP 공통 응답 봉투 */
interface SoopResult<T> {
  result?: number
  msg?: string
  data?: T
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

interface LiveStatus {
  user_id?: string
  status?: 'streaming' | 'streamend'
  broad_no?: number
  broad_title?: string
  broad_cate_no?: number | string
  broad_start?: string
  current_view_cnt?: number
}

interface StationInfo {
  user_nick?: string
  station_name?: string
}

interface CategoryNode {
  cate_name: string
  cate_no: string
  child?: CategoryNode[]
}

/**
 * 카테고리 번호를 한 가지 표기로 모읍니다.
 *
 * 목록은 "00040066", 방송 상태 조회는 40066 으로 같은 값을 다르게 돌려줍니다.
 * 앞의 0 을 떼는 쪽으로 맞춰야 두 응답을 비교할 수 있습니다.
 */
/** 응답에 뭐가 들어 있었는지 한 줄로 — 원인을 좁히는 데 씁니다. */
function describeShape(v: unknown): string {
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    return keys.length ? `응답 필드: ${keys.join(', ')}` : '빈 객체'
  }
  return `응답: ${JSON.stringify(v ?? null).slice(0, 120)}`
}

function normalizeCategoryNo(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const stripped = s.replace(/^0+/, '')
  return stripped || '0'
}

/**
 * 게임 대분류 — 이 아래 자식들이 개별 게임 타이틀입니다.
 *
 * '게임' 말고 '모바일게임' 도 따로 있습니다. 목록을 실제로 받아보고 알았습니다
 * (게임 355개, 모바일게임 109개). 게임만 넣어두면 배틀그라운드 모바일 같은
 * 항목이 게임으로 분류되지 않아, 다른 플랫폼으로 카테고리를 옮길 때 어긋납니다.
 * 나머지 22개 대분류에는 게임이 없습니다.
 */
const GAME_PARENTS = new Set(['40000', '360000'])

export function createSoopAdapter(): ServerAdapter {
  const id = 'soop' as const

  const requireCreds = (): { clientId: string; clientSecret: string } => {
    const c = getCredentials(id)
    if (!c?.clientId) {
      throw new ApiError('Client ID 가 설정되지 않았습니다.', 400)
    }
    if (!c.clientSecret) {
      throw new ApiError('Client Secret 이 설정되지 않았습니다.', 400)
    }
    return { clientId: c.clientId, clientSecret: c.clientSecret }
  }

  /**
   * 응답 봉투를 벗깁니다.
   *
   * 실패도 HTTP 200 으로 오기 때문에, 여기서 result 를 보고 직접 실패시키지 않으면
   * 아무 일도 안 일어났는데 성공했다고 표시됩니다.
   */
  const unwrap = <T>(raw: unknown): T | undefined => {
    const res = (raw ?? {}) as SoopResult<T>
    if (typeof res.result === 'number' && res.result <= 0) {
      throw new ApiError(res.msg || `SOOP 요청이 거부되었습니다. (result=${res.result})`, 400)
    }

    /*
     * data 가 객체로 올 때도 있고 배열로 올 때도 있습니다.
     *
     * 문서의 응답 표에는 array 라고 적혀 있는데 바로 아래 예시는 객체입니다.
     * 둘 중 하나로 단정하면 나머지 경우에 필드가 통째로 undefined 가 되고,
     * "값이 없다" 는 엉뚱한 오류로 이어집니다. 그래서 양쪽을 다 받습니다.
     */
    const data = res.data as unknown
    if (Array.isArray(data)) return data[0] as T | undefined
    return data as T | undefined
  }

  const parseToken = (raw: unknown): TokenResponse => {
    const res = (raw ?? {}) as TokenResponse & SoopResult<unknown>
    if (!res.access_token) {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw).join(', ') : typeof raw
      throw new ApiError(
        `토큰 응답에서 access_token 을 찾지 못했습니다. (응답 필드: ${keys})`,
        500
      )
    }
    return res
  }

  const refresh = async (refreshToken: string): Promise<StoredToken> => {
    const { clientId, clientSecret } = requireCreds()
    const res = parseToken(
      await apiFetch(`${BASE_URL}/auth/token`, {
        method: 'POST',
        form: {
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken
        }
      })
    )
    return {
      accessToken: res.access_token as string,
      refreshToken: res.refresh_token ?? refreshToken,
      expiresAt: toExpiryMs(res.expires_in)
    }
  }

  /** 사용자 토큰이 필요한 호출. SOOP 은 토큰을 폼 본문에 넣습니다. */
  const authed = <T>(path: string, form: Record<string, string> = {}): Promise<T | undefined> =>
    withRetryOnAuth(id, refresh, (token) =>
      apiFetch(`${BASE_URL}${path}`, {
        method: 'POST',
        form: { ...form, access_token: token }
      }).then((raw) => unwrap<T>(raw))
    )

  /*
   * 카테고리 목록은 자주 바뀌지 않는데 응답이 큽니다.
   * 검색할 때마다 전체를 다시 받지 않도록 한 번 받아 들고 있습니다.
   */
  let categoryCache: PlatformCategory[] | null = null

  const loadCategories = async (): Promise<PlatformCategory[]> => {
    if (categoryCache) return categoryCache

    const { clientId } = requireCreds()

    /*
     * 이 엔드포인트만 client_id 로 부릅니다.
     *
     * 문서의 파라미터 표에는 access_token 이 필수라고 적혀 있는데, 바로 아래
     * 예시는 client_id 를 씁니다. 항목 자체도 Public 으로 표시돼 있어
     * 예시 쪽을 따랐습니다. 문서 안에서 서로 어긋나는 자리입니다.
     */
    const raw = await apiFetch<{ broad_category?: CategoryNode[] }>(
      `${BASE_URL}/broad/category/list`,
      { query: { client_id: clientId, locale: 'ko_KR' } }
    )

    const out: PlatformCategory[] = []

    for (const parent of raw.broad_category ?? []) {
      const parentNo = normalizeCategoryNo(parent.cate_no)
      out.push({ id: parentNo, name: parent.cate_name })

      for (const child of parent.child ?? []) {
        out.push({
          id: normalizeCategoryNo(child.cate_no),
          name: child.cate_name,
          // 게임 대분류 아래에 달린 것만 개별 게임 타이틀입니다.
          isGame: GAME_PARENTS.has(parentNo)
        })
      }
    }

    categoryCache = out
    return out
  }

  const categoryName = async (no: string): Promise<string | undefined> => {
    if (!no) return undefined
    try {
      return (await loadCategories()).find((c) => c.id === no)?.name
    } catch {
      // 이름을 못 찾아도 번호는 살아 있으므로 조회 자체를 실패시키지는 않습니다.
      return undefined
    }
  }

  const readStatus = async (): Promise<LiveStatus | undefined> =>
    authed<LiveStatus>('/validate/live/status')

  /**
   * 연동한 계정이 누구인지 확인합니다.
   *
   * 방송국 정보를 먼저 봅니다. 방송 중이 아니어도 답을 주기 때문입니다.
   *
   * 처음에는 방송 상태 조회(validate/live/status)의 user_id 를 쓰려고 했는데,
   * 실제 응답에 그 필드가 없었습니다. 문서에는 방송 중이 아닐 때도 user_id 를
   * 돌려준다고 적혀 있지만 실제로는 broad_no 와 status 뿐이었습니다.
   * 그래서 문서만 믿지 않고, 방송국 정보를 주 경로로 두고 방송 상태를 예비로 둡니다.
   */
  const whoAmI = async (): Promise<string> => {
    const tried: string[] = []

    try {
      const info = await authed<StationInfo>('/user/stationinfo')
      const name = info?.user_nick?.trim() || info?.station_name?.trim()
      if (name) return name
      tried.push(`user/stationinfo -> ${describeShape(info)}`)
    } catch (e) {
      tried.push(`user/stationinfo -> ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const status = await authed<LiveStatus>('/validate/live/status')
      const login = status?.user_id?.trim()
      if (login) return login
      tried.push(`validate/live/status -> ${describeShape(status)}`)
    } catch (e) {
      tried.push(`validate/live/status -> ${e instanceof Error ? e.message : String(e)}`)
    }

    throw new ApiError(
      '계정 정보를 가져오지 못했습니다. SOOP 콘솔에서 이 앱에 ' +
        'user_stationinfo 권한이 켜져 있는지 확인해 주세요. ' +
        tried.join(' / '),
      404
    )
  }

  const readCurrent = async (): Promise<PlatformPatch | null> => {
    const s = await readStatus()

    /*
     * 방송 중이 아니면 제목도 카테고리도 돌려주지 않습니다 (user_id 와 status 뿐).
     * 없는 값을 빈 문자열로 채우면 "제목이 비어 있음" 으로 오해하게 되므로
     * 통째로 없음을 알립니다.
     */
    if (!s || s.status !== 'streaming') return null

    const cate = normalizeCategoryNo(s.broad_cate_no)
    return {
      platform: id,
      title: s.broad_title,
      categoryId: cate || undefined,
      categoryName: await categoryName(cate)
      // 해시태그는 이 응답에 없어서 읽어올 수 없습니다.
    }
  }

  return {
    id,

    async connectOAuth(opts) {
      const { clientId, clientSecret } = requireCreds()

      // 등록해 둔 Redirect URI 와 정확히 같아야 하므로 포트를 고정합니다.
      const spec = getRedirectSpec(id)

      const { code, redirectUri } = await startOAuthFlow({
        authorizeUrl: `${BASE_URL}/auth/code`,
        clientId,
        scopes: SCOPES,
        usePkce: false,
        fixedPort: spec?.port,
        host: spec?.host,
        callbackPath: spec?.path,
        signal: opts?.signal,
        // 기본 브라우저로 엽니다 — 이미 로그인해 둔 세션을 그대로 씁니다.
        openIn: 'system',
        // 문서의 요청 예시에 response_type 이 없어 보내지 않습니다.
        paramNames: { responseType: null }
      })

      const res = parseToken(
        await apiFetch(`${BASE_URL}/auth/token`, {
          method: 'POST',
          form: {
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code
          }
        })
      )

      setToken(id, {
        accessToken: res.access_token as string,
        refreshToken: res.refresh_token,
        expiresAt: toExpiryMs(res.expires_in)
      })

      // 토큰이 실제로 통하는지 확인합니다. 안 되면 연결된 척하지 않습니다.
      try {
        const login = await whoAmI()
        return { displayName: login, channelId: login }
      } catch (e) {
        setToken(id, null)
        throw e
      }
    },

    async connectToken(accessToken) {
      setToken(id, { accessToken, manual: true })
      const login = await whoAmI()
      return { displayName: login, channelId: login }
    },

    fetchCurrent: readCurrent,

    async searchCategory(query) {
      const q = query.trim().toLowerCase()
      if (!q) return []

      // SOOP 은 검색 엔드포인트가 없어 전체 목록을 받아 여기서 거릅니다.
      const all = await loadCategories()
      return all.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 20)
    },

    async updateBroadcast(patch): Promise<UpdateResult> {
      const started = Date.now()

      // 되돌리기 기준값을 먼저 잡아둡니다. 실패해도 적용은 진행합니다.
      let previous: PlatformPatch | null = null
      try {
        previous = await readCurrent()
      } catch {
        previous = null
      }

      const form: Record<string, string> = {}
      const fields: UpdateResult['fields'] = {}

      if (patch.title) {
        const title = patch.title.slice(0, TITLE_MAX)
        form.title = title
        fields.title =
          title === patch.title
            ? { outcome: 'applied', value: title }
            : {
                outcome: 'trimmed',
                value: title,
                message: `제목이 ${TITLE_MAX}자를 넘어 잘렸습니다.`
              }
      }

      if (patch.categoryId) {
        form.category = normalizeCategoryNo(patch.categoryId)
        fields.category = { outcome: 'applied', value: patch.categoryName }
      }

      if (patch.tags) {
        /*
         * 해시태그는 최대 5개이고 특수문자를 받지 않습니다.
         * 거르지 않고 그대로 보내면 요청 전체가 거부되어 제목까지 안 바뀝니다.
         */
        const cleaned = patch.tags
          .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter(Boolean)
        const kept = cleaned.slice(0, TAGS_MAX)

        form.hashtags = kept.join(', ')

        const dropped = patch.tags.length - kept.length
        fields.tags =
          dropped > 0
            ? {
                outcome: 'trimmed',
                value: kept.join(', '),
                message: `태그는 ${TAGS_MAX}개까지이고 특수문자를 쓸 수 없어 ${dropped}개를 뺐습니다.`
              }
            : { outcome: 'applied', value: kept.join(', ') }
      }

      if (Object.keys(form).length === 0) {
        return { platform: id, ok: true, durationMs: Date.now() - started, fields }
      }

      try {
        await authed('/broad/info/update', form)
        return {
          platform: id,
          ok: true,
          durationMs: Date.now() - started,
          fields,
          previous: previous
            ? {
                title: previous.title,
                categoryId: previous.categoryId,
                categoryName: previous.categoryName
              }
            : undefined
        }
      } catch (e) {
        return failure(id, started, e)
      }
    }
  }
}
