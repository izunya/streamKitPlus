import { useEffect, useState } from 'react'
import type { PlatformId } from '@shared/types'
import { PLATFORM_ORDER } from '@shared/types'
import { getRedirectUri, needsSeparateChatApp, type CredentialSlot } from '@shared/redirectUri'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from '@/store/useAppStore'
import { PlatformIcon } from './PlatformIcon'
import { ObsSection } from './ObsSection'
import { UpdateSection } from './UpdateSection'

/**
 * 설정 — 동작 모드와 플랫폼별 앱 자격 증명(BYOK).
 *
 * 왜 Client ID 가 필요한가:
 *   OAuth 는 "어떤 앱이 요청하는지"를 식별하지 못하면 동의 화면 자체를 띄우지 않습니다.
 *   등록되지 않은 앱에는 로그인을 붙일 수 없습니다. 이건 우회할 방법이 없습니다.
 *
 * Secret 은 플랫폼마다 다릅니다 (아래 SECRET_REQUIRED 참고).
 * defaultCredentials.ts 에 기본 ID 를 채워두면 사용자는 아무것도 입력하지 않아도 됩니다.
 *
 * 입력한 값은 OS 암호화(Windows DPAPI)로 이 PC 에만 저장되고, 화면에 다시 표시되지 않습니다.
 */

/** 각 플랫폼 개발자 콘솔 주소 */
const CONSOLE_URL: Record<PlatformId, string> = {
  youtube: 'https://console.cloud.google.com/apis/credentials',
  twitch: 'https://dev.twitch.tv/console/apps',
  chzzk: 'https://developers.chzzk.naver.com/application',
  soop: 'https://developers.sooplive.co.kr/',
  cime: 'https://developers.ci.me/applications'
}

interface Status {
  hasCredentials: boolean
  hasClientSecret: boolean
  hasOwnCredentials: boolean
  hasDefault: boolean
  connected: boolean
  account?: { displayName: string; channelId: string; connectedAt: number }
}

/**
 * 플랫폼별 Client Secret 필요 여부.
 *
 *   YouTube : 불필요. Google 문서가 "installed apps cannot keep secrets" 라고 명시하고
 *             client_secret 을 Optional 로 둡니다. PKCE 로 대체합니다.
 *   Twitch  : 불필요. Device Code Flow 는 "public clients do not need to maintain
 *             a client secret" 이라고 문서에 명시되어 있습니다.
 *   치지직/CIME : 필요. PKCE 도 device flow 도 없어 secret 없이는 토큰 교환이 불가능합니다.
 */
const SECRET_REQUIRED: Record<PlatformId, boolean> = {
  youtube: false,
  twitch: false,
  chzzk: true,
  soop: true,
  cime: true
}

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: Props): React.JSX.Element | null {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const liveOk = useAppStore((s) => s.liveAvailable)
  const clearSearchCache = useAppStore((s) => s.clearSearchCache)

  const [statuses, setStatuses] = useState<Partial<Record<PlatformId, Status>>>({})
  /** 채팅용 앱을 따로 쓰는 플랫폼(Twitch)의 자격 증명 상태 */
  const [chatStatuses, setChatStatuses] = useState<Partial<Record<PlatformId, Status>>>({})
  const [encryption, setEncryption] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  /**
   * 자격 증명 입력은 앱을 배포하는 사람만 필요합니다.
   * 일반 사용자는 로그인 버튼만 누르면 되므로 기본적으로 감춰둡니다.
   */
  const [showDev, setShowDev] = useState(false)

  const reload = async (): Promise<void> => {
    if (!liveOk) return
    const entries = await Promise.all(
      PLATFORM_ORDER.map(async (id) => [id, await window.skp.credentials.status(id)] as const)
    )
    setStatuses(Object.fromEntries(entries))

    const chatIds = PLATFORM_ORDER.filter(needsSeparateChatApp)
    const chatEntries = await Promise.all(
      chatIds.map(async (id) => [id, await window.skp.credentials.status(id, 'chat')] as const)
    )
    setChatStatuses(Object.fromEntries(chatEntries))
    setEncryption(await window.skp.credentials.encryptionAvailable())
    setUnreadable(await window.skp.credentials.vaultUnreadable())
  }

  useEffect(() => {
    if (open) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, liveOk])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up flex max-h-[86vh] w-[560px] flex-col rounded-2xl border border-ink-600 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-ink-600 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">설정</h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* 동작 모드 */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">동작 모드</h3>
            <div className="flex gap-1 rounded-xl bg-ink-900 p-1">
              {(
                [
                  ['mock', '연습 모드', '실제 적용X'],
                  ['live', '실제 적용', '실제 적용O']
                ] as const
              ).map(([key, label, desc]) => (
                <button
                  key={key}
                  type="button"
                  disabled={key === 'live' && !liveOk}
                  className={[
                    'flex-1 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-40',
                    mode === key ? 'bg-ink-700' : 'hover:bg-ink-800'
                  ].join(' ')}
                  onClick={() => setMode(key)}
                >
                  <div className="text-[12.5px] font-medium">{label}</div>
                  <div className="text-[10.5px] text-fg-faint">{desc}</div>
                </button>
              ))}
            </div>
            {mode === 'live' && (
              <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] leading-relaxed text-danger/90">
                지금은 실제 적용 모드입니다.
              </p>
            )}
          </section>

          {!encryption && (
            <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
              이 컴퓨터에서는 로그인 정보를 안전하게 저장할 수 없어 연동이 유지되지 않습니다.
            </p>
          )}

          {/* 연동 상태 — 일반 사용자가 볼 부분 */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">연동 상태</h3>
            <div className="space-y-1.5">
              {PLATFORM_ORDER.map((id) => {
                const st = statuses[id]
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-900/50 px-3 py-2"
                  >
                    <PlatformIcon id={id} size={18} />
                    <span className="w-16 shrink-0 text-[12.5px] font-medium">
                      {PLATFORMS[id].name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px]">
                      {st?.connected ? (
                        <span className="text-ok">연결됨 · {st.account?.displayName}</span>
                      ) : st?.hasCredentials ? (
                        <span className="text-fg-faint">아이콘을 눌러 로그인하세요</span>
                      ) : (
                        <span className="text-warn/90">지금은 로그인할 수 없습니다</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 캐시 */}
          <section className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold">저장된 검색 기록</h3>
              <p className="text-[11px] text-fg-faint">
                한 번 찾은 카테고리를 기억해 두어 다음엔 더 빨리 나옵니다.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:border-danger/50 hover:text-danger"
              onClick={clearSearchCache}
            >
              기록 지우기
            </button>
          </section>

          <ObsSection />

          <UpdateSection />

          {/* 개발자 설정 — 배포하는 사람만 씁니다 */}
          <section className="border-t border-ink-600 pt-3.5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowDev((v) => !v)}
            >
              <span className="text-[12.5px] font-semibold text-fg-faint">개발자 설정</span>
              <span className="text-[11px] text-fg-faint">{showDev ? '접기' : '열기'}</span>
            </button>

            {showDev && (
              <div className="fade-up mt-3 space-y-3">
                <p className="text-[11px] leading-relaxed text-fg-faint">
                  앱을 배포하는 사람만 쓰는 영역입니다. 여기서 입력한 값은 이 PC 에만
                  저장되므로, 배포본에 담으려면{' '}
                  <code className="text-fg-muted">src/main/defaultCredentials.ts</code> 를 채워야
                  합니다.
                </p>

                {unreadable && (
                  <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
                    저장해 둔 로그인 정보를 읽지 못했습니다. 아래에서 한 번만 다시 입력해 주세요.
                  </p>
                )}

                {!encryption && (
                  <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
                    이 시스템에서는 안전한 자격 증명 저장을 사용할 수 없어 키를 저장할 수 없습니다.
                  </p>
                )}

                <div className="space-y-2">
                  {PLATFORM_ORDER.map((id) => (
                    <CredentialRow
                      key={id}
                      id={id}
                      status={statuses[id]}
                      disabled={!liveOk || !encryption}
                      onSaved={reload}
                    />
                  ))}
                </div>

                {/* 채팅용 앱을 따로 등록해야 하는 플랫폼 */}
                <div>
                  <h4 className="mb-1 text-[12px] font-semibold">채팅용 앱</h4>
                  <p className="mb-2 text-[11px] leading-relaxed text-fg-faint">
                    <span className="text-ok">보통은 비워두면 됩니다.</span> Twitch 채팅은 방송
                    로그인에서 받은 토큰을 그대로 쓰고, IRC 접속에는 Client ID 가 필요 없습니다.
                    <br />
                    채팅만 다른 앱으로 돌리고 싶을 때만 여기에 넣으세요.
                  </p>

                  <div className="space-y-2">
                    {PLATFORM_ORDER.filter(needsSeparateChatApp).map((id) => (
                      <CredentialRow
                        key={`${id}-chat`}
                        id={id}
                        slot="chat"
                        status={chatStatuses[id]}
                        disabled={!liveOk || !encryption}
                        onSaved={reload}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="mb-1.5 text-[12px] font-semibold">
                    콘솔에 등록할 리다이렉트 URI
                  </h4>
                  <p className="mb-2 text-[11px] leading-relaxed text-fg-faint">
                    아래 문자열을 그대로 등록해야 합니다. 치지직·CIME 은 등록된 주소와 정확히
                    일치하지 않으면 인증을 거부합니다.
                  </p>
                  <div className="space-y-1">
                    {[
                      ...PLATFORM_ORDER.map((id) => [id, 'broadcast'] as const),
                      ...PLATFORM_ORDER.filter(needsSeparateChatApp).map(
                        (id) => [id, 'chat'] as const
                      )
                    ].map(([id, slot]) => {
                      const uri = getRedirectUri(id, slot)
                      return (
                        <div key={`${id}-${slot}`} className="flex items-center gap-2 text-[11px]">
                          <span className="w-20 shrink-0 text-fg-muted">
                            {PLATFORMS[id].name}
                            {slot === 'chat' && (
                              <span className="ml-1 text-[10px] text-fg-faint">채팅</span>
                            )}
                          </span>
                          {uri ? (
                            <code className="min-w-0 flex-1 truncate rounded bg-ink-900 px-2 py-1 text-fg">
                              {uri}
                            </code>
                          ) : (
                            <span className="text-fg-faint">
                              {id === 'twitch'
                                ? 'Device Code Flow — 리다이렉트 URI 불필요'
                                : '미구현'}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CredentialRow({
  id,
  slot = 'broadcast',
  status,
  disabled,
  onSaved
}: {
  id: PlatformId
  /** 방송 정보용인지 채팅용인지 */
  slot?: CredentialSlot
  status?: Status
  disabled: boolean
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const meta = PLATFORMS[id]
  // 채팅용 Twitch 앱은 IRC 로 붙으므로 Secret 이 필요 없습니다.
  const secretRequired = slot === 'chat' ? false : SECRET_REQUIRED[id]
  const redirectUri = getRedirectUri(id, slot)
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const res = await window.skp.credentials.set(
      id,
      { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined },
      slot
    )
    setSaving(false)
    if (!res.ok) {
      setError(res.error ?? '저장에 실패했습니다.')
      return
    }
    setClientId('')
    setClientSecret('')
    setOpen(false)
    await onSaved()
  }

  const clear = async (): Promise<void> => {
    await window.skp.credentials.set(id, null, slot)
    await onSaved()
  }

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/50 p-2.5">
      <div className="flex items-center gap-2.5">
        <PlatformIcon id={id} size={18} />
        <span className="w-20 shrink-0 text-[12.5px] font-medium">
          {meta.name}
          {slot === 'chat' && <span className="ml-1 text-[10.5px] text-fg-faint">채팅</span>}
        </span>

        <span className="min-w-0 flex-1 truncate text-[11px]">
          {status?.hasCredentials ? (
            <span className="text-ok">
              {status.hasOwnCredentials ? '설정됨' : '기본 제공'}
              {status.hasClientSecret ? ' · ID 와 Secret' : ' · ID 만'}
            </span>
          ) : secretRequired ? (
            <span className="text-fg-faint">미설정 — ID + Secret 필요</span>
          ) : (
            <span className="text-fg-faint">Client ID 만 입력하면 됩니다</span>
          )}
        </span>

        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-accent-soft"
          onClick={() => void window.skp.openExternal(CONSOLE_URL[id])}
        >
          콘솔 열기
        </button>
        <button
          type="button"
          disabled={disabled}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg disabled:opacity-40"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '접기' : status?.hasCredentials ? '변경' : '입력'}
        </button>
      </div>

      {open && (
        <div className="fade-up mt-2 space-y-1.5 border-t border-ink-600 pt-2">
          <input
            autoFocus
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/60"
          />
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={secretRequired ? 'Client Secret 을 입력하세요' : 'Client Secret 은 없어도 됩니다'}
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/60"
          />
          {!secretRequired && (
            <p className="text-[10.5px] leading-relaxed text-fg-faint">
              {id === 'twitch'
                ? 'Twitch 는 Device Code Flow 를 써서 Secret 없이 연동합니다. 넣으면 표준 인증 코드 방식으로 동작합니다.'
                : 'Google 설치형 앱은 PKCE 를 쓰므로 Secret 없이 동작합니다. 콘솔에서 함께 발급됐다면 넣어도 됩니다.'}
            </p>
          )}
          {redirectUri && (
            <div className="rounded-lg bg-ink-900 px-2.5 py-1.5">
              <p className="mb-1 text-[10.5px] text-fg-faint">
                아래 주소를 콘솔에 그대로 등록하세요
              </p>
              <code className="block break-all text-[11px] text-fg">{redirectUri}</code>
            </div>
          )}

          {error && <p className="text-[11px] text-danger">{error}</p>}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={!clientId.trim() || saving || (secretRequired && !clientSecret.trim())}
              className="flex-1 rounded-lg bg-accent py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-30"
              onClick={() => void save()}
            >
              {saving ? '저장 중…' : '저장'}
            </button>
            {status?.hasCredentials && (
              <button
                type="button"
                className="rounded-lg border border-danger/50 px-3 py-1.5 text-[12px] text-danger transition-colors hover:bg-danger/10"
                onClick={() => void clear()}
              >
                삭제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
