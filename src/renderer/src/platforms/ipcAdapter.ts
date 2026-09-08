import type {
  AuthMethod,
  ConnectedAccount,
  PlatformCategory,
  PlatformId,
  PlatformPatch,
  StreamPlatformAdapter,
  UpdateResult
} from '@shared/types'
import { PLATFORMS } from './catalog'

/**
 * 실제 API 를 쓰는 어댑터 — 메인 프로세스로 넘기는 얇은 프록시입니다.
 *
 * 네트워크 호출과 토큰 관리는 전부 메인 프로세스에 있습니다.
 * 렌더러는 결과만 받습니다.
 */
export function createIpcAdapter(id: PlatformId): StreamPlatformAdapter {
  const meta = PLATFORMS[id]

  return {
    meta,

    async connect(method: AuthMethod, credentials): Promise<ConnectedAccount> {
      const res = await window.skp.platform.connect(id, method, credentials?.apiKey)
      if (!res.ok || !res.channelId) {
        throw new Error(res.error ?? '연동에 실패했습니다.')
      }
      return {
        platform: id,
        displayName: res.displayName ?? '알 수 없는 채널',
        channelId: res.channelId,
        method,
        connectedAt: Date.now()
      }
    },

    async disconnect() {
      await window.skp.platform.disconnect(id)
    },

    async fetchCurrent(): Promise<PlatformPatch | null> {
      const res = await window.skp.platform.fetchCurrent(id)
      return res.ok ? (res.data ?? null) : null
    },

    async searchCategory(query: string): Promise<PlatformCategory[]> {
      const res = await window.skp.platform.searchCategory(id, query)
      if (!res.ok) throw new Error(res.error ?? '카테고리 검색에 실패했습니다.')
      return res.data ?? []
    },

    updateBroadcast(patch: PlatformPatch): Promise<UpdateResult> {
      // 메인 쪽에서 이미 실패도 결과 객체로 돌려주므로 그대로 넘깁니다.
      return window.skp.platform.update(patch)
    }
  }
}
