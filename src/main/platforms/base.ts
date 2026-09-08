import type { PlatformId, PlatformCategory, PlatformPatch, UpdateResult } from '../../shared/types'
import { ApiError } from '../net'
import { getToken, setToken, type StoredToken } from '../vault'

/**
 * 메인 프로세스 쪽 플랫폼 어댑터 계약.
 *
 * 렌더러의 StreamPlatformAdapter 와 모양이 비슷하지만, 이쪽이 실제 네트워크를 칩니다.
 * 렌더러는 IPC 프록시를 통해 이 구현을 호출합니다.
 */
/**
 * Device Code Flow 진행 상황.
 * 사용자가 브라우저에서 코드를 확인해야 하므로 화면에 띄워줘야 합니다.
 */
export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  expiresInSec: number
}

export interface ConnectOptions {
  /** Device Code Flow 진행 중 사용자에게 보여줄 코드 */
  notify?: (info: DeviceCodeInfo) => void
  /**
   * 취소 신호.
   * 사용자가 브라우저를 그냥 닫으면 콜백이 오지 않으므로,
   * 취소로 즉시 정리할 수 있어야 합니다.
   */
  signal?: AbortSignal
}

export interface ServerAdapter {
  id: PlatformId

  /**
   * 브라우저 로그인을 시작해 토큰까지 확보하고 계정 정보를 돌려줍니다.
   * Device Code Flow 를 쓰는 플랫폼은 진행 중에 notify 로 코드를 알려줍니다.
   */
  connectOAuth(opts?: ConnectOptions): Promise<{
    displayName: string
    channelId: string
  }>

  /** 사용자가 직접 붙여넣은 액세스 토큰으로 연결합니다. */
  connectToken(accessToken: string): Promise<{ displayName: string; channelId: string }>

  fetchCurrent(): Promise<PlatformPatch | null>
  searchCategory(query: string): Promise<PlatformCategory[]>
  updateBroadcast(patch: PlatformPatch): Promise<UpdateResult>
}

/* ------------------------------------------------------------------ */

/**
 * 액세스 토큰을 꺼냅니다. 만료가 임박했으면 먼저 갱신합니다.
 *
 * refresh 함수는 플랫폼마다 다르므로 주입받습니다.
 * 사용자가 직접 붙여넣은 토큰(manual)은 갱신할 수 없으므로 그대로 씁니다.
 */
export async function getFreshToken(
  id: PlatformId,
  refresh: (refreshToken: string) => Promise<StoredToken>
): Promise<string> {
  const token = getToken(id)
  if (!token) throw new ApiError('연동되어 있지 않습니다.', 401)

  // 만료 60초 전부터 미리 갱신합니다.
  const nearExpiry = token.expiresAt !== undefined && token.expiresAt - Date.now() < 60_000
  if (!nearExpiry || token.manual || !token.refreshToken) return token.accessToken

  try {
    const next = await refresh(token.refreshToken)
    setToken(id, next)
    return next.accessToken
  } catch {
    // 갱신에 실패해도 일단 기존 토큰으로 시도해봅니다.
    // 정말 만료됐다면 401 이 오고, 사용자에게 재연동을 안내하게 됩니다.
    return token.accessToken
  }
}

/**
 * 401 을 만나면 한 번 갱신하고 재시도하는 래퍼.
 * 만료 시각을 못 믿는 플랫폼이 있어 실제 401 기준으로도 한 번 더 시도합니다.
 */
export async function withRetryOnAuth<T>(
  id: PlatformId,
  refresh: (refreshToken: string) => Promise<StoredToken>,
  call: (accessToken: string) => Promise<T>
): Promise<T> {
  const token = await getFreshToken(id, refresh)
  try {
    return await call(token)
  } catch (e) {
    if (!(e instanceof ApiError) || !e.isAuthError) throw e

    const stored = getToken(id)
    if (!stored?.refreshToken || stored.manual) throw e

    const next = await refresh(stored.refreshToken)
    setToken(id, next)
    return call(next.accessToken)
  }
}

/* ------------------------------------------------------------------ */

/** 어댑터가 절대 throw 하지 않도록 감싸는 헬퍼 */
export function failure(id: PlatformId, started: number, e: unknown): UpdateResult {
  const message =
    e instanceof ApiError
      ? e.isAuthError
        ? '인증이 만료되었습니다. 다시 연동해 주세요.'
        : e.message
      : e instanceof Error
        ? e.message
        : String(e)

  return {
    platform: id,
    ok: false,
    durationMs: Date.now() - started,
    fields: {},
    error: message
  }
}

/** expiresIn(초, 문자열일 수도 있음) 을 절대 시각으로 바꿉니다. */
export function toExpiryMs(expiresIn: unknown): number | undefined {
  const n = typeof expiresIn === 'string' ? Number(expiresIn) : expiresIn
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Date.now() + n * 1000
}
