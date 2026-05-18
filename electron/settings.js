const path = require('path')
const fs = require('fs')
const { app } = require('electron')

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function defaultMusicDir() {
  return path.join(app.getPath('userData'), 'music')
}

let cached = null

function load() {
  if (cached) return cached
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    cached = JSON.parse(raw) || {}
  } catch {
    cached = {}
  }
  return cached
}

function save() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(cached || {}, null, 2))
  } catch (err) {
    console.error('settings save error', err)
  }
}

function getSettings() {
  const s = load()
  return {
    musicDir: s.musicDir || defaultMusicDir(),
    lucidMode: s.lucidMode === true,
    cookiesBrowser: s.cookiesBrowser || 'none',
    cookiesFile: s.cookiesFile || ''
  }
}

function setSetting(key, value) {
  load()
  cached[key] = value
  save()
}

function getMusicDir() {
  return getSettings().musicDir
}

module.exports = { getSettings, setSetting, getMusicDir, defaultMusicDir }
