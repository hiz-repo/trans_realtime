const path = require('node:path');
const { pathToFileURL } = require('node:url');
const electron = require('electron');
const dotenv = require('dotenv');

dotenv.config();

if (!electron || typeof electron !== 'object' || !electron.app) {
  console.error(
    '[FATAL] Electron main API is unavailable. If ELECTRON_RUN_AS_NODE is set, unset it before running npm start.'
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, screen } = electron;
const PORT = Number(process.env.PORT || 3000);
let apiServer = null;
let mainWindow = null;
let overlayWindow = null;
let overlayVisible = true;
let overlayStyle = {
  textColor: '#ffffff',
  bgColor: '#000000',
  bgOpacity: 0.78,
  fontSize: 32,
  bottom: 12,
  radius: 10
};

app.whenReady().then(bootstrap).catch(onFatal);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    createOverlayWindow();
  }
});
app.on('before-quit', async () => {
  if (!apiServer) return;
  await new Promise((resolve) => {
    apiServer.close(() => resolve());
  });
  apiServer = null;
});

async function bootstrap() {
  const serverModule = await import(pathToFileURL(path.join(__dirname, 'server.js')).href);
  const started = await serverModule.startServer({ port: PORT, host: '127.0.0.1' });
  apiServer = started.server;

  registerIpcHandlers();
  createMainWindow();
  createOverlayWindow();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 860,
    minWidth: 760,
    minHeight: 620,
    title: 'Realtime Subtitle Translator',
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const width = Math.min(1400, Math.floor(display.workArea.width * 0.9));
  const height = 220;
  const x = display.workArea.x + Math.floor((display.workArea.width - width) / 2);
  const y = display.workArea.y + display.workArea.height - height - 28;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: true,
    resizable: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadURL(`http://127.0.0.1:${PORT}/overlay.html`);
  overlayWindow.showInactive();
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow?.webContents.send('overlay:style', overlayStyle);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.on('overlay:subtitle', (_event, subtitle) => {
    if (!overlayWindow || !overlayVisible) return;
    overlayWindow.webContents.send('overlay:subtitle', String(subtitle || ''));
  });

  ipcMain.on('overlay:clear', () => {
    if (!overlayWindow) return;
    overlayWindow.webContents.send('overlay:clear');
  });

  ipcMain.handle('overlay:setStyle', (_event, style) => {
    overlayStyle = sanitizeOverlayStyle(style);
    if (overlayWindow) {
      overlayWindow.webContents.send('overlay:style', overlayStyle);
    }
    return overlayStyle;
  });

  ipcMain.handle('overlay:setVisible', (_event, visible) => {
    overlayVisible = Boolean(visible);
    if (!overlayWindow) return overlayVisible;

    if (overlayVisible) {
      overlayWindow.showInactive();
    } else {
      overlayWindow.hide();
    }

    return overlayVisible;
  });

  ipcMain.handle('overlay:getState', () => ({
    visible: overlayVisible
  }));
}

function onFatal(error) {
  console.error('[FATAL]', error);
  app.quit();
}

function sanitizeOverlayStyle(style) {
  const value = style && typeof style === 'object' ? style : {};
  return {
    textColor: sanitizeHexColor(value.textColor, '#ffffff'),
    bgColor: sanitizeHexColor(value.bgColor, '#000000'),
    bgOpacity: clampFloat(value.bgOpacity, 0.2, 1, 0.78),
    fontSize: clampInt(value.fontSize, 14, 96, 32),
    bottom: clampInt(value.bottom, 0, 200, 12),
    radius: clampInt(value.radius, 0, 40, 10)
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeHexColor(value, fallback) {
  const text = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return fallback;
}
