import { contextBridge, ipcRenderer } from 'electron'
import type { CredentialSlot } from '../shared/redirectUri'
import type { ChatMessage, ChatStatus } from '../shared/chat'
import type { ObsSettings, ObsState } from '../shared/obs'
import type { UpdateState } from '../shared/update'
import type {
  AuthMethod,
  PlatformCategory,
  PlatformId,
  PlatformPatch,
  UpdateResult
} from '../shared/types'

/**
 * 렌더러에 노출하는 안전한 API 표면.
 * 여기에 없는 것은 렌더러가 할 수 없습니다 (contextIsolation).
 *
 * 토큰을 읽는 통로는 의도적으로 없습니다 — 토큰은 메인 프로세스 밖으로 나가지 않습니다.
 */

export interface CredentialStatus {
  hasCredentials: boolean
  hasClientSecret: boolean
  /** 사용자가 직접 입력한 값이 있는지 */
  hasOwnCredentials: boolean
  /** 앱에 내장된 기본 자격 증명이 있는지 */
  hasDefault: boolean
  connected: boolean
  account?: { displayName: string; channelId: string; connectedAt: number }
}

export interface DeviceCodeEvent {
  platform: PlatformId
  userCode: string
  verificationUri: string
  expiresInSec: number
}

export interface ConnectResult {
  ok: boolean
  displayName?: string
  channelId?: string
  error?: string
}

const api = {
  credentials: {
    status: (id: PlatformId, slot: CredentialSlot = 'broadcast') =>
      ipcRenderer.invoke('cred:status', id, slot) as Promise<CredentialStatus>,
    set: (
      id: PlatformId,
      creds: { clientId: string; clientSecret?: string } | null,
      slot: CredentialSlot = 'broadcast'
    ) => ipcRenderer.invoke('cred:set', id, creds, slot) as Promise<{ ok: boolean; error?: string }>,
    encryptionAvailable: () =>
      ipcRenderer.invoke('cred:encryptionAvailable') as Promise<boolean>,
    vaultUnreadable: () => ipcRenderer.invoke('cred:vaultUnreadable') as Promise<boolean>
  },

  platform: {
    connect: (id: PlatformId, method: AuthMethod, token?: string) =>
      ipcRenderer.invoke('platform:connect', id, method, token) as Promise<ConnectResult>,
    disconnect: (id: PlatformId) => ipcRenderer.invoke('platform:disconnect', id),
    /** 진행 중인 브라우저 로그인 취소 */
    cancelConnect: (id: PlatformId) =>
      ipcRenderer.invoke('platform:cancelConnect', id) as Promise<{ ok: boolean }>,
    account: (id: PlatformId) =>
      ipcRenderer.invoke('platform:account', id) as Promise<CredentialStatus['account'] | null>,
    searchCategory: (id: PlatformId, query: string) =>
      ipcRenderer.invoke('platform:searchCategory', id, query) as Promise<{
        ok: boolean
        data?: PlatformCategory[]
        error?: string
      }>,
    fetchCurrent: (id: PlatformId) =>
      ipcRenderer.invoke('platform:fetchCurrent', id) as Promise<{
        ok: boolean
        data?: PlatformPatch | null
        error?: string
      }>,
    update: (patch: PlatformPatch) =>
      ipcRenderer.invoke('platform:update', patch) as Promise<UpdateResult>,

    /**
     * Device Code Flow 진행 알림 구독.
     * 트위치처럼 사용자가 코드를 확인해야 하는 플랫폼에서 호출됩니다.
     * 반환한 함수를 부르면 구독이 해제됩니다.
     */
    onDeviceCode: (cb: (info: DeviceCodeEvent) => void): (() => void) => {
      const listener = (_e: unknown, info: DeviceCodeEvent): void => cb(info)
      ipcRenderer.on('platform:deviceCode', listener)
      return () => ipcRenderer.off('platform:deviceCode', listener)
    }
  },

  chat: {
    /** 이 창으로 메시지를 보내달라고 등록하고, 현재 상태를 받아옵니다. */
    attach: () =>
      ipcRenderer.invoke('chat:attach') as Promise<
        { platform: PlatformId; status: ChatStatus; error?: string }[]
      >,
    connect: (id: PlatformId) =>
      ipcRenderer.invoke('chat:connect', id) as Promise<{ ok: boolean; error?: string }>,
    disconnect: (id: PlatformId) => ipcRenderer.invoke('chat:disconnect', id),
    send: (id: PlatformId, text: string) =>
      ipcRenderer.invoke('chat:send', id, text) as Promise<{ ok: boolean; error?: string }>,

    /** 채팅 전용 로그인 (Twitch 는 방송용과 앱이 달라 따로 필요합니다) */
    login: (id: PlatformId) =>
      ipcRenderer.invoke('chat:login', id) as Promise<{
        ok: boolean
        displayName?: string
        error?: string
      }>,
    loginStatus: (id: PlatformId) =>
      ipcRenderer.invoke('chat:status', id) as Promise<CredentialStatus>,

    onMessage: (cb: (m: ChatMessage) => void): (() => void) => {
      const listener = (_e: unknown, m: ChatMessage): void => cb(m)
      ipcRenderer.on('chat:message', listener)
      return () => ipcRenderer.off('chat:message', listener)
    },

    onStatus: (
      cb: (s: { platform: PlatformId; status: ChatStatus; error?: string }) => void
    ): (() => void) => {
      const listener = (
        _e: unknown,
        s: { platform: PlatformId; status: ChatStatus; error?: string }
      ): void => cb(s)
      ipcRenderer.on('chat:status', listener)
      return () => ipcRenderer.off('chat:status', listener)
    }
  },

  /**
   * OBS 연동.
   *
   * 비밀번호는 한 방향으로만 흐릅니다 — 넣을 수는 있어도 되읽을 수는 없습니다.
   */
  obs: {
    attach: () => ipcRenderer.invoke('obs:attach') as Promise<ObsState>,

    connect: (settings: Omit<ObsSettings, 'password'> & { password?: string }) =>
      ipcRenderer.invoke('obs:connect', settings) as Promise<{ ok: boolean }>,

    disconnect: () => ipcRenderer.invoke('obs:disconnect') as Promise<{ ok: boolean }>,

    hasPassword: () => ipcRenderer.invoke('obs:hasPassword') as Promise<boolean>,

    onState: (cb: (s: ObsState) => void): (() => void) => {
      const listener = (_e: unknown, s: ObsState): void => cb(s)
      ipcRenderer.on('obs:state', listener)
      return () => ipcRenderer.off('obs:state', listener)
    },

    /** 씬이 바뀌었을 때. 어떤 프리셋을 걸어뒀는지는 화면 쪽이 판단합니다. */
    onScene: (cb: (sceneName: string) => void): (() => void) => {
      const listener = (_e: unknown, name: string): void => cb(name)
      ipcRenderer.on('obs:scene', listener)
      return () => ipcRenderer.off('obs:scene', listener)
    }
  },

  /** 자동 업데이트 — 상태만 받고, 확인/설치를 요청합니다. */
  update: {
    attach: () => ipcRenderer.invoke('update:attach') as Promise<UpdateState>,
    check: () => ipcRenderer.invoke('update:check') as Promise<{ ok: boolean }>,
    install: () => ipcRenderer.invoke('update:install') as Promise<{ ok: boolean }>,
    version: () => ipcRenderer.invoke('app:version') as Promise<string>,
    onState: (cb: (s: UpdateState) => void): (() => void) => {
      const listener = (_e: unknown, s: UpdateState): void => cb(s)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.off('update:state', listener)
    }
  },

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url) as Promise<boolean>
}

contextBridge.exposeInMainWorld('skp', api)

export type SkpApi = typeof api
