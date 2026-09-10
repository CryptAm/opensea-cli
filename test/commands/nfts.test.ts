import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nftsCommand } from "../../src/commands/nfts.js"
import { type CommandTestContext, createCommandTestContext } from "../mocks.js"

describe("nftsCommand", () => {
  let ctx: CommandTestContext

  beforeEach(() => {
    ctx = createCommandTestContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates command with correct subcommands", () => {
    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    expect(cmd.name()).toBe("nfts")
    const subcommands = cmd.commands.map(c => c.name())
    expect(subcommands).toContain("get")
    expect(subcommands).toContain("list-by-collection")
    expect(subcommands).toContain("list-by-contract")
    expect(subcommands).toContain("list-by-account")
    expect(subcommands).toContain("refresh")
    expect(subcommands).toContain("contract")
  })

  it("get subcommand fetches NFT", async () => {
    ctx.mockClient.get.mockResolvedValue({ nft: {} })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["get", "ethereum", "0xabc", "1"], { from: "user" })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/chain/ethereum/contract/0xabc/nfts/1",
    )
  })

  it("list-by-collection passes options", async () => {
    ctx.mockClient.get.mockResolvedValue({ nfts: [] })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["list-by-collection", "cool-cats", "--limit", "10"], {
      from: "user",
    })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/collection/cool-cats/nfts",
      expect.objectContaining({ limit: 10 }),
    )
  })

  it("list-by-contract passes options", async () => {
    ctx.mockClient.get.mockResolvedValue({ nfts: [] })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(
      ["list-by-contract", "ethereum", "0xabc", "--limit", "5"],
      { from: "user" },
    )

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/chain/ethereum/contract/0xabc/nfts",
      expect.objectContaining({ limit: 5 }),
    )
  })

  it("list-by-account passes options", async () => {
    ctx.mockClient.get.mockResolvedValue({ nfts: [] })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["list-by-account", "ethereum", "0xabc"], {
      from: "user",
    })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/chain/ethereum/account/0xabc/nfts",
      expect.objectContaining({ limit: 20 }),
    )
  })

  it("list-by-account sends include_auto_hidden only with the flag", async () => {
    ctx.mockClient.get.mockResolvedValue({ nfts: [] })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(
      ["list-by-account", "ethereum", "0xabc", "--include-auto-hidden"],
      { from: "user" },
    )

    // Pinned as the whole params object, so the snake_case wire name is the
    // only spelling that can satisfy it.
    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/chain/ethereum/account/0xabc/nfts",
      { limit: 20, next: undefined, include_auto_hidden: true },
    )
  })

  it("list-by-account omits include_auto_hidden without the flag", async () => {
    ctx.mockClient.get.mockResolvedValue({ nfts: [] })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["list-by-account", "ethereum", "0xabc"], {
      from: "user",
    })

    const params = ctx.mockClient.get.mock.calls[0][1] as Record<
      string,
      unknown
    >
    // `toEqual` treats an undefined-valued key as absent, so read the value
    // directly rather than matching the object shape.
    expect(params.include_auto_hidden).toBeUndefined()
    expect(params.limit).toBe(20)
  })

  it("refresh subcommand calls post", async () => {
    ctx.mockClient.post.mockResolvedValue(undefined)

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["refresh", "ethereum", "0xabc", "1"], {
      from: "user",
    })

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/chain/ethereum/contract/0xabc/nfts/1/refresh",
    )
  })

  it("contract subcommand fetches contract", async () => {
    ctx.mockClient.get.mockResolvedValue({ address: "0xabc" })

    const cmd = nftsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["contract", "ethereum", "0xabc"], { from: "user" })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/chain/ethereum/contract/0xabc",
    )
  })
})
