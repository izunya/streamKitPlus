import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { BrowserWindow, shell } from 'electron'
import { URL } from 'node:url'

/**
 * 데스크톱 앱용 OAuth 인증 코드 흐름 (루프백 리다이렉트).
 *
 * 동작 순서
 *   1. 로컬에 임시 HTTP 서버를 띄운다  (http://127.0.0.1:<랜덤포트>/callback)
 *   2. 기본 브라우저로 플랫폼 로그인 페이지를 연다
 *   3. 사용자가 로그인/동의하면 브라우저가 위 주소로 code 를 물고 돌아온다
 *   4. code 를 받아 서버를 닫고, 호출자가 토큰 교환을 진행한다
 *
 * 앱 안에 BrowserWindow 로 로그인 창을 띄우지 않고 "기본 브라우저"를 쓰는 이유:
 *   - 이미 로그인된 세션을 그대로 활용할 수 있어 사용자가 편하다
 *   - 앱이 사용자의 아이디/비밀번호 입력창을 직접 렌더링하지 않으므로 안전하고,
 *     플랫폼 정책(임베디드 웹뷰 로그인 금지)에도 어긋나지 않는다
 */

/**
 * 인증 URL의 쿼리 파라미터 이름.
 *
 * 표준 OAuth 2.0 은 client_id / redirect_uri 같은 snake_case 를 쓰지만
 * 모든 플랫폼이 그렇지는 않습니다. 예를 들어 CIME 는
 *   https://ci.me/auth/openapi/account-interlock?clientId=..&redirectUri=..&state=..
 * 처럼 camelCase 를 쓰고 response_type / scope 를 아예 받지 않습니다.
 *
 * null 을 주면 해당 파라미터를 아예 보내지 않습니다.
 */
export interface OAuthParamNames {
  clientId?: string
  redirectUri?: string
  responseType?: string | null
  scope?: string | null
  state?: string
}

const DEFAULT_PARAM_NAMES: Required<OAuthParamNames> = {
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  responseType: 'response_type',
  scope: 'scope',
  state: 'state'
}

export interface OAuthRequest {
  /** 플랫폼 인증 엔드포인트 */
  authorizeUrl: string
  clientId: string
  scopes: string[]
  /** PKCE 미지원 플랫폼은 false. 이 경우 client_secret 이 필요합니다. */
  usePkce?: boolean
  /** 표준과 다른 파라미터 이름을 쓰는 플랫폼용 */
  paramNames?: OAuthParamNames
  /** 스코프 구분자. 기본은 공백이지만 쉼표를 쓰는 플랫폼도 있습니다. */
  scopeSeparator?: string
  /** 플랫폼이 요구하는 추가 쿼리 파라미터 */
  extraParams?: Record<string, string>
  /**
   * 콜백을 받을 고정 포트.
   *
   * 치지직처럼 "등록된 리다이렉트 URI 와 정확히 일치" 를 요구하는 플랫폼은
   * 반드시 지정해야 합니다. 매번 바뀌는 포트로는 검증을 통과할 수 없습니다.
   * 지정하지 않으면 OS 가 비어 있는 포트를 골라줍니다.
   */
  fixedPort?: number
  /** 콜백 호스트. 플랫폼이 localhost 표기를 요구하면 바꿉니다. */
  host?: string
  /** 콜백 경로 (기본 /callback) */
  callbackPath?: string
  /**
   * 취소 신호. 창 닫기나 재시도 시 이전 흐름을 끊는 데 씁니다.
   */
  signal?: AbortSignal
  /**
   * 로그인 페이지를 어디에 띄울지. 기본은 'system'.
   *
   *   'system' 기본 브라우저로 넘깁니다. ← 현재 모든 플랫폼이 이 방식
   *            이미 로그인해 둔 세션을 그대로 쓸 수 있어 가장 편합니다.
   *            대신 앱이 그 창을 제어할 수 없어 닫힘을 감지하지 못합니다.
   *            (그래서 연동 버튼을 잠그지 않고 다시 눌러 재시도할 수 있게 둡니다.)
   *
   *   'app'    앱 안의 별도 창에 띄웁니다.
   *            창이 닫히면 즉시 감지할 수 있지만, 세션이 분리돼 있어
   *            사용자가 매번 다시 로그인해야 합니다. 실제로 써 보니 그 불편이 더 컸습니다.
   *            Google 은 이 방식 자체를 차단합니다(disallowed_useragent).
   */
  openIn?: 'app' | 'system'
}

export interface OAuthResult {
  code: string
  redirectUri: string
  /** 치지직·CIME 은 토큰 교환 때 state 를 다시 보내야 합니다. */
  state: string
  /** PKCE 사용 시 토큰 교환에 함께 보내야 하는 값 */
  codeVerifier?: string
}

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * HTML 에 값을 넣기 전에 이스케이프합니다.
 *
 * 이 페이지는 Node http 서버가 직접 뱉으므로 렌더러 CSP 가 걸리지 않습니다.
 * message 에 콜백 쿼리에서 온 값(error 등)이 들어갈 수 있어, 그대로 넣으면
 * 스크립트가 실행됩니다. 반드시 이스케이프해야 합니다.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 사용자가 브라우저에서 보게 될 완료 안내 페이지 */
function resultPage(ok: boolean, message: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>StreamKit+ 연동</title>
<style>
  body{font-family:system-ui,'Malgun Gothic',sans-serif;background:#101219;color:#f1f3f8;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{text-align:center;padding:40px 56px;border-radius:16px;background:#1b1f2b;
        border:1px solid #2e3446}
  .mark{font-size:44px;margin-bottom:12px}
  h1{font-size:19px;margin:0 0 8px}
  p{font-size:14px;color:#aeb6c6;margin:0}
</style></head><body><div class="card">
<div class="mark">${ok ? '&#10003;' : '&#10005;'}</div>
<h1>${ok ? '연동이 완료되었습니다' : '연동에 실패했습니다'}</h1>
<p>${escapeHtml(message)}</p></div></body></html>`
}

const TIMEOUT_MS = 5 * 60 * 1000

export function startOAuthFlow(req: OAuthRequest): Promise<OAuthResult> {
  return new Promise((resolve, reject) => {
    // state 는 영숫자만 씁니다.
    // base64url 은 '-' 와 '_' 를 포함하는데, 값 형식을 엄격하게 검사하는
    // 플랫폼이 있을 수 있어 변수를 줄였습니다 (치지직 문서 예시도 영숫자입니다).
    const state = randomBytes(16).toString('hex')
    const pkce = req.usePkce === false ? null : createPkcePair()

    let server: Server | null = null
    let timer: NodeJS.Timeout | null = null
    let onAbort: (() => void) | null = null
    /** 앱 안에 띄운 로그인 창 (openIn: 'app' 일 때만) */
    let authWindow: BrowserWindow | null = null
    /** 이미 성공/실패가 확정됐는지. 창을 닫을 때 중복 처리를 막습니다. */
    let settled = false

    const cleanup = (): void => {
      settled = true
      if (timer) clearTimeout(timer)
      if (onAbort) req.signal?.removeEventListener('abort', onAbort)
      // 완료 안내 페이지가 사용자에게 잠깐 보이도록 여유를 둔 뒤 닫습니다.
      setTimeout(() => {
        server?.close()
        if (authWindow && !authWindow.isDestroyed()) authWindow.close()
      }, 800)
    }

    /** 중단 시 포트를 즉시 놓아줘야 다시 시도할 때 EADDRINUSE 가 안 납니다. */
    const abortNow = (message: string): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (onAbort) req.signal?.removeEventListener('abort', onAbort)
      server?.close()
      if (authWindow && !authWindow.isDestroyed()) authWindow.close()
      reject(new Error(message))
    }

    if (req.signal?.aborted) {
      reject(new Error('연동을 취소했습니다.'))
      return
    }
    onAbort = () => abortNow('연동을 취소했습니다.')
    req.signal?.addEventListener('abort', onAbort, { once: true })

    const host = req.host ?? '127.0.0.1'
    const callbackPath = req.callbackPath ?? '/callback'

    server = createServer((httpReq, httpRes) => {
      if (!httpReq.url) return

      const url = new URL(httpReq.url, `http://${host}`)
      if (url.pathname !== callbackPath) {
        httpRes.writeHead(404).end()
        return
      }

      // 어떤 요청이 들어왔는지 남깁니다. 인증이 안 될 때 원인을 좁히는 데 꼭 필요합니다.
      console.log(
        `[oauth] 콜백 수신 path=${url.pathname} params=${[...url.searchParams.keys()].join(',')}`
      )

      const send = (ok: boolean, msg: string): void => {
        httpRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        httpRes.end(resultPage(ok, msg))
      }

      // CSRF 방지: 우리가 보낸 state 와 일치해야 합니다.
      //
      // 다른 무엇보다 먼저 확인합니다. state 가 맞지 않으면 이 콜백은 우리가 시작한
      // 흐름이 아니므로, error 같은 다른 파라미터를 쳐다볼 이유도 없습니다.
      // (예전에는 error 를 state 검증 전에 페이지에 반영했는데, 그러면 아무나
      //  임의의 값을 이 페이지에 넣을 수 있었습니다.)
      if (url.searchParams.get('state') !== state) {
        send(false, 'state 값이 일치하지 않습니다.')
        cleanup()
        reject(new Error('state 불일치 — 인증을 중단했습니다.'))
        return
      }

      const error = url.searchParams.get('error')
      if (error) {
        // 표시는 이스케이프해서 하지만, 사유 자체도 형식이 이상하면 일반 문구로 바꿉니다.
        const safe = /^[a-z0-9_-]{1,64}$/i.test(error) ? error : '인증이 거부되었습니다'
        send(false, `${safe} — 앱으로 돌아가 다시 시도해 주세요.`)
        cleanup()
        reject(new Error(`인증 거부됨: ${safe}`))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        send(false, '인증 코드를 받지 못했습니다.')
        cleanup()
        reject(new Error('인증 코드 없음'))
        return
      }

      send(true, '이 탭을 닫고 StreamKit+ 로 돌아가세요.')
      cleanup()
      resolve({
        code,
        redirectUri: getRedirectUri(),
        state,
        codeVerifier: pkce?.verifier
      })
    })

    let redirectUri = ''
    const getRedirectUri = (): string => redirectUri

    // 포트 0 = OS가 비어 있는 포트를 알아서 골라줍니다.
    // 고정 포트가 지정되면 그 포트만 씁니다 (등록된 URI 와 일치시켜야 하므로).
    //
    // 127.0.0.1 에만 바인딩합니다 — 외부 네트워크에서 접근할 수 없습니다.
    server.listen(req.fixedPort ?? 0, '127.0.0.1', () => {
      const address = server?.address()
      if (!address || typeof address === 'string') {
        reject(new Error('루프백 서버를 시작하지 못했습니다.'))
        return
      }

      redirectUri = `http://${host}:${address.port}${callbackPath}`
      console.log(`[oauth] 콜백 서버 시작 127.0.0.1:${address.port}`)

      const names = { ...DEFAULT_PARAM_NAMES, ...req.paramNames }

      const authUrl = new URL(req.authorizeUrl)
      authUrl.searchParams.set(names.clientId, req.clientId)
      authUrl.searchParams.set(names.redirectUri, redirectUri)
      authUrl.searchParams.set(names.state, state)

      // null 로 지정된 파라미터는 보내지 않습니다 (CIME 처럼 받지 않는 플랫폼이 있습니다).
      if (names.responseType) authUrl.searchParams.set(names.responseType, 'code')
      if (names.scope && req.scopes.length > 0) {
        authUrl.searchParams.set(names.scope, req.scopes.join(req.scopeSeparator ?? ' '))
      }

      if (pkce) {
        authUrl.searchParams.set('code_challenge', pkce.challenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
      }
      for (const [k, v] of Object.entries(req.extraParams ?? {})) {
        authUrl.searchParams.set(k, v)
      }

      // 열리는 주소를 그대로 남깁니다.
      // 등록된 리다이렉트 URI 와 한 글자라도 다르면 플랫폼이 조용히 거부하기 때문에,
      // 이 로그가 원인을 찾는 가장 빠른 길입니다.
      console.log(`[oauth] 리다이렉트 URI = ${redirectUri}`)
      console.log(`[oauth] 인증 페이지 = ${authUrl.toString()}`)

      if (req.openIn === 'system') {
        // 기본 브라우저는 앱이 제어할 수 없어 닫힘을 감지하지 못합니다.
        // Google 처럼 임베디드 브라우저 로그인을 막는 곳에서만 씁니다.
        void shell.openExternal(authUrl.toString())
      } else {
        authWindow = new BrowserWindow({
          width: 520,
          height: 760,
          autoHideMenuBar: true,
          title: '로그인',
          backgroundColor: '#ffffff',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // 로그인 세션을 남겨두면 다음 연동 때 다시 로그인하지 않아도 됩니다.
            partition: 'persist:oauth'
          }
        })

        void authWindow.loadURL(authUrl.toString())

        // 사용자가 창을 닫으면 그 즉시 연동을 중단합니다.
        // 이게 있어야 "연동 중" 상태로 멈춰 있지 않습니다.
        authWindow.on('closed', () => {
          authWindow = null
          abortNow('로그인 창이 닫혀 연동을 중단했습니다.')
        })
      }

      timer = setTimeout(() => {
        abortNow('인증 대기 시간이 초과되었습니다 (5분).')
      }, TIMEOUT_MS)
    })

    server.on('error', (e) => {
      settled = true
      if (timer) clearTimeout(timer)
      if (authWindow && !authWindow.isDestroyed()) authWindow.close()
      // 고정 포트가 이미 사용 중이면 원인을 분명히 알려줍니다.
      // 이 경우 포트를 바꾸고 개발자 콘솔의 등록 주소도 함께 바꿔야 합니다.
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE' && req.fixedPort) {
        reject(
          new Error(
            `포트 ${req.fixedPort} 를 다른 프로그램이 쓰고 있어 연동을 시작할 수 없습니다. ` +
              '해당 프로그램을 종료한 뒤 다시 시도해 주세요.'
          )
        )
        return
      }
      reject(e)
    })
  })
}
