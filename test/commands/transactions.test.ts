import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { transactionsCommand } from "../../src/commands/transactions.js"
import { type CommandTestContext, createCommandTestContext } from "../mocks.js"

function writeTempFile(contents: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "opensea-cli-transactions-"))
  const file = join(dir, "request.json")
  writeFileSync(file, contents)
  return { dir, file }
}

describe("transactionsCommand", () => {
  let ctx: CommandTestContext

  beforeEach(() => {
    ctx = createCommandTestContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates the receipt subcommand", () => {
    const cmd = transactionsCommand(ctx.getClient, ctx.getFormat)

    expect(cmd.name()).toBe("transactions")
    expect(cmd.commands.map(command => command.name())).toContain("receipt")
  })

  it("posts the parsed request body to the receipt endpoint", async () => {
    ctx.mockClient.post.mockResolvedValue({ status: "confirmed" })
    const body = { swap_quote: { id: "quote-1" } }
    const { dir, file } = writeTempFile(JSON.stringify(body))

    const cmd = transactionsCommand(ctx.getClient, ctx.getFormat)
    try {
      await cmd.parseAsync(["receipt", "--request", file], { from: "user" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/transactions/receipt",
      body,
    )
    expect(ctx.consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ status: "confirmed" }, null, 2),
    )
  })

  it("names the option and path when the request file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opensea-cli-transactions-"))
    const missing = join(dir, "missing.json")

    const cmd = transactionsCommand(ctx.getClient, ctx.getFormat)
    try {
      await expect(
        cmd.parseAsync(["receipt", "--request", missing], { from: "user" }),
      ).rejects.toThrow(`--request: could not read or parse '${missing}': `)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(ctx.mockClient.post).not.toHaveBeenCalled()
  })

  it("names the option and path when the request file is invalid JSON", async () => {
    const { dir, file } = writeTempFile("{ not json }")

    const cmd = transactionsCommand(ctx.getClient, ctx.getFormat)
    try {
      await expect(
        cmd.parseAsync(["receipt", "--request", file], { from: "user" }),
      ).rejects.toThrow(`--request: could not read or parse '${file}': `)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(ctx.mockClient.post).not.toHaveBeenCalled()
  })

  it("requires --request", async () => {
    const cmd = transactionsCommand(ctx.getClient, ctx.getFormat)
    const receipt = cmd.commands.find(command => command.name() === "receipt")
    expect(receipt).toBeDefined()
    receipt?.exitOverride()

    await expect(cmd.parseAsync(["receipt"], { from: "user" })).rejects.toThrow(
      "error: required option '--request <file>' not specified",
    )
    expect(ctx.mockClient.post).not.toHaveBeenCalled()
  })
})
