/**
 * 각 플랫폼 API의 "확인된 스펙"을 한곳에 모아둡니다.
 *
 * 여기 있는 값은 공식 문서에서 직접 확인한 것만 적습니다.
 * 추측이나 기억으로 채우지 않습니다 — 틀린 값이 조용히 섞이면
 * 나중에 원인을 찾기가 매우 어렵습니다.
 *
 * 확인되지 않은 플랫폼은 아예 항목을 만들지 않고, 조사한 뒤에 추가합니다.
 */

export interface OAuthSpec {
  authorizeUrl: string
  tokenUrl: string
  grantTypes: string[]
  /** PKCE 지원 여부. false 면 client_secret 이 필요합니다. */
  pkce: boolean
  clientSecretRequired: boolean
  scopes: string[]
  /** 표준 snake_case 와 다른 파라미터 이름을 쓰는 경우 */
  paramNames?: {
    clientId?: string
    redirectUri?: string
    responseType?: string | null
    scope?: string | null
    state?: string
  }
}

export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT'
  path: string
  scope?: string
}

/* ------------------------------------------------------------------ */
/* CIME — 확인 완료 (https://developers.ci.me/docs)                    */
/* ------------------------------------------------------------------ */

export const CIME_BASE_URL = 'https://ci.me/api/openapi'

export const CIME_OAUTH: OAuthSpec = {
  // 표준 OAuth 와 달리 camelCase 파라미터를 쓰고 response_type / scope 를 받지 않습니다.
  authorizeUrl: 'https://ci.me/auth/openapi/account-interlock',
  tokenUrl: `${CIME_BASE_URL}/auth/v1/token`,
  grantTypes: ['authorization_code', 'refresh_token'],
  pkce: false,
  clientSecretRequired: true,
  paramNames: {
    clientId: 'clientId',
    redirectUri: 'redirectUri',
    responseType: null,
    scope: null
  },
  scopes: [
    'READ:USER',
    'READ:CHANNEL',
    'READ:SUBSCRIPTION',
    'READ:LIVE_STREAM_KEY',
    'READ:LIVE_STREAM_SETTINGS',
    'WRITE:LIVE_STREAM_SETTINGS',
    'READ:LIVE_CHAT',
    'WRITE:LIVE_CHAT',
    'WRITE:LIVE_CHAT_NOTICE',
    'READ:LIVE_CHAT_SETTINGS',
    'WRITE:LIVE_CHAT_SETTINGS',
    'WRITE:USER_BLOCK',
    'READ:USER_BLOCK',
    'READ:DONATION'
  ]
}

/** StreamKit+ 가 실제로 필요로 하는 최소 스코프 */
export const CIME_REQUIRED_SCOPES = [
  'READ:CHANNEL',
  'READ:LIVE_STREAM_SETTINGS',
  'WRITE:LIVE_STREAM_SETTINGS'
]

export const CIME_ENDPOINTS = {
  liveList: { method: 'GET', path: '/open/v1/lives' },
  readSetting: {
    method: 'GET',
    path: '/open/v1/lives/setting',
    scope: 'READ:LIVE_STREAM_SETTINGS'
  },
  updateSetting: {
    method: 'PATCH',
    path: '/open/v1/lives/setting',
    scope: 'WRITE:LIVE_STREAM_SETTINGS'
  },
  searchCategory: { method: 'GET', path: '/open/v1/categories/search' }
} satisfies Record<string, EndpointSpec>

/**
 * PATCH /open/v1/lives/setting 요청 바디.
 * 전달한 필드만 갱신됩니다 (부분 업데이트).
 */
export interface CimeLiveSettingPatch {
  /** 1~100자 */
  defaultLiveTitle?: string
  /** 최대 6개. 개당 길이 제한은 문서에 없음 */
  tags?: string[]
  /** null 을 보내면 카테고리 해제 */
  categoryId?: string | null
}

/** GET /open/v1/categories/search 응답의 content.data 원소 */
export interface CimeCategory {
  categoryId: string
  /**
   * ⚠️ 값이 categoryId 와 똑같습니다 (retrogame, asmr, valorant …).
   *
   * 치지직의 GAME / SPORTS / ETC 같은 분류 체계가 아닙니다.
   * 실제 응답 50건을 받아 전부 categoryId 와 같은 것을 확인했습니다.
   * 게임 여부 판별에 쓸 수 없고, 수정 요청 바디에도 이 필드는 없습니다.
   */
  categoryType: string
  categoryValue: string
  posterImageUrl: string | null
}

/** categories/search 쿼리 파라미터 */
export interface CimeCategorySearchQuery {
  /** 최대 100자. 비우면 전체 카테고리 반환 */
  keyword?: string
  /** 1~50, 기본 20 */
  size?: number
}

/* ------------------------------------------------------------------ */
/* 치지직 — 확인 완료 (https://chzzk.gitbook.io/chzzk)                  */
/*                                                                     */
/* ⚠️ 중요: CIME 와 경로·필드명이 사실상 동일합니다.                      */
/*    /open/v1/lives/setting, /open/v1/categories/search,               */
/*    POST /auth/v1/token, account-interlock?clientId=&redirectUri=     */
/*    어댑터 하나를 베이스 URL만 바꿔 양쪽에 재사용할 수 있습니다.        */
/* ------------------------------------------------------------------ */

export const CHZZK_OAUTH: OAuthSpec = {
  authorizeUrl: 'https://chzzk.naver.com/account-interlock',
  tokenUrl: 'https://openapi.chzzk.naver.com/auth/v1/token',
  grantTypes: ['authorization_code', 'refresh_token'],
  pkce: false,
  clientSecretRequired: true,
  paramNames: {
    clientId: 'clientId',
    redirectUri: 'redirectUri',
    responseType: null,
    scope: null
  },
  // 문서에 전체 스코프 목록이 정리되어 있지 않습니다. 연동 시 확인이 필요합니다.
  scopes: []
}

export const CHZZK_ENDPOINTS = {
  liveList: { method: 'GET', path: '/open/v1/lives' },
  readSetting: { method: 'GET', path: '/open/v1/lives/setting' },
  updateSetting: { method: 'PATCH', path: '/open/v1/lives/setting' },
  streamKey: { method: 'GET', path: '/open/v1/streams/key' },
  searchCategory: { method: 'GET', path: '/open/v1/categories/search' }
} satisfies Record<string, EndpointSpec>

/** 치지직/CIME 공통 카테고리 분류 */
export type ChzzkCategoryType = 'GAME' | 'SPORTS' | 'ETC'

/** PATCH /open/v1/lives/setting 요청 바디 (치지직) */
export interface ChzzkLiveSettingPatch {
  /** 빈 값으로 설정 불가. 최대 길이는 문서에 없음 */
  defaultLiveTitle?: string
  categoryType?: ChzzkCategoryType
  /** 빈 문자열을 보내면 카테고리 해제 */
  categoryId?: string
  /** 빈 배열을 보내면 태그 해제. 공백·특수문자 불가 */
  tags?: string[]
}

/* ------------------------------------------------------------------ */
/* Twitch — 확인 완료 (https://dev.twitch.tv/docs/api/reference)        */
/* ------------------------------------------------------------------ */

export const TWITCH_BASE_URL = 'https://api.twitch.tv/helix'

export const TWITCH_MODIFY_CHANNEL: EndpointSpec = {
  method: 'PATCH',
  // broadcaster_id 를 쿼리 파라미터로 함께 보내야 합니다.
  path: '/channels',
  scope: 'channel:manage:broadcast'
}

/** 요청 헤더: Authorization: Bearer <user token>, Client-Id, Content-Type: application/json */
export interface TwitchModifyChannelBody {
  /** 최대 140자. 빈 문자열로 설정 불가 */
  title?: string
  /** '0' 또는 빈 문자열을 보내면 카테고리 해제. 인식 못 하는 값은 무시됨 */
  game_id?: string
  /** 최대 10개, 각 최대 25자. 공백·특수문자 불가, 빈 문자열 불가 */
  tags?: string[]
  /** ISO 639-1 두 글자. 미지원 언어는 'other' */
  broadcaster_language?: string
  /** 파트너 전용, 최대 900초 */
  delay?: number
  content_classification_labels?: { id: string; is_enabled: boolean }[]
  is_branded_content?: boolean
}

/* ------------------------------------------------------------------ */
/* SOOP — 확인 완료 (https://developers.sooplive.co.kr/docs/api)        */
/* ------------------------------------------------------------------ */

export const SOOP_BASE_URL = 'https://openapi.sooplive.com'

export const SOOP_OAUTH: OAuthSpec = {
  authorizeUrl: `${SOOP_BASE_URL}/auth/code`,
  tokenUrl: `${SOOP_BASE_URL}/auth/token`,
  grantTypes: ['authorization_code', 'refresh_token'],
  pkce: false,
  clientSecretRequired: true,
  // 리다이렉트 URI 는 개발자 콘솔에 등록해 둔 주소를 씁니다.
  paramNames: { responseType: null },
  scopes: [
    'broad_info_update',
    'validate_live_status',
    'user_stationinfo',
    'broad_rtmp',
    'broad_rtmp_reset',
    'broad_review_list',
    'validate_vod_owner',
    'broad_access_chatinfo',
    'aqua_component_get'
  ]
}

/** StreamKit+ 가 실제로 필요로 하는 최소 스코프 */
export const SOOP_REQUIRED_SCOPES = [
  'broad_info_update',
  'validate_live_status',
  'user_stationinfo'
]

export const SOOP_ENDPOINTS = {
  updateSetting: { method: 'POST', path: '/broad/info/update', scope: 'broad_info_update' },
  liveStatus: { method: 'POST', path: '/validate/live/status', scope: 'validate_live_status' },
  stationInfo: { method: 'POST', path: '/user/stationinfo', scope: 'user_stationinfo' },
  categoryList: { method: 'GET', path: '/broad/category/list' }
} satisfies Record<string, EndpointSpec>

/**
 * POST /broad/info/update 요청 바디 (form-urlencoded).
 * 토큰을 헤더가 아니라 본문에 넣습니다.
 */
export interface SoopBroadInfoUpdate {
  access_token: string
  /** 최대 75자 */
  title?: string
  /** 카테고리 번호 (cate_no) */
  category?: string
  /** 최대 5개. 특수문자 불가. ', ' 로 구분 */
  hashtags?: string
}
