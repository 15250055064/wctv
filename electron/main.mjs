// WCcanvastv Mac app: runs the local server in-process and shows the canvas in its own window.
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { resolveDouyin } from './douyin.mjs';

app.setName('WCcanvastv');
// For running a second copy beside the installed app (testing): its own browser data.
if (process.env.WCCANVASTV_USERDATA) app.setPath('userData', process.env.WCCANVASTV_USERDATA);
// 链接下载 of 抖音 links needs a browser window, so the in-process server asks the app for it.
globalThis.__wctvDouyin = resolveDouyin;

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let stopServer = () => {};

async function ensureServer() {
  const server = await import('../server/index.mjs');
  stopServer = server.stopServer;
  const url = `http://localhost:${server.SERVER_PORT}`;
  try {
    await server.startServer();
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err;
    // Something already listens on the port; reuse it only if it is WCcanvastv.
    stopServer = () => {};
    const res = await fetch(`${url}/api/engines`).catch(() => null);
    if (!res?.ok) throw new Error(`端口 ${server.SERVER_PORT} 被其他程序占用，请关闭它后重新打开 WCcanvastv。`);
  }
  return url;
}

function sendMenu(action) {
  win?.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('libcanvas-menu', { detail: ${JSON.stringify(action)} }))`);
}

function buildMenu() {
  // No zoom accelerators: ⌘+ / ⌘- / ⌘0 belong to the canvas. Edit roles stay so text
  // fields keep copy and paste; the page still gets those keys first and may override them.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'WCcanvastv',
        submenu: [{ role: 'about', label: '关于 WCcanvastv' }, { type: 'separator' }, { role: 'hide', label: '隐藏 WCcanvastv' }, { role: 'hideOthers', label: '隐藏其他' }, { type: 'separator' }, { role: 'quit', label: '退出 WCcanvastv' }],
      },
      {
        label: '文件',
        submenu: [
          { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-project') },
          { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open-project') },
          { type: 'separator' },
          { label: '在访达中显示项目文件夹', click: () => sendMenu('reveal-project') },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '拷贝' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '显示',
        submenu: [{ role: 'reload', label: '重新载入' }, { role: 'togglefullscreen', label: '全屏' }, { type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }],
      },
      { role: 'windowMenu', label: '窗口' },
    ]),
  );
}

async function createWindow() {
  let url;
  try {
    url = await ensureServer();
  } catch (err) {
    dialog.showErrorBox('WCcanvastv 无法启动', String(err?.message ?? err));
    app.quit();
    return;
  }
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'WCcanvastv',
    backgroundColor: '#121214',
    // No system title bar: the traffic lights sit inside the app's own dark top bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 22, y: 26 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links that would open new windows go to the default browser instead.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) {
      e.preventDefault();
      if (/^https?:/.test(target)) shell.openExternal(target);
    }
  });
  // Save pending canvas edits before the window (and with it the server) goes away.
  let flushed = false;
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    const done = () => {
      flushed = true;
      win?.close();
    };
    Promise.race([win.webContents.executeJavaScript('window.__libcanvasFlush?.()'), new Promise((r) => setTimeout(r, 3000))]).then(done, done);
  });
  win.on('closed', () => (win = null));
  await win.loadURL(url);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

// The server lives inside the app, so closing the window quits everything.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => stopServer());
