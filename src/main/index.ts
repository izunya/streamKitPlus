import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { registerIpc } from './ipc'
import { disconnectAllChat, setChatTarget } from './chat'
import { disconnectObs, setObsTarget } from './obs'
import { checkForUpdates, setUpdateTarget, startUpdateSchedule, stopUpdateSchedule } from './updater'

const isDev = !app.isPackaged

/**
 * userData 경로를 고정합니다.
 *
 * 고정하지 않으면 app.getName() 에 따라 경로가 실행 방식마다 달라집니다:
 *   electron out/main/index.js   ->  %APPDATA%\Electron
 *   electron-vite dev / preview  ->  %APPDATA%\streamkit-plus
 *   패키징된 앱                   ->  %APPDATA%\StreamKit+   (productName)
 *
 * 그러면 개발 중에 저장한 자격 증명이 빌드본에서는 사라진 것처럼 보입니다.
 * 실제로 그 문제를 겪었습니다 — 입력한 키가 Electron 폴더에 들어가 있었습니다.
 *
 * setPath 는 app 이 ready 되기 전에 불러야 합니다.
 */
const USER_DATA_DIR = join(app.getPath('appData'), 'streamkit-plus')
app.setPath('userData', USER_DATA_DIR)

/**
 * 예전 기본 경로에 금고가 남아 있으면 알려만 줍니다.
 *
 * ⚠️ 파일을 복사해서 옮기면 안 됩니다.
 *    Electron 의 safeStorage 는 Windows 에서 userData 폴더마다 다른 키를 씁니다
 *    (Local State 의 os_crypt.encrypted_key). 그래서 vault.bin 만 옮기면
 *    복호화가 실패하고, 자격 증명이 조용히 사라진 것처럼 보입니다.
 *    실제로 그렇게 만들었다가 이 문제를 겪었습니다.
 *
 *    옮기려면 Local State 의 키까지 함께 다뤄야 하는데, 그 파일은 Chromium 이
 *    우리 코드보다 먼저 읽으므로 안전하게 개입할 수 없습니다.
 *    그래서 "다시 입력해 주세요" 라고 안내하는 편이 정직하고 안전합니다.
 */
function warnLegacyVault(): void {
  if (existsSync(join(USER_DATA_DIR, 'vault.bin'))) return

  for (const legacyName of ['Electron', 'StreamKit+']) {
    if (!existsSync(join(app.getPath('appData'), legacyName, 'vault.bin'))) continue
    console.warn(
      `[vault] 예전 경로(%APPDATA%/${legacyName})에 저장된 자격 증명이 있습니다. ` +
        '암호화 키가 폴더마다 달라 그대로 옮길 수 없으니, 설정에서 한 번만 다시 입력해 주세요.'
    )
    return
  }
}

let mainWindow: BrowserWindow | null = null

/**
 * 렌더러를 file:// 대신 app:// 로 서빙합니다.
 *
 * file:// 은 출처(origin)가 없어서 CSP 의 'self' 가 아무것도 허용하지 않고,
 * 모듈 스크립트가 CORS 로 차단됩니다. 표준 스킴을 하나 만들어 두면
 * 일반 웹 페이지와 동일한 보안 모델을 그대로 쓸 수 있습니다.
 */
const APP_SCHEME = 'app'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')

  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url)

    // 잘못된 %-시퀀스(예: app://local/%ZZ)는 decodeURIComponent 가 throw 합니다.
    // 그대로 두면 핸들러가 예외로 죽으므로, 잘못된 요청으로 처리합니다.
    let relative: string
    try {
      relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    const target = normalize(join(rendererRoot, relative))

    // 디렉터리 밖으로 나가는 경로는 거부합니다.
    if (!target.startsWith(rendererRoot + sep) && target !== rendererRoot) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}

/**
 * 창·작업표시줄 아이콘.
 *
 * 패키징된 Windows 앱은 exe 에 박힌 아이콘을 쓰지만,
 * 개발 중에는 이 값이 없으면 기본 Electron 아이콘이 뜹니다.
 */
const iconPath = join(__dirname, '../../resources/icon.png')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#101219',
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 창이 뜨면 조용히 새 버전을 확인합니다 (개발 모드에서는 넘어갑니다).
    if (mainWindow) setUpdateTarget(mainWindow.webContents)
    void checkForUpdates()
    // 오래 켜두는 앱이라 주기적으로도 확인합니다.
    startUpdateSchedule()
  })

  // 앱 안에서 외부 링크가 열리지 않게 하고 기본 브라우저로 넘깁니다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 렌더러 오류를 터미널에서도 볼 수 있게 넘겨줍니다.
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadURL(`${APP_SCHEME}://local/index.html`)
  }
}

void app.whenReady().then(() => {
  warnLegacyVault()
  registerAppProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 창이 없으면 채팅 소켓도 붙들고 있을 이유가 없습니다.
  setChatTarget(null)
  disconnectAllChat()
  setObsTarget(null)
  disconnectObs()
  stopUpdateSchedule()
  if (process.platform !== 'darwin') app.quit()
})
