import type { OpenSeaClientConfig } from "./types/index.js"

declare const __VERSION__: string

const DEFAULT_BASE_URL = "https://api.opensea.io"
const DEFAULT_TIMEOUT_MS = 30_000
const USER_AGENT = `opensea-cli/${__VERSION__}`
const DEFAULT_MAX_RETRIES = 0
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000

/**
 * Largest Retry-After value the client will take from a server, in seconds. A
 * header asking for more is clamped to this.
 *
 * It bounds the remote input, not the total wait. fetchWithRetry takes the
 * greater of this and its own exponential backoff and then adds jitter, and
 * both of those come from the operator's --retry-base-delay rather than from
 * the server. Kept equal to MAX_RETRY_AFTER_SECONDS in
 * packages/sdk/src/api/api.ts.
 */
const MAX_RETRY_AFTER_SECONDS = 300

function isRetryableStatus(status: number, method: string): boolean {
  if (status === 429) return true
  return status >= 500 && method === "GET"
}

/**
 * Parses a Retry-After header into milliseconds.
 *
 * Accepts a positive integer count of seconds or an HTTP-date in the future,
 * and nothing else. Fractional values, trailing units, zero, negatives and past
 * dates all return undefined, which leaves the caller on its own backoff. The
 * returned value is capped at MAX_RETRY_AFTER_SECONDS so a hostile or
 * misconfigured server cannot park the CLI for days on a single header.
 *
 * Dates go through Date.parse, which is looser than the RFC 9110 HTTP-date
 * grammar and will take "Jan 1, 2099". That is deliberate. A hand-rolled
 * grammar is likelier to reject a valid asctime or RFC 850 date than Date.parse
 * is to accept a harmful one, whatever it does accept is still clamped to
 * MAX_RETRY_AFTER_SECONDS, and the SDK parses dates the same way.
 *
 * The SDK carries a second copy of these rules in `_parseRetryAfter` in
 * packages/sdk/src/api/api.ts. It is private there and takes a Response rather
 * than a header string, so the two are kept in sync by hand. Change both.
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const trimmed = header.trim()

  // Anything starting with a digit or a minus sign is a delay-seconds value,
  // never a date, so a malformed one is rejected rather than fed to Date.parse.
  if (/^-?\d/.test(trimmed)) {
    if (!/^-?\d+$/.test(trimmed)) return undefined
    const seconds = Number(trimmed)
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined
    return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1_000
  }

  const parsedMs = Date.parse(trimmed)
  if (Number.isNaN(parsedMs)) return undefined
  const diffSeconds = Math.ceil((parsedMs - Date.now()) / 1_000)
  if (diffSeconds <= 0) return undefined
  return Math.min(diffSeconds, MAX_RETRY_AFTER_SECONDS) * 1_000
}

function appendParams(url: URL, params?: Record<string, unknown>): void {
  if (!params) return
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class OpenSeaClient {
  private apiKey: string
  private authToken: string | undefined
  private baseUrl: string
  private defaultChain: string
  private timeoutMs: number
  private verbose: boolean
  private maxRetries: number
  private retryBaseDelay: number

  constructor(config: OpenSeaClientConfig) {
    this.apiKey = config.apiKey
    this.authToken = config.authToken
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.defaultChain = config.chain ?? "ethereum"
    this.timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS
    this.verbose = config.verbose ?? false
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryBaseDelay = config.retryBaseDelay ?? DEFAULT_RETRY_BASE_DELAY_MS
  }

  private get defaultHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      "x-api-key": this.apiKey,
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
    }
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    appendParams(url, params)

    if (this.verbose) {
      console.error(`[verbose] GET ${url.toString()}`)
    }

    const response = await this.fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: this.defaultHeaders,
      },
      path,
    )

    return response.json() as Promise<T>
  }

  async getAsMarkdown(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<{ text: string; isMarkdown: boolean }> {
    const url = new URL(`${this.baseUrl}${path}`)
    appendParams(url, params)

    if (this.verbose) {
      console.error(`[verbose] GET ${url.toString()} (Accept: text/markdown)`)
    }

    const response = await this.fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: { ...this.defaultHeaders, Accept: "text/markdown" },
      },
      path,
    )

    const contentType = response.headers.get("content-type") ?? ""
    const text = await response.text()
    return {
      text,
      isMarkdown: contentType.includes("text/markdown"),
    }
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.write("POST", path, body, params)
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.write("PUT", path, body, params)
  }

  async patch<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.write("PATCH", path, body, params)
  }

  async delete<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.write("DELETE", path, body, params)
  }

  private async write<T>(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    appendParams(url, params)

    const headers: Record<string, string> = { ...this.defaultHeaders }

    if (body) {
      headers["Content-Type"] = "application/json"
    }

    if (this.verbose) {
      console.error(`[verbose] ${method} ${url.toString()}`)
    }

    const response = await this.fetchWithRetry(
      url.toString(),
      {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      },
      path,
    )

    if (
      response.status === 204 ||
      response.headers.get("content-length") === "0"
    ) {
      return undefined as T
    }
    const text = await response.text()
    return (text.length > 0 ? JSON.parse(text) : undefined) as T
  }

  getDefaultChain(): string {
    return this.defaultChain
  }

  getApiKeyPrefix(): string {
    if (this.apiKey.length < 8) return "***"
    return `${this.apiKey.slice(0, 4)}...`
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    path: string,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      if (this.verbose) {
        console.error(`[verbose] ${response.status} ${response.statusText}`)
      }

      if (response.ok) {
        return response
      }

      const method = init.method ?? "GET"
      if (
        attempt < this.maxRetries &&
        isRetryableStatus(response.status, method)
      ) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("Retry-After"),
        )
        const backoffMs = this.retryBaseDelay * 2 ** attempt
        const jitterMs = Math.random() * this.retryBaseDelay
        const delayMs = Math.max(retryAfterMs ?? 0, backoffMs) + jitterMs

        if (this.verbose) {
          console.error(
            `[verbose] Retry ${attempt + 1}/${this.maxRetries} after ${Math.round(delayMs)}ms (status ${response.status})`,
          )
        }

        try {
          await response.body?.cancel()
        } catch {
          // Stream may already be disturbed
        }
        await sleep(delayMs)
        continue
      }

      const text = await response.text()
      throw new OpenSeaAPIError(response.status, text, path)
    }
  }
}

export class OpenSeaAPIError extends Error {
  constructor(
    public statusCode: number,
    public responseBody: string,
    public path: string,
  ) {
    super(`OpenSea API error ${statusCode} on ${path}: ${responseBody}`)
    this.name = "OpenSeaAPIError"
  }
}
