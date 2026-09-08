import { useEffect, useState } from 'react'
import type { PlatformId } from '@shared/types'
import { useAppStore, useActiveTargets, useChangeSummary } from '@/store/useAppStore'
import { subscribeChat, useChatStore } from '@/store/useChatStore'
import { useObsStore } from '@/store/useObsStore'
import { PlatformToggleBar } from '@/components/PlatformToggleBar'
import { TitleField } from '@/components/TitleField'
import { CategoryField } from '@/components/CategoryField'
import { TagField } from '@/components/TagField'
import { ResultPanel } from '@/components/ResultPanel'
import { SidePanel } from '@/components/SidePanel'
import { ConnectDialog } from '@/components/ConnectDialog'
import { PlatformIcon } from '@/components/PlatformIcon'
import { SettingsDialog } from '@/components/SettingsDialog'
import { UpdateBanner } from '@/components/UpdateBanner'
import { useUpdateStore } from '@/store/useUpdateStore'

export default function App(): React.JSX.Element {
  const [connectTarget, setConnectTarget] = useState<PlatformId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const mode = useAppStore((s) => s.mode)
  const syncAccounts = useAppStore((s) => s.syncAccounts)
  const applying = useAppStore((s) => s.applying)
  const apply = useAppStore((s) => s.apply)
  const resetDraft = useAppStore((s) => s.resetDraft)
  const targets = useActiveTargets()

  /**
   * 실제로 값이 바뀌는 플랫폼.
   *
   * "입력칸이 채워졌는가" 가 아니라 "현재 값과 다른가" 로 판단합니다.
   * 그래야 고쳤다가 원래대로 되돌리면 적용 버튼이 다시 잠깁니다.
   */
  const changes = useChangeSummary()
  const canApply = changes.length > 0 && !applying

  // 앱을 다시 켜도 연동이 유지되도록 저장된 상태를 읽어옵니다.
  useEffect(() => {
    void syncAccounts()
  }, [syncAccounts])

  /*
   * 채팅 수신 구독.
   *
   * 구독을 먼저 걸고 연결을 요청해야 초반 메시지를 놓치지 않습니다.
   * 정리 함수를 돌려받아 언마운트 시 리스너를 떼어냅니다 (중복 구독 방지).
   */
  useEffect(() => {
    const off = subscribeChat()
    void useChatStore.getState().attach()
    void useObsStore.getState().attach()
    void useUpdateStore.getState().attach()
    return off
  }, [])

  // Ctrl+Enter 로 적용
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canApply) {
        e.preventDefault()
        void apply()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canApply, apply])

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <header className="flex shrink-0 items-center justify-between border-b border-ink-600 px-5 py-3">
        <div className="flex items-center gap-2.5">
          {/* 가로로 긴 로고라 정사각형에 넣으면 세로 여백 때문에 작아 보입니다.
              높이만 맞추고 가로는 비율대로 둡니다. */}
          <img src="./logo.png" alt="StreamKit+" className="h-9 w-auto shrink-0" />
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[16px] font-bold tracking-tight">
              StreamKit
              <span className="text-accent-soft">+</span>
            </h1>
            <span className="text-[11px] text-fg-faint">동시송출 통합 관리</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {mode === 'mock' ? (
            <span className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[10.5px] text-warn">
              연습 모드
            </span>
          ) : (
            <span className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[10.5px] text-ok">
              실제 모드
            </span>
          )}
          <button
            type="button"
            className="rounded-lg px-2.5 py-1 text-[12px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
            onClick={() => setSettingsOpen(true)}
          >
            설정
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* 좌: 입력 영역 */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <PlatformToggleBar onRequestConnect={setConnectTarget} />
          <TitleField />
          <CategoryField />
          <TagField />
          <ResultPanel />
        </main>

        {/* 우: 프리셋 / 이력 */}
        <SidePanel />
      </div>

      {/* 하단 실행 바 */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-ink-600 px-5 py-3">
        <button
          type="button"
          className="rounded-lg px-3 py-2 text-[12.5px] text-fg-faint transition-colors hover:bg-ink-700 hover:text-fg"
          onClick={resetDraft}
          title="입력한 걸 지우고 지금 방송 정보를 다시 불러옵니다"
        >
          초기화
        </button>

        <div className="min-w-0 flex-1 text-[11.5px]">
          {targets.length === 0 ? (
            <span className="text-fg-faint">
              적용할 곳이 없습니다 위 아이콘을 눌러 로그인하세요.
            </span>
          ) : changes.length > 0 ? (
            /* 무엇이 바뀌는지 항목까지 보여줍니다.
               접혀 있는 영역 때문에 이유를 모른 채 적용하게 되면 안 됩니다.
               바뀌는 게 없을 때는 버튼이 잠기므로 따로 알리지 않습니다. */
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-muted">
              {changes.map((c) => (
                <span key={c.platform} className="flex items-center gap-1">
                  <PlatformIcon id={c.platform} size={13} />
                  <span className="text-fg-faint">{c.fields.join('·')}</span>
                </span>
              ))}
            </span>
          ) : null}
        </div>

        <span className="text-[11px] text-fg-faint">Ctrl + Enter</span>
        <button
          type="button"
          disabled={!canApply}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent px-7 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          onClick={() => void apply()}
        >
          {applying && (
            <span className="spin block h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
          )}
          {applying ? '적용 중…' : '전체 적용'}
        </button>
      </footer>

      <ConnectDialog
        platform={connectTarget}
        onClose={() => setConnectTarget(null)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UpdateBanner />
    </div>
  )
}
