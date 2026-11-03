import { z } from "zod";
import { readErrorDetail, readResponse } from "@/lib/validation";
import { apiRequest } from "@/lib/api";
import {
  checkResponse,
  MeetingRequestError,
  eligibilityPolicySchema,
} from "@/features/meetings/api";

export interface BallotInput {
  kind: "election" | "motion";
  question: string;
  description: string;
  options: string[];
  candidate_source: "manual" | "nominations";
  counting_method: "standard" | "irv_v1";
}

export const ballotSchema = z.object({
  invalidated_at: z.string().nullish(),
  invalidation_reason: z.string().nullish(),
  predecessor_id: z.string().nullable(),
  followup_kind: z.enum(["runoff", "replacement"]).nullable(),
  id: z.string(),
  meeting_id: z.string(),
  kind: z.enum(["election", "motion"]),
  state: z.enum(["DRAFT", "OPEN", "CLOSED", "PUBLISHED", "CANCELLED"]),
  question: z.string(),
  description: z.string(),
  min_selections: z.number(),
  max_selections: z.number(),
  revision: z.number(),
  candidate_source: z.enum(["manual", "nominations"]),
  counting_method: z.enum(["standard", "irv_v1"]),
  nomination_state: z.enum(["NOT_OPEN", "OPEN", "CLOSED"]),
  opened_at: z.string().nullable(),
  eligibility_policy: eligibilityPolicySchema.nullable(),
  eligible_count: z.number().nullable(),
  eligible_attendance_count: z.number().nullable(),
  participation_count: z.number(),
  closed_at: z.string().nullable(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    position: z.number(),
    code: z.enum(["for", "against", "abstain"]).nullable(),
  })),
});

export type Ballot = z.infer<typeof ballotSchema>;

async function checkBallotResponse(response: Response) {

  // showing the server's explanation when the ballot has changed
  if (response.status === 409) {
    const detail = (await readErrorDetail(response)) ??
      "This ballot or its meeting changed. Refresh before trying again.";

    throw new MeetingRequestError(detail, 409);
  }

  if (response.status === 422)
    throw new MeetingRequestError(
      "Check the question, description and candidate source. Manual elections need 2–50 distinct options; nomination elections receive their candidates through nominations.",
      422,
    );

  if (response.status === 404)
    throw new MeetingRequestError(
      "Meeting or ballot not found. Refresh the page.",
      404,
    );

  await checkResponse(response);
}

export async function getBallots(
  meetingId: string,
  offset: number,
  signal: AbortSignal,
  focusId: string | null = null,
) {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/ballots?offset=${offset}&limit=20${focusId ? `&focus_id=${encodeURIComponent(focusId)}` : ""}`,
    { signal },
  );

  await checkBallotResponse(response);

  return readResponse(
    response,
    z.object({ items: z.array(ballotSchema), total: z.number(), offset: z.number() }),
    "Couldn’t load ballots. Try again.",
  );
}

export async function saveBallot(
  meetingId: string,
  input: BallotInput,
  editing: Ballot | null,
  key?: string,
): Promise<Ballot> {
  const path = `/api/meetings/${encodeURIComponent(meetingId)}/ballots`;

  const response = await apiRequest(
    editing ? `${path}/${encodeURIComponent(editing.id)}` : path,
    {
      method: editing ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        // reusing  creation key so retries don't create another ballot
        ...(!editing && key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(
        editing ? { ...input, expected_revision: editing.revision } : input,
      ),
    },
  );

  await checkBallotResponse(response);

  return readResponse(
    response,
    ballotSchema,
    "Couldn’t confirm the saved ballot. Check the list before creating another.",
  );
}

export async function openBallot(
  meetingId: string,
  ballot: Ballot,
  eligibilityRevision: number,
): Promise<Ballot> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/ballots/${encodeURIComponent(ballot.id)}/open`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: ballot.revision,
        expected_eligibility_revision: eligibilityRevision,
      }),
    },
  );

  await checkBallotResponse(response);

  return readResponse(
    response,
    ballotSchema,
    "Couldn’t confirm opening. Refresh to check the ballot’s status.",
  );
}

export async function closeBallot(
  meetingId: string,
  ballotId: string,
): Promise<Ballot> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/ballots/${encodeURIComponent(ballotId)}/close`,
    { method: "POST" },
  );

  await checkBallotResponse(response);

  return readResponse(
    response,
    ballotSchema,
    "Couldn’t confirm closure. Refresh to check the ballot’s status.",
  );
}

export async function publishBallot(
  meetingId: string,
  ballotId: string,
): Promise<Ballot> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/ballots/${encodeURIComponent(ballotId)}/publish`,
    { method: "POST" },
  );

  await checkBallotResponse(response);

  return readResponse(
    response,
    ballotSchema,
    "Couldn’t confirm publication. Refresh to check the results.",
  );
}

export async function withdrawDraft(
  meetingId: string,
  ballot: { id: string; revision: number },
) {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/drafts/${encodeURIComponent(ballot.id)}/withdraw`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: ballot.revision }),
    },
  );

  await checkResponse(response);
}
