const path = require('path')
const { app } = require('electron')
const Database = require('better-sqlite3')
const settings = require('./settings.js')

let db

function musicDir() {
  return settings.getMusicDir()
}
function resolveDownloadPath(filePath) {
  if (!filePath) return filePath
  return path.isAbsolute(filePath) ? filePath : path.join(musicDir(), filePath)
}

function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'vinyl.db')
  db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnail TEXT,
      file_path TEXT NOT NULL,
      downloaded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS liked (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      thumbnail TEXT,
      liked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );
  `)

  // Migrations: add columns that may be missing from older DB versions
  const ptCols = db.prepare("PRAGMA table_info('playlist_tracks')").all().map(c => c.name)
  if (!ptCols.includes('title')) {
    db.exec("ALTER TABLE playlist_tracks ADD COLUMN title TEXT NOT NULL DEFAULT ''")
  }
  if (!ptCols.includes('author')) {
    db.exec("ALTER TABLE playlist_tracks ADD COLUMN author TEXT DEFAULT ''")
  }
  if (!ptCols.includes('thumbnail')) {
    db.exec("ALTER TABLE playlist_tracks ADD COLUMN thumbnail TEXT DEFAULT ''")
  }
  if (!ptCols.includes('duration')) {
    db.exec("ALTER TABLE playlist_tracks ADD COLUMN duration TEXT DEFAULT ''")
  }
  if (!ptCols.includes('added_at')) {
    db.exec("ALTER TABLE playlist_tracks ADD COLUMN added_at INTEGER DEFAULT 0")
  }

  // Migrations for liked table
  const likedCols = db.prepare("PRAGMA table_info('liked')").all().map(c => c.name)
  if (!likedCols.includes('duration')) {
    db.exec("ALTER TABLE liked ADD COLUMN duration TEXT DEFAULT ''")
  }

  // Migrations for downloads table
  const dlCols = db.prepare("PRAGMA table_info('downloads')").all().map(c => c.name)
  if (!dlCols.includes('duration')) {
    db.exec("ALTER TABLE downloads ADD COLUMN duration TEXT DEFAULT ''")
  }

  // Migración: convertir paths absolutos a basenames (portabilidad)
  const base = musicDir()
  const rows = db.prepare('SELECT id, file_path FROM downloads').all()
  const upd = db.prepare('UPDATE downloads SET file_path = ? WHERE id = ?')
  for (const r of rows) {
    if (r.file_path && path.isAbsolute(r.file_path)) {
      const normalized = path.normalize(r.file_path)
      if (normalized.toLowerCase().startsWith(base.toLowerCase())) {
        upd.run(path.basename(normalized), r.id)
      }
    }
  }
}

// Downloads
function addDownload(track) {
  const stored = track.file_path
    ? (path.isAbsolute(track.file_path) ? path.basename(track.file_path) : track.file_path)
    : ''
  db.prepare(`
    INSERT OR REPLACE INTO downloads (id, title, author, thumbnail, duration, file_path, downloaded_at)
    VALUES (@id, @title, @author, @thumbnail, @duration, @file_path, @downloaded_at)
  `).run({
    id: track.id,
    title: track.title,
    author: track.author || '',
    thumbnail: track.thumbnail || '',
    duration: track.duration ? String(track.duration) : '',
    file_path: stored,
    downloaded_at: Date.now()
  })
}
function listDownloads() {
  const fs = require('fs')
  const rows = db.prepare('SELECT * FROM downloads ORDER BY downloaded_at DESC').all()
  return rows
    .map((r) => ({ ...r, file_path: resolveDownloadPath(r.file_path) }))
    .filter((r) => r.file_path && fs.existsSync(r.file_path))
}
function listDownloadRowsRaw() {
  return db.prepare('SELECT id, title, file_path FROM downloads').all()
}
function getDownload(id) {
  const r = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id)
  if (!r) return r
  return { ...r, file_path: resolveDownloadPath(r.file_path) }
}
function removeDownload(id) {
  db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
}

// Liked
function likeTrack(track) {
  db.prepare(`
    INSERT OR REPLACE INTO liked (id, title, author, thumbnail, duration, liked_at)
    VALUES (@id, @title, @author, @thumbnail, @duration, @liked_at)
  `).run({
    id: track.id,
    title: track.title,
    author: track.author || '',
    thumbnail: track.thumbnail || '',
    duration: track.duration || '',
    liked_at: Date.now()
  })
}
function unlikeTrack(id) {
  db.prepare('DELETE FROM liked WHERE id = ?').run(id)
}
function listLiked() {
  return db.prepare('SELECT * FROM liked ORDER BY liked_at DESC').all()
}
function getLikedIds() {
  return db.prepare('SELECT id FROM liked').all().map((r) => r.id)
}

// Playlists
function createPlaylist(name) {
  const info = db
    .prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)')
    .run(name, Date.now())
  return { id: info.lastInsertRowid, name, created_at: Date.now() }
}
function listPlaylists() {
  const rows = db
    .prepare('SELECT * FROM playlists ORDER BY created_at DESC')
    .all()
  const coverStmt = db.prepare(
    `SELECT thumbnail FROM playlist_tracks
     WHERE playlist_id = ?
       AND thumbnail IS NOT NULL AND thumbnail != ''
     ORDER BY position ASC
     LIMIT 4`
  )
  for (const p of rows) {
    p.covers = coverStmt.all(p.id).map((r) => r.thumbnail)
  }
  return rows
}
function deletePlaylist(id) {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id)
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
}
function renamePlaylist(id, name) {
  db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, id)
}
function addToPlaylist(playlistId, track) {
  const max = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) AS p FROM playlist_tracks WHERE playlist_id = ?'
    )
    .get(playlistId).p
  db.prepare(`
    INSERT OR REPLACE INTO playlist_tracks
      (playlist_id, track_id, title, author, thumbnail, duration, added_at, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    playlistId,
    track.id,
    track.title,
    track.author || '',
    track.thumbnail || '',
    track.duration || '',
    Date.now(),
    max + 1
  )
}
function removeFromPlaylist(playlistId, trackId) {
  db.prepare(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
  ).run(playlistId, trackId)
}
function getPlaylistTracks(playlistId) {
  return db
    .prepare(
      'SELECT track_id AS id, title, author, thumbnail, duration, added_at FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC'
    )
    .all(playlistId)
}
function backfillDuration(id, seconds) {
  if (!id || !seconds || isNaN(seconds)) return
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  const dur = `${m}:${s}`
  db.prepare(
    "UPDATE downloads SET duration = ? WHERE id = ? AND (duration IS NULL OR duration = '')"
  ).run(dur, id)
  db.prepare(
    "UPDATE liked SET duration = ? WHERE id = ? AND (duration IS NULL OR duration = '')"
  ).run(dur, id)
  db.prepare(
    "UPDATE playlist_tracks SET duration = ? WHERE track_id = ? AND (duration IS NULL OR duration = '')"
  ).run(dur, id)
}

function getAllPlaylistTrackIds() {
  return db
    .prepare('SELECT DISTINCT track_id FROM playlist_tracks')
    .all()
    .map((r) => r.track_id)
}

module.exports = {
  initDb,
  musicDir,
  addDownload,
  listDownloads,
  listDownloadRowsRaw,
  getDownload,
  removeDownload,
  likeTrack,
  unlikeTrack,
  listLiked,
  getLikedIds,
  createPlaylist,
  listPlaylists,
  deletePlaylist,
  renamePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  getPlaylistTracks,
  getAllPlaylistTrackIds,
  backfillDuration
}
