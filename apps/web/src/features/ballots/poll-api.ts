import { z } from "zod";
import { readResponse, parseData } from "@/lib/validation";
import { meetingStateSchema } from "@/features/meetings/api";
import { apiRequest } from "@/lib/api";
import { checkResponse, MeetingRequestError } from "@/features/meetings/api";

export interface PollInput {
  kind: "poll_single" | "poll_multiple";
  question: string;
  description: string;
  options: string[];
  min_selections: number;
  max_selections: number;
}

export const pollSchema = z.object({
  followup_kind: z.enum(["runoff", "replacement"]).nullish(),
  invalidated_at: z.string().nullish(),
  invalidation_reason: z.string().nullish(),
  id: z.string(),
  revision: z.number(),
  kind: z.enum(["poll_single", "poll_multiple"]),
  question: z.string(),
  description: z.string(),
  min_selections: z.number(),
  max_selections: z.number(),
  state: z.enum(["DRAFT", "OPEN", "CLOSED", "PUBLISHED", "CANCELLED"]),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
  })),
});

export type Poll = z.infer<typeof pollSchema>;

async function check(response: Response) {
  if (response.status === 409)
    throw new MeetingRequestError(
      "This draft or creation request changed. Refresh and review it again.",
      409,
    );

  if (response.status === 404)
    throw new MeetingRequestError("Meeting or poll not found.", 404);

  if (response.status === 422)
    throw new MeetingRequestError(
      "Check the question, distinct options and selection limits. Limits must fit the number of options.",
      422,
    );

  await checkResponse(response);
}

export async function getPolls(
  meetingId: string,
  offset: number,
  signal: AbortSignal,
  focusId: string | null = null,
) {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/polls?offset=${offset}&limit=20${focusId ? `&focus_id=${encodeURIComponent(focusId)}` : ""}`,
    { signal },
  );

  await check(response);

  return readResponse(
    response,
    z.object({ items: z.array(pollSchema), total: z.number(), offset: z.number() }),
    "Couldn’t load polls. Try again.",
  );
}

export async function savePoll(
  meetingId: string,
  input: PollInput,
  editing: Poll | null,
  key?: string,
) {
  const path = `/api/meetings/${encodeURIComponent(meetingId)}/polls`;

  const response = await apiRequest(
    editing ? `${path}/${encodeURIComponent(editing.id)}` : path,
    {
      method: editing ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(!editing && key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(
        editing ? { ...input, expected_revision: editing.revision } : input,
      ),
    },
  );

  await check(response);

  return readResponse(
    response,
    pollSchema,
    "Couldn’t confirm the saved poll. Check the list before creating another.",
  );
}

export const pollTotalsSchema = z.object({
  invalidated_at: z.string().nullish(),
  invalidation_reason: z.string().nullish(),
  participation_count: z.number(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    count: z.number(),
  })),
});

export type PollTotals = z.infer<typeof pollTotalsSchema>;

export const pollPresentationSchema = pollTotalsSchema.extend({
  ballot_id: z.string(),
  meeting_title: z.string(),
  meeting_state: meetingStateSchema,
  question: z.string(),
  description: z.string(),
  kind: z.enum(["poll_single", "poll_multiple"]),
  state: z.enum(["OPEN", "CLOSED"]),
  min_selections: z.number(),
  max_selections: z.number(),
});

export type PollPresentation = z.infer<typeof pollPresentationSchema>;

export async function getPollPresentation(
  meetingId: string,
  pollId: string,
  signal: AbortSignal,
): Promise<PollPresentation> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/polls/${encodeURIComponent(pollId)}/presentation`,
    { signal },
  );

  await check(response);

  return readResponse(
    response,
    pollPresentationSchema,
    "Couldn’t load the presentation. Try again.",
  );
}

export const guestPollSchema = pollSchema.omit({ revision: true }).extend({
  ...pollTotalsSchema.shape,
  state: z.enum(["OPEN", "CLOSED"]),
  submitted: z.boolean(),
});

export type GuestPoll = z.infer<typeof guestPollSchema>;

export async function changePollState(
  meetingId: string,
  poll: Poll,
  action: "open" | "close",
) {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/polls/${encodeURIComponent(poll.id)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "open" ? { expected_revision: poll.revision } : {},
      ),
    },
  );

  await check(response);

  return readResponse(
    response,
    pollSchema,
    "Couldn’t confirm the change. Refresh to check the poll’s status.",
  );
}

export async function getPollTotals(
  meetingId: string,
  pollId: string,
  signal: AbortSignal,
) {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/polls/${encodeURIComponent(pollId)}/results`,
    { signal },
  );

  await check(response);

  return readResponse(response, pollTotalsSchema, "Couldn’t load poll results. Try again.");
}

async function checkGuest(response: Response) {
  if (response.status === 401)
    throw new Error(
      "Your guest session is unavailable or expired. Join the meeting again.",
    );

  if (response.status === 404)
    throw new Error(
      "This meeting or poll is unavailable to your guest session.",
    );

  if (response.status === 409)
    throw new Error(
      "This poll is closed. Refresh to check whether your response was recorded.",
    );

  if (response.status === 422)
    throw new Error(
      "Choose distinct options within the question's selection limits.",
    );

  await checkResponse(response);
}

export async function getGuestPolls(
  meetingId: string,
  offset: number,
  signal: AbortSignal,
) {
  const response = await apiRequest(
    `/api/guest/meetings/${encodeURIComponent(meetingId)}/polls?offset=${offset}&limit=20`,
    { signal },
  );

  await checkGuest(response);

  const data = await readResponse(response,
    z.object({ items: z.array(z.unknown()), total: z.number(), offset: z.number() }),
    "Couldn’t load polls. Try again.",
  );

  const items = data.items.map((item) =>
    parseData(guestPollSchema, item, "Couldn’t load this poll. Try again."),
  );
  return { items, total: data.total };
}

export async function submitPollResponse(
  meetingId: string,
  pollId: string,
  optionIds: string[],
) {
  const response = await apiRequest(
    `/api/guest/meetings/${encodeURIComponent(meetingId)}/polls/${encodeURIComponent(pollId)}/responses`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option_ids: optionIds }),
    },
  );

  await checkGuest(response);

  return readResponse(
    response,
    z.object({ submitted: z.literal(true) }),
    "Confirmation was unavailable. Refresh or retry to check your response.",
  );
}
