import { useEffect, useState, useRef, useCallback } from 'react'
import {
  usePlayer,
  useLibrary,
  useLiked,
  usePlaylists,
  useContextMenu,
  usePromptModal,
  useConfirmModal,
  useSaved,
  useNav,
  useDownloads,
  useRecent,
  useSettings,
  useSettingsModal
} from './store.js'
import { Icon } from './icons.jsx'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 420
const PANEL_MIN = 260
const PANEL_MAX = 520

export default function App() {
  // Cada entrada guarda { view, q } para que back/forward restauren ambas cosas
  const [history, setHistory] = useState([
    { view: { type: 'home' }, q: '' }
  ])
  const [historyIdx, setHistoryIdx] = useState(0)
  const entry = history[historyIdx] || { view: { type: 'home' }, q: '' }
  const view = entry.view
  const q = entry.q
  const canBack = historyIdx > 0
  const canForward = historyIdx < history.length - 1

  function sameView(a, b) {
    return (
      a.type === b.type &&
      a.id === b.id &&
      a.artist?.id === b.artist?.id &&
      a.album?.id === b.album?.id
    )
  }

  function pushEntry(newEntry) {
    setHistory((h) => {
      const cur = h[historyIdx]
      if (
        cur &&
        sameView(cur.view, newEntry.view) &&
        cur.q === newEntry.q
      ) {
        return h
      }
      return [...h.slice(0, historyIdx + 1), newEntry]
    })
    setHistoryIdx((i) => {
      const cur = history[i]
      if (cur && sameView(cur.view, newEntry.view) && cur.q === newEntry.q) {
        return i
      }
      return i + 1
    })
  }

  // Actualiza el query del entry actual SIN crear nueva entrada en historial
  // (para que escribir letra por letra no spamée el historial)
  function setQ(newQ) {
    setHistory((h) => {
      const next = [...h]
      next[historyIdx] = { ...next[historyIdx], q: newQ }
      return next
    })
  }

  function setView(v) {
    pushEntry({ view: v, q: '' })
  }

  // Navegar con un query específico (ej: click en categoría de Explorar)
  function navigateWithQuery(q) {
    skipCommitResetRef.current = true
    setSearchCommitted(true)
    pushEntry({ view: { type: 'browse' }, q })
  }

  function back() {
    if (canBack) setHistoryIdx((i) => i - 1)
  }
  function forward() {
    if (canForward) setHistoryIdx((i) => i + 1)
  }

  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchCommitted, setSearchCommitted] = useState(false)
  const skipCommitResetRef = useRef(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [showPanel, setShowPanel] = useState(true)
  const [fullScreen, setFullScreen] = useState(false)
  const [miniOpen, setMiniOpen] = useState(false)
  const [sidebarW, setSidebarW] = useState(
    () => Number(localStorage.getItem('sidebarW')) || 256
  )
  const [panelW, setPanelW] = useState(
    () => Number(localStorage.getItem('panelW')) || 320
  )
  const reqIdRef = useRef(0)
  const refreshLiked = useLiked((s) => s.refresh)
  const refreshPlaylists = usePlaylists((s) => s.refresh)
  const refreshSaved = useSaved((s) => s.refresh)
  const refreshLib = useLibrary((s) => s.refresh)
  const refreshSettings = useSettings((s) => s.refresh)
  const current = usePlayer((s) => s.current)

  useEffect(() => { refreshSettings() }, [refreshSettings])

  useEffect(() => {
    localStorage.setItem('sidebarW', sidebarW)
  }, [sidebarW])
  useEffect(() => {
    localStorage.setItem('panelW', panelW)
  }, [panelW])

  // Extrae color dominante de la canción actual y lo guarda en el store.
  // Solo en modo Lucid: en modo normal mantenemos el ruby del sistema de diseño.
  const lucidMode = useSettings((s) => s.lucidMode)
  useEffect(() => {
    const setDom = usePlayer.getState().setDominantColor
    if (!lucidMode || !current?.thumbnail) { setDom(null); return }
    let cancelled = false
    extractDominantColor(current.thumbnail).then((c) => {
      if (!cancelled) setDom(c)
    })
    return () => { cancelled = true }
  }, [lucidMode, current?.thumbnail])

  // Expone el color dominante como CSS variable para selectores Lucid.
  const dominantColor = usePlayer((s) => s.dominantColor)
  useEffect(() => {
    document.documentElement.style.setProperty('--active-color', dominantColor || '#DC2659')
  }, [dominantColor])

  useEffect(() => {
    refreshSaved()
    refreshLib()
  }, [])

  // Estado abierto/cerrado del mini (para colorear el botón)
  useEffect(() => {
    window.api.isMiniOpen?.().then(setMiniOpen).catch(() => {})
    const off = window.api.onMiniClosed?.(() => setMiniOpen(false))
    return off
  }, [])

  // Comandos provenientes del mini player
  useEffect(() => {
    const off = window.api.onMiniCommand?.((msg) => {
      const p = usePlayer.getState()
      const { cmd, payload } = msg || {}
      if (cmd === 'togglePlay') p.togglePlay()
      else if (cmd === 'next') p.next()
      else if (cmd === 'prev') p.prev()
      else if (cmd === 'seek' && typeof payload === 'number') {
        const audio = document.querySelector('audio')
        if (audio) audio.currentTime = payload
      } else if (cmd === 'toggleLike' && p.current) {
        useLiked.getState().toggle(p.current)
      } else if (cmd === 'setVolume' && typeof payload === 'number') {
        p.setVolume(payload)
      } else if (cmd === 'toggleMute') {
        p.toggleMute()
      } else if (cmd === 'cycleRepeat') {
        p.cycleRepeat()
      }
    })
    return off
  }, [])

  // Listener de progreso de descargas
  useEffect(() => {
    const apply = useDownloads.getState().apply
    const off = window.api.onDownloadProgress(apply)
    return off
  }, [])

  // Listener de los botones de la miniatura de la barra de tareas
  useEffect(() => {
    const off = window.api.onThumbarAction((action) => {
      const p = usePlayer.getState()
      if (action === 'playpause') p.togglePlay()
      else if (action === 'next') p.next()
      else if (action === 'prev') p.prev()
      else if (action === 'like' && p.current) {
        useLiked.getState().toggle(p.current)
      }
    })
    return off
  }, [])

  useEffect(() => {
    refreshLiked()
    refreshPlaylists()
  }, [])

  // Resetea el "committed" al cambiar la query (excepto si la navegación lo forzó)
  useEffect(() => {
    if (skipCommitResetRef.current) {
      skipCommitResetRef.current = false
      return
    }
    setSearchCommitted(false)
  }, [q])

  // Búsqueda dinámica
  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setResults([])
      setSearching(false)
      return
    }
    const myReq = ++reqIdRef.current
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const r = await window.api.search(term)
        if (reqIdRef.current === myReq) {
          setResults(r)
          setSearching(false)
        }
      } catch {
        if (reqIdRef.current === myReq) setSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [q])

  function selectView(v) {
    setView(v)
    setQ('')
  }

  useEffect(() => {
    useNav.getState().register(selectView)
  }, [historyIdx, history])

  // Atajos: Alt+Izq/Der y botones laterales del mouse
  useEffect(() => {
    function onKey(e) {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        forward()
      }
    }
    function onMouseUp(e) {
      // button 3 = atrás, button 4 = adelante (botones laterales)
      if (e.button === 3) {
        e.preventDefault()
        back()
      } else if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }
    // Evita el menú/historial nativo de Electron al presionar los laterales
    function onMouseDown(e) {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [canBack, canForward])

  return (
    <div className={`h-full flex flex-col bg-warm-paper text-bone-100 overflow-hidden relative ${lucidMode ? 'lucid' : ''}`}>
      {lucidMode && current?.thumbnail && (
        <div
          className="lucid-bg absolute inset-0 pointer-events-none z-0"
          style={{ backgroundImage: `url(${current.thumbnail})` }}
        />
      )}
      <div className="grain absolute inset-0 pointer-events-none z-0" />
      <TopBar
        q={q}
        setQ={setQ}
        searching={searching}
        onBack={back}
        onForward={forward}
        canBack={canBack}
        canForward={canForward}
        onBrowse={() => selectView({ type: 'browse' })}
        onHome={() => selectView({ type: 'home' })}
        results={results}
        searchFocused={searchFocused}
        setSearchFocused={setSearchFocused}
        searchCommitted={searchCommitted}
        onCommitSearch={() => setSearchCommitted(true)}
        setView={setView}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden p-2">
        <Sidebar
          view={view}
          setView={selectView}
          width={sidebarW}
        />
        <Resizer
          onDrag={(dx) =>
            setSidebarW((w) =>
              Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w + dx))
            )
          }
        />
        <main className="flex-1 overflow-y-auto bg-carbon-900 rounded-xl border border-ruby-faint relative">
          {q.trim() && searchCommitted ? (
            <SearchResults results={results} setQ={setQ} setView={setView} />
          ) : view.type === 'liked' ? (
            <LikedView />
          ) : view.type === 'library' ? (
            <LibraryView />
          ) : view.type === 'playlist' ? (
            <PlaylistView playlistId={view.id} />
          ) : view.type === 'album' ? (
            <AlbumView album={view.album} />
          ) : view.type === 'artist' ? (
            <ArtistView artist={view.artist} setView={setView} />
          ) : view.type === 'browse' ? (
            <BrowseView onCategory={navigateWithQuery} />
          ) : view.type === 'home' ? (
            <HomeView setView={setView} />
          ) : null}
        </main>
        {showPanel && (
          <>
            <Resizer
              onDrag={(dx) =>
                setPanelW((w) =>
                  Math.max(PANEL_MIN, Math.min(PANEL_MAX, w - dx))
                )
              }
            />
            <NowPlayingPanel
              width={panelW}
              onClose={() => setShowPanel(false)}
              onExpand={() => setFullScreen(true)}
            />
          </>
        )}
      </div>
      <Player
        showPanel={showPanel}
        onTogglePanel={() => setShowPanel((v) => !v)}
        onToggleFullScreen={() => setFullScreen((v) => !v)}
        miniOpen={miniOpen}
        onToggleMini={async () => {
          if (miniOpen) {
            await window.api.closeMini?.()
            setMiniOpen(false)
          } else {
            await window.api.openMini?.()
            setMiniOpen(true)
          }
        }}
      />
      {fullScreen && <FullPlayer onClose={() => setFullScreen(false)} />}
      <ContextMenu />
      <PromptModal />
      <ConfirmModal />
      <SettingsModal />
      <DownloadsWidget />
    </div>
  )
}

// ---------------- DownloadsWidget ----------------

function DownloadsWidget() {
  const active = useDownloads((s) => s.active)
  const dismiss = useDownloads((s) => s.dismiss)
  const dominantColor = usePlayer((s) => s.dominantColor)
  const items = Object.values(active)
  if (items.length === 0) return null

  const activeColor = dominantColor || '#DC2659'
  const rgb = parseRgb(dominantColor) || [220, 38, 89]
  const tintStrong = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`
  const tintMid = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.18)`
  const tintSoft = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.40)`
  const tintFaint = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.22)`
  const activeCount = items.filter((d) => d.status !== 'done' && d.status !== 'error').length

  return (
    <div
      className="fixed bottom-24 right-4 z-40 w-96 rounded-xl overflow-hidden anim-up backdrop-blur-md border"
      style={{
        backgroundColor: 'rgba(22, 15, 12, 0.92)',
        borderColor: tintSoft,
        boxShadow: `0 24px 60px -20px ${tintStrong}, 0 12px 32px -12px rgba(0,0,0,0.7)`,
        transition: 'border-color 0.6s ease, box-shadow 0.6s ease'
      }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{
          background: `linear-gradient(135deg, ${tintMid}, ${tintFaint})`,
          borderBottom: `1px solid ${tintFaint}`,
          transition: 'background 0.6s ease, border-color 0.6s ease'
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: activeColor, transition: 'color 0.6s ease' }}>
            <Icon name="download" size={18} />
          </span>
          <div>
            <p className="font-display text-base font-bold leading-none">Descargas</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-bone-500 mt-1">
              {activeCount > 0
                ? `${activeCount} en curso · ${items.length} total`
                : `${items.length} ${items.length === 1 ? 'completada' : 'completadas'}`}
            </p>
          </div>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {items.map((d) => {
          const isError = d.status === 'error'
          const isDone = d.status === 'done'
          const isProc = d.status === 'finished' || d.status === 'post_processing'
          const fillColor = isError ? '#B91C1C' : isDone ? activeColor : '#FEF3C7'
          const label = isError
            ? 'Error'
            : isDone
            ? 'Listo'
            : isProc
            ? 'Procesando…'
            : `${Math.round(d.percent || 0)}%`
          return (
            <div
              key={d.id}
              className="px-4 py-3 border-b border-ruby-faint/60 last:border-0 hover:bg-carbon-800/40 transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                {d.thumbnail ? (
                  <img src={d.thumbnail} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-carbon-700 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">{d.title}</p>
                  <p className="truncate text-xs text-bone-400">{d.author}</p>
                </div>
                {(isDone || isError) ? (
                  <button
                    onClick={() => dismiss(d.id)}
                    className="text-bone-500 hover:text-bone-100 p-1 transition-colors"
                    title="Cerrar"
                  >
                    <Icon name="close" size={14} />
                  </button>
                ) : (
                  <span
                    className="w-7 h-7 rounded-full border flex items-center justify-center"
                    style={{ borderColor: tintSoft, transition: 'border-color 0.6s ease' }}
                  >
                    <span
                      className="w-3 h-3 rounded-full animate-pulse"
                      style={{ backgroundColor: activeColor, transition: 'background-color 0.6s ease' }}
                    />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: 'rgba(254, 243, 199, 0.15)' }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, d.percent || (isDone ? 100 : 0)))}%`,
                      backgroundColor: fillColor,
                      boxShadow: !isError && !isDone ? '0 0 8px rgba(254, 243, 199, 0.4)' : undefined
                    }}
                  />
                </div>
                <span
                  className="text-[11px] w-20 text-right tabular-nums font-semibold"
                  style={{
                    color: isError ? '#B91C1C' : isDone ? activeColor : '#C9B596',
                    transition: 'color 0.6s ease'
                  }}
                >
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------- ConfirmModal ----------------

function ModalBackdrop({ onClick, children }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-md anim-soft"
      onClick={onClick}
    >
      {children}
    </div>
  )
}

function ConfirmModal() {
  const { state, resolve } = useConfirmModal()
  const dominantColor = usePlayer((s) => s.dominantColor)
  if (!state) return null
  const activeColor = dominantColor || '#DC2659'
  const rgb = parseRgb(dominantColor) || [220, 38, 89]
  const tintStrong = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`
  const tintSoft = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`
  // En modo danger, mantenemos rojo "alerta" sólido, no el color dominante.
  const confirmBg = state.danger ? '#B91C1C' : activeColor
  const confirmShadow = state.danger ? 'rgba(185, 28, 28, 0.6)' : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.6)`
  return (
    <ModalBackdrop onClick={() => resolve(false)}>
      <div
        className="bg-carbon-900/95 rounded-xl p-7 w-[28rem] max-w-[90vw] anim-up border"
        style={{
          borderColor: tintSoft,
          boxShadow: `0 30px 80px -20px ${tintStrong}, 0 16px 40px -16px rgba(0,0,0,0.7)`,
          transition: 'border-color 0.6s ease, box-shadow 0.6s ease'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-2xl font-bold mb-2">{state.title}</h3>
        {state.message && (
          <p className="font-cormorant italic text-bone-400 text-base mb-6">{state.message}</p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => resolve(false)}
            className="px-5 py-2 text-bone-400 hover:text-bone-100 rounded-full transition-colors"
          >
            {state.cancelLabel}
          </button>
          <button
            autoFocus
            onClick={() => resolve(true)}
            className="px-5 py-2 rounded-full font-semibold text-bone-100 transition-all hover:scale-[1.03]"
            style={{
              backgroundColor: confirmBg,
              boxShadow: `0 8px 24px -8px ${confirmShadow}`
            }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ---------------- PromptModal ----------------

function PromptModal() {
  const { state, submit, cancel } = usePromptModal()
  const dominantColor = usePlayer((s) => s.dominantColor)
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (state) {
      setValue(state.defaultValue || '')
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [state])

  if (!state) return null

  const activeColor = dominantColor || '#DC2659'
  const rgb = parseRgb(dominantColor) || [220, 38, 89]
  const tintStrong = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`
  const tintSoft = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`
  const tintFaint = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.22)`

  return (
    <ModalBackdrop onClick={cancel}>
      <div
        className="bg-carbon-900/95 rounded-xl p-7 w-[28rem] max-w-[90vw] anim-up border"
        style={{
          borderColor: tintSoft,
          boxShadow: `0 30px 80px -20px ${tintStrong}, 0 16px 40px -16px rgba(0,0,0,0.7)`,
          transition: 'border-color 0.6s ease, box-shadow 0.6s ease'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-[0.2em] font-semibold mb-2" style={{ color: activeColor, transition: 'color 0.6s ease' }}>
          Nueva playlist
        </p>
        <h3 className="font-display text-2xl font-bold mb-5">{state.title}</h3>
        <input
          ref={inputRef}
          autoFocus
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(value.trim())
            if (e.key === 'Escape') cancel()
          }}
          placeholder="Mi nueva playlist"
          className="w-full border px-4 py-2.5 rounded-lg outline-none mb-6 transition-colors placeholder:text-bone-500"
          style={{ backgroundColor: 'rgba(22, 15, 12, 0.85)', color: '#FEF3C7', borderColor: tintFaint }}
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={cancel}
            className="px-5 py-2 text-bone-400 hover:text-bone-100 rounded-full transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => submit(value.trim())}
            className="px-5 py-2 rounded-full font-semibold text-bone-100 transition-all hover:scale-[1.03]"
            style={{
              backgroundColor: activeColor,
              boxShadow: `0 8px 24px -8px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.6)`
            }}
          >
            Crear
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ---------------- SettingsModal ----------------

function SettingsModal() {
  const open = useSettingsModal((s) => s.open)
  const hide = useSettingsModal((s) => s.hide)
  const lucidMode = useSettings((s) => s.lucidMode)
  const setLucid = useSettings((s) => s.setLucid)
  const musicDir = useSettings((s) => s.musicDir)
  const cookiesBrowser = useSettings((s) => s.cookiesBrowser)
  const setCookiesBrowser = useSettings((s) => s.setCookiesBrowser)
  const cookiesFile = useSettings((s) => s.cookiesFile)
  const setCookiesFile = useSettings((s) => s.setCookiesFile)
  const refreshSettings = useSettings((s) => s.refresh)
  const refreshLib = useLibrary((s) => s.refresh)
  const dominantColor = usePlayer((s) => s.dominantColor)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { kind: 'ok' | 'err', text }

  if (!open) return null

  const activeColor = dominantColor || '#DC2659'
  const rgb = parseRgb(dominantColor) || [220, 38, 89]
  const tintStrong = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`
  const tintSoft = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`
  const tintFaint = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.22)`

  async function pickDir() {
    if (busy) return
    setStatus(null)
    const chosen = await window.api.pickMusicDir()
    if (!chosen) return
    setBusy(true)
    try {
      const res = await window.api.setMusicDir(chosen)
      if (!res?.ok) {
        setStatus({ kind: 'err', text: res?.error || 'No se pudo cambiar la carpeta' })
      } else {
        await refreshSettings()
        await refreshLib()
        const parts = [`Movidas ${res.moved} canciones a la nueva carpeta`]
        if (res.failed?.length) {
          parts.push(`Fallaron ${res.failed.length} (siguen en la carpeta anterior)`)
        }
        setStatus({ kind: res.failed?.length ? 'err' : 'ok', text: parts.join('. ') })
      }
    } catch (err) {
      setStatus({ kind: 'err', text: err.message || 'Error inesperado' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop onClick={hide}>
      <div
        className="bg-carbon-900/95 rounded-xl p-7 w-[32rem] max-w-[92vw] anim-up border"
        style={{
          borderColor: tintSoft,
          boxShadow: `0 30px 80px -20px ${tintStrong}, 0 16px 40px -16px rgba(0,0,0,0.7)`,
          transition: 'border-color 0.6s ease, box-shadow 0.6s ease'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-[0.2em] font-semibold mb-2" style={{ color: activeColor }}>
          Preferencias
        </p>
        <h3 className="font-display text-2xl font-bold mb-6">Configuración</h3>

        {/* Tema */}
        <div className="mb-7">
          <p className="text-xs uppercase tracking-wider text-bone-400 mb-3">Tema</p>
          <div className="flex gap-2">
            {[
              { id: 'normal', label: 'Normal', active: !lucidMode },
              { id: 'lucid', label: 'Lucid', active: lucidMode }
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setLucid(opt.id === 'lucid')}
                className="px-4 py-2 rounded-full text-sm font-semibold transition-all"
                style={
                  opt.active
                    ? {
                        backgroundColor: activeColor,
                        color: '#FEF3C7',
                        boxShadow: `0 6px 18px -6px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`
                      }
                    : {
                        backgroundColor: 'rgba(22, 15, 12, 0.6)',
                        color: '#E7D9C6',
                        border: `1px solid ${tintFaint}`
                      }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-bone-500 mt-2 font-cormorant italic">
            Lucid tiñe la app con el color dominante de la portada.
          </p>
        </div>

        {/* Carpeta de descargas */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-bone-400 mb-3">Carpeta de descargas</p>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono break-all"
            style={{ backgroundColor: 'rgba(22, 15, 12, 0.85)', color: '#FEF3C7', border: `1px solid ${tintFaint}` }}
          >
            <span className="flex-1 break-all">{musicDir || '—'}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={pickDir}
              disabled={busy}
              className="px-4 py-2 rounded-full text-sm font-semibold transition-all disabled:opacity-50"
              style={{
                backgroundColor: activeColor,
                color: '#FEF3C7',
                boxShadow: `0 6px 18px -6px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`
              }}
            >
              {busy ? 'Moviendo…' : 'Elegir carpeta…'}
            </button>
            <button
              onClick={() => window.api.openMusicFolder()}
              disabled={busy}
              className="px-4 py-2 rounded-full text-sm transition-colors disabled:opacity-50"
              style={{ color: '#E7D9C6', border: `1px solid ${tintFaint}` }}
            >
              Abrir carpeta
            </button>
          </div>
          {status && (
            <p
              className="text-[12px] mt-3 font-cormorant italic"
              style={{ color: status.kind === 'ok' ? '#A7F3D0' : '#FCA5A5' }}
            >
              {status.text}
            </p>
          )}
          <p className="text-[12px] text-bone-500 mt-2 font-cormorant italic">
            Al cambiarla se mueven las descargas existentes a la nueva ubicación.
          </p>
        </div>

        {/* Cookies del navegador (para evitar 429 de YouTube) */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-bone-400 mb-3">Cookies del navegador</p>
          <select
            value={cookiesBrowser}
            onChange={(e) => setCookiesBrowser(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
            style={{ backgroundColor: 'rgba(22, 15, 12, 0.85)', color: '#FEF3C7', border: `1px solid ${tintFaint}` }}
          >
            <option value="none">Ninguno (anónimo)</option>
            <option value="chrome">Chrome</option>
            <option value="firefox">Firefox</option>
            <option value="edge">Edge</option>
            <option value="brave">Brave</option>
            <option value="opera">Opera</option>
            <option value="vivaldi">Vivaldi</option>
            <option value="chromium">Chromium</option>
          </select>
          <p className="text-[12px] text-bone-500 mt-2 font-cormorant italic">
            yt-dlp tomará las cookies del navegador elegido (debes estar logueado en YouTube allí).
            Si falla con "DPAPI" (Chromium en Windows), usa "Archivo cookies.txt" abajo.
          </p>
        </div>

        {/* Archivo cookies.txt (workaround para DPAPI en Chromium/Windows) */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-bone-400 mb-3">Archivo cookies.txt (opcional)</p>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono break-all"
            style={{ backgroundColor: 'rgba(22, 15, 12, 0.85)', color: '#FEF3C7', border: `1px solid ${tintFaint}` }}
          >
            <span className="flex-1 break-all">{cookiesFile || '— ninguno —'}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={async () => {
                const f = await window.api.pickCookiesFile()
                if (f) await setCookiesFile(f)
              }}
              className="px-4 py-2 rounded-full text-sm font-semibold transition-all"
              style={{
                backgroundColor: activeColor,
                color: '#FEF3C7',
                boxShadow: `0 6px 18px -6px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`
              }}
            >
              Elegir archivo…
            </button>
            {cookiesFile && (
              <button
                onClick={() => setCookiesFile('')}
                className="px-4 py-2 rounded-full text-sm transition-colors"
                style={{ color: '#E7D9C6', border: `1px solid ${tintFaint}` }}
              >
                Quitar
              </button>
            )}
          </div>
          <p className="text-[12px] text-bone-500 mt-2 font-cormorant italic">
            Si está definido, tiene prioridad sobre el navegador. Exporta el archivo con una extensión como
            "Get cookies.txt LOCALLY" (Chrome) o "cookies.txt" (Firefox) estando logueado en youtube.com.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={hide}
            className="px-5 py-2 rounded-full font-semibold text-bone-100 transition-all hover:scale-[1.03]"
            style={{
              backgroundColor: activeColor,
              boxShadow: `0 8px 24px -8px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.6)`
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// ---------------- Resizer ----------------

function Resizer({ onDrag }) {
  const dragging = useRef(false)
  const lastX = useRef(0)

  function onMouseDown(e) {
    dragging.current = true
    lastX.current = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev) => {
      if (!dragging.current) return
      const dx = ev.clientX - lastX.current
      lastX.current = ev.clientX
      onDrag(dx)
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-2 flex-shrink-0 cursor-col-resize group flex items-center justify-center"
    >
      <div className="w-px h-full bg-transparent group-hover:bg-carbon-700 transition-colors" />
    </div>
  )
}

// ---------------- AppMenu ----------------

function AppMenu() {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(null)
  const ref = useRef(null)
  const playlistsRefresh = usePlaylists((s) => s.refresh)

  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setSub(null)
      }
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [open])

  async function newPlaylist() {
    setOpen(false)
    setSub(null)
    const name = await usePromptModal
      .getState()
      .open({ title: 'Nombre de la playlist' })
    if (name?.trim()) {
      await window.api.createPlaylist(name.trim())
      await playlistsRefresh()
    }
  }

  const togglePlay = usePlayer((s) => s.togglePlay)
  const next = usePlayer((s) => s.next)
  const prev = usePlayer((s) => s.prev)

  const menus = {
    Archivo: [
      { label: 'Nueva playlist', onClick: newPlaylist },
      { label: 'Abrir carpeta de música', onClick: () => window.api.openMusicFolder() },
      { sep: true },
      { label: 'Salir', onClick: () => window.api.quit() }
    ],
    Editar: [
      { label: 'Cortar', onClick: () => document.execCommand('cut') },
      { label: 'Copiar', onClick: () => document.execCommand('copy') },
      { label: 'Pegar', onClick: () => document.execCommand('paste') },
      { label: 'Seleccionar todo', onClick: () => document.execCommand('selectAll') }
    ],
    Ver: [
      { label: 'Recargar', onClick: () => window.api.reload() },
      { label: 'Pantalla completa', onClick: () => window.api.toggleFullscreen() },
      { sep: true },
      { label: 'Configuración…', onClick: () => useSettingsModal.getState().show() },
      { sep: true },
      { label: 'Herramientas de desarrollador', onClick: () => window.api.toggleDevTools() }
    ],
    Reproducción: [
      { label: 'Reproducir / Pausar', onClick: togglePlay },
      { label: 'Siguiente', onClick: next },
      { label: 'Anterior', onClick: prev }
    ],
    Ayuda: [
      { label: 'Vinyl v0.1', onClick: () => {} }
    ]
  }

  function runItem(item) {
    item.onClick?.()
    setOpen(false)
    setSub(null)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title="Menú"
        className="w-8 h-8 rounded-full bg-black/40 hover:bg-carbon-800 flex items-center justify-center text-bone-100"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 bg-carbon-900 border border-ruby-faint rounded shadow-xl text-sm z-50 min-w-[180px] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {Object.keys(menus).map((name) => (
            <div
              key={name}
              onMouseEnter={() => setSub(name)}
              className="relative"
            >
              <button
                className={`w-full text-left px-3 py-2 flex items-center justify-between ${
                  sub === name ? 'bg-carbon-800' : 'hover:bg-carbon-800'
                }`}
              >
                <span>{name}</span>
                <span className="text-bone-500">›</span>
              </button>
              {sub === name && (
                <div className="absolute left-full top-0 ml-px bg-carbon-900 border border-ruby-faint rounded shadow-xl min-w-[220px] py-1">
                  {menus[name].map((item, i) =>
                    item.sep ? (
                      <div
                        key={i}
                        className="border-t border-ruby-faint my-1"
                      />
                    ) : (
                      <button
                        key={i}
                        onClick={() => runItem(item)}
                        className="w-full text-left px-3 py-2 hover:bg-carbon-800 truncate"
                      >
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- TopBar ----------------

function SearchDropdownItem({ track, allVideos }) {
  const savedIds = useSaved((s) => s.savedIds)
  const likedIds = useLiked((s) => s.likedIds)
  const toggleLike = useLiked((s) => s.toggle)
  const saved = savedIds.has(track.id) || likedIds.has(track.id)
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const playTrack = usePlayer((s) => s.playTrack)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const dominantColor = usePlayer((s) => s.dominantColor)
  const isCurrent = current?.id === track.id
  const showPauseIcon = isCurrent && isPlaying
  const activeColor = dominantColor || '#DC2659'

  function handlePlay(e) {
    e.stopPropagation()
    if (isCurrent) togglePlay()
    else playTrack(track, allVideos)
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2 hover:bg-carbon-700/70 group">
      <div
        onClick={handlePlay}
        className="relative w-10 h-10 flex-shrink-0 rounded overflow-hidden cursor-pointer"
      >
        {track.thumbnail ? (
          <img src={track.thumbnail} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-carbon-700" />
        )}
        <span
          className={`absolute inset-0 flex items-center justify-center bg-black/60 transition-opacity ${
            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <span className={`text-bone-100 ${showPauseIcon ? '' : 'ml-0.5'}`}>
            <Icon name={showPauseIcon ? 'pause' : 'play'} size={14} />
          </span>
        </span>
      </div>
      <div
        onClick={handlePlay}
        className="min-w-0 flex-1 cursor-pointer"
      >
        <p className={`text-sm truncate transition-colors ${isCurrent ? 'font-semibold' : ''}`} style={isCurrent ? { color: activeColor } : undefined}>{track.title}</p>
        <p className="text-xs text-bone-400 truncate">{track.author}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); toggleLike(track) }}
        title={saved ? 'Quitar de Me gusta' : 'Agregar a Me gusta'}
        className="flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center transition-colors"
        style={
          saved
            ? { borderColor: activeColor, backgroundColor: activeColor, color: '#FEF3C7', transition: 'background-color 0.6s ease, border-color 0.6s ease' }
            : { borderColor: 'rgba(159, 18, 57, 0.35)', color: '#C9B596' }
        }
      >
        {saved ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <Icon name="plus" size={14} />
        )}
      </button>
    </li>
  )
}

function TopBar({ q, setQ, searching, onBack, onForward, canBack, canForward, onBrowse, onHome, results, searchFocused, setSearchFocused, searchCommitted, onCommitSearch, setView }) {
  const showDropdown = !!q.trim() && searchFocused && !searchCommitted
  const topVideos = (results || []).filter((r) => r.type === 'video').slice(0, 6)
  const playTrack = usePlayer((s) => s.playTrack)
  const allVideos = (results || []).filter((r) => r.type === 'video')
  const dominantColor = usePlayer((s) => s.dominantColor)
  const activeColor = dominantColor || '#DC2659'
  // Toda la header es drag region; los elementos interactivos se marcan como no-drag
  return (
    <header
      className="h-16 flex-shrink-0 flex items-center px-3 bg-carbon-900 gap-3 py-2 border-b border-ruby-faint relative z-30"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div style={{ WebkitAppRegion: 'no-drag' }}>
          <AppMenu />
        </div>
        <button
          onClick={onBack}
          disabled={!canBack}
          title="Atrás (Alt+←)"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-7 h-7 rounded-full bg-black/40 hover:bg-carbon-800 flex items-center justify-center text-bone-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={onForward}
          disabled={!canForward}
          title="Adelante (Alt+→)"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-7 h-7 rounded-full bg-black/40 hover:bg-carbon-800 flex items-center justify-center text-bone-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        <button
          onClick={onHome}
          title="Inicio"
          className="search-input w-10 h-10 rounded-xl bg-carbon-800 hover:bg-carbon-700 flex items-center justify-center text-bone-100 border border-ruby-faint hover:border-ruby-soft transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3l9 8h-2v10h-5v-6h-4v6H5V11H3l9-8z" />
          </svg>
        </button>
      </div>
      <div
        className="search-input relative w-full max-w-lg flex items-center bg-carbon-800 hover:bg-carbon-700 focus-within:bg-carbon-700 transition-colors rounded-xl border border-ruby-faint hover:border-ruby-soft focus-within:border-ruby-soft"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        <span className="pl-4 pr-2 pointer-events-none flex items-center" style={{ color: activeColor, transition: 'color 0.6s ease' }}>
          <Icon name="search" size={20} />
        </span>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSearchFocused(true) }}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) onCommitSearch()
            if (e.key === 'Escape') {
              setQ('')
              setSearchFocused(false)
            }
          }}
          placeholder="¿Qué quieres reproducir?"
          className="flex-1 bg-transparent py-2.5 outline-none text-sm placeholder:text-bone-400"
        />
        {searching && (
          <span className="text-xs text-bone-400 pr-2 pointer-events-none">
            ...
          </span>
        )}
        {showDropdown && (
          <div
            className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-ruby-soft bg-carbon-900/95 backdrop-blur-md shadow-2xl overflow-hidden z-40 anim-soft"
            onMouseDown={(e) => e.preventDefault()}
          >
            {topVideos.length === 0 && !searching && (
              <p className="px-4 py-3 text-sm text-bone-400">Sin resultados.</p>
            )}
            {topVideos.length === 0 && searching && (
              <p className="px-4 py-3 text-sm text-bone-400">Buscando…</p>
            )}
            <ul className="max-h-96 overflow-y-auto">
              {topVideos.map((t) => (
                <SearchDropdownItem
                  key={t.id}
                  track={t}
                  allVideos={allVideos}
                />
              ))}
            </ul>
            {q.trim() && (
              <button
                onClick={() => { onCommitSearch(); setSearchFocused(false) }}
                className="w-full text-left px-4 py-2.5 text-sm border-t border-ruby-faint hover:bg-carbon-700/70 transition-colors flex items-center gap-2"
                style={{ color: activeColor, transition: 'color 0.6s ease' }}
              >
                <Icon name="search" size={14} />
                <span>Ver todos los resultados para "<span className="font-semibold">{q.trim()}</span>"</span>
              </button>
            )}
          </div>
        )}
        <div className="h-6 w-px bg-neutral-600 mx-1" />
        <button
          onClick={onBrowse}
          title="Explorar"
          className="px-3 py-2 text-bone-300 hover:text-bone-100"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <line x1="6" y1="18" x2="18" y2="6" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex items-center justify-end gap-1 min-w-0">
        <WindowControls />
      </div>
    </header>
  )
}

function WindowControls() {
  const [maxed, setMaxed] = useState(false)
  useEffect(() => {
    window.api.isMaximized().then(setMaxed)
    return window.api.onMaximizeChange(setMaxed)
  }, [])
  return (
    <div
      className="flex items-center"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <button
        onClick={() => window.api.minimize()}
        title="Minimizar"
        className="w-11 h-10 flex items-center justify-center text-bone-300 hover:bg-carbon-800"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="5.5" width="10" height="1" />
        </svg>
      </button>
      <button
        onClick={() => window.api.maximizeToggle()}
        title={maxed ? 'Restaurar' : 'Maximizar'}
        className="w-11 h-10 flex items-center justify-center text-bone-300 hover:bg-carbon-800"
      >
        {maxed ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2.5" y="0.5" width="9" height="9" />
            <rect x="0.5" y="2.5" width="9" height="9" fill="#000" />
            <rect x="0.5" y="2.5" width="9" height="9" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="11" height="11" />
          </svg>
        )}
      </button>
      <button
        onClick={() => window.api.closeWindow()}
        title="Cerrar"
        className="w-11 h-10 flex items-center justify-center text-bone-300 hover:bg-red-600 hover:text-bone-100"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="1" y1="1" x2="11" y2="11" />
          <line x1="11" y1="1" x2="1" y2="11" />
        </svg>
      </button>
    </div>
  )
}

// ---------------- Sidebar ----------------

function Sidebar({ view, setView, width }) {
  const { playlists, create, remove } = usePlaylists()

  async function newPlaylist() {
    const name = await usePromptModal
      .getState()
      .open({ title: 'Nombre de la playlist' })
    if (name?.trim()) await create(name.trim())
  }

  async function deletePl(e, p) {
    e.stopPropagation()
    const ok = await useConfirmModal.getState().open({
      title: `¿Eliminar la playlist "${p.name}"?`,
      message: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar'
    })
    if (ok) await remove(p.id)
  }

  const fixed = [
    {
      id: 'liked',
      label: 'Me gusta',
      icon: 'heart',
      filled: true,
      gradient:
        'radial-gradient(circle at 30% 20%, #F472B6 0%, #E84A78 25%, #DC2659 55%, #6B0C2A 100%)'
    },
    {
      id: 'library',
      label: 'Descargas',
      icon: 'download',
      gradient:
        'radial-gradient(circle at 30% 20%, #C9B596 0%, #876F58 35%, #4A372C 70%, #1C1410 100%)'
    }
  ]

  return (
    <aside
      style={{ width }}
      className="bg-carbon-900 rounded-xl p-4 flex flex-col flex-shrink-0 border border-ruby-faint"
    >
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2.5 text-bone-200 min-w-0">
          <Icon name="library" size={18} className="text-ruby-500 flex-shrink-0" />
          <span className="font-display italic text-[14px] tracking-wide whitespace-nowrap">Tu biblioteca</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => useSettingsModal.getState().show()}
            className="text-bone-400 hover:text-bone-100 p-1 rounded-full hover:bg-carbon-800"
            title="Configuración"
          >
            <Icon name="settings" size={17} />
          </button>
          <button
            onClick={newPlaylist}
            className="text-bone-400 hover:text-bone-100 p-1 rounded-full hover:bg-carbon-800"
            title="Crear playlist"
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
      </div>

      <div className="space-y-1 mb-2">
        {fixed.map((i) => {
          const active = view.type === i.id
          return (
            <button
              key={i.id}
              onClick={() => setView({ type: i.id })}
              className={`sidebar-item w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-all border border-transparent ${
                active
                  ? 'sidebar-item-active bg-carbon-800/80 text-bone-100'
                  : 'text-bone-200 hover:bg-carbon-800/60'
              }`}
            >
              <span
                className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ background: i.gradient }}
              >
                <Icon name={i.icon} size={16} filled={!!i.filled} className="text-bone-100" />
              </span>
              <span className="text-sm">{i.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 my-3 px-1">
        <div className="flex-1 ruby-rule-tight" />
        <span className="text-[9px] uppercase tracking-[0.28em] text-ruby-500 font-medium">Playlists</span>
        <div className="flex-1 ruby-rule-tight" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {playlists.length === 0 && (
          <p className="px-3 text-sm text-bone-500">
            No tienes playlists. Crea una con el botón +.
          </p>
        )}
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => setView({ type: 'playlist', id: p.id })}
            className={`sidebar-item group w-full text-left px-2 py-2 rounded-lg flex items-center gap-3 border border-transparent transition-all ${
              view.type === 'playlist' && view.id === p.id
                ? 'sidebar-item-active bg-carbon-800/80'
                : 'hover:bg-carbon-800/60'
            }`}
          >
            <PlaylistCover covers={p.covers} />
            <div className="flex-1 min-w-0">
              <p className="truncate">{p.name}</p>
              <p className="text-xs text-bone-500">Playlist</p>
            </div>
            <span
              onClick={(e) => deletePl(e, p)}
              className="opacity-0 group-hover:opacity-100 text-bone-400 hover:text-red-400 ml-1 flex-shrink-0"
              title="Eliminar"
            >
              <Icon name="close" size={14} />
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

// ---------------- PlaylistCover ----------------

function PlaylistCover({ covers = [], size = 48 }) {
  const style = { width: size, height: size }
  if (!covers || covers.length === 0) {
    return (
      <div
        style={style}
        className="rounded bg-carbon-800 flex-shrink-0 flex items-center justify-center text-bone-600"
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    )
  }
  if (covers.length === 1) {
    return (
      <img
        src={covers[0]}
        style={style}
        className="rounded object-cover flex-shrink-0"
      />
    )
  }
  // 2x2 collage; si hay menos de 4, repite las disponibles
  const filled = []
  for (let i = 0; i < 4; i++) filled.push(covers[i % covers.length])
  return (
    <div
      style={style}
      className="rounded overflow-hidden grid grid-cols-2 grid-rows-2 flex-shrink-0"
    >
      {filled.map((c, i) => (
        <img key={i} src={c} className="w-full h-full object-cover" />
      ))}
    </div>
  )
}

// ---------------- TrackRow ----------------

function ArtistLink({ author, className = '' }) {
  if (!author) return <span className={className}>—</span>
  function go(e) {
    e.stopPropagation()
    useNav.getState().go({
      type: 'artist',
      artist: { id: null, title: author, thumbnail: '' }
    })
  }
  return (
    <button
      onClick={go}
      title={`Ir al artista ${author}`}
      className={'text-left ' + className}
    >
      {author}
    </button>
  )
}

function LikeButton({ track }) {
  const likedIds = useLiked((s) => s.likedIds)
  const toggle = useLiked((s) => s.toggle)
  const dominantColor = usePlayer((s) => s.dominantColor)
  const isLiked = likedIds.has(track.id)
  const activeColor = dominantColor || '#DC2659'
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggle(track)
      }}
      title={isLiked ? 'Quitar de Me gusta' : 'Agregar a Me gusta'}
      className="p-2 rounded transition-colors"
      style={{ color: isLiked ? activeColor : undefined, transition: 'color 0.6s ease' }}
    >
      <span className={isLiked ? '' : 'text-bone-400 hover:text-bone-100'}>
        <Icon name="heart" size={18} filled={isLiked} />
      </span>
    </button>
  )
}

function TrackRow({ track, onPlay, onPrefetch, loading, extra }) {
  const openMenu = useContextMenu((s) => s.open)
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const dominantColor = usePlayer((s) => s.dominantColor)
  const isCurrent = current?.id === track.id
  const isThisPlaying = isCurrent && isPlaying
  const activeColor = dominantColor || '#DC2659'

  function handlePlay() {
    if (loading) return
    if (isCurrent) togglePlay()
    else onPlay()
  }

  return (
    <li
      onMouseEnter={onPrefetch}
      onClick={handlePlay}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e.clientX, e.clientY, track)
      }}
      className="group flex items-center gap-3 p-2 hover:bg-carbon-800 rounded select-none cursor-pointer"
    >
      {track.thumbnail && (
        <div className="relative w-12 h-12 flex-shrink-0">
          <img src={track.thumbnail} className="w-full h-full rounded object-cover" />
          <span
            className={`absolute inset-0 rounded flex items-center justify-center transition-opacity ${
              isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          >
            <span className="text-bone-100">
              {loading ? (
                <span className="text-xs">...</span>
              ) : (
                <Icon name={isThisPlaying ? 'pause' : 'play'} size={18} />
              )}
            </span>
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="truncate transition-colors" style={isCurrent ? { color: activeColor } : undefined}>{track.title}</p>
        <ArtistLink
          author={track.author}
          className="text-sm text-bone-400 truncate hover:underline hover:text-bone-100"
        />
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <LikeButton track={track} />
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        {extra}
      </div>
    </li>
  )
}

function usePlayCtl(queue) {
  const playTrack = usePlayer((s) => s.playTrack)
  const prefetched = useRef(new Set())
  const [loadingId, setLoadingId] = useState(null)

  const prefetch = useCallback((id) => {
    if (prefetched.current.has(id)) return
    prefetched.current.add(id)
    window.api.getStreamUrl(id).catch(() => prefetched.current.delete(id))
  }, [])

  const play = useCallback(
    async (track, idx) => {
      setLoadingId(track.id)
      try {
        await playTrack(track, queue, idx)
      } finally {
        setLoadingId(null)
      }
    },
    [playTrack, queue]
  )

  return { play, prefetch, loadingId }
}

// ---------------- Vistas ----------------

// ---------------- Duration helpers ----------------

function parseDurationToSeconds(d) {
  if (d == null || d === '') return 0
  if (typeof d === 'number') return Math.floor(d)
  const parts = String(d).split(':').map((n) => parseInt(n, 10))
  if (parts.some(isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function formatDurationShort(d) {
  const s = parseDurationToSeconds(d)
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

function formatTotalDuration(tracks) {
  const total = tracks.reduce((acc, t) => acc + parseDurationToSeconds(t.duration), 0)
  if (!total) return ''
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

// ---------------- Banner component ----------------

async function downloadAllTracks(tracks) {
  for (const t of tracks) {
    try {
      await window.api.download(t)
    } catch {
      // el evento de progreso ya marcó el error
    }
  }
}

function parseRgb(str) {
  if (!str) return null
  const m = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!m) return null
  return [+m[1], +m[2], +m[3]]
}

function luminance([r, g, b]) {
  // Aproximación de luminancia perceptual (0..1)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function ViewBanner({ gradient, icon, title, subtitle, eyebrow, tagline, location, tracks, onPlayAll, onDownloadAll, coverImage }) {
  const totalDur = formatTotalDuration(tracks)
  const lucid = useSettings((s) => s.lucidMode)
  const currentThumb = usePlayer((s) => s.current?.thumbnail)
  const dominantFromPlayer = usePlayer((s) => s.dominantColor)
  const dynamicSource = currentThumb || coverImage
  const [domFallback, setDomFallback] = useState(null)

  // Si la canción actual ya tiene color extraído en el store, lo usamos.
  // Si no (banner sin canción reproduciéndose), extraemos del coverImage del propio banner.
  useEffect(() => {
    if (!lucid || currentThumb || !coverImage) { setDomFallback(null); return }
    let cancelled = false
    extractDominantColor(coverImage).then((c) => {
      if (!cancelled) setDomFallback(c)
    })
    return () => { cancelled = true }
  }, [lucid, currentThumb, coverImage])

  const dom = lucid ? (currentThumb ? dominantFromPlayer : domFallback) : null

  const rgb = parseRgb(dom)
  const lum = rgb ? luminance(rgb) : 0
  const useDarkText = lum > 0.62
  const textColor = useDarkText ? '#1C1410' : '#FEF3C7'
  const subTextColor = useDarkText ? 'rgba(28, 20, 16, 0.78)' : 'rgba(254, 243, 199, 0.82)'
  const subTextDim = useDarkText ? 'rgba(28, 20, 16, 0.60)' : 'rgba(254, 243, 199, 0.65)'

  const effectiveBg = lucid && dom
    ? `linear-gradient(135deg, ${dom} 0%, rgba(0,0,0,0.55) 100%)`
    : gradient

  return (
    <div>
      {/* Banner header */}
      <div
        className="relative px-8 py-10 rounded-xl m-4 mb-2 border overflow-hidden"
        style={{
          background: effectiveBg,
          borderColor: rgb
            ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`
            : 'rgba(159, 18, 57, 0.35)',
          boxShadow: rgb
            ? `0 20px 60px -20px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`
            : '0 20px 60px -20px rgba(159, 18, 57, 0.45)',
          transition: 'background 0.8s ease, border-color 0.6s ease, box-shadow 0.6s ease'
        }}
      >
        {lucid && dynamicSource && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${dynamicSource})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(40px) saturate(140%) brightness(0.85)',
              opacity: 0.45,
              transform: 'scale(1.3)',
              transition: 'background-image 0.6s ease'
            }}
          />
        )}
        <div className="grain absolute inset-0 pointer-events-none" />
        <div className="flex items-center gap-8 relative">
          {/* Icon / Cover */}
          <div
            className="w-44 h-44 rounded-lg flex items-center justify-center flex-shrink-0 border border-bone-100/15"
            style={{
              background: 'linear-gradient(135deg, rgba(0,0,0,0.25), rgba(0,0,0,0.05))',
              boxShadow: '0 16px 40px -12px rgba(0,0,0,0.5)'
            }}
          >
            {icon}
          </div>
          {/* Info */}
          <div className="min-w-0 flex-1" style={{ transition: 'color 0.6s ease', color: textColor }}>
            <p className="text-[11px] uppercase tracking-[0.25em] font-semibold mb-3" style={{ color: subTextColor }}>{eyebrow || 'Playlist'}</p>
            <h1 className="font-display text-6xl font-bold mb-4 truncate tracking-tight" style={{ color: textColor }}>{title}</h1>
            {tagline && (
              <p className="font-cormorant italic text-lg mb-4" style={{ color: subTextColor }}>{tagline}</p>
            )}
            <div className="flex items-center gap-2 text-[12px]" style={{ color: subTextDim }}>
              {location && <><span>{location}</span><span className="opacity-50">·</span></>}
              <span>{subtitle}</span>
              {totalDur && <><span className="opacity-50">·</span><span>{totalDur}</span></>}
            </div>
          </div>
        </div>
      </div>

      {/* Action bar with gradient fade */}
      <div
        className="px-6 py-4 flex items-center gap-4"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), transparent)'
        }}
      >
        <button
          onClick={onPlayAll}
          disabled={tracks.length === 0}
          className="w-14 h-14 bg-ruby-800 hover:bg-cherry-600 hover:scale-105 rounded-full flex items-center justify-center text-bone-100 shadow-ruby-lg transition-all disabled:opacity-40 disabled:hover:scale-100"
        >
          <Icon name="play" size={24} />
        </button>
        {onDownloadAll && (
          <button
            onClick={onDownloadAll}
            disabled={tracks.length === 0}
            className="text-bone-300 hover:text-bone-100 hover:scale-110 transition-all disabled:opacity-40"
            title="Descargar toda la playlist"
          >
            <Icon name="download" size={28} />
          </button>
        )}
      </div>
    </div>
  )
}

function SearchResults({ results, setQ, setView }) {
  const refreshLib = useLibrary((s) => s.refresh)
  const downloadedIds = useLibrary((s) => s.downloadedIds)
  const [downloading, setDownloading] = useState({})

  const videos = results.filter((r) => r.type === 'video')
  const artists = results.filter((r) => r.type === 'artist').slice(0, 6)
  const albums = results.filter((r) => r.type === 'album').slice(0, 6)

  const { play, prefetch, loadingId } = usePlayCtl(videos)

  async function download(track) {
    setDownloading((d) => ({ ...d, [track.id]: true }))
    try {
      await window.api.download(track)
      refreshLib()
    } finally {
      setDownloading((d) => ({ ...d, [track.id]: false }))
    }
  }

  return (
    <div className="p-6 space-y-8">
      {results.length === 0 && (
        <p className="text-bone-400">Escribe algo para buscar.</p>
      )}

      {artists.length > 0 && (
        <section>
          <h3 className="text-xl font-bold mb-3">Artistas</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {artists.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setQ('')
                  setView({ type: 'artist', artist: a })
                }}
                className="bg-carbon-800/50 hover:bg-carbon-800 p-4 rounded-lg text-left transition-colors"
              >
                {a.thumbnail ? (
                  <img
                    src={a.thumbnail}
                    className="w-full aspect-square rounded-full object-cover mb-3"
                  />
                ) : (
                  <div className="w-full aspect-square rounded-full bg-carbon-700 mb-3" />
                )}
                <p className="truncate font-semibold text-sm">{a.title}</p>
                <p className="text-xs text-bone-400">Artista</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section>
          <h3 className="text-xl font-bold mb-3">Álbumes y playlists</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {albums.map((a) => (
              <button
                key={a.id}
                onClick={() => setView({ type: 'album', album: a })}
                className="bg-carbon-800/50 hover:bg-carbon-800 p-4 rounded-lg text-left transition-colors"
              >
                {a.thumbnail ? (
                  <img
                    src={a.thumbnail}
                    className="w-full aspect-square rounded object-cover mb-3"
                  />
                ) : (
                  <div className="w-full aspect-square rounded bg-carbon-700 mb-3" />
                )}
                <p className="truncate font-semibold text-sm">{a.title}</p>
                <p className="truncate text-xs text-bone-400">
                  {a.author || 'Álbum'}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section>
          <h3 className="text-xl font-bold mb-3">Canciones</h3>
          <ul className="space-y-2">
            {videos.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                onPlay={() => play(t, i)}
                onPrefetch={() => prefetch(t.id)}
                loading={loadingId === t.id}
                extra={
                  downloadedIds.has(t.id) ? (
                    <span
                      className="p-2 text-cherry-500"
                      title="Ya descargada"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  ) : (
                    <button
                      onClick={() => download(t)}
                      disabled={downloading[t.id]}
                      className="p-2 text-bone-400 hover:text-bone-100 disabled:opacity-50"
                      title="Descargar"
                    >
                      <Icon name="download" size={18} />
                    </button>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ---------------- Vista de álbum ----------------

function AlbumView({ album }) {
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)
  const { play, prefetch, loadingId } = usePlayCtl(tracks)
  const playTrack = usePlayer((s) => s.playTrack)

  useEffect(() => {
    if (!album?.id) return
    setLoading(true)
    setTracks([])
    window.api
      .getPlaylistVideos(album.id)
      .then(setTracks)
      .catch(() => setTracks([]))
      .finally(() => setLoading(false))
  }, [album?.id])

  async function playAll() {
    if (tracks.length === 0) return
    await playTrack(tracks[0], tracks, 0)
  }

  const hue =
    (album?.title || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) %
    360

  return (
    <div>
      <ViewBanner
        gradient={`linear-gradient(135deg, hsl(${hue}, 50%, 25%) 0%, hsl(${hue}, 60%, 35%) 40%, hsl(${hue}, 45%, 20%) 100%)`}
        icon={
          album?.thumbnail ? (
            <img
              src={album.thumbnail}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <Icon name="library" size={80} className="text-bone-100" />
          )
        }
        title={album?.title || 'Álbum'}
        subtitle={`${tracks.length} cancion${tracks.length !== 1 ? 'es' : ''}${album?.author ? ' · ' + album.author : ''}`}
        tracks={tracks}
        coverImage={album?.thumbnail || tracks[0]?.thumbnail}
        onPlayAll={playAll}
        onDownloadAll={() => downloadAllTracks(tracks)}
      />
      <div className="px-2 pb-6">
        {loading && (
          <p className="text-bone-400 px-4">Cargando canciones...</p>
        )}
        {!loading && tracks.length === 0 && (
          <p className="text-bone-400 px-4">No se pudieron cargar las canciones.</p>
        )}
        {tracks.length > 0 && (
          <>
            <TrackTableHeader showDate={false} />
            <div className="mt-1">
              {tracks.map((t, i) => (
                <TableTrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  onPlay={() => play(t, i)}
                  onPrefetch={() => prefetch(t.id)}
                  loading={loadingId === t.id}
                  showDate={false}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------- Vista Inicio ----------------

function QuickTile({ cover, label, sublabel, onClick, onPlay }) {
  return (
    <button
      onClick={onClick}
      className="quick-tile group relative flex items-center gap-3 hover:bg-carbon-800/60 rounded-lg overflow-hidden transition-all text-left border border-ruby-faint hover:border-ruby-soft"
      style={{ backgroundColor: 'rgba(42, 31, 26, 0.55)' }}
    >
      <div className="w-14 h-14 flex-shrink-0 overflow-hidden">
        {cover}
      </div>
      <div className="min-w-0 flex-1 pr-12">
        <p className="font-semibold truncate text-bone-100 text-sm">{label}</p>
        <p className="text-[10px] uppercase tracking-wider text-bone-500 truncate">{sublabel}</p>
      </div>
      {onPlay && (
        <span
          onClick={(e) => { e.stopPropagation(); onPlay() }}
          className="quick-tile-play absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: '#DC2659', boxShadow: '0 8px 24px -8px rgba(220, 38, 89, 0.7)' }}
        >
          <span className="text-bone-100 ml-0.5">
            <Icon name="play" size={14} />
          </span>
        </span>
      )}
    </button>
  )
}

function RecentCard({ track, onPlay }) {
  return (
    <div
      onClick={() => onPlay()}
      className="recent-card group relative hover:bg-carbon-800/60 p-3 rounded-lg cursor-pointer transition-all border border-ruby-faint hover:border-ruby-soft"
      style={{ backgroundColor: 'rgba(42, 31, 26, 0.55)' }}
    >
      <div className="relative mb-3">
        {track.thumbnail ? (
          <img src={track.thumbnail} className="w-full aspect-square rounded object-cover" />
        ) : (
          <div className="w-full aspect-square rounded bg-carbon-700" />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onPlay() }}
          className="recent-card-play absolute bottom-2 right-2 w-11 h-11 rounded-full flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all"
          style={{ backgroundColor: '#DC2659', boxShadow: '0 8px 24px -8px rgba(220, 38, 89, 0.7)' }}
        >
          <span className="text-bone-100 ml-0.5"><Icon name="play" size={18} /></span>
        </button>
      </div>
      <p className="truncate text-sm font-semibold">{track.title}</p>
      <p className="truncate text-xs text-bone-400">{track.author}</p>
    </div>
  )
}

function HomeView({ setView }) {
  const { liked } = useLiked()
  const { playlists } = usePlaylists()
  const { downloads } = useLibrary()
  const { recent } = useRecent()
  const playTrack = usePlayer((s) => s.playTrack)

  const now = new Date()
  const h = now.getHours()
  const greeting = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
  const days = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
  const dateLabel = `${days[now.getDay()]}, ${now.getDate()} DE ${months[now.getMonth()]}`

  const tiles = []
  tiles.push({
    label: 'Me gusta',
    sublabel: `${liked.length} CANCION${liked.length !== 1 ? 'ES' : ''}`,
    cover: (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #9F1239 0%, #DC2659 100%)' }}
      >
        <Icon name="heart" size={28} className="text-bone-100" filled />
      </div>
    ),
    onClick: () => setView({ type: 'liked' }),
    onPlay: liked.length > 0 ? () => playTrack(liked[0], liked, 0) : null
  })
  if (downloads.length > 0) {
    tiles.push({
      label: 'Descargas',
      sublabel: `${downloads.length} CANCION${downloads.length !== 1 ? 'ES' : ''}`,
      cover: (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #2A1F1A 0%, #4A372C 100%)' }}
        >
          <Icon name="download" size={26} className="text-bone-300" />
        </div>
      ),
      onClick: () => setView({ type: 'library' }),
      onPlay: downloads.length > 0 ? () => playTrack(downloads[0], downloads, 0) : null
    })
  }
  for (const p of playlists.slice(0, 6)) {
    tiles.push({
      label: p.name,
      sublabel: 'PLAYLIST',
      cover: <PlaylistCover covers={p.covers} size={64} />,
      onClick: () => setView({ type: 'playlist', id: p.id }),
      onPlay: p.tracks && p.tracks.length > 0 ? () => playTrack(p.tracks[0], p.tracks, 0) : null
    })
  }

  return (
    <div className="p-4 md:p-6 xl:p-8 space-y-8">
      <header className="anim-soft">
        <p className="text-[11px] tracking-[0.2em] font-semibold mb-3" style={{ color: '#DC2659' }}>{dateLabel}</p>
        <h2 className="font-display text-4xl md:text-5xl xl:text-6xl font-bold leading-none">
          {greeting}<span style={{ color: '#DC2659' }}>.</span>
        </h2>
        <p className="font-cormorant italic text-bone-400 text-base md:text-lg mt-2">Tu colección, sin prisa.</p>
      </header>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {tiles.map((t, i) => (
          <QuickTile key={i} {...t} />
        ))}
      </div>

      {recent.length > 0 && (
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h3 className="font-display text-2xl font-bold">Reproducido recientemente</h3>
              <p className="font-cormorant italic text-bone-500 text-sm">Lo que sonó esta semana</p>
            </div>
          </div>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {recent.slice(0, 12).map((t) => (
              <RecentCard
                key={t.id}
                track={t}
                onPlay={() => playTrack(t, recent.slice(0, 12))}
              />
            ))}
          </div>
        </section>
      )}

      {playlists.length > 0 && (
        <section>
          <h3 className="font-display text-2xl font-bold mb-4">Tus playlists</h3>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {playlists.map((p) => (
              <div
                key={p.id}
                onClick={() => setView({ type: 'playlist', id: p.id })}
                className="recent-card group hover:bg-carbon-800/60 p-3 rounded-lg cursor-pointer transition-all border border-ruby-faint hover:border-ruby-soft"
                style={{ backgroundColor: 'rgba(42, 31, 26, 0.55)' }}
              >
                <div className="mb-3">
                  <PlaylistCover covers={p.covers} size={140} />
                </div>
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="truncate text-xs text-bone-400">Playlist</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {liked.length > 0 && (
        <section>
          <h3 className="font-display text-2xl font-bold mb-4">Canciones que te gustan</h3>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {liked.slice(0, 12).map((t) => (
              <RecentCard
                key={t.id}
                track={t}
                onPlay={() => playTrack(t, liked)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------- Vista Explorar ----------------

const BROWSE_CATEGORIES = [
  { name: 'Música', color: '#dc2566', query: 'top música 2026' },
  { name: 'Nuevos lanzamientos', color: '#8d67ab', query: 'nuevos lanzamientos 2026' },
  { name: 'Reggaetón', color: '#e8125c', query: 'reggaeton hits 2026' },
  { name: 'Latina', color: '#0d72ea', query: 'música latina' },
  { name: 'Pop', color: '#148a08', query: 'pop hits' },
  { name: 'Rock', color: '#e1118c', query: 'rock clásico' },
  { name: 'Hip Hop', color: '#bc5900', query: 'hip hop' },
  { name: 'Trap latino', color: '#1e3264', query: 'trap latino' },
  { name: 'Salsa', color: '#d84000', query: 'salsa clásica' },
  { name: 'Bachata', color: '#b49bc8', query: 'bachata' },
  { name: 'Cumbia', color: '#477d95', query: 'cumbia' },
  { name: 'Electrónica', color: '#0f7363', query: 'electronic dance music' },
  { name: 'R&B', color: '#8c1932', query: 'rnb soul' },
  { name: 'Indie', color: '#608108', query: 'indie rock' },
  { name: 'Clásica', color: '#7d4b32', query: 'música clásica' },
  { name: 'Jazz', color: '#777777', query: 'smooth jazz' },
  { name: 'Para entrenar', color: '#1e3264', query: 'workout music' },
  { name: 'Para estudiar', color: '#503750', query: 'lofi study music' },
  { name: 'Para dormir', color: '#574bff', query: 'relaxing sleep music' },
  { name: 'Romántica', color: '#dc148c', query: 'baladas románticas' },
  { name: 'En tendencia', color: '#1db954', query: 'tendencias 2026' },
  { name: 'Banda', color: '#a56752', query: 'música de banda' },
  { name: 'K-Pop', color: '#27856a', query: 'kpop hits' },
  { name: 'Anime', color: '#8d67ab', query: 'anime openings' }
]

function BrowseView({ onCategory }) {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="ruby-rule-tight flex-1 max-w-[60px]" />
        <span className="text-[10px] uppercase tracking-[0.3em] text-ruby-500 font-medium">Explorar</span>
        <div className="ruby-rule-tight flex-1" />
      </div>
      <h2 className="font-display italic text-4xl text-bone-100 mb-1">Todos los géneros</h2>
      <p className="font-cormorant italic text-bone-400 mb-8">
        Elige un género para descubrir música y artistas.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {BROWSE_CATEGORIES.map((c) => (
          <button
            key={c.name}
            onClick={() => onCategory(c.query)}
            className="browse-tile group relative overflow-hidden rounded-lg aspect-[5/4] p-4 text-left border border-ruby-faint hover:border-ruby-500/60 transition-all hover:scale-[1.02]"
            style={{ '--tile-accent': c.color }}
          >
            <span className="browse-tile-glow absolute inset-0 opacity-40 group-hover:opacity-60 transition-opacity pointer-events-none" />
            <span className="font-display italic text-[17px] leading-tight relative z-10 text-bone-100 block">
              {c.name}
            </span>
            <span
              className="absolute right-3 bottom-3 w-3 h-3 rounded-full opacity-70 group-hover:opacity-100 transition-opacity"
              style={{
                background: 'var(--tile-accent)',
                boxShadow: '0 0 12px var(--tile-accent)'
              }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------- Vista de artista ----------------

function ArtistView({ artist, setView }) {
  const [data, setData] = useState({ tracks: [], albums: [] })
  const [loading, setLoading] = useState(true)
  const { play, prefetch, loadingId } = usePlayCtl(data.tracks)
  const playTrack = usePlayer((s) => s.playTrack)

  useEffect(() => {
    if (!artist) return
    setLoading(true)
    setData({ tracks: [], albums: [] })
    window.api
      .getArtistData({ channelId: artist.id, name: artist.title })
      .then(setData)
      .catch(() => setData({ tracks: [], albums: [] }))
      .finally(() => setLoading(false))
  }, [artist?.id])

  async function playAll() {
    if (data.tracks.length === 0) return
    await playTrack(data.tracks[0], data.tracks, 0)
  }

  // Probamos primero una versión más grande; si falla, caemos a la original
  const baseThumb = artist?.thumbnail || data.thumbnail || ''
  const bigThumb = baseThumb.replace(/=s\d+/, '=s480')

  return (
    <div>
      <div
        className="relative px-8 pt-16 pb-8 rounded-t-lg"
        style={{
          background:
            'linear-gradient(180deg, #525252 0%, #2a2a2a 100%)'
        }}
      >
        <div className="flex items-end gap-6">
          {baseThumb ? (
            <img
              src={bigThumb}
              onError={(e) => {
                if (e.currentTarget.src !== baseThumb) {
                  e.currentTarget.src = baseThumb
                }
              }}
              className="w-48 h-48 rounded-full object-cover shadow-2xl flex-shrink-0 bg-carbon-800"
            />
          ) : (
            <div className="w-48 h-48 rounded-full bg-carbon-800 shadow-2xl flex-shrink-0 flex items-center justify-center text-bone-600">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
          )}
          <div className="min-w-0 pb-2">
            <p className="text-xs uppercase tracking-widest text-bone-100/70 mb-2">
              Artista
            </p>
            <h1 className="text-6xl font-extrabold mb-3 drop-shadow-lg">
              {artist?.title}
            </h1>
            {artist?.subscribers && (
              <p className="text-sm text-bone-100/80">{artist.subscribers}</p>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        <button
          onClick={playAll}
          disabled={data.tracks.length === 0}
          className="w-14 h-14 bg-ruby-800 hover:bg-cherry-600 hover:scale-105 rounded-full flex items-center justify-center text-bone-100 shadow-ruby-lg transition-all disabled:opacity-40"
        >
          <Icon name="play" size={24} />
        </button>
      </div>

      <div className="px-6 pb-6 space-y-8">
        {loading && (
          <p className="text-bone-400">Cargando...</p>
        )}

        {!loading && data.tracks.length > 0 && (
          <section>
            <h3 className="text-2xl font-bold mb-3">Populares</h3>
            <div>
              {data.tracks.slice(0, 5).map((t, i) => (
                <ArtistTrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  onPlay={() => play(t, i)}
                  onPrefetch={() => prefetch(t.id)}
                  loading={loadingId === t.id}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && data.albums.length > 0 && (
          <section>
            <h3 className="text-2xl font-bold mb-3">Discografía</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {data.albums.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setView({ type: 'album', album: a })}
                  className="bg-carbon-800/50 hover:bg-carbon-800 p-4 rounded-lg text-left transition-colors"
                >
                  {a.thumbnail ? (
                    <img
                      src={a.thumbnail}
                      className="w-full aspect-square rounded object-cover mb-3"
                    />
                  ) : (
                    <div className="w-full aspect-square rounded bg-carbon-700 mb-3" />
                  )}
                  <p className="truncate font-semibold text-sm">{a.title}</p>
                  <p className="truncate text-xs text-bone-400">Álbum</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {!loading && data.tracks.length === 0 && data.albums.length === 0 && (
          <p className="text-bone-400">
            No se encontró información del artista.
          </p>
        )}
      </div>
    </div>
  )
}

function ArtistTrackRow({ track, index, onPlay, onPrefetch, loading }) {
  const openMenu = useContextMenu((s) => s.open)
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const isCurrent = current?.id === track.id
  const isThisPlaying = isCurrent && isPlaying

  function handleClick() {
    if (isCurrent) togglePlay()
    else onPlay()
  }

  return (
    <div
      onMouseEnter={onPrefetch}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e.clientX, e.clientY, track)
      }}
      className="group grid items-center gap-4 px-4 py-2 rounded hover:bg-white/10 select-none"
      style={{ gridTemplateColumns: '40px 60px 1fr 80px 60px' }}
    >
      <div className="flex items-center justify-center">
        {isThisPlaying ? (
          <button onClick={handleClick} className="text-bone-100">
            <Icon name="pause" size={14} />
          </button>
        ) : (
          <>
            <span
              className={`text-sm group-hover:hidden ${
                isCurrent ? 'text-cherry-500' : 'text-bone-400'
              }`}
            >
              {loading ? '...' : index + 1}
            </span>
            <button
              onClick={handleClick}
              disabled={loading}
              className="hidden group-hover:flex text-bone-100 disabled:opacity-50"
            >
              <Icon name="play" size={14} />
            </button>
          </>
        )}
      </div>

      {track.thumbnail && (
        <img
          src={track.thumbnail}
          className="w-12 h-12 rounded object-cover"
        />
      )}

      <div className="min-w-0">
        <p
          className={`truncate text-sm ${
            isCurrent ? 'text-cherry-500' : ''
          }`}
        >
          {track.title}
        </p>
      </div>

      <span className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-center">
        <LikeButton track={track} />
      </span>

      <span className="text-sm text-bone-400 text-right tabular-nums">
        {formatDurationShort(track.duration)}
      </span>
    </div>
  )
}

// ---------------- Table-style track components ----------------

function formatDateAdded(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  const diffWeeks = Math.floor(diffDays / 7)

  if (diffMin < 1) return 'justo ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffHrs < 24) return `hace ${diffHrs} hora${diffHrs !== 1 ? 's' : ''}`
  if (diffDays < 7) return `hace ${diffDays} día${diffDays !== 1 ? 's' : ''}`
  if (diffWeeks < 5) return `hace ${diffWeeks} semana${diffWeeks !== 1 ? 's' : ''}`

  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

function TrackTableHeader({ showDate = true }) {
  return (
    <div className="grid items-center gap-4 px-4 py-2 border-b border-ruby-faint text-xs uppercase tracking-wider text-bone-400"
      style={{ gridTemplateColumns: showDate ? '40px 1fr 1fr 140px 80px' : '40px 1fr 1fr 80px' }}
    >
      <span className="text-center">#</span>
      <span>Título</span>
      <span className="hidden md:block">Álbum</span>
      {showDate && <span>Fecha</span>}
      <span className="flex justify-end pr-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </span>
    </div>
  )
}

function TableTrackRow({ track, index, onPlay, onPrefetch, loading, extra, showDate = true }) {
  const openMenu = useContextMenu((s) => s.open)
  const current = usePlayer((s) => s.current)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const dominantColor = usePlayer((s) => s.dominantColor)
  const isCurrent = current?.id === track.id
  const isThisPlaying = isCurrent && isPlaying
  const activeColor = dominantColor || '#DC2659'

  function handleClick() {
    if (isCurrent) togglePlay()
    else onPlay()
  }

  return (
    <div
      onMouseEnter={onPrefetch}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e.clientX, e.clientY, track)
      }}
      className={`group grid items-center gap-4 px-4 py-2 rounded hover:bg-white/10 select-none transition-colors ${isCurrent ? 'bg-white/5' : ''}`}
      style={{ gridTemplateColumns: showDate ? '40px 1fr 1fr 140px 80px' : '40px 1fr 1fr 80px' }}
    >
      {/* Number / Play / Pause / EQ */}
      <div className="flex items-center justify-center">
        {isThisPlaying ? (
          <>
            <span className="bar-eq group-hover:hidden" style={{ color: activeColor }}>
              <span /><span /><span /><span />
            </span>
            <button
              onClick={handleClick}
              className="hidden group-hover:flex items-center justify-center text-bone-100"
              title="Pausar"
            >
              <Icon name="pause" size={14} />
            </button>
          </>
        ) : (
          <>
            <span
              className="text-sm group-hover:hidden"
              style={{ color: isCurrent ? activeColor : undefined }}
            >
              {loading ? '...' : index + 1}
            </span>
            <button
              onClick={handleClick}
              disabled={loading}
              className="hidden group-hover:flex items-center justify-center text-bone-100 disabled:opacity-50"
              title={isCurrent ? 'Reanudar' : 'Reproducir'}
            >
              {loading ? (
                <span className="text-xs">...</span>
              ) : (
                <Icon name="play" size={14} />
              )}
            </button>
          </>
        )}
      </div>

      {/* Title + thumbnail + artist */}
      <div className="flex items-center gap-3 min-w-0">
        {track.thumbnail && (
          <img src={track.thumbnail} className="w-10 h-10 rounded object-cover flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm transition-colors" style={{ color: isCurrent ? activeColor : undefined }}>{track.title}</p>
          <ArtistLink author={track.author} className="truncate text-xs text-bone-400 hover:underline hover:text-bone-100" />
        </div>
      </div>

      {/* Álbum (usamos autor como proxy ya que YT no expone álbumes) */}
      <ArtistLink
        author={track.author}
        className="truncate text-sm text-bone-400 hover:underline hover:text-bone-100 hidden md:block"
      />

      {/* Date added */}
      {showDate && (
        <span className="text-sm text-bone-400 truncate">
          {formatDateAdded(track.added_at || track.liked_at)}
        </span>
      )}

      {/* Duration + actions */}
      <div className="flex items-center justify-end gap-1">
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          <LikeButton track={track} />
        </span>
        <span className="text-sm text-bone-400 w-14 text-right tabular-nums">
          {formatDurationShort(track.duration)}
        </span>
        {extra && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            {extra}
          </span>
        )}
      </div>
    </div>
  )
}

function LikedView() {
  const { liked, refresh } = useLiked()
  const { play, prefetch, loadingId } = usePlayCtl(liked)
  const playTrack = usePlayer((s) => s.playTrack)

  useEffect(() => {
    refresh()
  }, [])

  async function playAll() {
    if (liked.length === 0) return
    await playTrack(liked[0], liked, 0)
  }

  return (
    <div>
      <ViewBanner
        gradient="linear-gradient(135deg, #4A0820 0%, #6B0C2A 35%, #9F1239 70%, #1C1410 100%)"
        icon={<Icon name="heart" size={80} className="text-bone-100" filled />}
        title="Tus Me Gusta"
        eyebrow="COLECCIÓN"
        tagline="Las que volverás a oír. Una caja roja con tus piezas favoritas."
        subtitle={`${liked.length} cancion${liked.length !== 1 ? 'es' : ''}`}
        location="Tu biblioteca"
        tracks={liked}
        coverImage={liked[0]?.thumbnail}
        onPlayAll={playAll}
        onDownloadAll={() => downloadAllTracks(liked)}
      />
      <div className="px-2 pb-6">
        {liked.length === 0 && (
          <p className="text-bone-400 px-4">
            Aún no le has dado me gusta a ninguna canción.
          </p>
        )}
        {liked.length > 0 && (
          <>
            <TrackTableHeader showDate={true} />
            <div className="mt-1">
              {liked.map((t, i) => (
                <TableTrackRow
                  key={t.id}
                  track={{ ...t, added_at: t.liked_at }}
                  index={i}
                  onPlay={() => play(t, i)}
                  onPrefetch={() => prefetch(t.id)}
                  loading={loadingId === t.id}
                  showDate={true}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LibraryView() {
  const { downloads, refresh } = useLibrary()
  const playTrack = usePlayer((s) => s.playTrack)
  const [loadingId, setLoadingId] = useState(null)

  useEffect(() => {
    refresh()
  }, [])

  async function play(track, idx) {
    setLoadingId(track.id)
    try {
      const queue = downloads.map((d) => ({ ...d, localPath: d.file_path }))
      await playTrack(
        { ...track, localPath: track.file_path },
        queue,
        idx
      )
    } finally {
      setLoadingId(null)
    }
  }

  async function playAll() {
    if (downloads.length === 0) return
    const queue = downloads.map((d) => ({ ...d, localPath: d.file_path }))
    await playTrack(
      { ...downloads[0], localPath: downloads[0].file_path },
      queue,
      0
    )
  }

  async function remove(track) {
    const ok = await useConfirmModal.getState().open({
      title: `¿Eliminar "${track.title}"?`,
      message: 'Se borrará el archivo de tu disco.',
      confirmLabel: 'Eliminar'
    })
    if (!ok) return
    await window.api.deleteDownload(track.id)
    refresh()
  }

  return (
    <div>
      <ViewBanner
        gradient="linear-gradient(135deg, #2A1F1A 0%, #3A2A22 35%, #4A372C 70%, #1C1410 100%)"
        icon={<Icon name="download" size={80} className="text-bone-100" />}
        title="Descargas"
        eyebrow="TU DISCO"
        tagline="Lo que vive en tu computadora. Para los días sin internet."
        location="Local"
        subtitle={`${downloads.length} cancion${downloads.length !== 1 ? 'es' : ''}`}
        tracks={downloads}
        coverImage={downloads[0]?.thumbnail}
        onPlayAll={playAll}
      />
      <div className="px-2 pb-6">
        {downloads.length === 0 && (
          <p className="text-bone-400 px-4">No tienes nada descargado todavía.</p>
        )}
        {downloads.length > 0 && (
          <>
            <TrackTableHeader showDate={true} />
            <div className="mt-1">
              {downloads.map((t, i) => (
                <TableTrackRow
                  key={t.id}
                  track={{ ...t, added_at: t.downloaded_at }}
                  index={i}
                  onPlay={() => play(t, i)}
                  loading={loadingId === t.id}
                  showDate={true}
                  extra={
                    <button
                      onClick={() => remove(t)}
                      className="p-1 text-bone-400 hover:text-red-500"
                      title="Eliminar"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PlaylistView({ playlistId }) {
  const playlists = usePlaylists((s) => s.playlists)
  const rename = usePlaylists((s) => s.rename)
  const playlist = playlists.find((p) => p.id === playlistId)
  const [tracks, setTracks] = useState([])
  const { play, prefetch, loadingId } = usePlayCtl(tracks)
  const playTrack = usePlayer((s) => s.playTrack)

  // Generate a consistent gradient color based on playlist name
  const hue = (playlist?.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360

  async function refresh() {
    if (!playlistId) return
    setTracks(await window.api.getPlaylistTracks(playlistId))
  }

  useEffect(() => {
    refresh()
  }, [playlistId])

  async function removeTrack(track) {
    await window.api.removeFromPlaylist(playlistId, track.id)
    refresh()
    await Promise.all([
      useSaved.getState().refresh(),
      usePlaylists.getState().refresh()
    ])
  }

  async function doRename() {
    const name = await usePromptModal.getState().open({
      title: 'Nuevo nombre de la playlist',
      defaultValue: playlist?.name || ''
    })
    if (name?.trim()) await rename(playlistId, name.trim())
  }

  async function playAll() {
    if (tracks.length === 0) return
    await playTrack(tracks[0], tracks, 0)
  }

  return (
    <div>
      <ViewBanner
        gradient={`linear-gradient(135deg, hsl(${hue}, 50%, 25%) 0%, hsl(${hue}, 60%, 35%) 40%, hsl(${hue}, 45%, 20%) 100%)`}
        icon={
          tracks.length > 0 ? (
            <div className="w-full h-full overflow-hidden rounded-lg">
              <PlaylistCover
                covers={tracks
                  .map((t) => t.thumbnail)
                  .filter(Boolean)
                  .slice(0, 4)}
                size={192}
              />
            </div>
          ) : (
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-bone-100">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" fill="currentColor" />
              <circle cx="18" cy="16" r="3" fill="currentColor" />
            </svg>
          )
        }
        title={playlist?.name || 'Playlist'}
        subtitle={`${tracks.length} cancion${tracks.length !== 1 ? 'es' : ''}`}
        tracks={tracks}
        coverImage={tracks[0]?.thumbnail}
        onPlayAll={playAll}
        onDownloadAll={() => downloadAllTracks(tracks)}
      />
      <div className="px-2 pb-6">
        <div className="flex items-center gap-3 mb-2 px-4">
          <button
            onClick={doRename}
            className="text-sm text-bone-400 hover:text-bone-100 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            <span>Renombrar</span>
          </button>
        </div>
        {tracks.length === 0 && (
          <p className="text-bone-400 px-4">
            Esta playlist está vacía. Click derecho sobre una canción para
            agregarla.
          </p>
        )}
        {tracks.length > 0 && (
          <>
            <TrackTableHeader showDate={true} />
            <div className="mt-1">
              {tracks.map((t, i) => (
                <TableTrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  onPlay={() => play(t, i)}
                  onPrefetch={() => prefetch(t.id)}
                  loading={loadingId === t.id}
                  showDate={true}
                  extra={
                    <button
                      onClick={() => removeTrack(t)}
                      className="p-1 text-bone-400 hover:text-red-500"
                      title="Quitar de la playlist"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------- Saved indicator ----------------

function SavedIndicator({ track }) {
  const savedIds = useSaved((s) => s.savedIds)
  const openMenu = useContextMenu((s) => s.open)
  const dominantColor = usePlayer((s) => s.dominantColor)
  const saved = savedIds.has(track.id)
  const activeColor = dominantColor || '#DC2659'

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    openMenu(rect.left - 200, rect.bottom + 4, track)
  }

  return (
    <button
      onClick={handleClick}
      title={saved ? 'Guardado' : 'Agregar a playlist'}
      className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
        saved
          ? ''
          : 'border-neutral-500 text-bone-300 hover:border-white hover:text-bone-100'
      }`}
      style={
        saved
          ? { borderColor: activeColor, backgroundColor: activeColor, color: '#FEF3C7', transition: 'background-color 0.6s ease, border-color 0.6s ease' }
          : undefined
      }
    >
      {saved ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <Icon name="plus" size={16} />
      )}
    </button>
  )
}

// ---------------- Panel derecho (Now Playing) ----------------

function NowPlayingPanel({ onClose, onExpand, width }) {
  const current = usePlayer((s) => s.current)
  const playTrack = usePlayer((s) => s.playTrack)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(false)
  const lastArtistRef = useRef(null)

  useEffect(() => {
    if (!current?.author) {
      setRelated([])
      return
    }
    if (lastArtistRef.current === current.author) return
    lastArtistRef.current = current.author
    setLoading(true)
    window.api
      .search(current.author)
      .then((r) => {
        const filtered = r
          .filter((t) => t.id !== current.id)
          .slice(0, 6)
        setRelated(filtered)
      })
      .catch(() => setRelated([]))
      .finally(() => setLoading(false))
  }, [current?.author, current?.id])

  async function playRelated(track, idx) {
    await playTrack(track, related, idx)
  }

  if (!current) {
    return (
      <aside
        style={{ width }}
        className="glass-warm rounded-xl overflow-y-auto flex-shrink-0 flex flex-col"
      >
        <div className="flex items-center justify-between p-4">
          <h3 className="font-semibold text-bone-300">En reproducción</h3>
          <button
            onClick={onClose}
            className="text-bone-400 hover:text-bone-100 p-1"
            title="Cerrar"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="text-bone-500 text-sm">
            Selecciona una canción para ver su información aquí.
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside
      style={{ width }}
      className="glass-warm rounded-xl overflow-y-auto flex-shrink-0"
    >
      <div className="flex items-center justify-between p-4 sticky top-0 glass-warm z-10 gap-2 border-b border-ruby-faint">
        <h3 className="font-semibold truncate flex-1 min-w-0">{current.title}</h3>
        <button
          onClick={onExpand}
          className="text-bone-400 hover:text-bone-100 p-1 flex-shrink-0"
          title="Ver en grande"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="text-bone-400 hover:text-bone-100 p-1 flex-shrink-0"
          title="Cerrar"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="px-4">
        {current.thumbnail && (
          <img
            src={current.thumbnail}
            className="w-full aspect-square rounded-lg object-cover mb-4"
          />
        )}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold mb-1 truncate">
              {current.title}
            </h2>
            <ArtistLink
              author={current.author}
              className="text-bone-400 truncate hover:underline hover:text-bone-100"
            />
          </div>
          <SavedIndicator track={current} />
        </div>

        <div className="border-t border-ruby-faint pt-4">
          <h4 className="text-sm uppercase tracking-wider text-bone-500 mb-3">
            Más de {current.author || 'este artista'}
          </h4>
          {loading && (
            <p className="text-sm text-bone-500">Cargando...</p>
          )}
          {!loading && related.length === 0 && (
            <p className="text-sm text-bone-500">
              Sin canciones relacionadas.
            </p>
          )}
          <ul className="space-y-2">
            {related.map((t, i) => (
              <li
                key={t.id}
                onClick={() => playRelated(t, i)}
                className="flex items-center gap-3 p-2 hover:bg-carbon-800 rounded cursor-pointer"
              >
                {t.thumbnail && (
                  <img
                    src={t.thumbnail}
                    className="w-10 h-10 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.title}</p>
                  <ArtistLink
                    author={t.author}
                    className="truncate text-xs text-bone-400 hover:underline hover:text-bone-100"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="h-6" />
    </aside>
  )
}

// ---------------- Menú contextual ----------------

function ContextMenu() {
  const { menu, close } = useContextMenu()
  const { playlists, create, refresh } = usePlaylists()
  const downloadedIds = useLibrary((s) => s.downloadedIds)
  const [submenu, setSubmenu] = useState(false)
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [subDir, setSubDir] = useState('right')

  useEffect(() => {
    if (!menu) return
    // Calcular posición para que no se salga de la pantalla
    const menuW = 220
    const menuH = 40
    let nx = menu.x
    let ny = menu.y
    if (nx + menuW > window.innerWidth) nx = window.innerWidth - menuW - 8
    if (ny + menuH > window.innerHeight) ny = window.innerHeight - menuH - 8
    if (nx < 0) nx = 8
    if (ny < 0) ny = 8
    setPos({ x: nx, y: ny })
    // Determinar si el submenú abre a la derecha o izquierda
    setSubDir(nx + menuW + 210 > window.innerWidth ? 'left' : 'right')
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const handler = (e) => {
      // Don't close if clicking inside the menu itself
      if (menuRef.current && menuRef.current.contains(e.target)) return
      close()
    }
    // Use mousedown so it fires for both left and right clicks
    // Use setTimeout to avoid catching the same event that opened the menu
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handler, true)
    }, 0)
    return () => {
      clearTimeout(timerId)
      document.removeEventListener('mousedown', handler, true)
    }
  }, [menu, close])

  useEffect(() => {
    if (!menu) setSubmenu(false)
  }, [menu])

  if (!menu) return null
  const { track } = menu

  async function addTo(playlistId) {
    await window.api.addToPlaylist(playlistId, track)
    await Promise.all([
      useSaved.getState().refresh(),
      usePlaylists.getState().refresh()
    ])
    close()
  }

  async function newAndAdd() {
    close()
    const name = await usePromptModal
      .getState()
      .open({ title: 'Nombre de la nueva playlist' })
    if (!name?.trim()) return
    await create(name.trim())
    const fresh = await window.api.listPlaylists()
    const newest = fresh[0]
    if (newest) await window.api.addToPlaylist(newest.id, track)
    await refresh()
    await useSaved.getState().refresh()
  }

  async function doDownload() {
    close()
    try {
      await window.api.download(track)
      await useLibrary.getState().refresh()
    } catch {
      // el widget de descargas ya muestra el error
    }
  }

  function doLikeToggle() {
    close()
    useLiked.getState().toggle(track)
  }

  const subMenuStyle = subDir === 'right'
    ? { left: '100%', top: 0, marginLeft: 1 }
    : { right: '100%', top: 0, marginRight: 1 }

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 bg-carbon-900 border border-ruby-faint rounded shadow-lg text-sm min-w-[200px]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="py-1">
        <button
          onClick={doLikeToggle}
          className="w-full text-left px-3 py-2 hover:bg-carbon-800 flex items-center gap-2"
        >
          <Icon
            name="heart"
            size={14}
            filled={useLiked.getState().likedIds.has(track.id)}
          />
          <span>
            {useLiked.getState().likedIds.has(track.id)
              ? 'Quitar de Me gusta'
              : 'Agregar a Me gusta'}
          </span>
        </button>

        <div
          onMouseEnter={() => setSubmenu(true)}
          onMouseLeave={() => setSubmenu(false)}
          className="relative"
        >
          <button
            onClick={() => setSubmenu((v) => !v)}
            className="w-full text-left px-3 py-2 hover:bg-carbon-800 flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <Icon name="plus" size={14} /> Agregar a playlist
            </span>
            <span className="text-bone-500">
              {subDir === 'right' ? '›' : '‹'}
            </span>
          </button>
          {submenu && (
            <div
              className="absolute bg-carbon-900 border border-ruby-faint rounded shadow-lg min-w-[200px] max-h-72 overflow-y-auto"
              style={subMenuStyle}
            >
              <button
                onClick={newAndAdd}
                className="w-full text-left px-3 py-2 hover:bg-carbon-800 text-cherry-500 flex items-center gap-2"
              >
                <Icon name="plus" size={14} /> Nueva playlist...
              </button>
              {playlists.length > 0 && (
                <div className="border-t border-ruby-faint" />
              )}
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addTo(p.id)}
                  className="w-full text-left px-3 py-2 hover:bg-carbon-800 truncate"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {!downloadedIds.has(track.id) && (
          <>
            <div className="border-t border-ruby-faint my-1" />
            <button
              onClick={doDownload}
              className="w-full text-left px-3 py-2 hover:bg-carbon-800 flex items-center gap-2"
            >
              <Icon name="download" size={14} />
              <span>Descargar</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------- FullPlayer ----------------

function extractDominantColor(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        const s = 40
        c.width = s
        c.height = s
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, s, s)
        const data = ctx.getImageData(0, 0, s, s).data
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < data.length; i += 4) {
          // Ignorar píxeles muy oscuros o muy claros para sacar un color "vivo"
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (lum < 20 || lum > 240) continue
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
        if (n === 0) return resolve(null)
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function FullPlayer({ onClose }) {
  const current = usePlayer((s) => s.current)
  const [bg, setBg] = useState('#1f1f1f')
  const [isFs, setIsFs] = useState(false)

  useEffect(() => {
    window.api.isFullscreen?.().then(setIsFs).catch(() => {})
    const off = window.api.onFullscreenChange?.(setIsFs)
    return off
  }, [])

  useEffect(() => {
    if (!current?.thumbnail) {
      setBg('#1f1f1f')
      return
    }
    extractDominantColor(current.thumbnail).then((c) => {
      setBg(c || '#1f1f1f')
    })
  }, [current?.thumbnail])

  useEffect(() => {
    async function onKey(e) {
      if (e.key === 'Escape') {
        if (isFs) {
          try { await window.api.toggleFullscreen?.() } catch {}
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, isFs])

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{
        background: `linear-gradient(180deg, ${bg} 0%, #0a0a0a 100%)`,
        paddingBottom: 80 // espacio para el player de abajo
      }}
    >
      <div className="flex items-center justify-between p-4">
        <p className="font-semibold truncate max-w-md">{current.title}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => window.api.toggleFullscreen?.()}
            title={isFs ? 'Salir de pantalla completa (F11)' : 'Pantalla completa (F11)'}
            className="text-bone-100/80 hover:text-bone-100 p-2"
          >
            {isFs ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v4H4" />
                <path d="M16 3v4h4" />
                <path d="M8 21v-4H4" />
                <path d="M16 21v-4h4" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V3h4" />
                <path d="M21 7V3h-4" />
                <path d="M3 17v4h4" />
                <path d="M21 17v4h-4" />
              </svg>
            )}
          </button>
          <button
            onClick={async () => {
              if (isFs) {
                try { await window.api.toggleFullscreen?.() } catch {}
              }
              onClose()
            }}
            title="Minimizar"
            className="text-bone-100/80 hover:text-bone-100 p-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {current.thumbnail && (
          <img
            src={current.thumbnail}
            className="max-w-[55vh] max-h-[55vh] aspect-square object-cover rounded-2xl shadow-2xl"
          />
        )}
        <div className="mt-8 text-center max-w-2xl">
          <h1 className="text-4xl font-extrabold truncate">{current.title}</h1>
          <div className="text-lg text-bone-100/70 mt-2">
            <ArtistLink
              author={current.author}
              className="hover:underline hover:text-bone-100"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------- Player ----------------

function VolumeSlider({ value, onChange }) {
  const ref = useRef(null)
  const [dragging, setDragging] = useState(false)

  function handle(e) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onChange(pct)
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e) => handle(e)
    const up = () => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging])

  const pct = `${value * 100}%`
  return (
    <div
      ref={ref}
      onMouseDown={(e) => { setDragging(true); handle(e) }}
      className="progress-bar w-28 cursor-pointer group relative flex items-center"
    >
      <div
        className="progress-track w-full rounded-full overflow-hidden relative"
        style={{ backgroundColor: 'rgba(254, 243, 199, 0.35)', height: '5px' }}
      >
        <div
          className="progress-fill rounded-full"
          style={{ height: '100%', width: pct, backgroundColor: '#FEF3C7' }}
        />
      </div>
      <span
        className="progress-thumb absolute top-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 pointer-events-none"
        style={{
          left: pct,
          backgroundColor: '#FEF3C7',
          boxShadow: '0 2px 6px rgba(0,0,0,0.6)'
        }}
      />
    </div>
  )
}

function Player({ showPanel, onTogglePanel, onToggleFullScreen, miniOpen, onToggleMini }) {
  const {
    current,
    isPlaying,
    repeatMode,
    volume,
    muted,
    restartTick,
    togglePlay,
    next,
    prev,
    handleEnded,
    cycleRepeat,
    setVolume,
    toggleMute
  } = usePlayer()
  const dominantColor = usePlayer((s) => s.dominantColor)
  const activeColor = dominantColor || '#DC2659'
  const activeRgb = parseRgb(dominantColor) || [220, 38, 89]
  const shadowStrong = `rgba(${activeRgb[0]}, ${activeRgb[1]}, ${activeRgb[2]}, 0.7)`
  const shadowSoft = `rgba(${activeRgb[0]}, ${activeRgb[1]}, ${activeRgb[2]}, 0.4)`
  const audioRef = useRef(null)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const likedIds = useLiked((s) => s.likedIds)
  const isLiked = !!current && likedIds.has(current.id)

  // Sincroniza los botones de la miniatura de Windows
  useEffect(() => {
    window.api
      .updateThumbar({
        hasCurrent: !!current,
        isPlaying,
        isLiked
      })
      .catch(() => {})
  }, [current?.id, isPlaying, isLiked])

  // Broadcast del estado al mini player (ventana externa)
  const dominantColorForMini = usePlayer((s) => s.dominantColor)
  useEffect(() => {
    window.api.broadcastMiniState?.({
      track: current
        ? { id: current.id, title: current.title, author: current.author, thumbnail: current.thumbnail }
        : null,
      isPlaying,
      progress,
      duration,
      isLiked,
      volume,
      muted,
      repeatMode,
      dominantColor: dominantColorForMini
    })
  }, [current?.id, current?.thumbnail, isPlaying, progress, duration, isLiked, volume, muted, repeatMode, dominantColorForMini])

  // Al cambiar de canción: pausa la actual de inmediato (antes de que llegue la nueva URL)
  // para no oír la anterior mientras se carga el stream de la siguiente.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.pause()
    try { a.removeAttribute('src'); a.load() } catch {}
    setProgress(0)
    setDuration(0)
  }, [current?.id])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (current?.streamUrl) {
      a.src = current.streamUrl
      a.play().catch(() => {})
    }
  }, [current?.streamUrl])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (isPlaying) a.play().catch(() => {})
    else a.pause()
  }, [isPlaying])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.volume = muted ? 0 : volume
  }, [volume, muted])

  // Reiniciar canción cuando repeatMode === 'one' al terminar
  useEffect(() => {
    if (restartTick === 0) return
    const a = audioRef.current
    if (!a) return
    a.currentTime = 0
    a.play().catch(() => {})
  }, [restartTick])

  function fmt(s) {
    if (!s || isNaN(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const progressBarRef = useRef(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)

  function pctFromEvent(e) {
    const el = progressBarRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function onScrubStart(e) {
    if (!duration) return
    setScrubbing(true)
    setScrubPct(pctFromEvent(e))
  }

  useEffect(() => {
    if (!scrubbing) return
    const onMove = (e) => setScrubPct(pctFromEvent(e))
    const onUp = (e) => {
      const pct = pctFromEvent(e)
      const a = audioRef.current
      if (a && duration) a.currentTime = pct * duration
      setScrubbing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [scrubbing, duration])

  const displayPct = duration
    ? scrubbing
      ? scrubPct * 100
      : (progress / duration) * 100
    : 0
  const displayTime = duration && scrubbing ? scrubPct * duration : progress

  return (
    <footer className="h-20 flex-shrink-0 bg-carbon-950 border-t border-ruby-soft flex items-center px-4 gap-6 relative z-50 shadow-[0_-8px_24px_-12px_rgba(159,18,57,0.35)]">
      {/* Info de la canción */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {current?.thumbnail && (
          <img
            src={current.thumbnail}
            className="w-12 h-12 rounded object-cover"
          />
        )}
        <div className="min-w-0">
          {current ? (
            <>
              <p className="truncate text-sm">{current.title}</p>
              <ArtistLink
                author={current.author}
                className="text-xs text-bone-400 truncate hover:underline hover:text-bone-100"
              />
            </>
          ) : (
            <p className="text-bone-500 text-sm">Nada en reproducción</p>
          )}
        </div>
        {current && <LikeButton track={current} />}
      </div>

      {/* Controles centrales */}
      <div className="flex-1 flex flex-col items-center gap-1.5 max-w-[44%]">
        <div className="flex items-center gap-5">
          <button
            onClick={() => {}}
            className="text-bone-400 hover:text-bone-100 transition-colors"
            title="Aleatorio"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" /><path d="M4 20l17-17" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" />
            </svg>
          </button>
          <button
            onClick={prev}
            disabled={!current}
            className="text-bone-300 hover:text-bone-100 disabled:opacity-30 transition-colors"
            title="Anterior"
          >
            <Icon name="prev" size={20} />
          </button>
          <button
            disabled={!current}
            onClick={togglePlay}
            style={{
              backgroundColor: activeColor,
              boxShadow: `0 8px 24px -8px ${shadowStrong}, 0 2px 6px ${shadowSoft}`,
              transition: 'background-color 0.6s ease, box-shadow 0.6s ease, transform 0.2s'
            }}
            className={`relative w-11 h-11 rounded-full flex items-center justify-center ${
              current ? 'hover:scale-105' : 'pulse-ruby'
            }`}
          >
            <span className="text-bone-100 flex items-center justify-center">
              {isPlaying ? <Icon name="pause" size={18} /> : <Icon name="play" size={18} />}
            </span>
          </button>
          <button
            onClick={next}
            disabled={!current}
            className="text-bone-300 hover:text-bone-100 disabled:opacity-30 transition-colors"
            title="Siguiente"
          >
            <Icon name="next" size={20} />
          </button>
          <button
            onClick={cycleRepeat}
            className={
              repeatMode !== 'off'
                ? 'transition-colors'
                : 'text-bone-400 hover:text-bone-100 transition-colors'
            }
            style={repeatMode !== 'off' ? { color: activeColor, transition: 'color 0.6s ease' } : undefined}
            title={`Repetir: ${repeatMode}`}
          >
            <Icon
              name={repeatMode === 'one' ? 'repeatOne' : 'repeat'}
              size={18}
            />
          </button>
        </div>
        <div className="w-full flex items-center gap-3 text-[11px] text-bone-500 tabular-nums">
          <span className="w-10 text-right">{fmt(displayTime)}</span>
          <div
            ref={progressBarRef}
            onMouseDown={onScrubStart}
            className={`progress-bar flex-1 cursor-pointer group relative flex items-center ${scrubbing ? 'is-scrubbing' : ''}`}
          >
            <div
              className="progress-track w-full rounded-full overflow-hidden relative"
              style={{ backgroundColor: 'rgba(254, 243, 199, 0.35)', height: '5px' }}
            >
              <div
                className="progress-fill rounded-full"
                style={{
                  height: '100%',
                  width: `${displayPct}%`,
                  backgroundColor: '#FEF3C7'
                }}
              />
            </div>
            <span
              className="progress-thumb absolute top-1/2 w-3 h-3 rounded-full pointer-events-none"
              style={{
                left: `${displayPct}%`,
                backgroundColor: '#FEF3C7',
                boxShadow: '0 2px 6px rgba(0,0,0,0.6)'
              }}
            />
          </div>
          <span className="w-10 text-left">{fmt(duration)}</span>
        </div>
      </div>

      {/* Volumen + panel toggle (extremo derecho) */}
      <div className="flex items-center gap-2 flex-1 justify-end">
        <button
          onClick={onToggleMini}
          className="transition-colors"
          style={{ color: miniOpen ? activeColor : undefined, transition: 'color 0.6s ease' }}
          title={miniOpen ? 'Cerrar reproductor en miniatura' : 'Abrir el reproductor en miniatura'}
        >
          <span className={miniOpen ? '' : 'text-bone-400 hover:text-bone-100'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <rect x="9" y="18" width="6" height="2" rx="1" fill="currentColor" />
            </svg>
          </span>
        </button>
        <button
          onClick={onTogglePanel}
          className="transition-colors"
          style={{ color: showPanel ? activeColor : undefined, transition: 'color 0.6s ease' }}
          title="Mostrar/ocultar info"
        >
          <span className={showPanel ? '' : 'text-bone-400 hover:text-bone-100'}>
            <Icon name="library" size={18} />
          </span>
        </button>
        <button
          onClick={toggleMute}
          className="text-bone-400 hover:text-bone-100"
          title={muted ? 'Quitar silencio' : 'Silenciar'}
        >
          <Icon
            name={muted || volume === 0 ? 'volumeMute' : 'volume'}
            size={18}
          />
        </button>
        <VolumeSlider
          value={muted ? 0 : volume}
          onChange={(v) => setVolume(v)}
        />
        <button
          onClick={onToggleFullScreen}
          disabled={!current}
          className="text-bone-400 hover:text-bone-100 disabled:opacity-40 ml-1"
          title="Ver en grande"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          setDuration(d)
          if (current?.id && d && !isNaN(d)) {
            window.api.backfillDuration(current.id, d).catch(() => {})
          }
        }}
        onEnded={handleEnded}
        className="hidden"
      />
    </footer>
  )
}
