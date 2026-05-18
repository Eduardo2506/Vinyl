import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'

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
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (lum < 20 || lum > 240) continue
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
        }
        if (n === 0) return resolve(null)
        resolve([Math.round(r / n), Math.round(g / n), Math.round(b / n)])
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function parseRgbStr(str) {
  if (!str) return null
  const m = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!m) return null
  return [+m[1], +m[2], +m[3]]
}

export default function MiniPlayer() {
  const [state, setState] = useState({
    track: null,
    isPlaying: false,
    progress: 0,
    duration: 0,
    isLiked: false,
    volume: 0.8,
    muted: false,
    repeatMode: 'off',
    dominantColor: null
  })
  const [localRgb, setLocalRgb] = useState(null)

  useEffect(() => {
    const off = window.api.onMiniState?.((s) => setState((prev) => ({ ...prev, ...s })))
    return off
  }, [])

  // Si el broadcast no incluye color (porque Lucid está apagado en el principal),
  // lo extraemos localmente para que el mini siempre tenga su tinte.
  useEffect(() => {
    const thumb = state.track?.thumbnail
    if (!thumb) { setLocalRgb(null); return }
    let cancelled = false
    extractDominantColor(thumb).then((rgb) => {
      if (!cancelled) setLocalRgb(rgb)
    })
    return () => { cancelled = true }
  }, [state.track?.thumbnail])

  function send(cmd, payload) {
    window.api.sendMiniCommand?.({ cmd, payload })
  }

  function fmt(s) {
    if (!s || isNaN(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const { track, isPlaying, progress, duration, isLiked, volume, muted, repeatMode } = state
  const rgb = parseRgbStr(state.dominantColor) || localRgb || [220, 38, 89]
  const activeColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  const bgGradient = `linear-gradient(135deg, rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45) 0%, #1C1410 70%)`
  const shadowStrong = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.65)`
  const shadowSoft = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`

  // Scrubbing
  const progressRef = useRef(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)

  function pctFromEvent(e, ref) {
    const el = ref.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function onScrubStart(e) {
    if (!duration) return
    setScrubbing(true)
    setScrubPct(pctFromEvent(e, progressRef))
  }

  useEffect(() => {
    if (!scrubbing) return
    const onMove = (e) => setScrubPct(pctFromEvent(e, progressRef))
    const onUp = (e) => {
      const p = pctFromEvent(e, progressRef)
      if (duration) send('seek', p * duration)
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
    ? scrubbing ? scrubPct * 100 : (progress / duration) * 100
    : 0
  const displayTime = duration && scrubbing ? scrubPct * duration : progress

  // Volume slider
  const volumeRef = useRef(null)
  const [volDragging, setVolDragging] = useState(false)
  function onVolMouseDown(e) {
    setVolDragging(true)
    send('setVolume', pctFromEvent(e, volumeRef))
  }
  useEffect(() => {
    if (!volDragging) return
    const onMove = (e) => send('setVolume', pctFromEvent(e, volumeRef))
    const onUp = () => setVolDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [volDragging])
  const volPct = (muted ? 0 : volume) * 100

  return (
    <div
      className="h-screen w-screen flex flex-col text-bone-100 overflow-hidden relative"
      style={{
        background: bgGradient,
        transition: 'background 0.8s ease'
      }}
    >
      {/* Drag region */}
      <div
        className="h-7 flex items-center justify-between px-2 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <span className="text-bone-500 text-[10px] flex items-center gap-1.5 px-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: activeColor, transition: 'background-color 0.6s ease' }}
          />
          Mini
        </span>
        <button
          onClick={() => window.api.closeMini?.()}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="text-bone-400 hover:text-bone-100 p-1 rounded"
          title="Cerrar mini"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Cover */}
      <div className="flex-1 flex items-center justify-center px-4">
        {track?.thumbnail ? (
          <div className="relative w-full aspect-square max-w-[220px] rounded-lg overflow-hidden shadow-2xl">
            <img src={track.thumbnail} className="w-full h-full object-cover" />
            <button
              onClick={() => send('togglePlay')}
              className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors group"
              title={isPlaying ? 'Pausar' : 'Reproducir'}
            >
              <span className="w-14 h-14 rounded-full bg-bone-100 text-carbon-900 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                {isPlaying ? <Icon name="pause" size={20} /> : <Icon name="play" size={20} />}
              </span>
            </button>
          </div>
        ) : (
          <div className="w-full aspect-square max-w-[220px] rounded-lg bg-carbon-800 flex items-center justify-center text-bone-600 text-xs">
            Sin reproducción
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 mt-2">
        <div
          ref={progressRef}
          onMouseDown={onScrubStart}
          className="h-3 flex items-center cursor-pointer group relative"
        >
          <div
            className="w-full rounded-full overflow-hidden relative"
            style={{ backgroundColor: 'rgba(254, 243, 199, 0.25)', height: '4px' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${displayPct}%`, backgroundColor: '#FEF3C7' }}
            />
          </div>
          <span
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{
              left: `${displayPct}%`,
              backgroundColor: '#FEF3C7',
              boxShadow: '0 2px 6px rgba(0,0,0,0.6)'
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-bone-500 tabular-nums mt-0.5">
          <span>{fmt(displayTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>

      {/* Title + like */}
      <div className="px-4 pt-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold">
              {track?.title || 'Nada en reproducción'}
            </p>
            <p className="truncate text-xs text-bone-400">{track?.author || ''}</p>
          </div>
          <button
            onClick={() => send('toggleLike')}
            disabled={!track}
            className="p-1.5 transition-colors disabled:opacity-30"
            style={{ color: isLiked ? activeColor : '#A89678', transition: 'color 0.6s ease' }}
            title={isLiked ? 'Quitar de Me gusta' : 'Agregar a Me gusta'}
          >
            <Icon name="heart" size={16} filled={isLiked} />
          </button>
        </div>
      </div>

      {/* Controles centrales */}
      <div className="flex items-center justify-center gap-3 mt-2">
        <button
          onClick={() => send('prev')}
          disabled={!track}
          className="text-bone-300 hover:text-bone-100 disabled:opacity-30 p-1"
          title="Anterior"
        >
          <Icon name="prev" size={18} />
        </button>
        <button
          onClick={() => send('togglePlay')}
          disabled={!track}
          className="w-11 h-11 rounded-full flex items-center justify-center text-bone-100 disabled:opacity-50 transition-transform hover:scale-105"
          style={{
            backgroundColor: activeColor,
            boxShadow: `0 8px 20px -8px ${shadowStrong}, 0 2px 6px ${shadowSoft}`,
            transition: 'background-color 0.6s ease, box-shadow 0.6s ease, transform 0.2s'
          }}
          title={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? <Icon name="pause" size={18} /> : <Icon name="play" size={18} />}
        </button>
        <button
          onClick={() => send('next')}
          disabled={!track}
          className="text-bone-300 hover:text-bone-100 disabled:opacity-30 p-1"
          title="Siguiente"
        >
          <Icon name="next" size={18} />
        </button>
      </div>

      {/* Repetir + volumen */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={() => send('cycleRepeat')}
          className="transition-colors p-1"
          style={{ color: repeatMode !== 'off' ? activeColor : '#A89678', transition: 'color 0.6s ease' }}
          title={`Repetir: ${repeatMode}`}
        >
          <Icon name={repeatMode === 'one' ? 'repeatOne' : 'repeat'} size={15} />
        </button>
        <button
          onClick={() => send('toggleMute')}
          className="text-bone-400 hover:text-bone-100 p-1"
          title={muted ? 'Quitar silencio' : 'Silenciar'}
        >
          <Icon name={muted || volume === 0 ? 'volumeMute' : 'volume'} size={15} />
        </button>
        <div
          ref={volumeRef}
          onMouseDown={onVolMouseDown}
          className="flex-1 h-3 flex items-center cursor-pointer group relative"
        >
          <div
            className="w-full rounded-full overflow-hidden relative"
            style={{ backgroundColor: 'rgba(254, 243, 199, 0.25)', height: '4px' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${volPct}%`, backgroundColor: '#FEF3C7' }}
            />
          </div>
          <span
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{
              left: `${volPct}%`,
              backgroundColor: '#FEF3C7',
              boxShadow: '0 2px 6px rgba(0,0,0,0.6)'
            }}
          />
        </div>
      </div>
    </div>
  )
}
