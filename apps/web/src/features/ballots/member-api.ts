import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { apiRequest, blockedRequestMessage } from "@/lib/api";

export const memberBallotSchema = z.object({
  invalidated_at: z.string().nullish(),
  invalidation_reason: z.string().nullish(),
  id: z.string(),
  meeting_title: z.string(),
  question: z.string(),
  description: z.string(),
  kind: z.enum(["election", "motion"]),
  counting_method: z.enum(["standard", "irv_v1"]),
  state: z.enum(["OPEN", "CLOSED", "PUBLISHED"]),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
  })),
  submitted: z.boolean(),
  participation_count: z.number(),
});

export type MemberBallot = z.infer<typeof memberBallotSchema>;

async function check(response: Response) {
  if (response.ok) return;

  if (response.status === 401)
    throw new Error(
      "Sign in to view your ballots. Your session may have expired.",
    );

  if (response.status === 403) throw new Error(blockedRequestMessage);

  if (response.status === 404)
    throw new Error("This ballot is not available to your account.");

  if (response.status === 409)
    throw new Error(
      "Voting has closed. Refresh to check your participation status.",
    );

  if (response.status === 422)
    throw new Error(
      "Check your choices: use only the candidates shown, without repeats, and follow this ballot's selection rules.",
    );
  throw new Error(
    "The request could not be confirmed. Refresh to check your participation status.",
  );
}

export async function getMyBallots(
  offset: number,
  signal: AbortSignal,
  view = "all",
) {
  const response = await apiRequest(
    `/api/ballots?offset=${offset}&limit=20&view=${encodeURIComponent(view)}`,
    { signal },
  );

  await check(response);

  return readResponse(
    response,
    z.object({ items: z.array(memberBallotSchema), total: z.number() }),
    "Couldn’t load your ballots. Try again.",
  );
}

export async function getMyBallot(
  id: string,

  signal: AbortSignal,
): Promise<MemberBallot> {
  const response = await apiRequest(`/api/ballots/${encodeURIComponent(id)}`, {
    signal,
  });

  await check(response);

  return readResponse(response, memberBallotSchema, "Couldn’t load this ballot. Try again.");
}

export async function submitVote(
  id: string,

  optionIds: string[],
): Promise<{ submitted: true; already_submitted: boolean }> {
  const response = await apiRequest(
    `/api/ballots/${encodeURIComponent(id)}/votes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ option_ids: optionIds }),
    },
  );

  await check(response);

  return readResponse(
    response,
    z.object({ submitted: z.literal(true), already_submitted: z.boolean() }),
    "Couldn’t confirm your vote. Refresh to check whether it was recorded.",
  );
}
