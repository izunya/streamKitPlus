/**
 * StreamKit+ 공통 도메인 타입
 * 메인 프로세스(실제 API 호출)와 렌더러(UI)가 함께 사용합니다.
 */

export type PlatformId = 'youtube' | 'twitch' | 'chzzk' | 'soop' | 'cime'

export const PLATFORM_ORDER: PlatformId[] = ['youtube', 'twitch', 'chzzk', 'soop', 'cime']

/** 계정 연동 방식. oauth = 브라우저 로그인, apiKey = 사용자가 키를 직접 입력 */
export type AuthMethod = 'oauth' | 'apiKey'

/** 플랫폼이 무엇을 할 수 있는지. UI는 이 값만 보고 입력칸을 켜고 끕니다. */
export interface PlatformCapabilities {
  title: {
    supported: boolean
    /**
     * 플랫폼이 허용하는 제목 최대 길이.
     * 문서에 명시되지 않은 플랫폼은 비워둡니다 — 추측한 숫자로 자르면
     * 사용자가 의도한 제목이 조용히 잘려나가기 때문입니다.
     * 비어 있으면 클라이언트에서 자르지 않고 플랫폼 응답에 맡깁니다.
     */
    maxLength?: number
  }
  category: {
    supported: boolean
    /** 카테고리 검색 API 제공 여부. false면 고정 목록에서만 고름 */
    searchable: boolean
    /**
     * 유튜브형 2단 구조.
     *
     * 유튜브는 대분류(게임/음악/스포츠…)를 먼저 고르고,
     * '게임'을 골랐을 때만 게임 제목을 따로 입력하는 방식입니다.
     * 즉 "발로란트"는 대분류가 아니라 대분류 '게임' 아래의 게임 제목입니다.
     *
     * 이 필드가 있으면 게임 방송일 때 대분류를 자동으로 정하고
     * 게임 제목만 채우면 되므로, 사용자에게 물어볼 것이 없어집니다.
     */
    gameTitle?: {
      /** 게임 제목 입력칸이 나타나는 대분류 ID */
      underCategoryId: string
      maxLength?: number
      /**
       * 앱이 대신 넣어줄 수 없고 사용자가 플랫폼에서 직접 지정해야 하는 경우.
       *
       * 유튜브가 여기에 해당합니다. 고르는 칸은 보여주되, 적용되지 않는다는 것을
       * 고르는 순간에 알려야 합니다. 적용한 뒤에 알리면 이미 늦습니다.
       */
      manualNote?: string
    }
    /**
     * categoryId 만으로는 부족하고 categoryType(GAME/SPORTS/ETC)을
     * 함께 보내야 하는 플랫폼. 치지직이 여기에 해당하고 CIME 도 같은 필드를 씁니다.
     */
    requiresCategoryType?: boolean
    note?: string
  }
  tags: {
    supported: boolean
    maxCount?: number
    /** 태그 1개의 최대 길이 */
    maxLength?: number
    /** 전체 태그를 합친 문자열의 최대 길이 (유튜브형) */
    maxTotalLength?: number
    /**
     * 태그에 공백과 특수문자를 허용하지 않는 플랫폼.
     * 트위치("may not contain spaces or special characters")와
     * 치지직("공백 및 특수문자 비허용")이 여기에 해당합니다.
     */
    noSpaceOrSpecial?: boolean
    note?: string
  }
}

export interface PlatformMeta {
  id: PlatformId
  /** 화면 표시 이름 */
  name: string
  /** 브랜드 색상 (활성 상태 아이콘 색) */
  color: string
  /** 지원하는 연동 방식 */
  authMethods: AuthMethod[]
  capabilities: PlatformCapabilities
  /** 아직 확인이 필요한 사항 메모 (UI 툴팁에 노출) */
  caution?: string
}

/** 플랫폼이 실제로 가지고 있는 카테고리 1건 */
export interface PlatformCategory {
  id: string
  name: string
  /** 검색 매칭 보조용 별칭 */
  aliases?: string[]
  /**
   * 이 항목이 개별 게임 타이틀인지.
   * 사용자가 입력한 값이 게임인지 판별하는 근거가 되고,
   * 게임이면 유튜브는 대분류 '게임' + 게임 제목으로 자동 변환됩니다.
   *
   * 치지직·CIME 는 응답의 categoryType === 'GAME' 으로 판정합니다.
   */
  isGame?: boolean
  /** 치지직/CIME 의 categoryType (GAME | SPORTS | ETC). 수정 요청에 함께 보냅니다. */
  categoryType?: string
}

/** 연동된 계정 정보 (토큰 본체는 렌더러로 내려보내지 않습니다) */
export interface ConnectedAccount {
  platform: PlatformId
  displayName: string
  channelId: string
  method: AuthMethod
  connectedAt: number
  /** 토큰 만료 시각. 지나면 자동 갱신 시도 */
  expiresAt?: number
}

/* ------------------------------------------------------------------ */
/* 방송 정보 적용                                                       */
/* ------------------------------------------------------------------ */

/** 사용자가 UI에서 만든 "통합 입력값". 아직 플랫폼별로 변환되기 전 상태입니다. */
export interface BroadcastDraft {
  title: string
  /** 내부 표준 카테고리 ID (canon:*). 비어 있으면 카테고리 미변경 */
  canonicalCategoryId: string | null
  /** 사용자가 입력한 카테고리 표시 이름 */
  canonicalCategoryName: string
  /** 모든 플랫폼 공통 태그 */
  tags: string[]
  /** 플랫폼별 추가 태그 (공통 태그 뒤에 붙습니다) */
  extraTags: Partial<Record<PlatformId, string[]>>
  /** 플랫폼별 제목 덮어쓰기. 값이 있으면 공통 제목 대신 사용 */
  titleOverride: Partial<Record<PlatformId, string>>
}

/** 특정 플랫폼에 실제로 전송될 최종 페이로드 */
export interface PlatformPatch {
  platform: PlatformId
  title?: string
  categoryId?: string
  categoryName?: string
  /** 치지직/CIME 처럼 categoryId 와 함께 보내야 하는 분류 (GAME | SPORTS | ETC) */
  categoryType?: string
  /** 유튜브형 2단 구조에서 대분류 아래에 지정하는 게임 제목 */
  gameTitle?: string
  tags?: string[]
}

export type FieldOutcome =
  | 'applied' // 그대로 적용됨
  | 'trimmed' // 플랫폼 제한에 맞춰 잘려서 적용됨
  | 'skipped' // 사용자가 값을 비워둬서 건너뜀
  | 'unsupported' // 플랫폼이 지원하지 않음
  | 'unmapped' // 카테고리 매핑을 찾지 못함
  | 'failed' // 요청은 보냈으나 실패

export interface FieldResult {
  outcome: FieldOutcome
  /** 실제 적용된 값 */
  value?: string
  message?: string
}

/**
 * 적용 결과. 절대 throw 하지 않고 항상 이 객체를 돌려줍니다.
 * 5개 중 1개가 실패해도 나머지 4개는 적용되어야 하기 때문입니다.
 */
export interface UpdateResult {
  platform: PlatformId
  ok: boolean
  durationMs: number
  fields: {
    title?: FieldResult
    category?: FieldResult
    tags?: FieldResult
  }
  /** 플랫폼 전체가 실패한 경우의 사유 */
  error?: string
  /** 되돌리기용: 적용 직전의 값 */
  previous?: {
    title?: string
    categoryId?: string
    categoryName?: string
    categoryType?: string
    gameTitle?: string
    tags?: string[]
  }
}

/* ------------------------------------------------------------------ */
/* 어댑터 계약                                                          */
/* ------------------------------------------------------------------ */

export interface StreamPlatformAdapter {
  meta: PlatformMeta

  connect(method: AuthMethod, credentials?: Record<string, string>): Promise<ConnectedAccount>
  disconnect(): Promise<void>

  /** 현재 방송 정보 조회 (되돌리기 기준값 확보용) */
  fetchCurrent(): Promise<PlatformPatch | null>

  /** 카테고리 검색. searchable=false면 전체 목록을 필터링해 돌려줍니다. */
  searchCategory(query: string): Promise<PlatformCategory[]>

  /** 방송 정보 적용. 실패해도 throw 하지 않습니다. */
  updateBroadcast(patch: PlatformPatch): Promise<UpdateResult>
}

/* ------------------------------------------------------------------ */
/* 프리셋 / 이력                                                        */
/* ------------------------------------------------------------------ */

export interface Preset {
  id: string
  name: string
  /** 프리셋 색상 태그 */
  accent: string
  draft: BroadcastDraft
  /** 이 프리셋을 적용할 플랫폼 */
  targets: PlatformId[]
  createdAt: number
  usedCount: number
}

export interface HistoryEntry {
  id: string
  at: number
  draft: BroadcastDraft
  targets: PlatformId[]
  results: UpdateResult[]
  /** 되돌리기가 이미 실행된 이력인지 */
  revertedAt?: number
}
