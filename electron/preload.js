const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  search: (q) => ipcRenderer.invoke('search', q),
  getStreamUrl: (id) => ipcRenderer.invoke('getStreamUrl', id),
  getPlaylistVideos: (id) => ipcRenderer.invoke('getPlaylistVideos', id),
  getArtistData: (args) => ipcRenderer.invoke('getArtistData', args),

  download: (track) => ipcRenderer.invoke('download', track),
  listDownloads: () => ipcRenderer.invoke('listDownloads'),
  deleteDownload: (id) => ipcRenderer.invoke('deleteDownload', id),

  like: (track) => ipcRenderer.invoke('like', track),
  unlike: (id) => ipcRenderer.invoke('unlike', id),
  listLiked: () => ipcRenderer.invoke('listLiked'),
  getLikedIds: () => ipcRenderer.invoke('getLikedIds'),

  createPlaylist: (name) => ipcRenderer.invoke('createPlaylist', name),
  listPlaylists: () => ipcRenderer.invoke('listPlaylists'),
  deletePlaylist: (id) => ipcRenderer.invoke('deletePlaylist', id),
  renamePlaylist: (id, name) => ipcRenderer.invoke('renamePlaylist', id, name),
  addToPlaylist: (playlistId, track) =>
    ipcRenderer.invoke('addToPlaylist', playlistId, track),
  removeFromPlaylist: (playlistId, trackId) =>
    ipcRenderer.invoke('removeFromPlaylist', playlistId, trackId),
  getPlaylistTracks: (playlistId) =>
    ipcRenderer.invoke('getPlaylistTracks', playlistId),
  getAllPlaylistTrackIds: () => ipcRenderer.invoke('getAllPlaylistTrackIds'),
  backfillDuration: (id, seconds) =>
    ipcRenderer.invoke('backfillDuration', id, seconds),

  // Acciones de ventana
  quit: () => ipcRenderer.invoke('app:quit'),
  reload: () => ipcRenderer.invoke('window:reload'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  onMaximizeChange: (cb) => {
    const handler = (_e, isMax) => cb(isMax)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },
  onFullscreenChange: (cb) => {
    const handler = (_e, isFs) => cb(isFs)
    ipcRenderer.on('window:fullscreen', handler)
    return () => ipcRenderer.removeListener('window:fullscreen', handler)
  },
  openMusicFolder: () => ipcRenderer.invoke('shell:openMusicFolder'),

  // Settings (panel de configuración)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  pickMusicDir: () => ipcRenderer.invoke('settings:pickMusicDir'),
  setMusicDir: (newDir) => ipcRenderer.invoke('settings:setMusicDir', newDir),
  pickCookiesFile: () => ipcRenderer.invoke('settings:pickCookiesFile'),

  // Mini player
  openMini: () => ipcRenderer.invoke('mini:open'),
  closeMini: () => ipcRenderer.invoke('mini:close'),
  isMiniOpen: () => ipcRenderer.invoke('mini:isOpen'),
  broadcastMiniState: (state) => ipcRenderer.send('mini:broadcast-state', state),
  onMiniState: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('mini:state', h)
    return () => ipcRenderer.removeListener('mini:state', h)
  },
  sendMiniCommand: (cmd) => ipcRenderer.send('mini:command', cmd),
  onMiniCommand: (cb) => {
    const h = (_e, c) => cb(c)
    ipcRenderer.on('mini:command', h)
    return () => ipcRenderer.removeListener('mini:command', h)
  },
  onMiniClosed: (cb) => {
    ipcRenderer.on('mini:closed', cb)
    return () => ipcRenderer.removeListener('mini:closed', cb)
  },

  // Listener de progreso de descarga
  onDownloadProgress: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('download:progress', handler)
    return () => ipcRenderer.removeListener('download:progress', handler)
  },

  // Botones de la miniatura en la barra de tareas
  updateThumbar: (state) => ipcRenderer.invoke('thumbar:update', state),
  onThumbarAction: (cb) => {
    const handler = (_e, action) => cb(action)
    ipcRenderer.on('thumbar:action', handler)
    return () => ipcRenderer.removeListener('thumbar:action', handler)
  },

  ytdlpVersion: () => ipcRenderer.invoke('ytdlp:version'),
  ytdlpUpdate: () => ipcRenderer.invoke('ytdlp:update'),

  omicronReady: () => ipcRenderer.send('omicron:ready'),
  onOmicronCommand: (cb) => {
    const handler = (_e, cmd) => cb(cmd)
    ipcRenderer.on('omicron:command', handler)
    return () => ipcRenderer.removeListener('omicron:command', handler)
  }
})
