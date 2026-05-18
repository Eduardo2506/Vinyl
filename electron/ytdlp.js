const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const settings = require('./settings.js')

const execFileP = promisify(execFile)

function resolveYtdlpBin() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'yt-dlp.exe')
    if (fs.existsSync(bundled)) return bundled
  } else {
    // En dev también probamos resources/ por si existe, para testear el flujo "como empaquetado"
    const devBundled = path.join(__dirname, '..', 'resources', 'yt-dlp.exe')
    if (fs.existsSync(devBundled)) return devBundled
  }
  return 'yt-dlp'
}
const YTDLP_BIN = resolveYtdlpBin()

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

async function getStreamUrl(id) {
  const now = Date.now()
  const cached = streamCache.get(id)
  if (cached && cached.expiresAt > now) return cached.url

  if (inflight.has(id)) return inflight.get(id)

  const p = (async () => {
    const { stdout } = await execFileP(YTDLP_BIN, [
      ...cookieArgs(),
      '-f',
      'bestaudio',
      '-g',
      `https://www.youtube.com/watch?v=${id}`
    ])
    const url = stdout.trim()
    streamCache.set(id, { url, expiresAt: Date.now() + STREAM_TTL_MS })
    return url
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

module.exports = {
  search,
  getStreamUrl,
  download,
  musicDir,
  getPlaylistVideos,
  getArtistData
}
