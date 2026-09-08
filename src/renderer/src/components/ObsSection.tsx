import { useState } from 'react'
import { OBS_DEFAULT_PORT } from '@shared/obs'
import { useAppStore } from '@/store/useAppStore'
import { useObsStore } from '@/store/useObsStore'

/**
 * OBS 연동 설정.
 *
 * 씬에 프리셋을 걸어두면 OBS 에서 씬을 바꿀 때 방송 제목·카테고리·태그가 따라갑니다.
 */
export function ObsSection(): React.JSX.Element {
  const settings = useObsStore((s) => s.settings)
  const state = useObsStore((s) => s.state)
  const bindings = useObsStore((s) => s.bindings)
  const hasPassword = useObsStore((s) => s.hasPassword)
  const lastRun = useObsStore((s) => s.lastRun)
  const saveSettings = useObsStore((s) => s.saveSettings)
  const bind = useObsStore((s) => s.bind)
  const runCurrentScene = useObsStore((s) => s.runCurrentScene)

  const presets = useAppStore((s) => s.presets)

  const [host, setHost] = useState(settings.host)
  const [port, setPort] = useState(String(settings.port))
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const dirty =
    host !== settings.host || port !== String(settings.port) || password.length > 0

  const save = async (patch: Partial<typeof settings> = {}): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings(
        {
          host: host.trim() || '127.0.0.1',
          port: Number(port) || OBS_DEFAULT_PORT,
          ...patch
        },
        password || undefined
      )
      setPassword('')
    } finally {
      setSaving(false)
    }
  }

  /* 걸어둔 씬 + OBS 가 알려준 씬을 합칩니다. OBS 가 꺼져 있어도 이미 건 건 보여야 합니다. */
  const scenes = [...new Set([...(state.scenes ?? []), ...Object.keys(bindings)])]

  const statusLabel =
    state.status === 'connected'
      ? `연결됨${state.obsVersion ? ` · OBS ${state.obsVersion}` : ''}`
      : state.status === 'connecting'
        ? '연결하는 중'
        : state.status === 'error'
          ? '연결 실패'
          : '사용 안 함'

  const statusColor =
    state.status === 'connected'
      ? 'bg-ok'
      : state.status === 'connecting'
        ? 'bg-warn'
        : state.status === 'error'
          ? 'bg-danger'
          : 'bg-ink-500'

  return (
    <section className="border-t border-ink-600 pt-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">OBS 연동</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
            OBS 에서 장면을 바꾸면 방송 제목·카테고리·태그가 따라 바뀝니다.
            장면마다 프리셋을 걸어두면 됩니다.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          className={[
            'mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors',
            settings.enabled ? 'border-accent bg-accent/30' : 'border-ink-600 bg-ink-850'
          ].join(' ')}
          onClick={() => void save({ enabled: !settings.enabled })}
        >
          <span
            className={[
              'block h-3.5 w-3.5 rounded-full bg-fg transition-transform',
              settings.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            ].join(' ')}
          />
        </button>
      </div>

      {settings.enabled && (
        <div className="fade-up mt-3 space-y-3">
          {/* 연결 상태 */}
          <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
            <span className="text-[12px] text-fg-muted">{statusLabel}</span>
            {state.currentScene && (
              <span className="ml-auto truncate text-[11px] text-fg-faint">
                지금 장면: {state.currentScene}
              </span>
            )}
          </div>

          {state.error && (
            <p className="text-[11px] leading-relaxed text-danger">{state.error}</p>
          )}

          {state.status !== 'connected' && (
            <p className="text-[11px] leading-relaxed text-fg-faint">
              OBS 에서 <span className="text-fg-muted">도구 &gt; WebSocket 서버 설정</span> 을 열고
              서버를 켜주세요. 비밀번호를 쓰고 있다면 아래에 같이 입력하면 됩니다.
            </p>
          )}

          {/* 접속 정보 */}
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-fg-faint">주소</span>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="127.0.0.1"
                className="w-full rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-fg-faint">포트</span>
              <input
                value={port}
                inputMode="numeric"
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={String(OBS_DEFAULT_PORT)}
                className="w-full rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] text-fg-faint">
              비밀번호{hasPassword ? ' — 저장되어 있습니다. 바꿀 때만 입력하세요' : ''}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? '••••••••' : 'OBS 에서 인증을 켰다면 입력'}
              className="w-full rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            />
          </label>

          <button
            type="button"
            disabled={!dirty || saving}
            className="rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] text-fg-muted transition-colors enabled:hover:border-accent enabled:hover:text-fg disabled:opacity-40"
            onClick={() => void save()}
          >
            {saving ? '연결하는 중' : '저장하고 다시 연결'}
          </button>

          {/* 자동 적용 여부 */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-600 bg-ink-850 p-2.5">
            <input
              type="checkbox"
              checked={settings.autoApply}
              onChange={(e) => void save({ autoApply: e.target.checked })}
              className="mt-0.5 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[12px]">장면을 바꾸면 바로 적용</span>
              <span className="block text-[11px] leading-relaxed text-fg-faint">
                끄면 프리셋을 화면에 불러오기만 하고, 적용은 직접 누릅니다.
              </span>
            </span>
          </label>

          {/* 장면별 프리셋 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold">장면별 프리셋</span>
              {state.currentScene && bindings[state.currentScene] && (
                <button
                  type="button"
                  className="text-[11px] text-fg-faint transition-colors hover:text-fg"
                  onClick={() => void runCurrentScene()}
                >
                  지금 장면으로 한 번 적용
                </button>
              )}
            </div>

            {presets.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-fg-faint">
                저장된 프리셋이 없습니다. 프리셋 탭에서 먼저 하나 만들어 주세요.
              </p>
            ) : scenes.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-fg-faint">
                OBS 에 연결되면 장면 목록이 여기에 나옵니다.
              </p>
            ) : (
              <div className="space-y-1.5">
                {scenes.map((scene) => (
                  <div key={scene} className="flex items-center gap-2">
                    <span
                      className={[
                        'min-w-0 flex-1 truncate text-[12px]',
                        scene === state.currentScene ? 'text-fg' : 'text-fg-muted'
                      ].join(' ')}
                      title={scene}
                    >
                      {scene}
                    </span>
                    <select
                      value={bindings[scene] ?? ''}
                      onChange={(e) => bind(scene, e.target.value || null)}
                      className="w-[150px] shrink-0 rounded-lg border border-ink-600 bg-ink-850 px-2 py-1 text-[11.5px] outline-none focus:border-accent"
                    >
                      <option value="">걸지 않음</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 마지막으로 무슨 일이 있었는지 */}
          {lastRun && (
            <p
              className={[
                'text-[11px] leading-relaxed',
                lastRun.ok ? 'text-fg-faint' : 'text-danger'
              ].join(' ')}
            >
              {lastRun.ok
                ? `${lastRun.sceneName} 장면으로 바뀌어 '${lastRun.presetName}' 을 ${
                    lastRun.applied ? '적용했습니다' : '불러왔습니다'
                  }.`
                : `${lastRun.sceneName} 장면 처리에 실패했습니다. ${lastRun.error ?? ''}`}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
