import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type {
  AuthMethod,
  PlatformCategory,
  PlatformId,
  PlatformPatch,
  UpdateResult
} from '../shared/types'
import type { CredentialSlot } from '../shared/redirectUri'
import { getServerAdapter } from './platforms'
import {
  connectChat,
  disconnectChat,
  getChatStatuses,
  loginChat,
  sendChat,
  setChatTarget
} from './chat'
import { connectObs, disconnectObs, getObsState, setObsTarget } from './obs'
import { checkForUpdates, getUpdateState, quitAndInstall, setUpdateTarget } from './updater'
import type { ObsSettings } from '../shared/obs'
import {
  clearConnection,
  encryptionAvailable,
  isVaultUnreadable,
  getAccount,
  setAccount,
  setCredentials,
  getObsPassword,
  setObsPassword,
  summarize,
  type AppCredentials
} from './vault'

/**
 * 렌더러 ↔ 메인 경계.
 *
 * 규칙 하나: 토큰은 이 선을 넘지 않습니다.
 * 렌더러는 "연결됨/안 됨"과 채널 이름까지만 알 수 있습니다.
 */

/** 렌더러로 보내는 오류는 문자열로 평탄화합니다 (Error 객체는 IPC 를 넘으면서 뭉개집니다). */
function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface ConnectResult {
  ok: boolean
  displayName?: string
  channelId?: string
  error?: string
}

/**
 * 진행 중인 연동 흐름.
 *
 * 사용자가 브라우저를 그냥 닫으면 콜백이 영영 오지 않습니다.
 * 취소할 수단이 없으면 앱이 5분 타임아웃까지 멈춰 있게 되므로,
 * 취소 버튼과 창 닫기에서 이 컨트롤러를 끊습니다.
 */
const inflight = new Map<PlatformId, AbortController>()

export function registerIpc(): void {
  /* ---------------- 자격 증명 (BYOK) ---------------- */

  ipcMain.handle('cred:status', (_e, id: PlatformId, slot: CredentialSlot = 'broadcast') =>
    summarize(id, slot)
  )

  ipcMain.handle(
    'cred:set',
    (_e, id: PlatformId, creds: AppCredentials | null, slot: CredentialSlot = 'broadcast') => {
      try {
        setCredentials(id, creds && creds.clientId ? creds : null, slot)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: toMessage(e) }
      }
    }
  )

  ipcMain.handle('cred:encryptionAvailable', () => encryptionAvailable())

  /** 금고 파일이 있는데 복호화가 안 되는 상태인지 (userData 경로가 바뀐 경우 등) */
  ipcMain.handle('cred:vaultUnreadable', () => isVaultUnreadable())

  /* ---------------- 연동 ---------------- */

  ipcMain.handle(
    'platform:connect',
    async (
      e: IpcMainInvokeEvent,
      id: PlatformId,
      method: AuthMethod,
      token?: string
    ): Promise<ConnectResult> => {
      // 같은 플랫폼에 이미 진행 중인 흐름이 있으면 먼저 끊습니다.
      // 그러지 않으면 고정 포트가 물려 있어 새 시도가 EADDRINUSE 로 실패합니다.
      inflight.get(id)?.abort()

      const controller = new AbortController()
      inflight.set(id, controller)

      try {
        const adapter = getServerAdapter(id)
        const account =
          method === 'oauth'
            ? await adapter.connectOAuth({
                signal: controller.signal,
                notify: (info) => {
                  // Device Code Flow 는 사용자가 코드를 눈으로 확인해야 하므로
                  // 연동이 끝나기 전에 화면으로 먼저 보냅니다.
                  if (!e.sender.isDestroyed()) {
                    e.sender.send('platform:deviceCode', { platform: id, ...info })
                  }
                }
              })
            : await adapter.connectToken((token ?? '').trim())

        setAccount(id, { ...account, connectedAt: Date.now() })
        return { ok: true, ...account }
      } catch (err) {
        // 실패하면 절반만 저장된 상태가 남지 않도록 정리합니다.
        clearConnection(id)
        return { ok: false, error: toMessage(err) }
      } finally {
        if (inflight.get(id) === controller) inflight.delete(id)
      }
    }
  )

  /** 진행 중인 연동 취소 — 취소 버튼과 창 닫기가 부릅니다 */
  ipcMain.handle('platform:cancelConnect', (_e, id: PlatformId) => {
    const c = inflight.get(id)
    if (!c) return { ok: false }
    c.abort()
    inflight.delete(id)
    return { ok: true }
  })

  ipcMain.handle('platform:disconnect', (_e, id: PlatformId) => {
    clearConnection(id)
    return { ok: true }
  })

  ipcMain.handle('platform:account', (_e, id: PlatformId) => getAccount(id) ?? null)

  /* ---------------- 방송 정보 ---------------- */

  ipcMain.handle(
    'platform:searchCategory',
    async (
      _e,
      id: PlatformId,
      query: string
    ): Promise<{ ok: boolean; data?: PlatformCategory[]; error?: string }> => {
      try {
        const data = await getServerAdapter(id).searchCategory(query)
        console.log(`[category] ${id} "${query}" -> ${data.length}건`)
        return { ok: true, data }
      } catch (e) {
        // 조용히 삼키면 화면에는 "결과 없음" 으로만 보여 원인을 알 수 없습니다.
        console.error(`[category] ${id} 검색 실패:`, toMessage(e))
        return { ok: false, error: toMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'platform:fetchCurrent',
    async (
      _e,
      id: PlatformId
    ): Promise<{ ok: boolean; data?: PlatformPatch | null; error?: string }> => {
      try {
        return { ok: true, data: await getServerAdapter(id).fetchCurrent() }
      } catch (e) {
        return { ok: false, error: toMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'platform:update',
    async (_e, patch: PlatformPatch): Promise<UpdateResult> => {
      try {
        return await getServerAdapter(patch.platform).updateBroadcast(patch)
      } catch (e) {
        // 어댑터가 계약을 어기고 throw 해도 여기서 결과 객체로 바꿉니다.
        return {
          platform: patch.platform,
          ok: false,
          durationMs: 0,
          fields: {},
          error: toMessage(e)
        }
      }
    }
  )

  /* ---------------- 채팅 ---------------- */

  /** 메시지를 밀어줄 창을 알려줍니다 (창이 다시 열리면 갱신). */
  ipcMain.handle('chat:attach', (e: IpcMainInvokeEvent) => {
    setChatTarget(e.sender)
    return getChatStatuses()
  })

  ipcMain.handle('chat:connect', (_e, id: PlatformId) => connectChat(id))

  ipcMain.handle('chat:disconnect', (_e, id: PlatformId) => {
    disconnectChat(id)
    return { ok: true }
  })

  ipcMain.handle('chat:send', async (_e, id: PlatformId, text: string) => sendChat(id, text))

  /** 채팅 전용 로그인 (Twitch 만 해당) */
  ipcMain.handle('chat:login', async (e: IpcMainInvokeEvent, id: PlatformId) =>
    loginChat(id, (info) => {
      if (!e.sender.isDestroyed()) {
        e.sender.send('platform:deviceCode', { platform: id, ...info })
      }
    })
  )

  /** 채팅 로그인 여부 (Twitch 채팅 슬롯) */
  ipcMain.handle('chat:status', (_e, id: PlatformId) => summarize(id, 'chat'))

  /* ---------------- OBS ---------------- */

  ipcMain.handle('obs:attach', (e: IpcMainInvokeEvent) => {
    setObsTarget(e.sender)
    return getObsState()
  })

  /**
   * 설정을 받아 다시 연결합니다.
   *
   * 비밀번호는 금고에만 두고 렌더러로 돌려보내지 않습니다.
   * password 를 안 보내면 저장된 값을 그대로 씁니다 — 화면이 값을 되읽을 수 없으니,
   * 칸을 건드리지 않았을 때 기존 비밀번호가 지워지면 안 되기 때문입니다.
   */
  ipcMain.handle(
    'obs:connect',
    (e: IpcMainInvokeEvent, settings: Omit<ObsSettings, 'password'> & { password?: string }) => {
      setObsPassword(settings.password)
      setObsTarget(e.sender)

      connectObs({ ...settings, password: getObsPassword() }, (sceneName) => {
        // 어떤 프리셋을 걸어뒀는지는 화면 쪽이 압니다. 여기서는 알리기만 합니다.
        if (!e.sender.isDestroyed()) e.sender.send('obs:scene', sceneName)
      })
      return { ok: true }
    }
  )

  ipcMain.handle('obs:disconnect', () => {
    disconnectObs()
    return { ok: true }
  })

  /** 비밀번호를 저장해뒀는지만 알려줍니다 (값은 주지 않습니다) */
  ipcMain.handle('obs:hasPassword', () => Boolean(getObsPassword()))

  /* ---------------- 자동 업데이트 ---------------- */

  ipcMain.handle('update:attach', (e: IpcMainInvokeEvent) => {
    setUpdateTarget(e.sender)
    return getUpdateState()
  })

  ipcMain.handle('update:check', (e: IpcMainInvokeEvent) => {
    setUpdateTarget(e.sender)
    void checkForUpdates()
    return { ok: true }
  })

  ipcMain.handle('update:install', () => {
    quitAndInstall()
    return { ok: true }
  })

  ipcMain.handle('app:version', () => app.getVersion())

  /* ---------------- 기타 ---------------- */

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // 외부 링크 열기는 http(s) 로만 제한합니다.
    if (!/^https?:\/\//i.test(url)) return false
    void shell.openExternal(url)
    return true
  })
}
