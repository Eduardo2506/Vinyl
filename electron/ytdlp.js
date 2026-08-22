const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const settings = require('./settings.js')

const execFileP = promisify(execFile)

const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'

function managedBin() {
  return path.join(app.getPath('userData'), 'bin', EXE)
}

function bundledBin() {
  if (app.isPackaged) return path.join(process.resourcesPath, EXE)
  return path.join(__dirname, '..', 'resources', EXE)
}

function resolveYtdlpBin() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN
  const managed = managedBin()
  const bundled = bundledBin()
  if (fs.existsSync(managed)) {
    if (!fs.existsSync(bundled)) return managed
    if (fs.statSync(managed).mtimeMs >= fs.statSync(bundled).mtimeMs) return managed
  }
  if (fs.existsSync(bundled)) return bundled
  return 'yt-dlp'
}

let YTDLP_BIN = resolveYtdlpBin()

function ffmpegArgs() {
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg.exe')
    : path.join(__dirname, '..', 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (fs.existsSync(bundled)) return ['--ffmpeg-location', bundled]
  return []
}

const VALID_BROWSERS = new Set(['chrome', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'chromium', 'safari'])
function cookieArgs() {
  const s = settings.getSettings()
  // El archivo tiene prioridad (workaround para DPAPI en Chromium en Windows)
  if (s.cookiesFile && fs.existsSync(s.cookiesFile)) {
    return ['--cookies', s.cookiesFile]
  }
  const b = s.cookiesBrowser
  if (!b || b === 'none' || !VALID_BROWSERS.has(b)) return []
  return ['--cookies-from-browser', b]
}

function musicDir() {
  const dir = settings.getMusicDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Cache de búsquedas (TTL 10 min)
const searchCache = new Map() // key -> { results, expiresAt }
const SEARCH_TTL_MS = 10 * 60 * 1000

async function search(query) {
  const key = query.trim().toLowerCase()
  if (!key) return []

  const now = Date.now()
  const cached = searchCache.get(key)
  if (cached && cached.expiresAt > now) return cached.results

  let results
  try {
    results = await searchInnerTube(query)
  } catch (err) {
    console.warn('InnerTube falló, usando yt-dlp:', err.message)
    results = await searchYtDlp(query)
  }

  searchCache.set(key, { results, expiresAt: now + SEARCH_TTL_MS })
  return results
}

// Llama directamente a la API interna de YouTube (la que usa el buscador web).
// Mucho más rápida que yt-dlp porque no hay subproceso.
async function searchInnerTube(query) {
  const res = await fetch(
    'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'es',
            gl: 'US'
          }
        },
        query
      })
    }
  )
  if (!res.ok) throw new Error(`InnerTube HTTP ${res.status}`)
  const data = await res.json()

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || []
  const items = sections.flatMap(
    (s) => s?.itemSectionRenderer?.contents || []
  )

  const out = []
  for (const c of items) {
    if (c.videoRenderer) {
      const v = c.videoRenderer
      const thumbs = v.thumbnail?.thumbnails || []
      out.push({
        type: 'video',
        id: v.videoId,
        title: v.title?.runs?.[0]?.text || '',
        author:
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text ||
          '',
        thumbnail:
          thumbs[thumbs.length - 1]?.url ||
          `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        duration: v.lengthText?.simpleText || ''
      })
    } else if (c.channelRenderer) {
      const ch = c.channelRenderer
      const thumbs = ch.thumbnail?.thumbnails || []
      let url = thumbs[thumbs.length - 1]?.url || ''
      if (url.startsWith('//')) url = 'https:' + url
      out.push({
        type: 'artist',
        id: ch.channelId,
        title: ch.title?.simpleText || '',
        thumbnail: url,
        subscribers:
          ch.videoCountText?.simpleText ||
          ch.subscriberCountText?.simpleText ||
          ''
      })
    } else if (c.playlistRenderer) {
      const p = c.playlistRenderer
      const thumbs = p.thumbnails?.[0]?.thumbnails || []
      out.push({
        type: 'album',
        id: p.playlistId,
        title: p.title?.simpleText || '',
        author:
          p.shortBylineText?.runs?.[0]?.text ||
          p.longBylineText?.runs?.[0]?.text ||
          '',
        thumbnail:
          thumbs[thumbs.length - 1]?.url ||
          `https://i.ytimg.com/vi/${p.navigationEndpoint?.watchEndpoint?.videoId}/hqdefault.jpg`,
        count: p.videoCount || ''
      })
    }
  }
  return out
}

async function searchYtDlp(query) {
  const { stdout } = await execFileP(
    YTDLP_BIN,
    [
      ...cookieArgs(),
      '--default-search',
      'ytsearch',
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      `ytsearch15:${query}`
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  )

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((v) => v.ie_key === 'Youtube' && v.id?.length === 11)
    .map((v) => ({
      type: 'video',
      id: v.id,
      title: v.title,
      author: v.uploader || v.channel || '',
      thumbnail:
        v.thumbnails?.[v.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      duration: v.duration
    }))
}

// Cache de URLs de stream. YouTube las firma con expiración (~6h);
// guardamos 4h para tener margen.
const streamCache = new Map() // id -> { url, expiresAt }
const inflight = new Map()    // id -> Promise<url> (deduplica llamadas concurrentes)
const STREAM_TTL_MS = 4 * 60 * 60 * 1000

function explainYtdlpError(err) {
  const raw = `${err?.stderr || ''} ${err?.message || ''}`
  if (/HTTP Error 429|Too Many Requests/i.test(raw)) {
    return 'YouTube está limitando las peticiones desde tu conexión (error 429). ' +
      'Configura tus cookies en Configuración para seguir escuchando.'
  }
  if (/confirm.+not a bot|Sign in to confirm/i.test(raw)) {
    return 'YouTube pide verificar que no eres un bot. ' +
      'Configura tus cookies en Configuración para seguir escuchando.'
  }
  if (/Video unavailable|Private video|removed by the uploader/i.test(raw)) {
    return 'Esta canción ya no está disponible en YouTube.'
  }
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|Failed to resolve|Temporary failure|urlopen error|No address associated/i.test(raw)) {
    return 'No hay conexión a internet.'
  }
  if (/age-restricted|age restricted|confirm your age|Sign in to view this video/i.test(raw)) {
    return 'Esta canción tiene restricción de edad. Configura tus cookies para reproducirla.'
  }
  return 'No se pudo obtener el audio de esta canción.'
}

function isPermanent(err) {
  const raw = `${err?.stderr || ''} ${err?.message || ''}`
  return /Video unavailable|Private video|removed by the uploader|HTTP Error 429|confirm.+not a bot|Sign in to confirm/i.test(raw)
}

function invalidateStream(id) {
  streamCache.delete(id)
}

async function getStreamUrl(id, { force = false } = {}) {
  const now = Date.now()
  if (force) streamCache.delete(id)
  const cached = streamCache.get(id)
  if (cached && cached.expiresAt > now) return cached.url

  if (!force && inflight.has(id)) return inflight.get(id)

  const p = (async () => {
    let lastErr
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { stdout } = await execFileP(YTDLP_BIN, [
          ...cookieArgs(),
          '-f',
          'bestaudio',
          '-g',
          `https://www.youtube.com/watch?v=${id}`
        ])
        const url = stdout.trim()
        if (!url) throw new Error('yt-dlp no devolvió ninguna URL')
        streamCache.set(id, { url, expiresAt: Date.now() + STREAM_TTL_MS })
        return url
      } catch (err) {
        lastErr = err
        if (isPermanent(err)) break
        if (attempt === 0) await new Promise((r) => setTimeout(r, 700))
      }
    }
    const friendly = new Error(explainYtdlpError(lastErr))
    friendly.cause = lastErr
    throw friendly
  })()
    .finally(() => inflight.delete(id))

  inflight.set(id, p)
  return p
}

function download(id, onProgress) {
  return new Promise((resolve, reject) => {
    const outTemplate = path.join(musicDir(), `${id}.%(ext)s`)
    const proc = spawn(YTDLP_BIN, [
      ...cookieArgs(),
      ...ffmpegArgs(),
      '-x',
      '--audio-format',
      'm4a',
      '--newline',
      '--progress-template',
      'PRG|%(progress._percent_str)s|%(progress.status)s',
      '-o',
      outTemplate,
      `https://www.youtube.com/watch?v=${id}`
    ])

    let buf = ''
    function handle(chunk) {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('PRG|')) continue
        const m = line.match(/PRG\|\s*(\d+(?:\.\d+)?)%\|(\w+)/)
        if (m) {
          const pct = parseFloat(m[1])
          const status = m[2]
          onProgress?.({ percent: pct, status })
        }
      }
    }
    proc.stdout.on('data', handle)
    proc.stderr.on('data', handle)
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(path.join(musicDir(), `${id}.m4a`))
      else reject(new Error(`yt-dlp exit ${code}`))
    })
  })
}

async function getPlaylistVideos(playlistId) {
  const { stdout } = await execFileP(
    YTDLP_BIN,
    [
      ...cookieArgs(),
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      `https://www.youtube.com/playlist?list=${playlistId}`
    ],
    { maxBuffer: 40 * 1024 * 1024 }
  )
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((v) => v.id?.length === 11)
    .map((v) => ({
      type: 'video',
      id: v.id,
      title: v.title,
      author: v.uploader || v.channel || '',
      thumbnail:
        v.thumbnails?.[v.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      duration:
        typeof v.duration === 'number'
          ? v.duration
          : v.duration_string || ''
    }))
}

async function getArtistData({ channelId, name }) {
  // Top tracks: usamos la búsqueda (ya viene ordenada por relevancia/popularidad)
  let tracks = []
  let resolvedChannelId = channelId
  let artistThumb = null
  try {
    const results = await search(name)
    tracks = results.filter((r) => r.type === 'video').slice(0, 10)
    // Si no nos pasaron channelId, lo buscamos en los resultados
    if (!resolvedChannelId) {
      const ch = results.find(
        (r) =>
          r.type === 'artist' &&
          r.title?.toLowerCase() === name.toLowerCase()
      ) || results.find((r) => r.type === 'artist')
      if (ch) {
        resolvedChannelId = ch.id
        artistThumb = ch.thumbnail
      }
    }
  } catch (err) {
    console.warn('No se pudo cargar top tracks:', err.message)
  }

  // Álbumes/playlists del canal
  let albums = []
  if (resolvedChannelId) {
    try {
      const { stdout } = await execFileP(
        YTDLP_BIN,
        [
          ...cookieArgs(),
          '--flat-playlist',
          '--dump-json',
          '--no-warnings',
          '--playlist-end',
          '30',
          `https://www.youtube.com/channel/${resolvedChannelId}/playlists`
        ],
        { maxBuffer: 40 * 1024 * 1024 }
      )
      albums = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((p) => p.id && (p._type === 'playlist' || p._type === 'url'))
        .map((p) => ({
          type: 'album',
          id: p.id,
          title: p.title || '',
          thumbnail:
            p.thumbnails?.[p.thumbnails.length - 1]?.url || '',
          author: name
        }))
    } catch (err) {
      console.warn('No se pudieron cargar álbumes del canal:', err.message)
    }
  }

  return { tracks, albums, channelId: resolvedChannelId, thumbnail: artistThumb }
}

// ---------- Auto-actualización de yt-dlp ----------
// YouTube cambia los formatos cada pocas semanas y un binario viejo devuelve
// URLs que googlevideo responde con 403: la app deja de reproducir sin dar
// ningún error. Por eso comprobamos una vez al día si hay versión nueva.

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const RELEASE_DOWNLOAD = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${EXE}`

async function currentVersion(bin = YTDLP_BIN) {
  const { stdout } = await execFileP(bin, ['--no-update', '--version'])
  return stdout.trim()
}

// Las versiones de yt-dlp son fechas (2026.08.19), así que comparar como
// texto ya da el orden correcto.
function isNewer(remote, local) {
  return !!remote && !!local && remote > local
}

async function ensureLatest({ force = false } = {}) {
  const last = settings.getSettings().ytdlpCheckedAt || 0
  if (!force && Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return { skipped: true }
  settings.setSetting('ytdlpCheckedAt', Date.now())

  const local = await currentVersion()

  const res = await fetch(RELEASE_API, {
    headers: { 'User-Agent': 'Vinyl', Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
  const remote = (await res.json()).tag_name

  if (!isNewer(remote, local)) return { updated: false, version: local }

  const dir = path.join(app.getPath('userData'), 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `${EXE}.download`)

  const dl = await fetch(RELEASE_DOWNLOAD, { headers: { 'User-Agent': 'Vinyl' } })
  if (!dl.ok) throw new Error(`descarga HTTP ${dl.status}`)
  fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()))
  if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755)

  const downloaded = await currentVersion(tmp).catch(() => null)
  if (downloaded !== remote) {
    try { fs.unlinkSync(tmp) } catch {}
    throw new Error(`binario descargado inválido (reportó "${downloaded}")`)
  }

  fs.renameSync(tmp, managedBin())
  YTDLP_BIN = resolveYtdlpBin()

  return { updated: true, from: local, version: remote }
}

function ensureLatestInBackground() {
  ensureLatest()
    .then((r) => {
      if (r.updated) console.log(`yt-dlp actualizado: ${r.from} → ${r.version}`)
    })
    .catch((err) => console.warn('No se pudo actualizar yt-dlp:', err.message))
}

module.exports = {
  search,
  getStreamUrl,
  invalidateStream,
  download,
  musicDir,
  getPlaylistVideos,
  getArtistData,
  currentVersion,
  ensureLatest,
  ensureLatestInBackground
}
