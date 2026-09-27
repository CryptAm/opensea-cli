import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isAuthTokenExpired,
  OpenSeaAPIError,
  OpenSeaClient,
} from "../src/client.js"

const PAST = "2020-01-01T00:00:00.000Z"
const FUTURE = "2999-01-01T00:00:00.000Z"

function authHeaders(fetchSpy: ReturnType<typeof vi.fn>): string[] {
  return fetchSpy.mock.calls.map(
    call =>
      ((call[1] as RequestInit).headers as Record<string, string>)
        .Authorization,
  )
}

function stubFetch(...statuses: number[]) {
  const fetchSpy = vi.fn(async () => {
    const status = statuses.shift() ?? 200
    return new Response(JSON.stringify({ ok: status < 400 }), { status })
  })
  vi.stubGlobal("fetch", fetchSpy)
  return fetchSpy
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("isAuthTokenExpired", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z")

  it("treats a token inside the 30s margin, or an unparseable time, as expired", () => {
    expect(isAuthTokenExpired("2026-01-01T00:00:30.000Z", now)).toBe(true)
    expect(isAuthTokenExpired("2026-01-01T00:00:31.000Z", now)).toBe(false)
    expect(isAuthTokenExpired("not a date", now)).toBe(true)
  })
})

describe("OpenSeaClient auth token refresh", () => {
  it("refreshes an expired token before the request", async () => {
    const fetchSpy = stubFetch(200)
    const refreshAuthToken = vi.fn(async () => "new-token")
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      authTokenExpiresAt: PAST,
      refreshAuthToken,
    })

    await client.get("/api/v2/drops/x/eligibility")

    expect(refreshAuthToken).toHaveBeenCalledWith("expired")
    expect(authHeaders(fetchSpy)).toEqual(["Bearer new-token"])
  })

  it("does not refresh a token that has not expired", async () => {
    const fetchSpy = stubFetch(200)
    const refreshAuthToken = vi.fn(async () => "new-token")
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      authTokenExpiresAt: FUTURE,
      refreshAuthToken,
    })

    await client.post("/api/v2/drops/x/publish")

    expect(refreshAuthToken).not.toHaveBeenCalled()
    expect(authHeaders(fetchSpy)).toEqual(["Bearer old-token"])
  })

  it("refreshes once on a 401 and resends the request with the new token", async () => {
    const fetchSpy = stubFetch(401, 200)
    const refreshAuthToken = vi.fn(async () => "new-token")
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      authTokenExpiresAt: FUTURE,
      refreshAuthToken,
    })

    await expect(client.post("/api/v2/drops/x/publish")).resolves.toEqual({
      ok: true,
    })

    expect(refreshAuthToken).toHaveBeenCalledExactlyOnceWith("unauthorized")
    expect(authHeaders(fetchSpy)).toEqual([
      "Bearer old-token",
      "Bearer new-token",
    ])
  })

  it("throws the 401 when the refreshed token is rejected too", async () => {
    const fetchSpy = stubFetch(401, 401, 401)
    const refreshAuthToken = vi.fn(async () => "new-token")
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      refreshAuthToken,
    })

    await expect(client.get("/api/v2/x")).rejects.toBeInstanceOf(
      OpenSeaAPIError,
    )
    await expect(client.get("/api/v2/x")).rejects.toBeInstanceOf(
      OpenSeaAPIError,
    )

    expect(refreshAuthToken).toHaveBeenCalledTimes(1)
    // The second request already carries the refreshed token, so its 401 is
    // not retried.
    expect(authHeaders(fetchSpy)).toEqual([
      "Bearer old-token",
      "Bearer new-token",
      "Bearer new-token",
    ])
  })

  it("shares one refresh between concurrent 401s", async () => {
    const fetchSpy = stubFetch(401, 401, 200, 200)
    const refreshAuthToken = vi.fn(async () => "new-token")
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      refreshAuthToken,
    })

    await Promise.all([client.get("/api/v2/a"), client.get("/api/v2/b")])

    expect(refreshAuthToken).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it("sends a public request with the old token when the refresh fails", async () => {
    const fetchSpy = stubFetch(200)
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      authTokenExpiresAt: PAST,
      refreshAuthToken: async () => {
        throw new Error("refresh token rejected")
      },
    })

    await expect(client.get("/api/v2/collections")).resolves.toEqual({
      ok: true,
    })
    expect(authHeaders(fetchSpy)).toEqual(["Bearer old-token"])
  })

  it("throws the refresh failure when the server then answers 401", async () => {
    const fetchSpy = stubFetch(401)
    const refreshAuthToken = vi.fn(async () => {
      throw new Error("refresh token rejected")
    })
    const client = new OpenSeaClient({
      apiKey: "key",
      authToken: "old-token",
      authTokenExpiresAt: PAST,
      refreshAuthToken,
    })

    await expect(client.post("/api/v2/drops/x/publish")).rejects.toThrow(
      "refresh token rejected",
    )
    expect(refreshAuthToken).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("does not retry a 401 without a refresh callback or without a token", async () => {
    const fetchSpy = stubFetch(401, 401)
    const refreshAuthToken = vi.fn(async () => "new-token")

    await expect(
      new OpenSeaClient({ apiKey: "key", authToken: "t" }).get("/api/v2/x"),
    ).rejects.toBeInstanceOf(OpenSeaAPIError)
    await expect(
      new OpenSeaClient({ apiKey: "key", refreshAuthToken }).get("/api/v2/x"),
    ).rejects.toBeInstanceOf(OpenSeaAPIError)

    expect(refreshAuthToken).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
