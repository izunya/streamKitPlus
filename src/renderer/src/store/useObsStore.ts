import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  OBS_DEFAULT_SETTINGS,
  type ObsSettings,
  type ObsState,
  type SceneBindings
} from '@shared/obs'
import { useAppStore } from './useAppStore'

/**
 * OBS 연동 상태.
 *
 * 씬에 프리셋을 걸어두면 OBS 에서 씬을 바꿀 때 방송 정보가 따라갑니다.
 * 연결 자체는 메인 프로세스가 들고, 여기는 "어느 씬에 어느 프리셋인가" 만 압니다.
 *
 * 비밀번호는 이 store 에 담지 않습니다 — 금고에만 두고 되읽지 않습니다.
 */

/** 씬 전환에 반응해 실제로 무슨 일이 있었는지 */
export interface ObsLastRun {
  sceneName: string
  presetName: string
  at: number
  ok: boolean
  error?: string
  /** 적용까지 했는지, 화면에 불러오기만 했는지 */
  applied: boolean
}

interface ObsStore {
  /** 비밀번호를 뺀 설정 — 이것만 저장합니다 */
  settings: Omit<ObsSettings, 'password'>
  /** 금고에 비밀번호가 들어 있는지 */
  hasPassword: boolean

  /** 씬 이름 -> 프리셋 id */
  bindings: SceneBindings

  /** 메인이 알려주는 연결 상태 */
  state: ObsState

  lastRun: ObsLastRun | null

  attach: () => Promise<void>
  saveSettings: (next: Partial<Omit<ObsSettings, 'password'>>, password?: string) => Promise<void>
  bind: (sceneName: string, presetId: string | null) => void
  /** 지금 씬에 걸린 프리셋을 손으로 한 번 돌려봅니다 */
  runCurrentScene: () => Promise<void>
}

/**
 * 같은 씬이 연달아 들어와도 한 번만 처리합니다.
 *
 * 씬을 왔다 갔다 하면 이벤트가 여러 번 오고, 그때마다 방송 API 를 부르면
 * 호출만 쌓이고 결과는 똑같습니다.
 */
let lastAppliedScene: string | null = null

/** 이벤트 구독이 두 번 걸리는 걸 막습니다 */
let detach: (() => void)[] = []

export const useObsStore = create<ObsStore>()(
  persist(
    (set, get) => ({
      settings: {
        enabled: OBS_DEFAULT_SETTINGS.enabled,
        host: OBS_DEFAULT_SETTINGS.host,
        port: OBS_DEFAULT_SETTINGS.port,
        autoApply: OBS_DEFAULT_SETTINGS.autoApply
      },
      hasPassword: false,
      bindings: {},
      state: { status: 'off' },
      lastRun: null,

      attach: async () => {
        if (typeof window.skp === 'undefined') return

        for (const off of detach) off()
        detach = [
          window.skp.obs.onState((s) => set({ state: s })),
          window.skp.obs.onScene((name) => void handleScene(name))
        ]

        const [state, hasPassword] = await Promise.all([
          window.skp.obs.attach(),
          window.skp.obs.hasPassword()
        ])
        set({ state, hasPassword })

        // 앱을 켜면 켜둔 설정 그대로 다시 붙습니다.
        if (get().settings.enabled) {
          await window.skp.obs.connect(get().settings)
        }
      },

      saveSettings: async (next, password) => {
        const settings = { ...get().settings, ...next }
        set({ settings })
        if (typeof window.skp === 'undefined') return

        if (password !== undefined && password !== '') set({ hasPassword: true })

        if (settings.enabled) {
          // 씬이 달라졌을 수 있으니 중복 방지 기록을 비웁니다.
          lastAppliedScene = null
          await window.skp.obs.connect({ ...settings, password })
        } else {
          await window.skp.obs.disconnect()
        }
      },

      bind: (sceneName, presetId) =>
        set((s) => {
          const bindings = { ...s.bindings }
          if (presetId) bindings[sceneName] = presetId
          else delete bindings[sceneName]
          return { bindings }
        }),

      runCurrentScene: async () => {
        const scene = get().state.currentScene
        if (!scene) return
        lastAppliedScene = null
        await handleScene(scene)
      }
    }),
    {
      name: 'streamkit-obs',
      // 연결 상태와 마지막 결과는 매번 새로 받습니다.
      partialize: (s) => ({
        settings: s.settings,
        bindings: s.bindings
      })
    }
  )
)

/**
 * 씬이 바뀌었을 때 할 일.
 *
 * 걸어둔 프리셋이 없으면 아무 일도 하지 않습니다 — 씬을 바꿀 때마다 방송 정보가
 * 흔들리면 곤란하므로, 사용자가 명시적으로 건 씬에서만 움직입니다.
 */
async function handleScene(sceneName: string): Promise<void> {
  const { bindings, settings } = useObsStore.getState()

  /*
   * 같은 씬 이벤트가 연달아 오는 것만 막습니다.
   *
   * 걸어두지 않은 씬을 지나갔더라도 "씬이 바뀌었다" 는 사실은 남겨야,
   * 게임 -> 대기화면 -> 게임 으로 돌아왔을 때 프리셋이 다시 걸립니다.
   */
  if (lastAppliedScene === sceneName) return
  lastAppliedScene = sceneName

  const presetId = bindings[sceneName]
  if (!presetId) return

  const app = useAppStore.getState()
  const preset = app.presets.find((p) => p.id === presetId)
  if (!preset) {
    // 프리셋을 지웠는데 연결만 남은 경우입니다. 조용히 실패하지 않고 알립니다.
    useObsStore.setState({
      lastRun: {
        sceneName,
        presetName: '삭제된 프리셋',
        at: Date.now(),
        ok: false,
        applied: false,
        error: '이 씬에 걸어둔 프리셋이 지워졌습니다. 다시 골라 주세요.'
      }
    })
    return
  }

  // 자동 적용이 꺼져 있으면 화면에 올려만 둡니다. 적용은 사용자가 누릅니다.
  if (!settings.autoApply) {
    app.loadPreset(presetId)
    useObsStore.setState({
      lastRun: { sceneName, presetName: preset.name, at: Date.now(), ok: true, applied: false }
    })
    return
  }

  const res = await app.applyPreset(presetId)
  useObsStore.setState({
    lastRun: {
      sceneName,
      presetName: preset.name,
      at: Date.now(),
      ok: res.ok,
      applied: true,
      error: res.error
    }
  })
}
