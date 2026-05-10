// IndexedDB-backed storage for local-m3u playlist text.
//
// Local-m3u entries can be megabytes of text - well past the ~5 MiB
// localStorage quota that the main `xt_playlists` blob lives under.
// Keeping the text in its own IDB store means the entries blob stays
// tiny (metadata only) and large playlists don't blow up the
// localStorage mirror in creds.js.

import { log } from "@/scripts/lib/log.js"

const DB_NAME = "xt_local_content"
const DB_VERSION = 1
const STORE = "entries"

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.reject(new Error("IndexedDB unavailable"))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error("IDB blocked"))
  })
  return dbPromise
}

/**
 * Persist the M3U text for one playlist entry.
 * @param {string} entryId
 * @param {string} text
 */
export async function setLocalContent(entryId, text) {
  if (!entryId) return
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(text || "", entryId)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    log.error("[xt:local-content] setLocalContent failed:", e)
  }
}

/**
 * Read the M3U text for one playlist entry, or "" if missing.
 * @param {string} entryId
 * @returns {Promise<string>}
 */
export async function getLocalContent(entryId) {
  if (!entryId) return ""
  try {
    const db = await openDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(entryId)
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : "")
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    log.warn("[xt:local-content] getLocalContent failed:", e)
    return ""
  }
}

/**
 * Drop the M3U text for one playlist entry.
 * @param {string} entryId
 */
export async function deleteLocalContent(entryId) {
  if (!entryId) return
  try {
    const db = await openDB()
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(entryId)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch (e) {
    log.warn("[xt:local-content] deleteLocalContent failed:", e)
  }
}
