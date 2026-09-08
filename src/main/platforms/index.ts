import type { PlatformId } from '../../shared/types'
import { CHZZK_OAUTH, CIME_BASE_URL, CIME_OAUTH } from '../../shared/platformSpecs'
import { createChzzkStyleAdapter } from './chzzkStyle'
import { createTwitchAdapter } from './twitch'
import { createYouTubeAdapter } from './youtube'
import { createSoopAdapter } from './soop'
import type { ServerAdapter } from './base'

/**
 * 실제 API 를 호출하는 어댑터 레지스트리 (메인 프로세스).
 *
 * 치지직과 CIME 은 같은 구현을 베이스 URL만 바꿔 씁니다 —
 * 두 플랫폼의 경로·필드명이 사실상 동일하기 때문입니다.
 */
const adapters: Record<PlatformId, ServerAdapter> = {
  youtube: createYouTubeAdapter(),
  twitch: createTwitchAdapter(),

  chzzk: createChzzkStyleAdapter({
    id: 'chzzk',
    baseUrl: 'https://openapi.chzzk.naver.com',
    authorizeUrl: CHZZK_OAUTH.authorizeUrl,
    categoryQueryParam: 'query'
  }),

  cime: createChzzkStyleAdapter({
    id: 'cime',
    baseUrl: CIME_BASE_URL,
    authorizeUrl: CIME_OAUTH.authorizeUrl,
    categoryQueryParam: 'keyword'
  }),

  soop: createSoopAdapter()
}

export function getServerAdapter(id: PlatformId): ServerAdapter {
  return adapters[id]
}
