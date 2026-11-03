import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { apiRequest, blockedRequestMessage } from "@/lib/api";

export const publishedResultsSchema = z.object({
  invalidated_at: z.string().nullish(),
  invalidation_reason: z.string().nullish(),
  ballot_id: z.string(),
  kind: z.enum(["election", "motion"]),
  published_at: z.string(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    count: z.number(),
  })),
  participation_count: z.number(),
  eligible_count: z.number(),
  eligible_attendance_count: z.number(),
  quorum_status: z.literal("not_configured"),
  outcome: z.enum(["passed", "failed", "winner", "runoff", "no_votes", "unresolved_tie"]),
  leading_option_ids: z.array(z.string()),
  counting_method: z.enum(["standard", "irv_v1"]),
  rounds: z.array(z.object({
    number: z.number(),
    counts: z.record(z.string(), z.number()),
    continuing_count: z.number(),
    exhausted_count: z.number(),
    majority_required: z.number(),
    eliminated_option_id: z.string().nullable(),
  })),
});

export type PublishedResults = z.infer<typeof publishedResultsSchema>;

function resultsPath(ballotId: string, meetingId: string | undefined) {
  const prefix = meetingId
    ? `/api/meetings/${encodeURIComponent(meetingId)}/ballots`
    : "/api/ballots";

  return `${prefix}/${encodeURIComponent(ballotId)}/results`;
}

function checkResultsResponse(response: Response) {
  if (response.status === 401)
    throw new Error("Sign in again to view results.");
  if (response.status === 403) throw new Error(blockedRequestMessage);

  if (response.status === 404)
    throw new Error("These results are not available to your account.");

  if (response.status === 409)
    throw new Error("Results have not been published.");

  if (!response.ok) throw new Error("Could not load results. Please refresh.");
}

export async function downloadResults(
  ballotId: string,
  meetingId: string | undefined,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await apiRequest(`${resultsPath(ballotId, meetingId)}.csv`, {
    signal,
    headers: { Accept: "text/csv" },
  });
  checkResultsResponse(response);

  if (
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "text/csv"
  ) {
    throw new Error("Couldn’t download the results. Try again.");
  }

  return response.blob();
}

export async function getResults(
  ballotId: string,
  meetingId: string | undefined,
  signal: AbortSignal,
): Promise<PublishedResults> {
  const response = await apiRequest(resultsPath(ballotId, meetingId), {
    signal,
  });
  checkResultsResponse(response);

  return readResponse(response, publishedResultsSchema, "Couldn’t load results. Try again.");
}
