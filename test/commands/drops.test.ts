import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { EvmWalletAdapter } from "@opensea/wallet-adapters"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dropsCommand } from "../../src/commands/drops.js"
import { type CommandTestContext, createCommandTestContext } from "../mocks.js"

const walletMock = vi.hoisted(() => ({ createWalletFromEnv: vi.fn() }))

vi.mock("../../src/wallet/index.js", async importOriginal => ({
  ...(await importOriginal<object>()),
  createWalletFromEnv: walletMock.createWalletFromEnv,
}))

const OWNER = "0xAbCdEf0000000000000000000000000000000001"

const publishTx = {
  to: "0x2222222222222222222222222222222222222222",
  from: OWNER,
  data: "0xdeadbeef",
  value: "0",
  chain: "base",
}

function evmWallet(address: string): EvmWalletAdapter {
  return {
    name: "mock",
    chainType: "evm",
    capabilities: {
      signMessage: true,
      signTypedData: false,
      managedGas: false,
      managedNonce: false,
    },
    getAddress: vi.fn(async () => address),
    sendTransaction: vi.fn(async () => ({ hash: "0xhash" })),
  } as EvmWalletAdapter
}

function writeTempFile(name: string, contents: string | Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"))
  const file = join(dir, name)
  writeFileSync(file, contents)
  return file
}

const uploadContext = {
  url: "https://uploads.example.com/",
  method: "POST",
  fields: {
    key: "uploads/manifest.csv",
    "Content-Type": "text/csv",
    success_action_status: "201",
  },
  token: "upload-token",
}

function writeTempJson(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"))
  const file = join(dir, "body.json")
  writeFileSync(file, JSON.stringify(data))
  return file
}

describe("dropsCommand", () => {
  let ctx: CommandTestContext

  beforeEach(() => {
    ctx = createCommandTestContext()
    walletMock.createWalletFromEnv.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates command with correct name and subcommands", () => {
    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    expect(cmd.name()).toBe("drops")
    const subcommands = cmd.commands.map(c => c.name())
    expect(subcommands).toContain("list")
    expect(subcommands).toContain("get")
    expect(subcommands).toContain("eligibility")
    expect(subcommands).toContain("mint")
    expect(subcommands).toContain("cross-chain-mint")
  })

  it("list subcommand passes options", async () => {
    ctx.mockClient.get.mockResolvedValue({ drops: [] })

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(
      [
        "list",
        "--type",
        "upcoming",
        "--chains",
        "ethereum,base",
        "--limit",
        "10",
        "--next",
        "abc",
      ],
      { from: "user" },
    )

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/drops",
      expect.objectContaining({
        type: "upcoming",
        chains: "ethereum,base",
        limit: 10,
        cursor: "abc",
      }),
    )
  })

  it("get subcommand fetches drop by slug", async () => {
    ctx.mockClient.get.mockResolvedValue({ collection_slug: "cool-cats" })

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["get", "cool-cats"], { from: "user" })

    expect(ctx.mockClient.get).toHaveBeenCalledWith("/api/v2/drops/cool-cats")
  })

  it("eligibility subcommand fetches eligibility by slug", async () => {
    const response = {
      stages: [
        {
          stage_uuid: "12345678-1234-1234-1234-123456789abc",
          is_eligible: true,
        },
      ],
    }
    ctx.mockClient.get.mockResolvedValue(response)

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["eligibility", "cool-cats"], { from: "user" })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/eligibility",
    )
    expect(ctx.consoleSpy).toHaveBeenCalledWith(
      JSON.stringify(response, null, 2),
    )
  })

  it("eligibility subcommand propagates API errors", async () => {
    const error = new Error("Wallet is not eligible")
    ctx.mockClient.get.mockRejectedValue(error)

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)

    await expect(
      cmd.parseAsync(["eligibility", "cool-cats"], { from: "user" }),
    ).rejects.toBe(error)
  })

  it("mint subcommand posts mint request", async () => {
    ctx.mockClient.post.mockResolvedValue({
      to: "0x123",
      data: "0x",
      value: "0x0",
      chain: "ethereum",
    })

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(
      [
        "mint",
        "cool-cats",
        "--minter",
        "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "--quantity",
        "2",
      ],
      { from: "user" },
    )

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/mint",
      { minter: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", quantity: 2 },
    )
  })

  it("cross-chain-mint posts payer, minter, quantity, and payment asset", async () => {
    ctx.mockClient.post.mockResolvedValue({
      transactions: [],
      receipt_request: {
        swap_quote: { from_assets: [] },
        relay_request_id: "0xrequest",
      },
    })

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(
      [
        "cross-chain-mint",
        "pyro-on-ape",
        "--payer",
        "0x1111111111111111111111111111111111111111",
        "--minter",
        "0x2222222222222222222222222222222222222222",
        "--payment-chain",
        "base",
        "--payment-token",
        "0x0000000000000000000000000000000000000000",
        "--quantity",
        "2",
      ],
      { from: "user" },
    )

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/drops/pyro-on-ape/cross_chain_mint",
      {
        payer: "0x1111111111111111111111111111111111111111",
        minter: "0x2222222222222222222222222222222222222222",
        quantity: 2,
        payment: {
          chain: "base",
          token_address: "0x0000000000000000000000000000000000000000",
        },
      },
    )
  })

  it("save-edits posts the request body", async () => {
    ctx.mockClient.post.mockResolvedValue({ success: true })
    const body = { stages: [] }
    const file = writeTempJson(body)

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    try {
      await cmd.parseAsync(["save-edits", "cool-cats", "--body", file], {
        from: "user",
      })
    } finally {
      rmSync(file, { force: true })
    }

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats",
      body,
    )
  })

  it("create-allowlist-upload posts to the allowlist endpoint", async () => {
    ctx.mockClient.post.mockResolvedValue({ upload_url: "https://x" })

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["create-allowlist-upload", "cool-cats"], {
      from: "user",
    })

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/allowlist",
    )
  })

  it("update-item PATCHes a drop item by token id", async () => {
    ctx.mockClient.patch.mockResolvedValue({ success: true })
    const body = { media_token: "t", name: "Item" }
    const file = writeTempJson(body)

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    try {
      await cmd.parseAsync(["update-item", "cool-cats", "7", "--body", file], {
        from: "user",
      })
    } finally {
      rmSync(file, { force: true })
    }

    expect(ctx.mockClient.patch).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/items/7",
      body,
    )
  })

  it("update-self-mint-item PUTs a self-mint item by token id", async () => {
    ctx.mockClient.put.mockResolvedValue({ success: true })
    const body = { media_token: "t", name: "Item" }
    const file = writeTempJson(body)

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    try {
      await cmd.parseAsync(
        ["update-self-mint-item", "cool-cats", "7", "--body", file],
        { from: "user" },
      )
    } finally {
      rmSync(file, { force: true })
    }

    expect(ctx.mockClient.put).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/items/7",
      body,
    )
  })

  describe("publish and unpublish", () => {
    it("publish without --send prints the transaction and never opens a wallet", async () => {
      ctx.mockClient.post.mockResolvedValue(publishTx)

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["publish", "cool-cats"], { from: "user" })

      expect(ctx.mockClient.post).toHaveBeenCalledWith(
        "/api/v2/drops/cool-cats/publish",
      )
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(publishTx, null, 2),
      )
      expect(walletMock.createWalletFromEnv).not.toHaveBeenCalled()
    })

    it("unpublish posts to the unpublish endpoint", async () => {
      ctx.mockClient.post.mockResolvedValue(publishTx)

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["unpublish", "cool-cats"], { from: "user" })

      expect(ctx.mockClient.post).toHaveBeenCalledWith(
        "/api/v2/drops/cool-cats/unpublish",
      )
    })

    it("publish --send refuses a wallet that is not the transaction's from", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      ctx.mockClient.post.mockResolvedValue(publishTx)
      const wallet = evmWallet("0x9999999999999999999999999999999999999999")
      walletMock.createWalletFromEnv.mockReturnValue(wallet)

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await expect(
        cmd.parseAsync(["publish", "cool-cats", "--send"], { from: "user" }),
      ).rejects.toThrow(`is not the contract owner ${OWNER}`)

      expect(wallet.sendTransaction).not.toHaveBeenCalled()
      expect(ctx.consoleSpy).not.toHaveBeenCalled()
    })

    it("publish --send rejects a Solana wallet before building the transaction", async () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {})
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit")
      })
      walletMock.createWalletFromEnv.mockReturnValue({
        name: "svm-mock",
        chainType: "svm",
        capabilities: {},
        getAddress: async () => "So11111111111111111111111111111111111111112",
        signTransaction: async () => ({ signedTransaction: "" }),
      })

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await expect(
        cmd.parseAsync(["publish", "cool-cats", "--send"], { from: "user" }),
      ).rejects.toThrow("process.exit")

      expect(ctx.mockClient.post).not.toHaveBeenCalled()
      expect(stderr.mock.calls.flat().join("\n")).toContain(
        "drop publish requires an EVM wallet",
      )
    })

    it("publish --send signs from the owner, matching its address case-insensitively", async () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {})
      ctx.mockClient.post.mockResolvedValue(publishTx)
      const wallet = evmWallet(OWNER.toLowerCase())
      walletMock.createWalletFromEnv.mockReturnValue(wallet)

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["publish", "cool-cats", "--send"], {
        from: "user",
      })

      expect(wallet.sendTransaction).toHaveBeenCalledWith({
        to: publishTx.to,
        data: publishTx.data,
        value: publishTx.value,
        chainId: 8453,
      })
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ hash: "0xhash" }, null, 2),
      )
      expect(stderr.mock.calls.flat().join("\n")).toContain(
        "Sending publish transaction",
      )
    })
  })

  describe("upload-metadata-ipfs", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it("prints the started upload without --wait", async () => {
      ctx.mockClient.post.mockResolvedValue({ workflow_execution_id: "run-1" })

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["upload-metadata-ipfs", "cool-cats"], {
        from: "user",
      })

      expect(ctx.mockClient.post).toHaveBeenCalledWith(
        "/api/v2/drops/cool-cats/metadata/ipfs",
      )
      expect(ctx.mockClient.get).not.toHaveBeenCalled()
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ workflow_execution_id: "run-1" }, null, 2),
      )
    })

    it("--wait polls until completed and prints the final status", async () => {
      vi.useFakeTimers()
      vi.spyOn(console, "error").mockImplementation(() => {})
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never)
      ctx.mockClient.post.mockResolvedValue({ workflow_execution_id: "run-1" })
      ctx.mockClient.get
        .mockResolvedValueOnce({ status: "running", media_upload_progress: 50 })
        .mockResolvedValueOnce({ status: "completed" })

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      const run = cmd.parseAsync(
        ["upload-metadata-ipfs", "cool-cats", "--wait"],
        { from: "user" },
      )
      await vi.advanceTimersByTimeAsync(5_000)
      await run

      expect(ctx.mockClient.get).toHaveBeenCalledTimes(2)
      expect(ctx.mockClient.get).toHaveBeenLastCalledWith(
        "/api/v2/drops/cool-cats/metadata/ipfs/run-1",
      )
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          { workflow_execution_id: "run-1", status: "completed" },
          null,
          2,
        ),
      )
      expect(exitSpy).not.toHaveBeenCalled()
    })

    it("--wait exits non-zero with the failure reason on failed", async () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {})
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never)
      ctx.mockClient.post.mockResolvedValue({ workflow_execution_id: "run-1" })
      ctx.mockClient.get.mockResolvedValue({
        status: "failed",
        failure_reason: "pin failed",
      })

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["upload-metadata-ipfs", "cool-cats", "--wait"], {
        from: "user",
      })

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderr.mock.calls.flat().join("\n")).toContain(
        "IPFS upload failed: pin failed",
      )
    })

    it("rejects bad wait options before starting the upload", async () => {
      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await expect(
        cmd.parseAsync(
          ["upload-metadata-ipfs", "cool-cats", "--wait", "--interval", "0"],
          { from: "user" },
        ),
      ).rejects.toThrow("--interval must be at least 1 second")
      await expect(
        dropsCommand(ctx.getClient, ctx.getFormat).parseAsync(
          [
            "upload-metadata-ipfs",
            "cool-cats",
            "--wait",
            "--wait-timeout",
            "x",
          ],
          { from: "user" },
        ),
      ).rejects.toThrow("--wait-timeout")

      expect(ctx.mockClient.post).not.toHaveBeenCalled()
    })

    it("--wait exits non-zero when the upload is not found", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never)
      ctx.mockClient.post.mockResolvedValue({ workflow_execution_id: "run-1" })
      ctx.mockClient.get.mockResolvedValue({ status: "not_found" })

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["upload-metadata-ipfs", "cool-cats", "--wait"], {
        from: "user",
      })

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it("--wait gives up after --wait-timeout while still running", async () => {
      vi.useFakeTimers()
      vi.spyOn(console, "error").mockImplementation(() => {})
      ctx.mockClient.post.mockResolvedValue({ workflow_execution_id: "run-1" })
      ctx.mockClient.get.mockResolvedValue({ status: "running" })

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      const run = cmd.parseAsync(
        [
          "upload-metadata-ipfs",
          "cool-cats",
          "--wait",
          "--interval",
          "5",
          "--wait-timeout",
          "12",
        ],
        { from: "user" },
      )
      const outcome = expect(run).rejects.toThrow("Timed out after 12000ms")
      await vi.advanceTimersByTimeAsync(12_000)
      await outcome

      // Polls at 0s, 5s, 10s and a last time at the 12s deadline.
      expect(ctx.mockClient.get).toHaveBeenCalledTimes(4)
    })
  })

  it("metadata-ipfs-status fetches progress for the execution id", async () => {
    ctx.mockClient.get.mockResolvedValue({ status: "running" })

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["metadata-ipfs-status", "cool-cats", "run-1"], {
      from: "user",
    })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/metadata/ipfs/run-1",
    )
  })

  it("create-manifest-upload posts to the manifest endpoint without a body", async () => {
    ctx.mockClient.post.mockResolvedValue(uploadContext)

    const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["create-manifest-upload", "cool-cats"], {
      from: "user",
    })

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/drops/cool-cats/items/manifest",
    )
    expect(ctx.consoleSpy).toHaveBeenCalledWith(
      JSON.stringify(uploadContext, null, 2),
    )
  })

  describe("upload-file", () => {
    const files: string[] = []

    afterEach(() => {
      for (const file of files.splice(0)) rmSync(file, { force: true })
    })

    function tempFile(name: string, contents: string | Uint8Array): string {
      const file = writeTempFile(name, contents)
      files.push(file)
      return file
    }

    it("sends every field unchanged, then the file last, and prints the token", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 204 }))
      const contextFile = tempFile(
        "context.json",
        JSON.stringify(uploadContext),
      )
      const csv = "tokenID,name,description,file_name\n1,One,First,1.png\n"
      const csvFile = tempFile("manifest.csv", csv)

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(
        ["upload-file", "--context", contextFile, "--file", csvFile],
        { from: "user" },
      )

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(uploadContext.url)
      expect(init.method).toBe("POST")
      expect(init.redirect).toBe("error")
      expect(init.headers).toBeUndefined()
      const form = init.body as FormData
      const entries = [...form.entries()]
      expect(entries.map(([name]) => name)).toEqual([
        "key",
        "Content-Type",
        "success_action_status",
        "file",
      ])
      expect(Object.fromEntries(entries.slice(0, 3))).toEqual(
        uploadContext.fields,
      )
      const file = form.get("file") as File
      expect(file.name).toBe("manifest.csv")
      expect(await file.text()).toBe(csv)
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ token: "upload-token" }, null, 2),
      )
    })

    it("reads the context from stdin with --context -", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 204 }))
      vi.spyOn(process, "stdin", "get").mockReturnValue(
        Readable.from([
          Buffer.from(JSON.stringify(uploadContext)),
        ]) as unknown as typeof process.stdin,
      )
      const file = tempFile("image.png", new Uint8Array([1, 2, 3]))

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(["upload-file", "--context", "-", "--file", file], {
        from: "user",
      })

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(uploadContext.url)
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ token: "upload-token" }, null, 2),
      )
    })

    it("uses --index to pick one context from an array", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 204 }))
      const second = {
        ...uploadContext,
        url: "https://uploads.example.com/second",
        token: "second-token",
      }
      const contextFile = tempFile(
        "contexts.json",
        JSON.stringify([uploadContext, second]),
      )
      const file = tempFile("2.png", new Uint8Array([2]))

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await expect(
        cmd.parseAsync(
          ["upload-file", "--context", contextFile, "--file", file],
          { from: "user" },
        ),
      ).rejects.toThrow("pass --index <n>")
      expect(fetchSpy).not.toHaveBeenCalled()

      await dropsCommand(ctx.getClient, ctx.getFormat).parseAsync(
        [
          "upload-file",
          "--context",
          contextFile,
          "--file",
          file,
          "--index",
          "1",
        ],
        { from: "user" },
      )
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(second.url)
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ token: "second-token" }, null, 2),
      )
    })

    it("sends the raw bytes for a PUT context", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }))
      const putContext = {
        url: "https://uploads.example.com/put",
        method: "PUT",
        fields: {},
        token: "put-token",
      }
      const contextFile = tempFile("context.json", JSON.stringify(putContext))
      const file = tempFile("image.png", new Uint8Array([7, 8, 9]))

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      await cmd.parseAsync(
        ["upload-file", "--context", contextFile, "--file", file],
        { from: "user" },
      )

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(putContext.url)
      expect(init.method).toBe("PUT")
      expect(init.redirect).toBe("error")
      expect(init.headers).toBeUndefined()
      const body = init.body as Blob
      expect(body).toBeInstanceOf(Blob)
      expect([...new Uint8Array(await body.arrayBuffer())]).toEqual([7, 8, 9])
      expect(ctx.consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ token: "put-token" }, null, 2),
      )
    })

    it("refuses a context url that is not https", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      const file = tempFile("manifest.csv", "tokenID\n")
      for (const url of ["http://uploads.example.com/", "file:///etc/passwd"]) {
        const contextFile = tempFile(
          "context.json",
          JSON.stringify({ ...uploadContext, url }),
        )
        await expect(
          dropsCommand(ctx.getClient, ctx.getFormat).parseAsync(
            ["upload-file", "--context", contextFile, "--file", file],
            { from: "user" },
          ),
        ).rejects.toThrow("must use https")
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("fails with the status and the start of the body on a non-2xx upload", async () => {
      const body = `<Error><Code>AccessDenied</Code>${"x".repeat(1_000)}</Error>`
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, { status: 403 }),
      )
      const contextFile = tempFile(
        "context.json",
        JSON.stringify(uploadContext),
      )
      const file = tempFile("manifest.csv", "tokenID\n")

      const cmd = dropsCommand(ctx.getClient, ctx.getFormat)
      const run = cmd.parseAsync(
        ["upload-file", "--context", contextFile, "--file", file],
        { from: "user" },
      )

      await expect(run).rejects.toThrow(
        "Storage upload failed with HTTP 403: <Error><Code>AccessDenied</Code>",
      )
      await expect(run).rejects.toSatisfy(
        (error: Error) => !error.message.includes("x".repeat(600)),
      )
      expect(ctx.consoleSpy).not.toHaveBeenCalled()
    })
  })
})
