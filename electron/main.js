const { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, net, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const settings = require('./settings.js')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])
const {
  search,
  getStreamUrl,
  download,
  getPlaylistVideos,
  getArtistData
} = require('./ytdlp.js')
const dbApi = require('./db.js')

const isDev = !app.isPackaged
let mainWindow = null
let miniWindow = null

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(windowStatePath(), 'utf8')
    const s = JSON.parse(raw)
    if (
      typeof s.width === 'number' &&
      typeof s.height === 'number' &&
      s.width >= 400 &&
      s.height >= 300
    ) {
      return s
    }
  } catch {}
  return null
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return
  try {
    const isMax = win.isMaximized()
    const isFs = win.isFullScreen()
    // Si está maximizado/fullscreen, getBounds() devuelve el tamaño actual;
    // queremos persistir el tamaño "normal" para restaurarlo correctamente.
    const bounds = isMax || isFs ? win.getNormalBounds() : win.getBounds()
    const state = { ...bounds, maximized: isMax, fullscreen: isFs }
    fs.writeFileSync(windowStatePath(), JSON.stringify(state))
  } catch {}
}

function resolveIconPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'imgs', 'logo', 'vinyl.png')]
    : [path.join(__dirname, '..', 'imgs', 'logo', 'vinyl.png')]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

function createWindow() {
  const saved = readWindowState()
  const iconPath = resolveIconPath()
  const win = new BrowserWindow({
    width: saved?.width || 1200,
    height: saved?.height || 800,
    x: saved?.x,
    y: saved?.y,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#171717',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  mainWindow = win

  if (saved?.maximized) win.maximize()
  if (saved?.fullscreen) win.setFullScreen(true)

  if (isDev) win.loadURL('http://localhost:5173')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  win.once('ready-to-show', () => updateThumbar({ hasCurrent: false }))

  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false))

  // Persiste el tamaño/posición tras cambios (debounced) y al cerrar
  let saveTimer = null
  const queueSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(win), 300)
  }
  win.on('resize', queueSave)
  win.on('move', queueSave)
  win.on('maximize', queueSave)
  win.on('unmaximize', queueSave)
  win.on('enter-full-screen', queueSave)
  win.on('leave-full-screen', queueSave)
  win.on('close', () => {
    clearTimeout(saveTimer)
    saveWindowState(win)
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  protocol.handle('localfile', (req) => {
    const prefix = 'localfile://media/'
    const raw = decodeURIComponent(req.url.slice(prefix.length))
    const resolved = path.resolve(raw)
    const base = path.resolve(dbApi.musicDir())
    if (!resolved.toLowerCase().startsWith(base.toLowerCase() + path.sep)) {
      return new Response('forbidden', { status: 403 })
    }
    if (!fs.existsSync(resolved)) {
      return new Response('not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(resolved).toString())
  })
  dbApi.initDb()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Búsqueda y reproducción
ipcMain.handle('search', async (_e, q) => search(q))
ipcMain.handle('getStreamUrl', async (_e, id) => getStreamUrl(id))
ipcMain.handle('getPlaylistVideos', async (_e, id) => getPlaylistVideos(id))
ipcMain.handle('getArtistData', async (_e, args) => getArtistData(args))

// Descargas
ipcMain.handle('download', async (event, track) => {
  event.sender.send('download:progress', {
    id: track.id,
    title: track.title,
    author: track.author,
    thumbnail: track.thumbnail || '',
    percent: 0,
    status: 'downloading'
  })
  try {
    const filePath = await download(track.id, ({ percent, status }) => {
      event.sender.send('download:progress', {
        id: track.id,
        percent,
        status
      })
    })
    dbApi.addDownload({
      id: track.id,
      title: track.title,
      author: track.author,
      thumbnail: track.thumbnail || '',
      duration: track.duration || '',
      file_path: filePath
    })
    event.sender.send('download:progress', {
      id: track.id,
      percent: 100,
      status: 'done'
    })
    return filePath
  } catch (err) {
    event.sender.send('download:progress', {
      id: track.id,
      percent: 0,
      status: 'error',
      error: err.message
    })
    throw err
  }
})
ipcMain.handle('listDownloads', () => dbApi.listDownloads())
ipcMain.handle('deleteDownload', (_e, id) => {
  const row = dbApi.getDownload(id)
  if (row?.file_path && fs.existsSync(row.file_path)) {
    try { fs.unlinkSync(row.file_path) } catch (err) { console.error(err) }
  }
  dbApi.removeDownload(id)
  return true
})

// Likes
ipcMain.handle('like', (_e, track) => dbApi.likeTrack(track))
ipcMain.handle('unlike', (_e, id) => dbApi.unlikeTrack(id))
ipcMain.handle('listLiked', () => dbApi.listLiked())
ipcMain.handle('getLikedIds', () => dbApi.getLikedIds())

// Playlists
ipcMain.handle('createPlaylist', (_e, name) => dbApi.createPlaylist(name))
ipcMain.handle('listPlaylists', () => dbApi.listPlaylists())
ipcMain.handle('deletePlaylist', (_e, id) => dbApi.deletePlaylist(id))
ipcMain.handle('renamePlaylist', (_e, id, name) => dbApi.renamePlaylist(id, name))
ipcMain.handle('addToPlaylist', (_e, playlistId, track) =>
  dbApi.addToPlaylist(playlistId, track)
)
ipcMain.handle('removeFromPlaylist', (_e, playlistId, trackId) =>
  dbApi.removeFromPlaylist(playlistId, trackId)
)
ipcMain.handle('getPlaylistTracks', (_e, playlistId) =>
  dbApi.getPlaylistTracks(playlistId)
)
ipcMain.handle('getAllPlaylistTrackIds', () => dbApi.getAllPlaylistTrackIds())
ipcMain.handle('backfillDuration', (_e, id, seconds) =>
  dbApi.backfillDuration(id, seconds)
)

// ---------- Thumbar (botones en la miniatura de la barra de tareas) ----------

const ICON_SIZE = 24

function makeIcon(drawFn) {
  const size = ICON_SIZE
  const buf = Buffer.alloc(size * size * 4)
  function px(x, y) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const idx = (y * size + x) * 4
    buf[idx] = 255
    buf[idx + 1] = 255
    buf[idx + 2] = 255
    buf[idx + 3] = 255
  }
  drawFn(px)
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function triangleRight(px, xL, yT, xR, yMid, yB) {
  for (let y = yT; y <= yB; y++) {
    const t = y < yMid ? (y - yT) / (yMid - yT) : (yB - y) / (yB - yMid)
    const xEnd = xL + (xR - xL) * t
    for (let x = xL; x <= xEnd; x++) px(x, y)
  }
}
function triangleLeft(px, xR, yT, xL, yMid, yB) {
  for (let y = yT; y <= yB; y++) {
    const t = y < yMid ? (y - yT) / (yMid - yT) : (yB - y) / (yB - yMid)
    const xEnd = xR - (xR - xL) * t
    for (let x = xEnd; x <= xR; x++) px(x, y)
  }
}
function rect(px, x1, y1, x2, y2) {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) px(x, y)
}
function thickLine(px, x1, y1, x2, y2, thickness = 2) {
  const dx = x2 - x1, dy = y2 - y1
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  for (let i = 0; i <= steps; i++) {
    const x = x1 + (dx * i) / steps
    const y = y1 + (dy * i) / steps
    for (let oy = -thickness; oy <= thickness; oy++) {
      for (let ox = -thickness; ox <= thickness; ox++) {
        if (ox * ox + oy * oy <= thickness * thickness) px(x + ox, y + oy)
      }
    }
  }
}

const ICON_PLAY = makeIcon((px) => {
  triangleRight(px, 7, 4, 19, 12, 20)
})

const ICON_PAUSE = makeIcon((px) => {
  rect(px, 6, 4, 9, 19)
  rect(px, 14, 4, 17, 19)
})

const ICON_PREV = makeIcon((px) => {
  rect(px, 4, 4, 6, 19)
  triangleLeft(px, 19, 4, 8, 12, 20)
})

const ICON_NEXT = makeIcon((px) => {
  triangleRight(px, 4, 4, 15, 12, 20)
  rect(px, 17, 4, 19, 19)
})

const ICON_PLUS = makeIcon((px) => {
  rect(px, 3, 10, 20, 13)
  rect(px, 10, 3, 13, 20)
})

const ICON_CHECK = makeIcon((px) => {
  thickLine(px, 4, 13, 10, 18, 1)
  thickLine(px, 10, 18, 20, 6, 1)
})

function updateThumbar(state) {
  if (!mainWindow) return
  const hasCurrent = !!state?.hasCurrent
  const isPlaying = !!state?.isPlaying
  const isLiked = !!state?.isLiked
  const flags = hasCurrent ? [] : ['disabled']

  mainWindow.setThumbarButtons([
    {
      tooltip: isLiked ? 'Quitar de Me gusta' : 'Agregar a Me gusta',
      icon: isLiked ? ICON_CHECK : ICON_PLUS,
      flags,
      click: () => mainWindow.webContents.send('thumbar:action', 'like')
    },
    {
      tooltip: 'Anterior',
      icon: ICON_PREV,
      flags,
      click: () => mainWindow.webContents.send('thumbar:action', 'prev')
    },
    {
      tooltip: isPlaying ? 'Pausar' : 'Reproducir',
      icon: isPlaying ? ICON_PAUSE : ICON_PLAY,
      flags,
      click: () => mainWindow.webContents.send('thumbar:action', 'playpause')
    },
    {
      tooltip: 'Siguiente',
      icon: ICON_NEXT,
      flags,
      click: () => mainWindow.webContents.send('thumbar:action', 'next')
    }
  ])
}

ipcMain.handle('thumbar:update', (_e, state) => updateThumbar(state))

// Acciones de ventana / app
ipcMain.handle('app:quit', () => app.quit())
ipcMain.handle('window:reload', () => mainWindow?.webContents.reload())
ipcMain.handle('window:toggleDevTools', () =>
  mainWindow?.webContents.toggleDevTools()
)
ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(!mainWindow.isFullScreen())
})
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized())
ipcMain.handle('window:isFullscreen', () => !!mainWindow?.isFullScreen())
ipcMain.handle('shell:openMusicFolder', () => {
  const { shell } = require('electron')
  shell.openPath(settings.getMusicDir())
})

// ---------- Settings (panel de configuración) ----------
ipcMain.handle('settings:get', () => settings.getSettings())

ipcMain.handle('settings:set', (_e, key, value) => {
  settings.setSetting(key, value)
  return settings.getSettings()
})

ipcMain.handle('settings:pickCookiesFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir archivo cookies.txt',
    properties: ['openFile'],
    filters: [
      { name: 'Cookies', extensions: ['txt'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  })
  if (res.canceled || !res.filePaths?.[0]) return null
  return res.filePaths[0]
})

ipcMain.handle('settings:pickMusicDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir carpeta de descargas',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: settings.getMusicDir()
  })
  if (res.canceled || !res.filePaths?.[0]) return null
  return res.filePaths[0]
})

ipcMain.handle('settings:setMusicDir', async (_e, newDir) => {
  const oldDir = settings.getMusicDir()
  if (!newDir || path.resolve(newDir) === path.resolve(oldDir)) {
    return { ok: true, moved: 0, failed: [] }
  }
  try {
    fs.mkdirSync(newDir, { recursive: true })
  } catch (err) {
    return { ok: false, error: err.message, moved: 0, failed: [] }
  }

  const rows = dbApi.listDownloadRowsRaw()
  let moved = 0
  const failed = []
  for (const r of rows) {
    const baseName = r.file_path && path.isAbsolute(r.file_path)
      ? path.basename(r.file_path)
      : r.file_path
    if (!baseName) continue
    const src = path.join(oldDir, baseName)
    const dst = path.join(newDir, baseName)
    if (!fs.existsSync(src)) continue
    try {
      try {
        fs.renameSync(src, dst)
      } catch (errRename) {
        if (errRename.code === 'EXDEV' || errRename.code === 'EPERM') {
          fs.copyFileSync(src, dst)
          fs.unlinkSync(src)
        } else {
          throw errRename
        }
      }
      moved++
    } catch (err) {
      failed.push({ id: r.id, title: r.title, error: err.message })
    }
  }
  settings.setSetting('musicDir', newDir)
  return { ok: true, moved, failed, newDir }
})

// ---------- Mini Player ----------
function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show()
    miniWindow.focus()
    return
  }
  miniWindow = new BrowserWindow({
    width: 320,
    height: 500,
    minWidth: 280,
    minHeight: 460,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#1C1410',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  miniWindow.setMenuBarVisibility(false)
  if (isDev) miniWindow.loadURL('http://localhost:5173/#mini')
  else miniWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'mini' })
  miniWindow.on('closed', () => {
    miniWindow = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini:closed')
    }
  })
}

ipcMain.handle('mini:open', () => createMiniWindow())
ipcMain.handle('mini:close', () => {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close()
})
ipcMain.handle('mini:isOpen', () => !!(miniWindow && !miniWindow.isDestroyed()))
// La ventana principal emite estado → forward al mini
ipcMain.on('mini:broadcast-state', (_e, state) => {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('mini:state', state)
  }
})
// El mini emite comandos → forward al main
ipcMain.on('mini:command', (_e, cmd) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mini:command', cmd)
  }
})

