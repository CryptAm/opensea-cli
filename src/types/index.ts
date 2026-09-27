export type * from "./api.js"

export interface OpenSeaClientConfig {
  apiKey: string
  baseUrl?: string
  chain?: string
  timeout?: number
  verbose?: boolean
  maxRetries?: number
  retryBaseDelay?: number
  /** Scoped JWT token for wallet-authenticated endpoints. */
  authToken?: string
  /**
   * ISO time `authToken` expires at. With `refreshAuthToken`, a request made
   * after it (less a 30s margin) refreshes the token first.
   */
  authTokenExpiresAt?: string
  /**
   * Replace `authToken` and return the new one. Called at most once per
   * client: before a request when `authTokenExpiresAt` has passed, or when a
   * request sent with `authToken` returns 401, which is then retried once.
   */
  refreshAuthToken?: (reason: "expired" | "unauthorized") => Promise<string>
}

export interface CommandOptions {
  apiKey?: string
  chain?: string
  format?: "json" | "table"
  raw?: boolean
}

export interface HealthResult {
  status: "ok" | "error"
  key_prefix: string
  authenticated: boolean
  rate_limited: boolean
  message: string
}
