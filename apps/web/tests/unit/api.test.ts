import { afterEach, expect, test, vi } from "vitest";
import { apiRequest, RequestConnectionError } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function pendingFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_path, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options.signal!;

          if (signal.aborted) reject(signal.reason);
          else
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
        }),
    ),
  );
}

test("cancelled requests keep their abort reason", async () => {
  pendingFetch();
  const controller = new AbortController();
  const request = apiRequest("/api/auth/me", { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({
    name: "AbortError",
  });

  controller.abort();

  await rejected;
});

test("timeouts stay distinct from connection failures", async () => {
  pendingFetch();
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);

  const request = apiRequest("/api/meetings", { method: "POST" });
  const rejected = expect(request).rejects.toMatchObject({
    kind: "timeout",
    message: expect.stringContaining("couldn't confirm"),
  });

  timeout.abort(new DOMException("timed out", "TimeoutError"));

  await rejected;
});

test("connection failures do not claim a save failed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("failed to fetch")),
  );

  const error = await apiRequest("/api/meetings", { method: "POST" }).catch(
    (error) => error,
  );

  expect(error).toBeInstanceOf(RequestConnectionError);
  expect(error.kind).toBe("network");
  expect(error.message).toContain("couldn't confirm");
});

test("requests keep session cookies, csrf headers and caller headers", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);

  await apiRequest("/api/meetings", {
    method: "POST",
    headers: { "Idempotency-Key": "draft-key" },
    body: "{}",
  });

  const options = fetch.mock.calls[0][1];

  expect(options.credentials).toBe("same-origin");
  expect(options.cache).toBe("no-store");
  expect(options.headers.get("X-CSRF-Protection")).toBe("1");
  expect(options.headers.get("Idempotency-Key")).toBe("draft-key");
});

test("rate limits keep their retry delay and status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "8" },
      }),
    ),
  );

  await expect(
    apiRequest("/api/auth/login", { method: "POST" }),
  ).rejects.toMatchObject({
    status: 429,
    message: "Too many attempts. Try again in 8 seconds.",
  });
});
