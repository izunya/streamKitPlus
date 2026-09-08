/**
 * 자동 업데이트 도메인 타입.
 *
 * 연결·다운로드는 메인 프로세스(electron-updater)가 맡고,
 * 화면은 상태만 받아 "새 버전 있음 / 받는 중 / 다시 시작" 을 안내합니다.
 */

export type UpdateStatus =
  | 'idle' // 확인 전
  | 'checking' // 확인 중
  | 'available' // 새 버전 발견 (내려받기 시작)
  | 'not-available' // 최신 버전
  | 'downloading' // 내려받는 중
  | 'downloaded' // 다 받음 — 다시 시작하면 적용
  | 'error' // 확인·다운로드 실패

export interface UpdateState {
  status: UpdateStatus
  /** 새 버전 번호 (available 이후) */
  version?: string
  /** 내려받기 진행률 0~100 */
  percent?: number
  /** 실패 사유. 사용자에게 그대로 보여줍니다. */
  error?: string
}
