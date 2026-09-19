import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlatformId } from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { CHAT_BUFFER_MAX, CHAT_CAPABILITIES, type ChatMessage, type ChatStatus } from '@shared/chat'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from './useAppStore'

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
  /** 보내기 대상 — 여러 곳에 동시에 보낼 수 있습니다 */
  sendTo: PlatformId[]
  /** 자동 스크롤 여부 (위로 올려 읽는 중이면 끕니다) */
  follow: boolean

  attach: () => Promise<void>
  toggle: (id: PlatformId) => Promise<void>
  send: (text: string) => Promise<{ ok: boolean; error?: string }>
  /** 한 곳을 켜고 끕니다 */
  toggleSendTo: (id: PlatformId) => void
  /** 통째로 지정합니다 ("전부" 버튼이 씁니다) */
  setSendTo: (ids: PlatformId[]) => void
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
      sendTo: [],
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
          // 보내기 대상에 남아 있으면 끊긴 곳으로 보내려다 실패하므로 같이 뺍니다.
          set((s) => ({
            messages: s.messages.filter((m) => m.platform !== id),
            sendTo: s.sendTo.filter((p) => p !== id)
          }))
        }
      },

      /**
       * 고른 플랫폼 전부에 같은 내용을 보냅니다.
       *
       * 한 곳이 실패해도 나머지는 가야 하므로 동시에 쏘고 결과를 모읍니다.
       * 하나라도 갔으면 성공으로 봐서 입력칸을 비우되, 실패한 곳은 따로 알려줍니다.
       */
      send: async (text) => {
        const to = get().sendTo.filter((id) => CHAT_CAPABILITIES[id].write)
        if (to.length === 0) return { ok: false, error: '보낼 플랫폼을 골라주세요.' }
        if (!available()) return { ok: false, error: '이 환경에서는 보낼 수 없습니다.' }

        const results = await Promise.all(
          to.map(async (id) => ({ id, res: await window.skp.chat.send(id, text) }))
        )

        /*
         * 보낸 것은 화면에 직접 올립니다.
         *
         * 플랫폼마다 자기 메시지를 되돌려주는지가 달라서(치지직은 주고 트위치 IRC 는
         * 안 줍니다) 되돌아오는 것만 믿으면 보낸 곳 일부만 뜹니다.
         * 여러 곳에 보냈어도 줄은 하나로 두고, 아이콘만 여러 개 답니다.
         */
        const sent = results.filter((r) => r.res.ok).map((r) => r.id)
        if (sent.length > 0) {
          const accounts = useAppStore.getState().accounts
          const nickname = sent.map((id) => accounts[id]?.displayName).find(Boolean) ?? '나'

          set((s) => {
            const next = [
              ...s.messages,
              {
                id: `me-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                platform: sent[0],
                platforms: sent,
                nickname,
                text,
                at: Date.now(),
                mine: true
              }
            ]
            return { messages: next.length > CHAT_BUFFER_MAX ? next.slice(-CHAT_BUFFER_MAX) : next }
          })
        }

        const failed = results.filter((r) => !r.res.ok)
        if (failed.length === 0) return { ok: true }

        const detail = failed
          .map((f) => `${PLATFORMS[f.id].name}: ${f.res.error ?? '보내지 못했습니다'}`)
          .join(' · ')
        // 전부 실패했을 때만 입력칸을 남겨둡니다.
        return { ok: failed.length < to.length, error: detail }
      },

      toggleSendTo: (id) =>
        set((s) => ({
          sendTo: s.sendTo.includes(id) ? s.sendTo.filter((p) => p !== id) : [...s.sendTo, id]
        })),
      setSendTo: (ids) => set({ sendTo: ids }),
      setFollow: (v) => set({ follow: v }),
      clear: () => set({ messages: [] })
    }),
    {
      name: 'streamkit-plus-chat',
      version: 1,
      /**
       * 예전에는 보내기 대상을 하나만 고를 수 있어 문자열로 저장했습니다.
       * 그대로 읽으면 배열 메서드에서 터지므로 배열로 바꿔줍니다.
       */
      migrate: (persisted, version) => {
        const p = persisted as { sendTo?: unknown } | undefined
        if (version < 1 && p) {
          p.sendTo = typeof p.sendTo === 'string' ? [p.sendTo] : []
        }
        return p as never
      },
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

      /*
       * 내가 방금 보낸 것이 플랫폼에서 되돌아온 경우는 버립니다.
       * 보낼 때 이미 한 줄 올려뒀기 때문에, 그대로 두면 같은 말이 두 번 보입니다.
       * (치지직처럼 되돌려주는 플랫폼에서만 발생합니다.)
       */
      const echoed = s.messages.some(
        (prev) =>
          prev.mine &&
          prev.text === m.text &&
          m.at - prev.at < 15_000 &&
          (prev.platforms ?? [prev.platform]).includes(m.platform)
      )
      if (echoed) return s

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
