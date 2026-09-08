import type { PlatformId, StreamPlatformAdapter } from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { createMockAdapter } from './mockAdapter'
import { createIpcAdapter } from './ipcAdapter'

/**
 * 어댑터 레지스트리.
 *
 * 두 가지 모드가 있습니다:
 *   live — 실제 플랫폼 API 를 호출합니다 (메인 프로세스 경유)
 *   mock — 네트워크 없이 UI 를 확인합니다
 *
 * Mock 을 지우지 않고 남겨둔 이유: 실제 방송 정보를 건드리지 않고
 * 화면과 흐름을 테스트할 수 있어야 하기 때문입니다.
 * 개발 중에는 물론이고, 사용자가 기능을 익힐 때도 안전합니다.
 */
export type AdapterMode = 'live' | 'mock'

const MODE_KEY = 'streamkit-plus:mode'

const mocks = Object.fromEntries(
  PLATFORM_ORDER.map((id) => [id, createMockAdapter(id)])
) as Record<PlatformId, StreamPlatformAdapter>

const live = Object.fromEntries(
  PLATFORM_ORDER.map((id) => [id, createIpcAdapter(id)])
) as Record<PlatformId, StreamPlatformAdapter>

/** Electron 밖(브라우저 테스트 등)에서는 실제 어댑터를 쓸 수 없습니다. */
export const liveAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.skp !== 'undefined'

function readMode(): AdapterMode {
  if (!liveAvailable()) return 'mock'
  try {
    return localStorage.getItem(MODE_KEY) === 'live' ? 'live' : 'mock'
  } catch {
    return 'mock'
  }
}

let mode: AdapterMode = readMode()

export function getMode(): AdapterMode {
  return mode
}

export function setMode(next: AdapterMode): void {
  mode = next === 'live' && liveAvailable() ? 'live' : 'mock'
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 저장 실패는 무시합니다 — 이번 세션에서만 적용됩니다.
  }
}

export function getAdapter(id: PlatformId): StreamPlatformAdapter {
  return mode === 'live' ? live[id] : mocks[id]
}

export function allAdapters(): StreamPlatformAdapter[] {
  return PLATFORM_ORDER.map(getAdapter)
}
