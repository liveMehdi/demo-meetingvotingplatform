import { z } from "zod";

const errorReferenceSchema = z.object({ reference: z.string().regex(/^[a-f0-9]{32}$/) });

export const blockedRequestMessage =
  "This request was blocked. Check the page address and reload before trying again.";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.method && options.method !== "GET")
    headers.set("X-CSRF-Protection", "1");
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(

      "We couldn't confirm whether that worked. Check your connection and try again.",
    );
  }
  
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    throw new ApiRequestError(
      `Too many attempts. Try again ${Number.isFinite(seconds) && seconds > 0 ? `in ${seconds} seconds` : "shortly"}.`,
      429,
    );
  }

  if (response.status === 500) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const parsed = errorReferenceSchema.safeParse(body);
    const reference = parsed.success ? parsed.data.reference : null;
    if (reference)
      throw new ApiRequestError(
        `Something went wrong. Refresh to check whether it worked. If the problem continues, give an admin this reference: ${reference}.`,
        500,
      );
      
  }
  return response;
}
