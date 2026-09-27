import type { Command } from "commander"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest"
import { createProgram } from "../src/program.js"

// These parse real argv through the full `opensea` program, not a lone
// subcommand. The program defines its own `--chain`, and commander hands a
// program option to the program wherever it appears on the line, so a
// subcommand's `--chain` only works if the program passes the value down.
// Parsing the subcommand alone can never catch that.

const SENDER = "0xAbCdEf0000000000000000000000000000000001"

const deployArgs = [
  "--name",
  "A",
  "--symbol",
  "A",
  "--drop-type",
  "seadrop_v2_erc1155_self_mint",
  "--token-type",
  "erc1155_clone",
  "--sender",
  SENDER,
]

let fetchSpy: MockInstance<typeof fetch>

function respondWith(data: unknown): void {
  fetchSpy.mockImplementation(
    async () => new Response(JSON.stringify(data), { status: 200 }),
  )
}

function requestedUrl(call = 0): URL {
  return new URL(String(fetchSpy.mock.calls[call][0]))
}

function requestedBody(call = 0): Record<string, unknown> {
  const init = fetchSpy.mock.calls[call][1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

async function run(...argv: string[]): Promise<void> {
  await createProgram().parseAsync(argv, { from: "user" })
}

beforeEach(() => {
  vi.stubEnv("OPENSEA_API_KEY", "test-key")
  vi.stubEnv("OPENSEA_AUTH_TOKEN", "")
  fetchSpy = vi.spyOn(globalThis, "fetch")
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("subcommand --chain through the full program", () => {
  describe("drops deploy", () => {
    const deployTx = {
      to: "0x2222222222222222222222222222222222222222",
      data: "0xdeadbeef",
      value: "0x0",
      chain: "base",
    }

    it.each([
      ["before the other flags", ["--chain", "base", ...deployArgs]],
      ["last", [...deployArgs, "--chain", "base"]],
    ])("sends the chain the user passed (--chain %s)", async (_, flags) => {
      respondWith(deployTx)

      await run("drops", "deploy", ...flags)

      expect(requestedUrl().pathname).toBe("/api/v2/drops/deploy")
      expect(requestedBody()).toMatchObject({ chain: "base", sender: SENDER })
    })

    it("accepts --chain placed before the subcommand", async () => {
      respondWith(deployTx)

      await run("--chain", "base", "drops", "deploy", ...deployArgs)

      expect(requestedBody()).toMatchObject({ chain: "base" })
    })

    it("refuses to fall back to the program's default chain", async () => {
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true)
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit")
      })

      await expect(run("drops", "deploy", ...deployArgs)).rejects.toThrow(
        "process.exit",
      )

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(stderr.mock.calls.flat().join("")).toContain(
        "required option '--chain <chain>' not specified",
      )
    })
  })

  describe("accounts token-transfers", () => {
    it("sends the chain the user passed", async () => {
      respondWith({ transfers: [] })

      await run(
        "accounts",
        "token-transfers",
        "0x1111111111111111111111111111111111111111",
        "--contract-address",
        "0x2222222222222222222222222222222222222222",
        "--chain",
        "base",
      )

      expect(requestedUrl().pathname).toBe(
        "/api/v2/account/0x1111111111111111111111111111111111111111/pnl/token-transfers",
      )
      expect(requestedUrl().searchParams.get("chain")).toBe("base")
    })

    it("errors instead of defaulting to ethereum when --chain is missing", async () => {
      vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit")
      })

      await expect(
        run(
          "accounts",
          "token-transfers",
          "0x1111111111111111111111111111111111111111",
          "--contract-address",
          "0x2222222222222222222222222222222222222222",
        ),
      ).rejects.toThrow("process.exit")

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe("--chain filters", () => {
    it.each([
      [["collections", "list"], "/api/v2/collections"],
      [["events", "list"], "/api/v2/events"],
      [
        ["events", "by-account", "0x1111111111111111111111111111111111111111"],
        "/api/v2/events/accounts/0x1111111111111111111111111111111111111111",
      ],
    ])("%j --chain base filters by base", async (command, path) => {
      respondWith({})

      await run(...command, "--chain", "base")

      expect(requestedUrl().pathname).toBe(path)
      expect(requestedUrl().searchParams.get("chain")).toBe("base")
    })

    it("does not send the program's default chain as a filter", async () => {
      respondWith({})

      await run("collections", "list")

      expect(requestedUrl().searchParams.has("chain")).toBe(false)
    })
  })

  // Commander checks a mandatory option before any hook runs, so a
  // `requiredOption("--chain ...")` on a subcommand can never be satisfied:
  // the program has already taken the value. Required chains are checked in
  // the action instead.
  it("no subcommand declares --chain as a mandatory option", () => {
    const declared: string[] = []
    const mandatory: string[] = []
    const visit = (cmd: Command, path: string[]) => {
      for (const option of cmd.options) {
        if (path.length === 0 || option.long !== "--chain") continue
        declared.push(path.join(" "))
        if (option.mandatory) mandatory.push(path.join(" "))
      }
      for (const sub of cmd.commands) visit(sub, [...path, sub.name()])
    }
    visit(createProgram(), [])

    expect(declared).toEqual(
      expect.arrayContaining(["drops deploy", "accounts token-transfers"]),
    )
    expect(mandatory).toEqual([])
  })
})
