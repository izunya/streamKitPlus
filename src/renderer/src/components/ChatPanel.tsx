import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PLATFORM_ORDER } from '@shared/types'
import { CHAT_CAPABILITIES } from '@shared/chat'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from '@/store/useAppStore'
import { useChatStore } from '@/store/useChatStore'
import { PlatformIcon } from './PlatformIcon'

/**
 * 채팅 패널.
 *
 * 레이아웃: [플랫폼 아이콘] [닉네임] : [내용]
 *
 * 끈 플랫폼은 화면에서 숨기는 것으로 끝내지 않고 연결까지 끊습니다.
 * 숨기기만 하면 트래픽과 토큰은 계속 나가기 때문입니다.
 */
export function ChatPanel(): React.JSX.Element {
  const accounts = useAppStore((s) => s.accounts)

  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const enabled = useChatStore((s) => s.enabled)
  const sendTo = useChatStore((s) => s.sendTo)
  const follow = useChatStore((s) => s.follow)
  const toggle = useChatStore((s) => s.toggle)
  const send = useChatStore((s) => s.send)
  const setSendTo = useChatStore((s) => s.setSendTo)
  const setFollow = useChatStore((s) => s.setFollow)

  const [text, setText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * Twitch 채팅 권한 보유 여부.
   *
   * 로그인은 한 번이면 됩니다 — 방송 권한과 채팅 권한을 한 토큰에 같이 받습니다.
   * 다만 채팅 기능이 생기기 전에 받아둔 토큰에는 채팅 권한이 없어서,
   * 그런 경우에만 다시 로그인하라고 알려줍니다.
   */
  const [chatReady, setChatReady] = useState<boolean | null>(null)

  const refreshLogin = async (): Promise<void> => {
    if (typeof window.skp === 'undefined') return
    const st = await window.skp.chat.loginStatus('twitch')
    setChatReady(st.connected)
  }

  useEffect(() => {
    void refreshLogin()
  }, [])

  /** 채팅을 켤 수 있는 플랫폼 — 로그인돼 있고 수신을 지원하는 곳 */
  const usable = PLATFORM_ORDER.filter((id) => CHAT_CAPABILITIES[id].read && accounts[id])

  // 새 메시지가 오면 아래로 따라갑니다. 위로 올려 읽는 중이면 건드리지 않습니다.
  useEffect(() => {
    if (!follow) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, follow])

  const onScroll = (): void => {
    const el = listRef.current
    if (!el) return
    // 바닥에서 40px 안쪽이면 "따라가는 중" 으로 봅니다.
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  const submit = async (): Promise<void> => {
    const t = text.trim()
    if (!t) return
    setSendError(null)

    const res = await send(t)
    if (res.ok) setText('')
    else setSendError(res.error ?? '보내지 못했습니다.')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 플랫폼 토글 */}
      <div className="shrink-0 border-b border-ink-600 px-3 py-2">
        {usable.length === 0 ? (
          <p className="py-1 text-[11px] leading-relaxed text-fg-faint">
            로그인한 플랫폼이 없습니다. 위쪽 아이콘을 눌러 로그인하면 채팅을 볼 수 있습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {usable.map((id) => {
              const on = Boolean(enabled[id])
              const st = status[id]
              const cap = CHAT_CAPABILITIES[id]

              return (
                <button
                  key={id}
                  type="button"
                  data-state={on ? 'on' : 'off'}
                  className={[
                    'platform-chip flex items-center gap-1.5 rounded-lg border px-2 py-1',
                    on ? 'border-ink-500 bg-ink-700' : 'border-ink-600 bg-ink-850'
                  ].join(' ')}
                  onClick={() => void toggle(id)}
                  title={
                    cap.unavailable
                      ? `${PLATFORMS[id].name} — ${cap.unavailable}`
                      : st?.error
                        ? `${PLATFORMS[id].name} — ${st.error}`
                        : PLATFORMS[id].name
                  }
                >
                  <PlatformIcon id={id} size={14} />
                  <span className="text-[11px]">{PLATFORMS[id].name}</span>

                  {on && st?.status === 'connecting' && (
                    <span className="spin block h-2.5 w-2.5 rounded-full border border-ink-500 border-t-accent-soft" />
                  )}
                  {on && st?.status === 'connected' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                  )}
                  {on && st?.status === 'error' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* 채팅 기능이 생기기 전 토큰에는 채팅 권한이 없습니다 */}
        {accounts.twitch && chatReady === false && (
          <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
            지금 Twitch 토큰에는 채팅 권한이 없습니다. 위쪽 Twitch 아이콘을 우클릭해 연동을 해제한
            뒤 다시 로그인하면 채팅 권한까지 한 번에 받습니다.
          </p>
        )}

        {/* 켜두면 비용이 드는 플랫폼은 켠 동안 계속 알려줍니다 */}
        {usable.map((id) =>
          enabled[id] && CHAT_CAPABILITIES[id].warning ? (
            <p
              key={`warn-${id}`}
              className="mt-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn"
            >
              {CHAT_CAPABILITIES[id].warning}
            </p>
          ) : null
        )}

        {/* 실패 사유는 접어두지 않고 그대로 보여줍니다 */}
        {usable.map((id) =>
          enabled[id] && status[id]?.status === 'error' ? (
            <p key={id} className="mt-1.5 text-[10.5px] leading-relaxed text-danger">
              {PLATFORMS[id].name}: {status[id]?.error}
            </p>
          ) : null
        )}
      </div>

      {/* 메시지 목록 */}
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-[11.5px] leading-relaxed text-fg-faint">
            아직 채팅이 없습니다.
            <br />앱을 켠 뒤 올라온 채팅만 보입니다.
          </p>
        ) : (
          <div className="space-y-0.5">
            {messages.map((m) => (
              <div key={m.id} className="flex items-start gap-1.5 text-[12px] leading-relaxed">
                <span className="mt-[3px] shrink-0">
                  <PlatformIcon id={m.platform} size={13} />
                </span>
                <span className="shrink-0 font-medium text-fg">{m.nickname}</span>
                <span className="shrink-0 text-fg-faint">:</span>
                <span className="min-w-0 break-words text-fg-muted">{m.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 보내기 */}
      <div className="shrink-0 border-t border-ink-600 p-2">
        {!follow && (
          <button
            type="button"
            className="mb-1.5 w-full rounded-lg bg-ink-700 py-1 text-[10.5px] text-fg-muted transition-colors hover:text-fg"
            onClick={() => setFollow(true)}
          >
            최신 채팅으로 이동
          </button>
        )}

        <div className="mb-1.5 flex flex-wrap gap-1">
          {usable
            .filter((id) => enabled[id] && CHAT_CAPABILITIES[id].write)
            .map((id) => (
              <button
                key={id}
                type="button"
                className={[
                  'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors',
                  sendTo === id
                    ? 'bg-accent/20 text-accent-soft'
                    : 'text-fg-faint hover:bg-ink-700 hover:text-fg'
                ].join(' ')}
                onClick={() => setSendTo(sendTo === id ? null : id)}
              >
                <PlatformIcon id={id} size={12} />
                {PLATFORMS[id].name}
              </button>
            ))}
        </div>

        <div className="flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={100}
            placeholder={sendTo ? `${PLATFORMS[sendTo].name} 에 보내기` : '보낼 플랫폼을 고르세요'}
            disabled={!sendTo}
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[12px] outline-none placeholder:text-fg-faint/60 focus:border-accent/60 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!sendTo || !text.trim()}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-30"
            onClick={() => void submit()}
          >
            보내기
          </button>
        </div>

        {sendError && <p className="mt-1 text-[10.5px] text-danger">{sendError}</p>}
      </div>
    </div>
  )
}
