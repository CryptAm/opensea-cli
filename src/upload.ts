import type { UploadContext } from "./types/index.js"

const BODY_EXCERPT_LENGTH = 500

/**
 * A storage upload that returned a non-2xx status. The message carries the
 * status and the start of the response body, never the context's URL or
 * fields, which are short-lived credentials.
 */
export class UploadContextError extends Error {
  constructor(
    public status: number,
    public bodyExcerpt: string,
  ) {
    super(
      `Storage upload failed with HTTP ${status}${bodyExcerpt ? `: ${bodyExcerpt}` : ""}`,
    )
    this.name = "UploadContextError"
  }
}

/**
 * OpenSea upload contexts always point at HTTPS storage. Refusing anything else
 * keeps a hand-edited or foreign context from sending the file in cleartext or
 * to a non-network scheme.
 */
function assertHttpsUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Upload context url is not a valid URL")
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Upload context url must use https, not ${parsed.protocol.replace(/:$/, "")}`,
    )
  }
}

/**
 * Perform the storage upload an `UploadContext` describes and return its
 * token for the follow-up OpenSea call.
 *
 * For POST, every entry of `fields` is sent unchanged as a multipart text
 * field, then the file as the last part, named `file`. The multipart boundary
 * and Content-Type header are left to fetch. For PUT, the raw bytes are sent
 * with no extra headers. Any 2xx response is success. The url must be HTTPS,
 * and a redirect fails the upload rather than resending the file elsewhere.
 */
export async function uploadToContext(
  context: UploadContext,
  file: Blob,
  options?: { filename?: string; signal?: AbortSignal },
): Promise<{ token: string }> {
  assertHttpsUrl(context.url)
  let response: Response
  if (context.method === "PUT") {
    response = await fetch(context.url, {
      method: "PUT",
      body: file,
      redirect: "error",
      signal: options?.signal,
    })
  } else {
    const form = new FormData()
    for (const [name, value] of Object.entries(context.fields)) {
      form.append(name, value)
    }
    form.append("file", file, options?.filename ?? "file")
    response = await fetch(context.url, {
      method: "POST",
      body: form,
      redirect: "error",
      signal: options?.signal,
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new UploadContextError(
      response.status,
      text.slice(0, BODY_EXCERPT_LENGTH),
    )
  }
  return { token: context.token }
}

/**
 * Narrow parsed JSON to a single `UploadContext`. An array (the shape
 * `create-item-media-upload` returns) is accepted only with an `index`.
 */
export function selectUploadContext(
  value: unknown,
  index?: number,
): UploadContext {
  let candidate = value
  if (Array.isArray(value)) {
    if (index === undefined) {
      throw new Error(
        `Upload context is an array of ${value.length}; pass --index <n> or pipe a single element (e.g. jq '.[0]')`,
      )
    }
    if (index < 0 || index >= value.length) {
      throw new Error(
        `--index ${index} is out of range for ${value.length} upload contexts`,
      )
    }
    candidate = value[index]
  } else if (index !== undefined) {
    throw new Error("--index applies only to an array of upload contexts")
  }

  const context = candidate as Partial<UploadContext> | null
  if (
    !context ||
    typeof context !== "object" ||
    typeof context.url !== "string" ||
    typeof context.token !== "string" ||
    (context.method !== "POST" && context.method !== "PUT") ||
    !context.fields ||
    typeof context.fields !== "object"
  ) {
    throw new Error(
      "Not an upload context: expected an object with url, method (POST or PUT), fields and token",
    )
  }
  return context as UploadContext
}
