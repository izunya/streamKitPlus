import { createHash } from 'node:crypto'
import { WebSocket } from 'ws'
import type { WebContents } from 'electron'
import {
  OBS_EVENT_SUB,
  OBS_FATAL_CLOSE,
  OBS_OP,
  OBS_RPC_VERSION,
  type ObsSettings,
  type ObsState
} from '../shared/obs'

/**
 * OBS 연결 (obs-websocket 5.x).
 *
 * 흐름:
 *   1. 접속하면 OBS 가 Hello(op 0) 를 보냅니다. 인증이 켜져 있으면 salt/challenge 가 들어옵니다.
 *   2. Identify(op 1) 로 답합니다 — rpcVersion, 인증 문자열, 받을 이벤트 종류.
 *   3. Identified(op 2) 가 오면 연결 완료입니다.
 *   4. 씬이 바뀌면 Event(op 5) 로 CurrentProgramSceneChanged 가 옵니다.
 *
 * 인증 문자열 만드는 법 (문서 그대로):
 *   base64(sha256(비밀번호 + salt))        -> secret
 *   base64(sha256(secret + challenge))     -> 이 값을 보냅니다
 *
 * 씬 목록은 GetSceneList(op 6) 로 한 번만 받아옵니다. 매핑 화면에서 고르라고 쓰는 용도라
 * 주기적으로 다시 부를 이유가 없습니다.
 */

type SceneHandler = (sceneName: string) => void

interface Envelope {
  op: number
  d?: Record<string, unknown>
}

let ws: WebSocket | null = null
let target: WebContents | null = null
let closedByUs = false
let retry = 0
let retryTimer: NodeJS.Timeout | null = null
let settings: ObsSettings | null = null

/** 마지막 상태 — 화면이 늦게 붙어도 현재 상태를 보여줄 수 있게 들고 있습니다. */
let state: ObsState = { status: 'off' }

/** 씬 전환을 알릴 곳 */
let onScene: SceneHandler | null = null

export function setObsTarget(wc: WebContents | null): void {
  target = wc
}

export function getObsState(): ObsState {
  return state
}

function emit(patch: Partial<ObsState>): void {
  state = { ...state, ...patch }
  if (target && !target.isDestroyed()) target.send('obs:state', state)
}

/** base64(sha256(x)) */
function hash(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('base64')
}

function buildAuth(password: string, salt: string, challenge: string): string {
  const secret = hash(password + salt)
  return hash(secret + challenge)
}

function send(msg: Envelope): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function request(requestType: string, requestId: string): void {
  send({ op: OBS_OP.request, d: { requestType, requestId } })
}

/**
 * 씬 목록 응답에서 이름만 뽑습니다.
 *
 * 문서가 scenes 배열 안쪽 필드까지는 적어두지 않아, 실제로 오는 모양을 넓게 받습니다.
 * 이름을 못 찾으면 그 항목만 건너뛰고 나머지는 살립니다.
 */
function sceneNames(data: unknown): string[] {
  const arr = (data as { scenes?: unknown[] } | undefined)?.scenes
  if (!Array.isArray(arr)) return []

  return arr
    .map((s) => {
      if (typeof s === 'string') return s
      const name = (s as Record<string, unknown> | null)?.['sceneName']
      return typeof name === 'string' ? name : ''
    })
    .filter(Boolean)
}

function scheduleRetry(): void {
  if (closedByUs || !settings?.enabled) return
  retry += 1
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(retry, 5))
  emit({
    status: 'connecting',
    error: `OBS 에 연결하지 못했습니다. ${Math.round(delay / 1000)}초 뒤 다시 시도합니다.`
  })
  retryTimer = setTimeout(() => connectNow(), delay)
}

function handle(env: Envelope): void {
  const d = env.d ?? {}

  if (env.op === OBS_OP.hello) {
    const auth = d['authentication'] as { challenge?: string; salt?: string } | undefined
    const payload: Record<string, unknown> = {
      rpcVersion: OBS_RPC_VERSION,
      // 씬 전환만 받습니다. 나머지는 받아도 쓰지 않습니다.
      eventSubscriptions: OBS_EVENT_SUB.scenes
    }

    if (auth?.challenge && auth.salt) {
      if (!settings?.password) {
        emit({
          status: 'error',
          error: 'OBS 가 비밀번호를 요구합니다. 설정에서 OBS 서버 비밀번호를 입력해 주세요.'
        })
        closedByUs = true
        ws?.close()
        return
      }
      payload.authentication = buildAuth(settings.password, auth.salt, auth.challenge)
    }

    emit({ obsVersion: typeof d['obsStudioVersion'] === 'string' ? d['obsStudioVersion'] : undefined })
    send({ op: OBS_OP.identify, d: payload })
    return
  }

  if (env.op === OBS_OP.identified) {
    retry = 0
    emit({ status: 'connected', error: undefined })
    // 매핑 화면에서 고를 씬 목록과, 지금 켜져 있는 씬을 한 번씩 받아옵니다.
    request('GetSceneList', 'scenes')
    request('GetCurrentProgramScene', 'current')
    return
  }

  if (env.op === OBS_OP.requestResponse) {
    const okStatus = d['requestStatus'] as { result?: boolean; comment?: string } | undefined
    const data = d['responseData']

    if (okStatus?.result === false) {
      // 요청 하나가 실패했다고 연결을 끊지는 않습니다.
      emit({ error: okStatus.comment })
      return
    }

    if (d['requestId'] === 'scenes') {
      const names = sceneNames(data)
      const currentFromList = (data as { currentProgramSceneName?: unknown } | undefined)?.[
        'currentProgramSceneName'
      ]
      emit({
        scenes: names,
        currentScene:
          typeof currentFromList === 'string' ? currentFromList : state.currentScene
      })
      return
    }

    if (d['requestId'] === 'current') {
      const name = (data as { sceneName?: unknown } | undefined)?.['sceneName']
      if (typeof name === 'string') emit({ currentScene: name })
    }
    return
  }

  if (env.op === OBS_OP.event) {
    if (d['eventType'] !== 'CurrentProgramSceneChanged') return
    const name = (d['eventData'] as { sceneName?: unknown } | undefined)?.['sceneName']
    if (typeof name !== 'string' || !name) return

    emit({ currentScene: name })
    onScene?.(name)
  }
}

function connectNow(): void {
  if (!settings?.enabled) return
  closedByUs = false
  emit({ status: 'connecting', error: undefined })

  const url = `ws://${settings.host}:${settings.port}`
  try {
    ws = new WebSocket(url)
  } catch (e) {
    emit({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    scheduleRetry()
    return
  }

  ws.on('message', (raw) => {
    let env: Envelope
    try {
      env = JSON.parse(raw.toString()) as Envelope
    } catch {
      return
    }
    handle(env)
  })

  ws.on('close', (code: number) => {
    if (closedByUs) return

    /*
     * 비밀번호가 틀렸거나 버전이 안 맞는 경우입니다.
     * 다시 붙어도 똑같이 거절당하므로, 계속 두드리지 않고 무엇을 고쳐야 하는지 알립니다.
     */
    const fatal = OBS_FATAL_CLOSE[code]
    if (fatal) {
      closedByUs = true
      emit({ status: 'error', error: fatal })
      return
    }

    scheduleRetry()
  })

  ws.on('error', (e) => {
    // 여기서 재연결을 걸면 close 와 겹쳐 두 번 예약됩니다. 예약은 close 에서만 합니다.
    emit({ status: 'error', error: friendlyError(e) })
  })
}

/** 연결 실패 사유를 방송인이 읽을 수 있는 말로 바꿉니다. */
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('ECONNREFUSED')) {
    return 'OBS 가 꺼져 있거나 WebSocket 서버가 켜져 있지 않습니다. OBS 의 도구 > WebSocket 서버 설정에서 켜주세요.'
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('EHOSTUNREACH')) {
    return 'OBS 에 연결하지 못했습니다. 주소와 포트를 확인해 주세요.'
  }
  return msg
}

/** 설정을 받아 연결합니다. 이미 붙어 있으면 끊고 다시 붙습니다. */
export function connectObs(next: ObsSettings, sceneHandler: SceneHandler): void {
  disconnectObs()
  settings = next
  onScene = sceneHandler

  if (!next.enabled) {
    emit({ status: 'off', error: undefined, currentScene: undefined, scenes: undefined })
    return
  }
  retry = 0
  connectNow()
}

export function disconnectObs(): void {
  closedByUs = true
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  ws?.close()
  ws = null
  if (state.status !== 'off') emit({ status: 'off', error: undefined })
}
