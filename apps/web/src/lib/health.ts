import { z } from "zod";
import { readResponse } from "@/lib/validation";
export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("voting-api"),
});

export type HealthResponse = z.infer<typeof healthSchema>;

export async function getReadiness(signal: AbortSignal): Promise<void> {
  const response = await fetch("/api/ready", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok)
    throw new Error(
      "Database readiness could not be confirmed. Ask an administrator to check connectivity and migrations.",
    );
  await readResponse(
    response,
    z.object({ status: z.literal("ready") }),
    "Unexpected readiness response. Restart the API after updating it.",
  );
}

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`The API returned HTTP ${response.status}.`);
  }

  return readResponse(
    response,
    healthSchema,
    "The API returned an unexpected health response.",
  );
}
