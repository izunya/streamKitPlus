/**
 * 메인 프로세스 HTTP 헬퍼.
 *
 * 모든 플랫폼 API 호출은 여기를 지납니다. 렌더러에서 직접 호출하지 않는 이유:
 *   1. CORS 회피 — 브라우저 컨텍스트가 아니므로 제약이 없습니다
 *   2. 토큰이 렌더러로 내려가지 않습니다
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** 토큰 만료로 보이는가 (갱신 후 재시도 대상) */
  get isAuthError(): boolean {
    return this.status === 401
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  query?: Record<string, string | number | undefined>
  /** JSON 바디. 문자열이면 그대로 보냅니다. */
  body?: unknown
  /** form-urlencoded 로 보낼 때 */
  form?: Record<string, string>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 15_000

function buildUrl(url: string, query?: RequestOptions['query']): string {
  if (!query) return url
  const u = new URL(url)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
  }
  return u.toString()
}

/**
 * JSON API 호출. 실패는 ApiError 로 던집니다.
 * (어댑터가 이걸 잡아서 UpdateResult 로 변환합니다 — 어댑터는 throw 하지 않습니다.)
 */
export async function apiFetch<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT)

  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  let body: string | undefined

  if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(opts.form).toString()
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  }

  try {
    const res = await fetch(buildUrl(url, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: controller.signal
    })

    const text = await res.text()
    let parsed: unknown = undefined
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!res.ok) {
      throw new ApiError(describeError(parsed) ?? `${res.status} ${res.statusText}`, res.status, parsed)
    }
    return parsed as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError('요청 시간이 초과되었습니다.', 408)
    }
    throw new ApiError(e instanceof Error ? e.message : String(e), 0)
  } finally {
    clearTimeout(timer)
  }
}

/** 플랫폼마다 오류 메시지 위치가 달라서, 흔한 자리를 훑어 사람이 읽을 문장을 뽑습니다. */
function describeError(body: unknown): string | null {
  if (!body) return null
  if (typeof body === 'string') return body.slice(0, 300)
  if (typeof body !== 'object') return null

  const o = body as Record<string, unknown>
  const candidates = [o.message, o.error_description, o.error, o.msg, o.errorMessage]
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c
  }

  /*
   * Google 형태: { error: { code, message, errors: [...] } }
   *
   * error 가 문자열이 아니라 객체라서 위 검사에 걸리지 않습니다.
   * 이걸 놓치면 사유가 통째로 사라지고 "403 Forbidden" 만 남아,
   * 할당량 초과인지 권한 문제인지 구분할 수 없게 됩니다.
   */
  if (typeof o.error === 'object' && o.error) {
    const inner = (o.error as Record<string, unknown>).message
    if (typeof inner === 'string' && inner) return inner
  }
  // 치지직/CIME 형태: { code, message, content }
  if (typeof o.content === 'object' && o.content) {
    const inner = (o.content as Record<string, unknown>).message
    if (typeof inner === 'string') return inner
  }
  return null
}
