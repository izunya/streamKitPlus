import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlatformId } from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { CHAT_BUFFER_MAX, CHAT_CAPABILITIES, type ChatMessage, type ChatStatus } from '@shared/chat'

/**
 * 채팅 상태.
 *
 * 방송 정보 쪽 스토어와 분리했습니다. 채팅은 초당 수십 건이 들어올 수 있어서,
 * 같은 스토어에 두면 제목·태그 화면까지 매번 다시 그리게 됩니다.
 */

interface ChatState {
  /** 앱을 켠 뒤 받은 메시지만 (이전 기록은 불러오지 않습니다) */
  messages: ChatMessage[]
  /** 플랫폼별 연결 상태 */
  status: Partial<Record<PlatformId, { status: ChatStatus; error?: string }>>
  /** 채팅을 켤 플랫폼 — 끄면 연결 자체를 끊습니다 */
  enabled: Partial<Record<PlatformId, boolean>>
  /** 보내기 대상 */
  sendTo: PlatformId | null
  /** 자동 스크롤 여부 (위로 올려 읽는 중이면 끕니다) */
  follow: boolean

  attach: () => Promise<void>
  toggle: (id: PlatformId) => Promise<void>
  send: (text: string) => Promise<{ ok: boolean; error?: string }>
  setSendTo: (id: PlatformId | null) => void
  setFollow: (v: boolean) => void
  clear: () => void
}

const available = (): boolean => typeof window !== 'undefined' && typeof window.skp !== 'undefined'

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      status: {},
      enabled: {},
      sendTo: null,
      follow: true,

      /**
       * 창을 메인 프로세스에 등록하고, 켜둔 플랫폼을 다시 연결합니다.
       * 앱을 껐다 켜면 이전 메시지는 남기지 않습니다 — 요구사항대로 실행 시점부터입니다.
       */
      attach: async () => {
        if (!available()) return

        set({ messages: [] })

        const current = await window.skp.chat.attach()
        const status: ChatState['status'] = {}
        for (const s of current) status[s.platform] = { status: s.status, error: s.error }
        set({ status })

        // 저장된 on/off 를 따라 다시 연결합니다.
        for (const id of PLATFORM_ORDER) {
          if (get().enabled[id]) await window.skp.chat.connect(id)
        }
      },

      toggle: async (id) => {
        const next = !get().enabled[id]
        set((s) => ({ enabled: { ...s.enabled, [id]: next } }))

        if (!available()) return

        if (next) {
          await window.skp.chat.connect(id)
        } else {
          await window.skp.chat.disconnect(id)
          // 끈 플랫폼의 메시지는 화면에서도 지웁니다 (요구사항 5).
          set((s) => ({ messages: s.messages.filter((m) => m.platform !== id) }))
        }
      },

      send: async (text) => {
        const to = get().sendTo
        if (!to) return { ok: false, error: '보낼 플랫폼을 골라주세요.' }
        if (!available()) return { ok: false, error: '이 환경에서는 보낼 수 없습니다.' }
        if (!CHAT_CAPABILITIES[to].write) {
          return { ok: false, error: '이 플랫폼은 채팅 전송을 지원하지 않습니다.' }
        }
        return window.skp.chat.send(to, text)
      },

      setSendTo: (id) => set({ sendTo: id }),
      setFollow: (v) => set({ follow: v }),
      clear: () => set({ messages: [] })
    }),
    {
      name: 'streamkit-plus-chat',
      // 메시지는 저장하지 않습니다. 켤 때마다 새로 쌓입니다.
      partialize: (s) => ({ enabled: s.enabled, sendTo: s.sendTo })
    }
  )
)

/**
 * 메인 프로세스가 보내는 메시지를 받아 스토어에 넣습니다.
 * App 에서 한 번만 호출하고, 반환한 함수로 정리합니다.
 */
export function subscribeChat(): () => void {
  if (!available()) return () => {}

  const offMessage = window.skp.chat.onMessage((m) => {
    useChatStore.setState((s) => {
      // 꺼둔 플랫폼의 메시지는 버립니다 (끊기 직전에 도착한 것 등).
      if (!s.enabled[m.platform]) return s

      // 같은 ID 가 두 번 오면 무시합니다.
      if (s.messages.length > 0 && s.messages[s.messages.length - 1]?.id === m.id) return s

      const next = [...s.messages, m]
      // 오래된 것부터 버려 메모리가 무한정 늘지 않게 합니다.
      return { messages: next.length > CHAT_BUFFER_MAX ? next.slice(-CHAT_BUFFER_MAX) : next }
    })
  })

  const offStatus = window.skp.chat.onStatus((s) => {
    useChatStore.setState((prev) => ({
      status: { ...prev.status, [s.platform]: { status: s.status, error: s.error } }
    }))
  })

  return () => {
    offMessage()
    offStatus()
  }
}
