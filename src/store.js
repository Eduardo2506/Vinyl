import { create } from 'zustand'

export const usePlayer = create((set, get) => ({
  current: null,
  queue: [],
  index: -1,
  isPlaying: false,
  repeatMode: 'off', // 'off' | 'all' | 'one'
  volume: 0.8,
  muted: false,
  // Contador que el Player observa para reiniciar la canción actual
  restartTick: 0,
  dominantColor: null,
  setDominantColor: (c) => set({ dominantColor: c }),
  playbackError: null,
  clearPlaybackError: () => set({ playbackError: null }),

  playTrack: async (track, queue = null, index = null) => {
    const q = queue || [track]
    const i = index ?? q.findIndex((t) => t.id === track.id)
    set({ queue: q, index: i, current: { ...track }, isPlaying: true, playbackError: null })
    try {
      useRecent.getState().push(track)
    } catch {}
    try {
      const local = track.localPath || track.file_path
      if (local) {
        set({ current: { ...track, streamUrl: 'localfile://media/' + encodeURIComponent(local) } })
        return
      }
      const res = await window.api.getStreamUrl(track.id)
      if (get().current?.id !== track.id) return
      if (res?.error) {
        set({ isPlaying: false, playbackError: res.error })
        return
      }
      set({ current: { ...track, streamUrl: res.url } })
    } catch (err) {
      console.error('Stream error:', err)
      if (get().current?.id === track.id) {
        set({ isPlaying: false, playbackError: 'No se pudo reproducir esta canción.' })
      }
    }
  },

  refreshStream: async () => {
    const track = get().current
    if (!track || track.localPath || track.file_path) return false
    try {
      const res = await window.api.getStreamUrl(track.id, { force: true })
      if (get().current?.id !== track.id) return false
      if (res?.error) {
        set({ isPlaying: false, playbackError: res.error })
        return false
      }
      set({ current: { ...track, streamUrl: res.url } })
      return true
    } catch {
      set({ isPlaying: false, playbackError: 'No se pudo reproducir esta canción.' })
      return false
    }
  },

  togglePlay: () => set({ isPlaying: !get().isPlaying }),

  next: () => {
    const { queue, index, repeatMode } = get()
    if (queue.length === 0) return
    let nextIdx = index + 1
    if (nextIdx >= queue.length) {
      if (repeatMode === 'all') nextIdx = 0
      else {
        set({ isPlaying: false })
        return
      }
    }
    get().playTrack(queue[nextIdx], queue, nextIdx)
  },

  prev: () => {
    const { queue, index, repeatMode } = get()
    if (queue.length === 0) return
    let prevIdx = index - 1
    if (prevIdx < 0) {
      if (repeatMode === 'all') prevIdx = queue.length - 1
      else return
    }
    get().playTrack(queue[prevIdx], queue, prevIdx)
  },

  handleEnded: () => {
    const { repeatMode } = get()
    if (repeatMode === 'one') {
      // Avisar al Player que rebobine sin cambiar la URL
      set({ restartTick: get().restartTick + 1, isPlaying: true })
    } else {
      get().next()
    }
  },

  cycleRepeat: () =>
    set({
      repeatMode:
        get().repeatMode === 'off'
          ? 'all'
          : get().repeatMode === 'all'
          ? 'one'
          : 'off'
    }),

  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: false }),
  toggleMute: () => set({ muted: !get().muted })
}))

export const useSettings = create((set, get) => ({
  lucidMode: localStorage.getItem('lucidMode') === '1',
  musicDir: '',
  cookiesBrowser: 'none',
  cookiesFile: '',
  refresh: async () => {
    try {
      const s = await window.api.getSettings()
      set({
        musicDir: s.musicDir || '',
        cookiesBrowser: s.cookiesBrowser || 'none',
        cookiesFile: s.cookiesFile || ''
      })
    } catch {}
  },
  setCookiesBrowser: async (b) => {
    await window.api.setSetting('cookiesBrowser', b)
    set({ cookiesBrowser: b })
  },
  setCookiesFile: async (file) => {
    await window.api.setSetting('cookiesFile', file)
    set({ cookiesFile: file })
  },
  toggleLucid: () => {
    const next = !get().lucidMode
    localStorage.setItem('lucidMode', next ? '1' : '0')
    set({ lucidMode: next })
  },
  setLucid: (val) => {
    localStorage.setItem('lucidMode', val ? '1' : '0')
    set({ lucidMode: !!val })
  }
}))

export const useSettingsModal = create((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))

export const useLibrary = create((set) => ({
  downloads: [],
  downloadedIds: new Set(),
  refresh: async () => {
    const downloads = await window.api.listDownloads()
    set({
      downloads,
      downloadedIds: new Set(downloads.map((d) => d.id))
    })
  }
}))

export const useLiked = create((set, get) => ({
  liked: [],
  likedIds: new Set(),
  refresh: async () => {
    const liked = await window.api.listLiked()
    set({ liked, likedIds: new Set(liked.map((t) => t.id)) })
  },
  toggle: async (track) => {
    if (get().likedIds.has(track.id)) await window.api.unlike(track.id)
    else await window.api.like(track)
    await get().refresh()
    await useSaved.getState().refresh()
  }
}))

export const usePlaylists = create((set) => ({
  playlists: [],
  refresh: async () => {
    const playlists = await window.api.listPlaylists()
    set({ playlists })
  },
  create: async (name) => {
    await window.api.createPlaylist(name)
    const playlists = await window.api.listPlaylists()
    set({ playlists })
  },
  remove: async (id) => {
    await window.api.deletePlaylist(id)
    const playlists = await window.api.listPlaylists()
    set({ playlists })
  },
  rename: async (id, name) => {
    await window.api.renamePlaylist(id, name)
    const playlists = await window.api.listPlaylists()
    set({ playlists })
  }
}))

export const useContextMenu = create((set) => ({
  menu: null,
  open: (x, y, track) => set({ menu: { x, y, track } }),
  close: () => set({ menu: null })
}))

// Navegación global (la registra App al iniciar)
export const useNav = create((set) => ({
  go: () => {},
  register: (fn) => set({ go: fn })
}))

// Reproducciones recientes (persistente en localStorage)
const RECENT_KEY = 'recentPlayed'
const recentInit = (() => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
})()

export const useRecent = create((set, get) => ({
  recent: recentInit,
  push: (track) => {
    if (!track?.id) return
    const list = get().recent.filter((t) => t.id !== track.id)
    const slim = {
      id: track.id,
      title: track.title,
      author: track.author || '',
      thumbnail: track.thumbnail || '',
      duration: track.duration || ''
    }
    list.unshift(slim)
    if (list.length > 30) list.length = 30
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    set({ recent: list })
  }
}))

// Cola y progreso de descargas
export const useDownloads = create((set, get) => ({
  active: {}, // id -> { id, title, author, thumbnail, percent, status, error }
  // Aplicar update desde main
  apply: (data) => {
    const prev = get().active[data.id] || {}
    set({ active: { ...get().active, [data.id]: { ...prev, ...data } } })
    if (data.status === 'done') {
      // auto-remover después de 4s
      setTimeout(() => {
        const cur = get().active[data.id]
        if (cur?.status === 'done') {
          const { [data.id]: _, ...rest } = get().active
          set({ active: rest })
        }
      }, 4000)
    }
  },
  dismiss: (id) => {
    const { [id]: _, ...rest } = get().active
    set({ active: rest })
  }
}))

// Modal de confirmación
export const useConfirmModal = create((set, get) => ({
  state: null,
  open: (opts) =>
    new Promise((resolve) => {
      set({
        state: {
          title: opts.title || '¿Estás seguro?',
          message: opts.message || '',
          confirmLabel: opts.confirmLabel || 'Eliminar',
          cancelLabel: opts.cancelLabel || 'Cancelar',
          danger: opts.danger !== false,
          resolve
        }
      })
    }),
  resolve: (ok) => {
    const s = get().state
    if (s) s.resolve(ok)
    set({ state: null })
  }
}))

// Modal de prompt (reemplazo de window.prompt que no funciona en Electron)
export const usePromptModal = create((set, get) => ({
  state: null,
  open: (opts) =>
    new Promise((resolve) => {
      set({ state: { title: opts.title || '', defaultValue: opts.defaultValue || '', resolve } })
    }),
  submit: (value) => {
    const s = get().state
    if (s) s.resolve(value)
    set({ state: null })
  },
  cancel: () => {
    const s = get().state
    if (s) s.resolve(null)
    set({ state: null })
  }
}))

// Set de IDs guardados (en me-gusta o en alguna playlist)
export const useSaved = create((set) => ({
  savedIds: new Set(),
  refresh: async () => {
    const [liked, plIds] = await Promise.all([
      window.api.getLikedIds(),
      window.api.getAllPlaylistTrackIds()
    ])
    set({ savedIds: new Set([...liked, ...plIds]) })
  }
}))
