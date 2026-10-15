'use strict';

const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    title: 'DocScan',
    backgroundColor: '#0f766e',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'web', 'index.html'));
  // Exports go through Chromium's download flow; without a save path Electron asks where to save.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  // The page only needs the camera.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const videoOnly = permission === 'media' && (details.mediaTypes ?? []).every((t) => t === 'video');
    callback(videoOnly);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
