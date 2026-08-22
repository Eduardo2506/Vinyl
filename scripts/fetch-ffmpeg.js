const fs = require('fs')
const path = require('path')
const https = require('https')
const os = require('os')
const { execFileSync } = require('child_process')

const FORCE = process.argv.includes('--force')

if (process.platform !== 'win32') {
  console.log(`fetch-ffmpeg: plataforma ${process.platform}, nada que hacer.`)
  process.exit(0)
}

const ZIP_URL =
  'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'

const resourcesDir = path.join(__dirname, '..', 'resources')
if (!fs.existsSync(resourcesDir)) fs.mkdirSync(resourcesDir, { recursive: true })

const outPath = path.join(resourcesDir, 'ffmpeg.exe')

if (fs.existsSync(outPath) && !FORCE) {
  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)
  console.log(
    `fetch-ffmpeg: ffmpeg.exe ya existe (${sizeMb} MB). Pasa --force para re-descargar.`
  )
  process.exit(0)
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects <= 0) return reject(new Error('demasiados redirects'))
          res.resume()
          return resolve(download(res.headers.location, dest, redirects - 1))
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} al descargar ffmpeg`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        let lastLog = 0
        const file = fs.createWriteStream(dest)
        res.on('data', (chunk) => {
          received += chunk.length
          if (total && Date.now() - lastLog > 500) {
            const pct = ((received / total) * 100).toFixed(1)
            process.stdout.write(`\rfetch-ffmpeg: ${pct}%`)
            lastLog = Date.now()
          }
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => {
          process.stdout.write('\n')
          resolve()
        }))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

function extraerFfmpeg(zipPath, destDir) {
  execFileSync(
    'tar',
    ['-xf', zipPath, '-C', destDir, '--strip-components=2', '*/bin/ffmpeg.exe'],
    { stdio: 'inherit' }
  )
}

const tmpZip = path.join(os.tmpdir(), `ffmpeg-vinyl-${Date.now()}.zip`)

async function descargarConReintentos(intentos = 3) {
  for (let i = 1; i <= intentos; i++) {
    try {
      console.log(`fetch-ffmpeg: descargando ${ZIP_URL}${i > 1 ? ` (intento ${i}/${intentos})` : ''}`)
      await download(ZIP_URL, tmpZip)
      return
    } catch (err) {
      try { fs.unlinkSync(tmpZip) } catch {}
      if (i === intentos) throw err
      console.warn(`fetch-ffmpeg: falló (${err.message}); reintentando…`)
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

descargarConReintentos()
  .then(() => {
    console.log('fetch-ffmpeg: extrayendo ffmpeg.exe…')
    extraerFfmpeg(tmpZip, resourcesDir)
    if (!fs.existsSync(outPath)) {
      throw new Error('el zip no contenía bin/ffmpeg.exe')
    }
    const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)
    console.log(`fetch-ffmpeg: listo (${sizeMb} MB) → ${outPath}`)
  })
  .catch((err) => {
    console.error(`fetch-ffmpeg: error — ${err.message}`)
    try { fs.unlinkSync(outPath) } catch {}
    process.exitCode = 1
  })
  .finally(() => {
    try { fs.unlinkSync(tmpZip) } catch {}
  })
