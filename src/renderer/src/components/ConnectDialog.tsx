import { useEffect, useState } from 'react'
import type { AuthMethod, PlatformId } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'
import { useAppStore } from '@/store/useAppStore'
import { PlatformIcon } from './PlatformIcon'

/**
 * 계정 연동 창.
 *
 * 기본은 "브라우저에서 로그인" (OAuth 루프백):
 *   기본 브라우저가 열리고 → 로그인/동의 → 앱으로 자동 복귀.
 *   앱이 아이디/비밀번호를 직접 받지 않으므로 안전합니다.
 *
 * 선택지로 "키 직접 입력"도 둡니다:
 *   자체 개발자 앱을 이미 만들어 둔 사용자, OAuth 승인이 아직 안 난 플랫폼,
 *   그리고 사내/테스트 환경에서 필요합니다.
 */

interface Props {
  platform: PlatformId | null
  onClose: () => void
  /** 자격 증명이 없을 때 설정 화면으로 바로 보내기 위한 콜백 */
  onOpenSettings: () => void
}

interface DeviceCode {
  userCode: string
  verificationUri: string
}

export function ConnectDialog({
  platform,
  onClose,
  onOpenSettings
}: Props): React.JSX.Element | null {
  const accounts = useAppStore((s) => s.accounts)
  const connecting = useAppStore((s) => s.connecting)
  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const cancelConnect = useAppStore((s) => s.cancelConnect)
  const mode = useAppStore((s) => s.mode)

  const [method, setMethod] = useState<AuthMethod>('oauth')
  const [apiKey, setApiKey] = useState('')
  const [channelName, setChannelName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null)
  const [credsReady, setCredsReady] = useState(true)

  useEffect(() => {
    if (!platform) return
    setMethod(PLATFORMS[platform].authMethods[0])
    setApiKey('')
    setChannelName('')
    setError(null)
    setDeviceCode(null)

    // Mock 모드에서는 자격 증명이 필요 없습니다.
    if (mode !== 'live' || typeof window.skp === 'undefined') {
      setCredsReady(true)
      return
    }
    void window.skp.credentials.status(platform).then((st) => setCredsReady(st.hasCredentials))
  }, [platform, mode])

  // Device Code Flow 진행 알림 구독 (트위치)
  useEffect(() => {
    if (typeof window.skp === 'undefined') return
    return window.skp.platform.onDeviceCode((info) => {
      if (info.platform === platform) {
        setDeviceCode({ userCode: info.userCode, verificationUri: info.verificationUri })
      }
    })
  }, [platform])

  /**
   * 창을 닫을 때 진행 중인 연동이 있으면 함께 취소합니다.
   * 그러지 않으면 콜백 서버가 포트를 계속 잡고 있어 다시 시도할 때 충돌합니다.
   */
  const closeAndCancel = (): void => {
    if (connecting === platform && platform) void cancelConnect(platform)
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeAndCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, connecting, platform])

  if (!platform) return null

  const meta = PLATFORMS[platform]
  const account = accounts[platform]
  const busy = connecting === platform

  /**
   * 로그인은 모두 기본 브라우저에서 진행합니다.
   * 이미 로그인해 둔 세션을 그대로 쓸 수 있어 가장 편하기 때문입니다.
   *
   * 대신 앱이 그 창을 제어할 수 없어 "사용자가 창을 닫았는지" 를 알 수 없습니다.
   * 그래서 연동 중에도 버튼을 잠그지 않습니다 — 다시 누르면 이전 흐름을
   * 정리하고 새로 시작하므로, 브라우저를 닫아도 멈춰 있지 않습니다.
   */

  const run = async (): Promise<void> => {
    setError(null)
    setDeviceCode(null)
    try {
      await connect(platform, method, { apiKey, channelName })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm"
      onClick={closeAndCancel}
    >
      <div
        className="fade-up w-[440px] rounded-2xl border border-ink-600 bg-ink-800 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center gap-3">
          <PlatformIcon id={platform} size={30} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{meta.name} 연동</h2>
            <p className="truncate text-[11.5px] text-fg-faint">
              {account ? `연결됨 · ${account.displayName}` : '아직 연결되지 않았습니다'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
            onClick={closeAndCancel}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        {account ? (
          <div className="space-y-3">
            <dl className="space-y-1.5 rounded-xl border border-ink-600 bg-ink-900/50 p-3 text-[12px]">
              <Row label="채널" value={account.displayName} />
              <Row label="채널 ID" value={account.channelId} />
              <Row
                label="로그인 방식"
                value={account.method === 'oauth' ? '브라우저 로그인' : '키 직접 입력'}
              />
              <Row
                label="연결 시각"
                value={new Date(account.connectedAt).toLocaleString('ko-KR')}
              />
            </dl>
            <button
              type="button"
              className="w-full rounded-xl border border-danger/50 py-2.5 text-[13px] text-danger transition-colors hover:bg-danger/10"
              onClick={() => void disconnect(platform).then(onClose)}
            >
              연동 해제
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 연동 방식 선택 */}
            {meta.authMethods.length > 1 && (
              <div className="flex gap-1 rounded-xl bg-ink-900 p-1">
                {meta.authMethods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={[
                      'flex-1 rounded-lg py-1.5 text-[12.5px] font-medium transition-colors',
                      method === m ? 'bg-ink-700 text-fg' : 'text-fg-faint hover:text-fg'
                    ].join(' ')}
                    onClick={() => setMethod(m)}
                  >
                    {m === 'oauth' ? '브라우저에서 로그인' : '키 직접 입력'}
                  </button>
                ))}
              </div>
            )}

            {method === 'oauth' ? (
              <div className="rounded-xl border border-ink-600 bg-ink-900/50 p-3">
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  기본 브라우저에서 {meta.name} 로그인 페이지가 열립니다. 이미 로그인해 두셨다면
                  권한 허용만 누르면 앱으로 자동으로 돌아옵니다.
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                  아이디와 비밀번호는 이 앱이 보지 않습니다. 로그인 정보는 이 컴퓨터에만
                  암호화되어 저장됩니다.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[11.5px] text-fg-muted">
                    발급받은 키
                  </span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="방송 정보를 바꿀 수 있는 키"
                    className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] outline-none focus:border-accent/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] text-fg-muted">
                    화면에 표시할 채널 이름
                  </span>
                  <input
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] outline-none focus:border-accent/60"
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-fg-faint">
                  입력한 키는 암호화되어 이 컴퓨터에만 저장됩니다.
                </p>
              </div>
            )}

            {/* Device Code Flow: 사용자가 브라우저에서 확인할 코드 */}
            {deviceCode && (
              <div className="fade-up rounded-xl border border-accent/50 bg-accent/10 p-3">
                <p className="mb-2 text-[12px] leading-relaxed text-fg">
                  브라우저에서 아래 코드를 확인하고 승인해 주세요. 승인하면 자동으로 연결됩니다.
                </p>
                <div className="mb-2 rounded-lg bg-ink-900 py-2.5 text-center font-mono text-[22px] font-bold tracking-[0.25em] text-accent-soft">
                  {deviceCode.userCode}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-fg-faint underline-offset-2 transition-colors hover:text-accent-soft hover:underline"
                  onClick={() => void window.skp?.openExternal(deviceCode.verificationUri)}
                >
                  브라우저가 안 열렸다면 여기를 눌러 다시 열기
                </button>
              </div>
            )}

            {/* 자격 증명이 없으면 원인과 해결 경로를 함께 보여줍니다 */}
            {!credsReady && method === 'oauth' && (
              <div className="rounded-xl border border-warn/40 bg-warn/10 p-3">
                <p className="text-[12px] leading-relaxed text-warn">
                  지금은 {meta.name} 로그인을 쓸 수 없습니다.
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">
                  앱을 만든 사람이 설정해야 하는 부분이라, 직접 해결하실 수는 없습니다.
                  제작자에게 알려주세요.
                </p>
                {/* 개발자 설정은 배포본에 없으므로, 그리로 가는 버튼도 개발 중에만 띄웁니다. */}
                {import.meta.env.DEV && (
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg border border-warn/40 py-2 text-[11.5px] text-warn/80 transition-colors hover:bg-warn/15"
                    onClick={() => {
                      onClose()
                      onOpenSettings()
                    }}
                  >
                    개발자 설정 열기
                  </button>
                )}
              </div>
            )}

            {meta.caution && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warn/80">
                <span>⚠</span>
                <span>{meta.caution}</span>
              </p>
            )}

            {error && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>
            )}

            <button
              type="button"
              disabled={!credsReady && method === 'oauth'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void run()}
            >
              {busy && (
                <span className="spin block h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
              )}
              {busy
                ? deviceCode
                  ? '승인 대기 중…'
                  : '브라우저에서 로그인을 기다리고 있습니다'
                : method === 'oauth'
                  ? '브라우저 열고 연동하기'
                  : '키로 연동하기'}
            </button>

            {busy && (
              <p className="text-center text-[11px] leading-relaxed text-fg-faint">
                브라우저에서 로그인해 주세요. 창을 닫으셨다면 위 버튼을 다시 누르면 됩니다.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-fg-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
    </div>
  )
}
