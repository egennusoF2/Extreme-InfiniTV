/**
 * Dev-only reverse proxy for IPTV stream URLs (HLS segments, MPEG-TS, manifests).
 * Browsers cannot set Referer reliably and block cross-origin redirects; Node fetch can.
 */
import type { Plugin, ViteDevServer } from "vite"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  looksLikeM3u8,
  rewriteM3u8Playlist,
} from "../scripts/lib/m3u8-proxy-rewrite.ts"
import { sanitizeTvMasterPlaylistIfNeeded } from "../scripts/lib/hls-manifest-sanitize.ts"
import {
  preferHttpsStreamUrl,
  httpFallbackStreamUrl,
} from "../scripts/lib/stream-proxy.ts"

const PROXY_PATH = "/__stream"
const SUBTITLE_PATH = "/__vod_subtitles"
const SUBTITLE_ASSET_PATH = "/__vod_subtitles_asset"

const DEFAULT_UA =
  "VLC/3.0.20 LibVLC/3.0.20"

const ALLOW_HEADERS = "Content-Type, Range, X-XT-UA, X-XT-Referer"
const EXPOSE_HEADERS = "Content-Length, Content-Range, Accept-Ranges"
const SUBTITLE_CACHE_DIR = join(tmpdir(), "leleg-iptv-vod-subtitles")

function redactStreamUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.pathname = parsed.pathname.replace(
      /\/(live|movie|series)\/[^/]+\/[^/]+\//i,
      "/$1/***/***/",
    )
    return parsed.href
  } catch {
    return url.replace(/\/(live|movie|series)\/[^/]+\/[^/]+\//i, "/$1/***/***/")
  }
}

function applyCorsHeaders(res: import("http").ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS)
  res.setHeader("Access-Control-Expose-Headers", EXPOSE_HEADERS)
}

function sendJson(
  res: import("http").ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
  applyCorsHeaders(res)
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Content-Length", String(body.byteLength))
  res.end(body)
}

function requestParam(req: import("http").IncomingMessage, key: string): string {
  const requestUrl = req.url || ""
  const qIndex = requestUrl.indexOf("?")
  const search = qIndex >= 0 ? requestUrl.slice(qIndex) : ""
  return new URLSearchParams(search).get(key) || ""
}

function mediaRequestHeaders(
  req: import("http").IncomingMessage,
  target: string,
): { userAgent: string; referer: string } {
  const userAgent =
    (typeof req.headers["x-xt-ua"] === "string" && req.headers["x-xt-ua"]) ||
    DEFAULT_UA
  let referer =
    (typeof req.headers["x-xt-referer"] === "string" &&
      req.headers["x-xt-referer"]) ||
    ""
  if (!referer) {
    try {
      referer = `${new URL(target).origin}/`
    } catch {}
  }
  return { userAgent, referer }
}

function ffmpegHeaders(userAgent: string, referer: string): string {
  return [
    userAgent ? `User-Agent: ${userAgent}` : "",
    referer ? `Referer: ${referer}` : "",
  ].filter(Boolean).join("\n")
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${command} timed out`))
    }, timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? 0 })
    })
  })
}

type SubtitleProbeStream = {
  index?: number
  codec_type?: string
  tags?: { language?: string; title?: string }
}

async function listSubtitleStreams(
  target: string,
  userAgent: string,
  referer: string,
): Promise<SubtitleProbeStream[]> {
  const headers = ffmpegHeaders(userAgent, referer)
  const args = [
    "-v", "error",
    ...(headers ? ["-headers", headers] : []),
    "-show_streams",
    "-of", "json",
    target,
  ]
  const result = await runProcess("ffprobe", args, 20_000)
  if (result.code !== 0) {
    throw new Error(result.stderr || "ffprobe failed")
  }
  const parsed = JSON.parse(result.stdout || "{}") as { streams?: SubtitleProbeStream[] }
  return (parsed.streams || []).filter((stream) => stream.codec_type === "subtitle")
}

async function extractSubtitleTrack(
  target: string,
  userAgent: string,
  referer: string,
  subtitleIndex: number,
  outPath: string,
): Promise<boolean> {
  const headers = ffmpegHeaders(userAgent, referer)
  const args = [
    "-y",
    ...(headers ? ["-headers", headers] : []),
    "-i", target,
    "-map", `0:s:${subtitleIndex}`,
    "-c:s", "webvtt",
    outPath,
  ]
  const result = await runProcess("ffmpeg", args, 120_000)
  return result.code === 0
}

async function subtitleHandler(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
): Promise<void> {
  let target = requestParam(req, "url")
  if (target) target = preferHttpsStreamUrl(target)
  if (!target || !isAllowedTarget(target)) {
    sendJson(res, 400, { tracks: [], error: "invalid url" })
    return
  }

  const { userAgent, referer } = mediaRequestHeaders(req, target)
  const hash = createHash("sha256").update(`${target}\n${userAgent}\n${referer}`).digest("hex").slice(0, 24)
  const dir = join(SUBTITLE_CACHE_DIR, hash)
  await mkdir(dir, { recursive: true })

  console.log("[xt:vod-subtitles]", redactStreamUrl(target).slice(0, 160))

  const streams = await listSubtitleStreams(target, userAgent, referer)
  const tracks: Array<{ src: string; label: string; language: string }> = []
  for (let i = 0; i < Math.min(streams.length, 8); i++) {
    const stream = streams[i]
    const language = stream.tags?.language || ""
    const label = stream.tags?.title || language || `Subtitle ${i + 1}`
    const filename = `sub-${i}.vtt`
    const outPath = join(dir, filename)
    let exists = false
    try {
      exists = (await stat(outPath)).size > 0
    } catch {}
    if (!exists) {
      const ok = await extractSubtitleTrack(target, userAgent, referer, i, outPath)
      if (!ok) continue
    }
    tracks.push({
      src: `${SUBTITLE_ASSET_PATH}?id=${encodeURIComponent(hash)}&file=${encodeURIComponent(filename)}`,
      label,
      language,
    })
  }

  sendJson(res, 200, { tracks })
}

async function subtitleAssetHandler(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
): Promise<void> {
  const id = requestParam(req, "id")
  const file = requestParam(req, "file")
  if (!/^[a-f0-9]{24}$/.test(id) || !/^sub-\d+\.vtt$/.test(file)) {
    res.statusCode = 400
    res.end("invalid subtitle asset")
    return
  }
  const path = join(SUBTITLE_CACHE_DIR, id, file)
  try {
    await stat(path)
    applyCorsHeaders(res)
    res.statusCode = 200
    res.setHeader("Content-Type", "text/vtt; charset=utf-8")
    createReadStream(path).pipe(res)
  } catch {
    res.statusCode = 404
    res.end("not found")
  }
}

function applyUpstreamMetadata(
  upstream: Response,
  res: import("http").ServerResponse,
): void {
  const contentType = upstream.headers.get("content-type")
  if (contentType) res.setHeader("Content-Type", contentType)
  const contentLength = upstream.headers.get("content-length")
  if (contentLength) res.setHeader("Content-Length", contentLength)
  const contentRange = upstream.headers.get("content-range")
  if (contentRange) res.setHeader("Content-Range", contentRange)
  const acceptRanges = upstream.headers.get("accept-ranges")
  if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges)
}

function isAllowedTarget(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    const host = parsed.hostname
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".local")
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function proxyHandler(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
): Promise<void> {
  const requestUrl = req.url || ""
  const qIndex = requestUrl.indexOf("?")
  const search = qIndex >= 0 ? requestUrl.slice(qIndex) : ""
  const params = new URLSearchParams(search)
  let target = params.get("url")
  if (target) {
    target = preferHttpsStreamUrl(target)
  }
  if (!target || !isAllowedTarget(target)) {
    res.statusCode = 400
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.end("Invalid or missing stream url")
    return
  }

  const ua =
    (typeof req.headers["x-xt-ua"] === "string" && req.headers["x-xt-ua"]) ||
    DEFAULT_UA
  let referer =
    (typeof req.headers["x-xt-referer"] === "string" &&
      req.headers["x-xt-referer"]) ||
    ""
  if (!referer) {
    try {
      referer = `${new URL(target).origin}/`
    } catch {}
  }

  const method = req.method === "HEAD" ? "HEAD" : "GET"
  const fetchHeaders: Record<string, string> = {
    "User-Agent": ua,
    ...(referer ? { Referer: referer } : {}),
  }
  if (typeof req.headers.range === "string" && req.headers.range) {
    fetchHeaders.Range = req.headers.range
  }
  console.log("[xt:stream-proxy]", req.method, redactStreamUrl(target).slice(0, 160))

  async function fetchUpstream(url: string) {
    return fetch(url, {
      method,
      headers: fetchHeaders,
      redirect: "follow",
    })
  }

  try {
    let upstream = await fetchUpstream(target)
    if (
      !upstream.ok &&
      upstream.status >= 500 &&
      target.startsWith("https://")
    ) {
      const fallback = httpFallbackStreamUrl(target)
      if (fallback) {
        console.log("[xt:stream-proxy] retry http", redactStreamUrl(fallback).slice(0, 160))
        upstream = await fetchUpstream(fallback)
      }
    }

    res.statusCode = upstream.status
    applyCorsHeaders(res)

    const contentType = upstream.headers.get("content-type")

    if (method === "HEAD") {
      applyUpstreamMetadata(upstream, res)
      res.end()
      return
    }

    if (!upstream.body) {
      res.end()
      return
    }

    const shouldRewrite =
      looksLikeM3u8(contentType, target) ||
      (upstream.ok && /\.m3u8(?:[?#]|$)/i.test(target))

    if (shouldRewrite) {
      const raw = await upstream.text()
      const finalUrl = upstream.url || target
      if (/\.m3u8(?:[?#]|$)/i.test(target)) {
        const mediaLines = raw.match(/^#EXT-X-MEDIA:.*$/gim)?.length || 0
        console.log(
          "[xt:stream-proxy] m3u8 status:",
          upstream.status,
          "content-type:",
          contentType,
          "media-lines:",
          mediaLines,
        )
      }
      let rewritten = looksLikeM3u8(contentType, target, raw)
        ? rewriteM3u8Playlist(raw, finalUrl)
        : raw
      rewritten = sanitizeTvMasterPlaylistIfNeeded(rewritten)
      const body = Buffer.from(rewritten, "utf8")
      res.setHeader("Content-Type", contentType || "application/vnd.apple.mpegurl")
      res.setHeader("Content-Length", String(body.byteLength))
      res.end(body)
      return
    }

    applyUpstreamMetadata(upstream, res)

    const reader = upstream.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.byteLength) res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    const fallback = httpFallbackStreamUrl(target)
    if (fallback && target.startsWith("https://")) {
      try {
        console.log("[xt:stream-proxy] tls retry http", redactStreamUrl(fallback).slice(0, 160))
        const upstream = await fetchUpstream(fallback)
        res.statusCode = upstream.status
        applyCorsHeaders(res)
        if (method === "HEAD") {
          applyUpstreamMetadata(upstream, res)
          res.end()
          return
        }
        if (!upstream.body) {
          res.end()
          return
        }
        applyUpstreamMetadata(upstream, res)
        const reader = upstream.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value?.byteLength) res.write(Buffer.from(value))
        }
        res.end()
        return
      } catch (retryErr) {
        console.warn("[xt:stream-proxy] http fallback failed:", retryErr)
      }
    }
    console.warn("[xt:stream-proxy] upstream error:", err)
    res.statusCode = 502
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.end(String((err as Error)?.message || err))
  }
}

export function streamProxyPlugin(): Plugin {
  return {
    name: "xtream-stream-proxy",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(SUBTITLE_PATH, (req, res) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204
          applyCorsHeaders(res)
          res.end()
          return
        }
        if (req.method !== "GET") {
          res.statusCode = 405
          res.end("Method not allowed")
          return
        }
        subtitleHandler(req, res).catch((err) => {
          console.warn("[xt:vod-subtitles] error:", err)
          sendJson(res, 502, { tracks: [], error: String(err?.message || err) })
        })
      })
      server.middlewares.use(SUBTITLE_ASSET_PATH, (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405
          res.end("Method not allowed")
          return
        }
        subtitleAssetHandler(req, res).catch((err) => {
          res.statusCode = 500
          res.end(String(err?.message || err))
        })
      })
      server.middlewares.use(PROXY_PATH, (req, res) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204
          applyCorsHeaders(res)
          res.end()
          return
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.statusCode = 405
          res.end("Method not allowed")
          return
        }
        proxyHandler(req, res).catch((err) => {
          res.statusCode = 500
          res.end(String(err?.message || err))
        })
      })
    },
  }
}

export const STREAM_PROXY_PATH = PROXY_PATH
