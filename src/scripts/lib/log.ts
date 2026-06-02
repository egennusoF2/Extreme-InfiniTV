/**
 * Tiny logging boundary for browser-side code.
 *
 * `error` and `warn` always reach the console so production users can attach
 * stack traces to a bug report. `info` / `debug` / `log` are gated to dev so
 * they don't pollute the console in shipping builds.
 *
 * Future: route through `@tauri-apps/plugin-log` when the plugin is installed
 * on the Rust side - the JS shim accepts the same arg shape, so swapping in is
 * a one-file change here.
 *
 * Existing call sites keep their `[xt:component]` prefix as the first arg.
 */

const isDev = Boolean(import.meta.env?.DEV)

type LogFn = (...args: unknown[]) => void
const noop: LogFn = () => {}

export const log: {
    error: LogFn
    warn: LogFn
    info: LogFn
    debug: LogFn
    log: LogFn
} = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: isDev ? console.info.bind(console) : noop,
    debug: isDev ? console.debug.bind(console) : noop,
    log: isDev ? console.log.bind(console) : noop,
}

const SENSITIVE_PARAMS = /(\b(?:username|user|password|pass|token|auth|key|api_key|apikey)=)([^&#\s]*)/gi
const SENSITIVE_XTREAM_PATH = /(\/(?:live|movie|series)\/)([^/?#\s]+)(\/)([^/?#\s]+)(\/)/gi
const SENSITIVE_ENCODED_XTREAM_PATH =
    /(%2f(?:live|movie|series)%2f)([^%&#\s]+)(%2f)([^%&#\s]+)(%2f)/gi

/**
 * Strip credential-looking query params from any URL or URL-bearing string
 * before it goes to log.error / log.warn. `log.error` is unconditional in
 * production builds (see `error` above). Xtream URLs can carry credentials in
 * either query params or path segments (`/movie/user/pass/id.ext`).
 */
export function redactUrl(input: unknown): string {
    if (input == null) return ""
    const text = typeof input === "string" ? input : String(input)
    return text
        .replace(SENSITIVE_PARAMS, (_match, prefix) => `${prefix}***`)
        .replace(SENSITIVE_XTREAM_PATH, (_match, prefix, _user, sep, _pass, suffix) => (
            `${prefix}***${sep}***${suffix}`
        ))
        .replace(SENSITIVE_ENCODED_XTREAM_PATH, (_match, prefix, _user, sep, _pass, suffix) => (
            `${prefix}***${sep}***${suffix}`
        ))
}
