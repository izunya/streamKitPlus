import type { SkpApi } from './index'

declare global {
  interface Window {
    /** preload 가 노출하는 API. Electron 밖에서는 undefined 입니다. */
    skp: SkpApi
  }
}

export {}
