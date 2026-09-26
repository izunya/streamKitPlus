import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 빌드할 때 앱에 끼워 넣을 플랫폼 키 목록.
 * 실제 값은 프로젝트 루트의 .env 에 있고, 그 파일은 저장소에 올라가지 않습니다.
 */
const CREDENTIAL_KEYS = [
  'SKP_YOUTUBE_CLIENT_ID',
  'SKP_YOUTUBE_CLIENT_SECRET',
  'SKP_TWITCH_CLIENT_ID',
  'SKP_TWITCH_CLIENT_SECRET',
  'SKP_CHZZK_CLIENT_ID',
  'SKP_CHZZK_CLIENT_SECRET',
  'SKP_CIME_CLIENT_ID',
  'SKP_CIME_CLIENT_SECRET',
  'SKP_SOOPLIVE_CLIENT_ID',
  'SKP_SOOPLIVE_CLIENT_SECRET'
] as const

/**
 * .env 의 값을 메인 프로세스 코드 안에 글자 그대로 박습니다.
 *
 * 왜 이렇게 하냐면, 패키징된 앱은 사용자 PC 에서 돌아가기 때문입니다.
 * 거기엔 우리 .env 가 없으니 실행 시점에 읽을 방법이 없고, 빌드하는 순간
 * 값을 코드에 넣어두는 수밖에 없습니다.
 *
 * 비어 있는 키는 건드리지 않고 그대로 둡니다. 그래야 개발 중에 셸에서
 * 값을 넘겨 시험해 보는 방식이 계속 통합니다.
 */
function credentialDefines(mode: string): Record<string, string> {
  const fromFile = loadEnv(mode, process.cwd(), 'SKP_')
  const defines: Record<string, string> = {}

  for (const key of CREDENTIAL_KEYS) {
    // 셸에서 넘긴 값이 .env 보다 우선입니다 (CI 에서 쓰는 방식).
    const value = (process.env[key] ?? fromFile[key])?.trim()
    if (value) defines[`process.env.${key}`] = JSON.stringify(value)
  }

  return defines
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: credentialDefines(mode)
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
}))
