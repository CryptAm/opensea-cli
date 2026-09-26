import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { Command } from "commander"
import type { OpenSeaClient } from "../client.js"
import type { OutputFormat } from "../output.js"
import { formatOutput, outputGet } from "../output.js"
import {
  addPaginationOptions,
  parseIntOption,
  readJsonBodyOption,
} from "../parse.js"
import { DropsAPI } from "../sdk.js"
import type {
  Chain,
  CrossChainDropMintRequest,
  CrossChainDropMintResponse,
  DropDeployRequest,
  DropDeployResponse,
  DropEligibilityResponse,
  DropMintResponse,
  DropTransactionResponse,
  SaveDropEditsRequest,
  SaveDropItemMediaRequest,
  SavePrerevealDropItemRequest,
  SaveSelfMintDropItemRequest,
  UpdateDropItemRequest,
  UpdateSelfMintDropItemRequest,
  UploadDropItemMediaRequest,
  ValidateDropAllowlistRequest,
} from "../types/index.js"
import { selectUploadContext, uploadToContext } from "../upload.js"
import type { WalletProvider } from "../wallet/index.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  isEvmAdapter,
  WALLET_PROVIDERS,
  WrongChainTypeError,
} from "../wallet/index.js"

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function readUploadContextJson(source: string): Promise<unknown> {
  if (source !== "-") return readJsonBodyOption(source, "--context")
  const raw = await readStdin()
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Could not parse --context from stdin as JSON: ${(err as Error).message}`,
    )
  }
}

function addDropTransactionCommand(
  cmd: Command,
  name: "publish" | "unpublish",
  getClient: () => OpenSeaClient,
  getFormat: () => OutputFormat,
): void {
  const build = (drops: DropsAPI, slug: string) =>
    name === "publish"
      ? drops.buildPublishTransaction(slug)
      : drops.buildUnpublishTransaction(slug)

  cmd
    .command(name)
    .description(
      `Build the ${name} transaction for a drop; with --send, sign and send it from the contract owner's wallet`,
    )
    .argument("<slug>", "Collection slug")
    .option(
      "--send",
      "Sign and send the transaction with the configured EVM wallet",
    )
    .option(
      "--wallet-provider <provider>",
      `Wallet provider to use with --send (${WALLET_PROVIDERS.join(", ")})`,
    )
    .action(
      async (
        slug: string,
        options: { send?: boolean; walletProvider?: string },
      ) => {
        const drops = new DropsAPI(getClient())
        const format = getFormat()
        if (!options.send) {
          const tx: DropTransactionResponse = await build(drops, slug)
          console.log(formatOutput(tx, format))
          return
        }

        const wallet = options.walletProvider
          ? createWalletForProvider(options.walletProvider as WalletProvider)
          : createWalletFromEnv()
        if (!isEvmAdapter(wallet)) {
          console.error(
            `Error: ${new WrongChainTypeError(wallet, "evm", `drop ${name}`).message}`,
          )
          process.exit(1)
        }
        const address = await wallet.getAddress()
        console.error(`Using ${wallet.name} wallet: ${address}`)

        const tx = await build(drops, slug)
        const result = await drops.sendTransaction(tx, wallet, {
          onSending: sending =>
            console.error(
              `Sending ${name} transaction to ${sending.to} on chain ${sending.chain} (${sending.chainId})...`,
            ),
        })
        console.log(formatOutput({ hash: result.hash }, format))
      },
    )
}

export function dropsCommand(
  getClient: () => OpenSeaClient,
  getFormat: () => OutputFormat,
): Command {
  const cmd = new Command("drops").description("Query and mint NFT drops")

  addPaginationOptions(
    cmd
      .command("list")
      .description("List drops (featured, upcoming, or recently minted)")
      .option(
        "--type <type>",
        "Drop type: featured, upcoming, or recently_minted",
        "featured",
      )
      .option(
        "--chains <chains>",
        "Comma-separated list of chains to filter by",
      ),
    "Number of results (max 100)",
  ).action(
    async (options: {
      type: string
      chains?: string
      limit: string
      next?: string
    }) => {
      const client = getClient()
      await outputGet(client, getFormat(), "/api/v2/drops", {
        type: options.type,
        chains: options.chains,
        limit: parseIntOption(options.limit, "--limit"),
        cursor: options.next,
      })
    },
  )

  cmd
    .command("get")
    .description("Get detailed drop info by collection slug")
    .argument("<slug>", "Collection slug")
    .action(async (slug: string) => {
      const client = getClient()
      await outputGet(client, getFormat(), `/api/v2/drops/${slug}`)
    })

  cmd
    .command("eligibility")
    .description("Check drop eligibility for the authenticated wallet")
    .argument("<slug>", "Collection slug")
    .action(async (slug: string) => {
      const client = getClient()
      const result = await client.get<DropEligibilityResponse>(
        `/api/v2/drops/${slug}/eligibility`,
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("mint")
    .description("Build a mint transaction for a drop")
    .argument("<slug>", "Collection slug")
    .requiredOption("--minter <address>", "Wallet address to receive tokens")
    .option("--quantity <n>", "Number of tokens to mint", "1")
    .action(
      async (
        slug: string,
        options: {
          minter: string
          quantity: string
        },
      ) => {
        const client = getClient()
        const result = await client.post<DropMintResponse>(
          `/api/v2/drops/${slug}/mint`,
          {
            minter: options.minter,
            quantity: parseIntOption(options.quantity, "--quantity"),
          },
        )
        console.log(formatOutput(result, getFormat()))
      },
    )

  cmd
    .command("cross-chain-mint")
    .description("Build transactions to pay on one chain and mint on another")
    .argument("<slug>", "Collection slug")
    .requiredOption("--payer <address>", "Wallet that signs and pays")
    .requiredOption("--minter <address>", "Wallet that receives the NFT")
    .requiredOption("--payment-chain <chain>", "Chain used for payment")
    .requiredOption(
      "--payment-token <address>",
      "Payment token contract or the null address for native currency",
    )
    .option("--quantity <n>", "Number of tokens to mint", "1")
    .action(
      async (
        slug: string,
        options: {
          payer: string
          minter: string
          paymentChain: string
          paymentToken: string
          quantity: string
        },
      ) => {
        const client = getClient()
        const request: CrossChainDropMintRequest = {
          payer: options.payer,
          minter: options.minter,
          quantity: parseIntOption(options.quantity, "--quantity"),
          payment: {
            chain: options.paymentChain,
            token_address: options.paymentToken,
          },
        }
        const result = await client.post<CrossChainDropMintResponse>(
          `/api/v2/drops/${slug}/cross_chain_mint`,
          request,
        )
        console.log(formatOutput(result, getFormat()))
      },
    )

  cmd
    .command("deploy")
    .description("Build a deploy-contract transaction for a new drop")
    .requiredOption("--chain <chain>", "Chain slug (e.g. ethereum, base)")
    .requiredOption("--name <name>", "Contract name")
    .requiredOption("--symbol <symbol>", "Contract symbol")
    .requiredOption("--drop-type <type>", "Drop type (e.g. seadrop_v1_erc721)")
    .requiredOption("--token-type <type>", "Token type (e.g. erc721_standard)")
    .requiredOption("--sender <address>", "Deployer wallet address")
    .action(
      async (options: {
        chain: string
        name: string
        symbol: string
        dropType: string
        tokenType: string
        sender: string
      }) => {
        const client = getClient()
        const body: DropDeployRequest = {
          chain: options.chain,
          contract_name: options.name,
          contract_symbol: options.symbol,
          drop_type: options.dropType,
          token_type: options.tokenType,
          sender: options.sender,
        }
        const result = await client.post<DropDeployResponse>(
          "/api/v2/drops/deploy",
          body,
        )
        console.log(formatOutput(result, getFormat()))
      },
    )

  cmd
    .command("deploy-receipt")
    .description(
      "Get the receipt for a previously submitted deploy transaction",
    )
    .argument("<chain>", "Chain slug")
    .argument("<tx-hash>", "Transaction hash")
    .action(async (chain: string, txHash: string) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/drops/deploy/${chain as Chain}/${txHash}/receipt`,
      )
    })

  cmd
    .command("save-edits")
    .description("Save edits to a drop's stages and settings (Creator Studio)")
    .argument("<slug>", "Collection slug")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the SaveDropEditsRequest body",
    )
    .action(async (slug: string, options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<SaveDropEditsRequest>(
        options.body,
        "--body",
      )
      const result = await client.post(`/api/v2/drops/${slug}`, request)
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("create-allowlist-upload")
    .description("Request a presigned upload for a drop allowlist file")
    .argument("<slug>", "Collection slug")
    .action(async (slug: string) => {
      const client = getClient()
      const result = await client.post(`/api/v2/drops/${slug}/allowlist`)
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("validate-allowlist")
    .description("Validate a previously uploaded drop allowlist file")
    .argument("<slug>", "Collection slug")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the ValidateDropAllowlistRequest body",
    )
    .action(async (slug: string, options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<ValidateDropAllowlistRequest>(
        options.body,
        "--body",
      )
      const result = await client.post(
        `/api/v2/drops/${slug}/allowlist/validate`,
        request,
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("save-prereveal-item")
    .description("Save the prereveal item for a drop")
    .argument("<slug>", "Collection slug")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the SavePrerevealDropItemRequest body",
    )
    .action(async (slug: string, options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<SavePrerevealDropItemRequest>(
        options.body,
        "--body",
      )
      const result = await client.post(
        `/api/v2/drops/${slug}/prereveal-item`,
        request,
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("save-item")
    .description("Save a self-mint drop item")
    .argument("<slug>", "Collection slug")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the SaveSelfMintDropItemRequest body",
    )
    .action(async (slug: string, options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<SaveSelfMintDropItemRequest>(
        options.body,
        "--body",
      )
      const result = await client.post(`/api/v2/drops/${slug}/items`, request)
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("update-self-mint-item")
    .description("Replace a self-mint drop item by token id")
    .argument("<slug>", "Collection slug")
    .argument("<token_id>", "Token id of the item to update")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the UpdateSelfMintDropItemRequest body",
    )
    .action(
      async (slug: string, tokenId: string, options: { body: string }) => {
        const client = getClient()
        const request = readJsonBodyOption<UpdateSelfMintDropItemRequest>(
          options.body,
          "--body",
        )
        const result = await client.put(
          `/api/v2/drops/${slug}/items/${tokenId}`,
          request,
        )
        console.log(formatOutput(result, getFormat()))
      },
    )

  cmd
    .command("update-item")
    .description("Update fields of a drop item by token id")
    .argument("<slug>", "Collection slug")
    .argument("<token_id>", "Token id of the item to update")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the UpdateDropItemRequest body",
    )
    .action(
      async (slug: string, tokenId: string, options: { body: string }) => {
        const client = getClient()
        const request = readJsonBodyOption<UpdateDropItemRequest>(
          options.body,
          "--body",
        )
        const result = await client.patch(
          `/api/v2/drops/${slug}/items/${tokenId}`,
          request,
        )
        console.log(formatOutput(result, getFormat()))
      },
    )

  cmd
    .command("create-item-media-upload")
    .description("Request presigned uploads for drop item media files")
    .argument("<slug>", "Collection slug")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the UploadDropItemMediaRequest body",
    )
    .action(async (slug: string, options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<UploadDropItemMediaRequest>(
        options.body,
        "--body",
      )
      const result = await client.post(
        `/api/v2/drops/${slug}/items/media`,
        request,
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("save-item-media")
    .description("Persist previously uploaded drop item media")
    .argument("<slug>", "Collection slug")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the SaveDropItemMediaRequest body",
    )
    .action(async (slug: string, options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<SaveDropItemMediaRequest>(
        options.body,
        "--body",
      )
      const result = await client.post(
        `/api/v2/drops/${slug}/items/media/save`,
        request,
      )
      console.log(formatOutput(result, getFormat()))
    })

  addDropTransactionCommand(cmd, "publish", getClient, getFormat)
  addDropTransactionCommand(cmd, "unpublish", getClient, getFormat)

  cmd
    .command("upload-metadata-ipfs")
    .description(
      "Start uploading a drop's item media and metadata to IPFS; with --wait, poll until it finishes",
    )
    .argument("<slug>", "Collection slug")
    .option("--wait", "Poll progress until the upload is no longer running")
    .option("--interval <seconds>", "Seconds between progress polls", "5")
    .option(
      "--wait-timeout <seconds>",
      "Seconds to wait before giving up with --wait",
      "600",
    )
    .action(
      async (
        slug: string,
        options: { wait?: boolean; interval: string; waitTimeout: string },
      ) => {
        const drops = new DropsAPI(getClient())
        const format = getFormat()
        // Validated before the POST so a bad flag never starts a workflow.
        const intervalMs =
          parseIntOption(options.interval, "--interval") * 1_000
        const timeoutMs =
          parseIntOption(options.waitTimeout, "--wait-timeout") * 1_000
        if (intervalMs < 1_000) {
          throw new Error("--interval must be at least 1 second")
        }
        if (timeoutMs < 0) {
          throw new Error("--wait-timeout must not be negative")
        }

        const started = await drops.uploadMetadataToIpfs(slug)
        if (!options.wait) {
          console.log(formatOutput(started, format))
          return
        }

        console.error(
          `IPFS upload started: ${started.workflow_execution_id}. Polling every ${intervalMs / 1_000}s...`,
        )
        const final = await drops.waitForMetadataIpfs(
          slug,
          started.workflow_execution_id,
          {
            intervalMs,
            timeoutMs,
            onProgress: progress =>
              console.error(
                `Status: ${progress.status} (media ${progress.media_upload_progress ?? 0}%, metadata ${progress.metadata_upload_progress ?? 0}%)`,
              ),
          },
        )
        const output = {
          workflow_execution_id: started.workflow_execution_id,
          ...final,
        }
        console.log(formatOutput(output, format))
        if (final.status !== "completed") {
          console.error(
            final.status === "failed"
              ? `Error: IPFS upload failed${final.failure_reason ? `: ${final.failure_reason}` : ""}`
              : `Error: IPFS upload ${started.workflow_execution_id} was not found`,
          )
          process.exit(1)
        }
      },
    )

  cmd
    .command("metadata-ipfs-status")
    .description("Get the progress of a drop's IPFS metadata upload")
    .argument("<slug>", "Collection slug")
    .argument(
      "<workflow-execution-id>",
      "The workflow_execution_id returned by upload-metadata-ipfs",
    )
    .action(async (slug: string, workflowExecutionId: string) => {
      const drops = new DropsAPI(getClient())
      const result = await drops.getMetadataIpfsProgress(
        slug,
        workflowExecutionId,
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("create-manifest-upload")
    .description(
      "Request an upload context for a drop's metadata manifest CSV (upload it with upload-file)",
    )
    .argument("<slug>", "Collection slug")
    .action(async (slug: string) => {
      const drops = new DropsAPI(getClient())
      const result = await drops.createManifestUpload(slug)
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("upload-file")
    .description(
      "Upload a file to the storage URL an upload context describes, and print its token. " +
        "For the array create-item-media-upload returns, pass --index or pipe one element.",
    )
    .requiredOption(
      "--context <path>",
      "Path to the upload context JSON, or - to read it from stdin",
    )
    .requiredOption("--file <path>", "Path to the file to upload")
    .option(
      "--index <n>",
      "Element to use when the context JSON is an array of upload contexts",
    )
    .action(
      async (options: { context: string; file: string; index?: string }) => {
        const context = selectUploadContext(
          await readUploadContextJson(options.context),
          options.index === undefined
            ? undefined
            : parseIntOption(options.index, "--index"),
        )
        let bytes: Buffer
        try {
          bytes = readFileSync(options.file)
        } catch (err) {
          throw new Error(
            `Could not read --file '${options.file}': ${(err as Error).message}`,
          )
        }
        const result = await uploadToContext(
          context,
          new Blob([new Uint8Array(bytes)]),
          {
            filename: basename(options.file),
          },
        )
        console.log(formatOutput(result, getFormat()))
      },
    )

  return cmd
}
