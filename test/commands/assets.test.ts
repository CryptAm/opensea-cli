import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { assetsCommand } from "../../src/commands/assets.js"
import { type CommandTestContext, createCommandTestContext } from "../mocks.js"

describe("assetsCommand", () => {
  let ctx: CommandTestContext
  let dir: string

  beforeEach(() => {
    ctx = createCommandTestContext()
    dir = mkdtempSync(join(tmpdir(), "cli-test-"))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates command with correct name and subcommands", () => {
    const cmd = assetsCommand(ctx.getClient, ctx.getFormat)
    expect(cmd.name()).toBe("assets")
    const subcommands = cmd.commands.map(c => c.name())
    expect(subcommands).toContain("transfer")
  })

  it("transfer subcommand posts the body file verbatim", async () => {
    const file = join(dir, "body.json")
    const body = {
      chain: "base",
      fromAddress: "0x0000000000000000000000000000000000000001",
      toAddress: "0x0000000000000000000000000000000000000002",
      quantity: "1",
    }
    writeFileSync(file, JSON.stringify(body))
    ctx.mockClient.post.mockResolvedValue({ transactions: [] })

    const cmd = assetsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["transfer", "--body", file], { from: "user" })

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/assets/transfer",
      body,
    )
  })

  it("transfer subcommand reports an unreadable --body file", async () => {
    const cmd = assetsCommand(ctx.getClient, ctx.getFormat)

    await expect(
      cmd.parseAsync(["transfer", "--body", join(dir, "missing.json")], {
        from: "user",
      }),
    ).rejects.toThrow(/Could not read --body/)
    expect(ctx.mockClient.post).not.toHaveBeenCalled()
  })

  it("transfer subcommand reports a --body file that is not JSON", async () => {
    const file = join(dir, "bad.json")
    writeFileSync(file, "{ not valid json")

    const cmd = assetsCommand(ctx.getClient, ctx.getFormat)

    await expect(
      cmd.parseAsync(["transfer", "--body", file], { from: "user" }),
    ).rejects.toThrow(/Could not parse --body/)
    expect(ctx.mockClient.post).not.toHaveBeenCalled()
  })
})
