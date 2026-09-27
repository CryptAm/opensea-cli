import {
  describeApiError,
  EXIT_API_ERROR,
  EXIT_AUTH_ERROR,
} from "./api-error.js"
import { TokenRefreshError } from "./auth/refresh.js"
import { OpenSeaAPIError } from "./client.js"
import { createProgram } from "./program.js"

const program = createProgram()

async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof OpenSeaAPIError) {
      const { exitCode, payload } = describeApiError(error)
      console.error(JSON.stringify(payload, null, 2))
      process.exit(exitCode)
    }
    if (error instanceof TokenRefreshError) {
      console.error(
        JSON.stringify(
          { error: error.name, status: error.status, message: error.message },
          null,
          2,
        ),
      )
      process.exit(EXIT_AUTH_ERROR)
    }
    const label =
      error instanceof TypeError ? "Network Error" : (error as Error).name
    console.error(
      JSON.stringify(
        {
          error: label,
          message: (error as Error).message,
        },
        null,
        2,
      ),
    )
    process.exit(EXIT_API_ERROR)
  }
}

main()
