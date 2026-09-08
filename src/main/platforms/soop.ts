import type { ServerAdapter } from './base'
import { ApiError } from '../net'

/**
 * SOOP 어댑터 — 아직 구현되지 않았습니다.
 *
 * 이유: developers.sooplive.co.kr 문서 페이지가 클라이언트 렌더링이라
 * 엔드포인트·인증 방식·필드명을 확인하지 못했습니다.
 *
 * 추측으로 채워 넣으면 "동작하는 것처럼 보이지만 실제로는 아무것도 안 되는" 코드가 됩니다.
 * 그래서 확인 전까지는 명확히 실패시키고, 사용자에게 이유를 알립니다.
 *
 * 확인이 끝나면 다른 어댑터와 같은 모양으로 채우면 됩니다:
 *   1. OAuth(또는 API 키) 흐름
 *   2. 내 채널 조회
 *   3. 방송 정보 조회/수정
 *   4. 카테고리 검색
 */

const NOT_IMPLEMENTED =
  'SOOP 은 아직 연동되지 않았습니다. 공식 개발자 문서에서 방송 정보 수정 API 스펙 확인이 필요합니다.'

export function createSoopAdapter(): ServerAdapter {
  const id = 'soop' as const
  const fail = (): never => {
    throw new ApiError(NOT_IMPLEMENTED, 501)
  }

  return {
    id,
    connectOAuth: async () => fail(),
    connectToken: async () => fail(),
    fetchCurrent: async () => null,
    searchCategory: async () => [],
    updateBroadcast: async (patch) => ({
      platform: patch.platform,
      ok: false,
      durationMs: 0,
      fields: {},
      error: NOT_IMPLEMENTED
    })
  }
}
