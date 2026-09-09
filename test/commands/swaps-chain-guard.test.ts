import type { SvmWalletAdapter } from "@opensea/wallet-adapters"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * `swaps execute` builds EVM transactions, so a Solana wallet cannot run it.
 *
 * Everything is imported inside the test, after `vi.doMock`. A top-level import of the test
 * helpers pulls the wallet module into the registry transitively, and the mock then has no effect.
 */

const svm: SvmWalletAdapter = {
  name: "svm-mock",
  chainType: "svm",
  capabilities: {
    signMessage: true,
    signTypedData: false,
    managedGas: false,
    managedNonce: false,
  },
  getAddress: async () => "So11111111111111111111111111111111111111112",
  signTransaction: async () => ({ signedTransaction: "" }),
}

describe("swaps execute chain-type guard", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("../../src/wallet/index.js")
  })

  it("rejects a Solana wallet, naming the provider and the reason", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit")
    })
    vi.resetModules()
    vi.doMock("../../src/wallet/index.js", async () => ({
      ...(await vi.importActual<object>("../../src/wallet/index.js")),
      createWalletFromEnv: () => svm,
    }))

    const { createCommandTestContext } = await import("../mocks.js")
    const { swapsCommand } = await import("../../src/commands/swaps.js")
    const ctx = createCommandTestContext()

    await expect(
      swapsCommand(ctx.getClient, ctx.getFormat).parseAsync(
        [
          "execute",
          "--from-chain",
          "ethereum",
          "--from-address",
          "0x0000000000000000000000000000000000000000",
          "--to-chain",
          "ethereum",
          "--to-address",
          "0x1111111111111111111111111111111111111111",
          "--quantity",
          "1",
        ],
        // Without this commander drops the first two entries as argv[0]/argv[1] and reports
        // "unknown command 'ethereum'", exiting before the action ever runs.
        { from: "user" },
      ),
    ).rejects.toThrow("process.exit")

    const output = errorSpy.mock.calls.map(c => c.join(" ")).join("\n")
    expect(output).toContain("signs for svm")
    expect(output).toContain("swap execution requires an EVM wallet")
    expect(output).toContain('"svm-mock"')
  })
})
