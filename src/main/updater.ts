import { app, type WebContents } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/update'

/**
 * 자동 업데이트 (electron-updater + GitHub 릴리스).
 *
 * 흐름:
 *   1. 앱을 켜면 조용히 새 버전을 확인합니다.
 *   2. 있으면 백그라운드로 내려받습니다 (사용자는 계속 쓸 수 있습니다).
 *   3. 다 받으면 "다시 시작하면 적용됩니다" 를 화면에 알립니다.
 *   4. 사용자가 다시 시작하거나, 다음에 앱을 끌 때 자동 적용됩니다.
 *
 * ⚠️ 개발 모드에서는 동작하지 않습니다 (설치된 앱에서만 유효).
 * ⚠️ 비공개(private) 저장소의 릴리스는 인증이 필요해 그대로는 내려받지 못합니다.
 *    저장소나 릴리스를 공개하면 별도 설정 없이 동작합니다.
 */

const { autoUpdater } = electronUpdater

let target: WebContents | null = null
let state: UpdateState = { status: 'idle' }
/** 확인이 이미 진행 중이면 중복 호출을 막습니다. */
let checking = false

export function setUpdateTarget(wc: WebContents | null): void {
  target = wc
}

export function getUpdateState(): UpdateState {
  return state
}

function emit(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  if (target && !target.isDestroyed()) target.send('update:state', state)
}

/** 사용자에게 그대로 보여줄 수 있게 오류를 다듬습니다. */
function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // 비공개 저장소·릴리스 없음일 때 흔한 404.
  if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
    return '업데이트 정보를 찾지 못했습니다. 아직 배포된 새 버전이 없을 수 있습니다.'
  }
  if (msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || msg.includes('network')) {
    return '네트워크에 연결하지 못해 업데이트를 확인할 수 없습니다.'
  }
  return msg
}

let wired = false

function wireOnce(): void {
  if (wired) return
  wired = true

  /*
   * 사용자가 아무것도 누르지 않아도 되도록 맞춰둡니다.
   *
   *   autoDownload          새 버전을 찾으면 바로 받습니다.
   *   autoInstallOnAppQuit  앱을 끌 때 조용히(silent) 설치합니다.
   *                         NSIS 설치 마법사가 뜨지 않고 그대로 갈아끼워집니다.
   *
   * 다 받았다고 즉시 재시작하지는 않습니다 — 방송 중에 창이 꺼지면 안 되니
   * 교체는 앱을 끄는 시점까지 미룹니다.
   */
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', error: undefined }))

  autoUpdater.on('update-available', (info) => {
    emit({ status: 'available', version: info.version, percent: 0, error: undefined })
  })

  autoUpdater.on('update-not-available', () => {
    emit({ status: 'not-available', error: undefined })
  })

  autoUpdater.on('download-progress', (p) => {
    emit({ status: 'downloading', percent: Math.round(p.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    emit({ status: 'downloaded', version: info.version, percent: 100, error: undefined })
  })

  autoUpdater.on('error', (err) => {
    emit({ status: 'error', error: friendly(err) })
  })
}

/**
 * 업데이트 확인을 시작합니다.
 *
 * 설치된 앱에서만 동작합니다. 개발 모드에서는 조용히 넘어갑니다 —
 * electron-updater 는 개발 실행 파일에서 스스로 오류를 내기 때문입니다.
 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    emit({ status: 'idle' })
    return
  }
  if (checking) return
  checking = true

  wireOnce()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ status: 'error', error: friendly(err) })
  } finally {
    checking = false
  }
}

/**
 * 주기적으로 새 버전을 확인합니다.
 *
 * 방송 도구는 하루 종일 켜두는 일이 흔해서, 켤 때 한 번만 보면
 * 그 사이에 나온 버전을 영영 못 받습니다. 6시간마다 조용히 확인합니다.
 * 이미 받아둔 게 있으면 electron-updater 가 알아서 건너뜁니다.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
let timer: NodeJS.Timeout | null = null

export function startUpdateSchedule(): void {
  if (timer || !app.isPackaged) return
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export function stopUpdateSchedule(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** 받아둔 업데이트를 지금 적용하고 다시 시작합니다. */
export function quitAndInstall(): void {
  if (state.status !== 'downloaded') return
  // 설치 마법사 없이(silent) 설치하고 다시 띄웁니다.
  autoUpdater.quitAndInstall(true, true)
}
