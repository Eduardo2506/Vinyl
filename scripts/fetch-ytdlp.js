// Descarga el binario yt-dlp adecuado para la plataforma a resources/
// Se ejecuta automáticamente antes de cualquier build (npm run prebuild) y
// es idempotente: si el binario ya existe, no vuelve a descargarlo.
//
// Forzar descarga: borra el archivo en resources/ o pasa --force.

const fs = require('fs')
const path = require('path')
const https = require('https')

const FORCE = process.argv.includes('--force')

const RELEASES = {
  win32: {
    file: 'yt-dlp.exe',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  },
  darwin: {
    file: 'yt-dlp_macos',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
  },
  linux: {
    file: 'yt-dlp',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
  }
}

const target = RELEASES[process.platform]
if (!target) {
  console.error(`fetch-ytdlp: plataforma no soportada (${process.platform})`)
  process.exit(1)
}

const resourcesDir = path.join(__dirname, '..', 'resources')
if (!fs.existsSync(resourcesDir)) fs.mkdirSync(resourcesDir, { recursive: true })

const outPath = path.join(resourcesDir, target.file)

if (fs.existsSync(outPath) && !FORCE) {
  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)
  console.log(`fetch-ytdlp: ${target.file} ya existe (${sizeMb} MB). Pasa --force para re-descargar.`)
  process.exit(0)
}

console.log(`fetch-ytdlp: descargando ${target.url}`)

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects <= 0) return reject(new Error('demasiados redirects'))
        res.resume()
        return resolve(download(res.headers.location, dest, redirects - 1))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} al descargar yt-dlp`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0
      let lastLog = 0
      const file = fs.createWriteStream(dest)
      res.on('data', (chunk) => {
        received += chunk.length
        if (total && Date.now() - lastLog > 500) {
          const pct = ((received / total) * 100).toFixed(1)
          process.stdout.write(`\rfetch-ytdlp: ${pct}%`)
          lastLog = Date.now()
        }
      })
      res.pipe(file)
      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n')
          resolve()
        })
      })
      file.on('error', reject)
    }).on('error', reject)
  })
}

download(target.url, outPath)
  .then(() => {
    if (process.platform !== 'win32') {
      fs.chmodSync(outPath, 0o755)
    }
    const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)
    console.log(`fetch-ytdlp: listo (${sizeMb} MB) → ${outPath}`)
  })
  .catch((err) => {
    console.error(`fetch-ytdlp: error — ${err.message}`)
    try { fs.unlinkSync(outPath) } catch {}
    process.exit(1)
  })
