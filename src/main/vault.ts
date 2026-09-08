import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import type { PlatformId } from '../shared/types'
import type { CredentialSlot } from '../shared/redirectUri'
import { getDefaultCredentials, hasDefaultCredentials } from './defaultCredentials'

/**
 * 자격 증명 금고.
 *
 * OS 수준 암호화(Windows DPAPI)로 파일 하나에 모아 보관합니다.
 * 렌더러에는 토큰 본체를 절대 내려보내지 않습니다 — "있다/없다"만 알려줍니다.
 */

/** 사용자가 각 플랫폼 개발자 콘솔에서 직접 발급받아 입력한 앱 자격 증명 (BYOK) */
export interface AppCredentials {
  clientId: string
  clientSecret?: string
}

export interface StoredToken {
  accessToken: string
  refreshToken?: string
  /** epoch ms. 지나면 갱신을 시도합니다. */
  expiresAt?: number
  /** 사용자가 직접 붙여넣은 토큰은 갱신할 수 없습니다. */
  manual?: boolean
}

export interface StoredAccount {
  displayName: string
  channelId: string
  connectedAt: number
}

/**
 * 저장 키.
 *
 * 방송용은 플랫폼 ID 를 그대로 쓰고, 채팅용은 뒤에 ':chat' 을 붙입니다.
 * 예전에 저장한 값이 그대로 방송용으로 읽히도록 접미사 없는 형태를 유지합니다.
 */
type SlotKey = string
const slotKey = (id: PlatformId, slot: CredentialSlot): SlotKey =>
  slot === 'chat' ? `${id}:chat` : id

interface VaultShape {
  credentials: Partial<Record<SlotKey, AppCredentials>>
  tokens: Partial<Record<SlotKey, StoredToken>>
  accounts: Partial<Record<SlotKey, StoredAccount>>
  /** OBS WebSocket 서버 비밀번호. 플랫폼 토큰과 같은 이유로 여기에 둡니다. */
  obsPassword?: string
}

const EMPTY: VaultShape = { credentials: {}, tokens: {}, accounts: {} }

let cache: VaultShape | null = null

/**
 * 금고 파일은 있는데 복호화에 실패한 상태.
 *
 * 이걸 그냥 "빈 금고" 로 취급하면 사용자는 저장한 키가 이유 없이 사라진 것처럼
 * 느낍니다. 원인을 화면에 알려주기 위해 따로 표시합니다.
 * (주로 userData 폴더가 바뀌었을 때 발생합니다 — 암호화 키가 폴더마다 다릅니다.)
 */
let unreadable = false

const vaultPath = (): string => join(app.getPath('userData'), 'vault.bin')

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

function read(): VaultShape {
  if (cache) return cache

  try {
    if (!existsSync(vaultPath()) || !encryptionAvailable()) {
      cache = structuredClone(EMPTY)
      return cache
    }
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(vaultPath()))) as VaultShape
    cache = { ...structuredClone(EMPTY), ...parsed }
    return cache
  } catch {
    // 복호화 실패 — 빈 금고로 동작하되, 사용자에게 알릴 수 있게 표시해 둡니다.
    unreadable = true
    cache = structuredClone(EMPTY)
    return cache
  }
}

function write(next: VaultShape): void {
  if (!encryptionAvailable()) {
    throw new Error('이 시스템에서는 안전한 자격 증명 저장을 사용할 수 없습니다.')
  }
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // 쓰다가 중단되어 금고가 깨지는 일을 막기 위해 임시 파일에 쓰고 교체합니다.
  const tmp = `${vaultPath()}.tmp`
  writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(next)))
  renameSync(tmp, vaultPath())
  cache = next
  // 새로 썼으니 이제 읽을 수 있는 상태입니다.
  unreadable = false
}

/** 금고 파일이 있는데 읽지 못하는 상태인지 */
export function isVaultUnreadable(): boolean {
  read()
  return unreadable
}

/* ------------------------------------------------------------------ */

/**
 * 자격 증명을 꺼냅니다.
 *
 * 사용자가 직접 입력한 값이 있으면 그걸 우선하고,
 * 없으면 앱에 내장된 기본값을 씁니다. 기본값이 있으면 사용자는
 * 아무것도 입력하지 않고 바로 로그인할 수 있습니다.
 */
export function getCredentials(
  id: PlatformId,
  slot: CredentialSlot = 'broadcast'
): AppCredentials | undefined {
  const own = read().credentials[slotKey(id, slot)]
  if (own?.clientId) return own
  // 내장 기본값은 방송용에만 둡니다 (채팅용 앱은 배포자가 따로 등록).
  return slot === 'broadcast' ? getDefaultCredentials(id) : undefined
}

/** 사용자가 직접 입력한 값만 (기본값 제외). 설정 화면이 씁니다. */
export function getOwnCredentials(
  id: PlatformId,
  slot: CredentialSlot = 'broadcast'
): AppCredentials | undefined {
  return read().credentials[slotKey(id, slot)]
}

export function setCredentials(
  id: PlatformId,
  creds: AppCredentials | null,
  slot: CredentialSlot = 'broadcast'
): void {
  const v = structuredClone(read())
  const k = slotKey(id, slot)
  if (creds) v.credentials[k] = creds
  else delete v.credentials[k]
  write(v)
}

export function getToken(
  id: PlatformId,
  slot: CredentialSlot = 'broadcast'
): StoredToken | undefined {
  return read().tokens[slotKey(id, slot)]
}

export function setToken(
  id: PlatformId,
  token: StoredToken | null,
  slot: CredentialSlot = 'broadcast'
): void {
  const v = structuredClone(read())
  const k = slotKey(id, slot)
  if (token) v.tokens[k] = token
  else delete v.tokens[k]
  write(v)
}

export function getAccount(
  id: PlatformId,
  slot: CredentialSlot = 'broadcast'
): StoredAccount | undefined {
  return read().accounts[slotKey(id, slot)]
}

export function setAccount(
  id: PlatformId,
  account: StoredAccount | null,
  slot: CredentialSlot = 'broadcast'
): void {
  const v = structuredClone(read())
  const k = slotKey(id, slot)
  if (account) v.accounts[k] = account
  else delete v.accounts[k]
  write(v)
}

/** 연동 해제 — 토큰과 계정 정보만 지우고, 앱 자격 증명(BYOK)은 남겨둡니다. */
export function clearConnection(id: PlatformId, slot: CredentialSlot = 'broadcast'): void {
  const v = structuredClone(read())
  const k = slotKey(id, slot)
  delete v.tokens[k]
  delete v.accounts[k]
  write(v)
}

/* ---------------- OBS ---------------- */

export function getObsPassword(): string {
  return read().obsPassword ?? ''
}

/**
 * 빈 문자열을 주면 지웁니다.
 * undefined 를 주면 지금 값을 그대로 둡니다 — 화면은 비밀번호를 되읽지 못하므로,
 * 사용자가 칸을 건드리지 않았을 때 기존 값이 지워지면 안 됩니다.
 */
export function setObsPassword(password: string | undefined): void {
  if (password === undefined) return
  const v = read()
  if (password) v.obsPassword = password
  else delete v.obsPassword
  write(v)
}

/** 렌더러에 내려보내도 안전한 요약 (토큰 본체 제외) */
export function summarize(
  id: PlatformId,
  slot: CredentialSlot = 'broadcast'
): {
  hasCredentials: boolean
  hasClientSecret: boolean
  /** 사용자가 직접 입력한 값이 있는지 (내장 기본값과 구분) */
  hasOwnCredentials: boolean
  /** 앱에 내장된 기본 자격 증명이 있는지 */
  hasDefault: boolean
  connected: boolean
  account?: StoredAccount
} {
  const v = read()
  const k = slotKey(id, slot)
  const own = v.credentials[k]
  const effective = getCredentials(id, slot)
  return {
    hasCredentials: Boolean(effective?.clientId),
    hasClientSecret: Boolean(effective?.clientSecret),
    hasOwnCredentials: Boolean(own?.clientId),
    hasDefault: slot === 'broadcast' && hasDefaultCredentials(id),
    connected: Boolean(v.tokens[k]),
    account: v.accounts[k]
  }
}
