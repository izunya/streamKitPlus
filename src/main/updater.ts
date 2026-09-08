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

  // 우리가 직접 시점을 정합니다. 켜자마자 강제로 받지 않습니다.
  autoUpdater.autoDownload = true
  // 앱을 끌 때 받아둔 업데이트를 조용히 적용합니다.
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

/** 받아둔 업데이트를 지금 적용하고 다시 시작합니다. */
export function quitAndInstall(): void {
  if (state.status !== 'downloaded') return
  // 남은 창을 닫고 설치 후 재실행합니다.
  autoUpdater.quitAndInstall()
}
