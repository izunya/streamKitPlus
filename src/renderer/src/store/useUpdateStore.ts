import { create } from 'zustand'
import type { UpdateState } from '@shared/update'

/**
 * 자동 업데이트 상태.
 *
 * 확인·다운로드는 메인 프로세스가 하고, 여기는 그 상태만 들고 화면에 보여줍니다.
 */

interface UpdateStore {
  state: UpdateState
  attach: () => Promise<void>
  check: () => Promise<void>
  install: () => Promise<void>
}

let detach: (() => void) | null = null

export const useUpdateStore = create<UpdateStore>((set) => ({
  state: { status: 'idle' },

  attach: async () => {
    if (typeof window.skp === 'undefined') return
    detach?.()
    detach = window.skp.update.onState((s) => set({ state: s }))
    set({ state: await window.skp.update.attach() })
  },

  check: async () => {
    if (typeof window.skp === 'undefined') return
    await window.skp.update.check()
  },

  install: async () => {
    if (typeof window.skp === 'undefined') return
    await window.skp.update.install()
  }
}))
