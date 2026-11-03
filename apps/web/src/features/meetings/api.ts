import { z } from "zod";
import { readErrorDetail, readResponse } from "@/lib/validation";
import { apiRequest, blockedRequestMessage } from "@/lib/api";

export const eligibilityPolicySchema = z.enum(["all_approved", "attending_approved"]);
export type EligibilityPolicy = z.infer<typeof eligibilityPolicySchema>;
export const eligibilityLabels: Record<EligibilityPolicy, string> = {
  all_approved: "All approved, active members",
  attending_approved: "Only approved, active members recorded as attending",
};

export const meetingStateSchema = z.enum(["PLANNED", "LIVE", "ENDED", "CANCELLED"]);
export type MeetingState = z.infer<typeof meetingStateSchema>;
export const meetingStateLabels: Record<MeetingState, string> = {
  PLANNED: "Planned",
  LIVE: "Live",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};
export function meetingIsActive(meeting: Meeting) {
  return meeting.state === "PLANNED" || meeting.state === "LIVE";
}

export const meetingSchema = z.object({
  state: meetingStateSchema,
  revision: z.number(),
  needs_status_review: z.boolean(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  id: z.string(),
  title: z.string(),
  description: z.string(),
  scheduled_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  created_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  eligibility_policy: eligibilityPolicySchema,
  eligibility_revision: z.number(),
  eligibility_locked_at: z.string().nullable(),
});

export type Meeting = z.infer<typeof meetingSchema>;

export interface MeetingInput {
  title: string;
  description: string;
  scheduled_at: string;
}

export const meetingsPageSchema = z.object({
  items: z.array(meetingSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
});

export type MeetingsPage = z.infer<typeof meetingsPageSchema>;

export class MeetingRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 401)
    throw new MeetingRequestError("Sign in to manage meetings.", 401);
  if (response.status === 403) {
    const csrf =
      (await readErrorDetail(response)) === "Request blocked. Refresh the page and try again.";
    throw new MeetingRequestError(
      csrf
        ? blockedRequestMessage
        : "Officer access is required. An administrator can grant it from member management.",
      403,
    );
  }
  if (response.status === 409) {
    throw new MeetingRequestError(
      (await readErrorDetail(response)) ?? "This meeting changed. Refresh and review it again.",
      409,
    );
  }

  if (response.status === 404)
    throw new MeetingRequestError("Meeting not found.", 404);
  if (response.status === 422)
    throw new MeetingRequestError(
      "Check the title, description and scheduled date and time.",
      422,
    );
  throw new MeetingRequestError(
    "The request could not be completed. Refresh and try again.",
    response.status,
  );
}

export async function getMeetings(
  offset: number,
  limit: number,
  signal: AbortSignal,
  view = "all",
  q = "",
): Promise<MeetingsPage> {

  const response = await apiRequest(
    `/api/meetings?offset=${offset}&limit=${limit}&view=${encodeURIComponent(view)}&q=${encodeURIComponent(q)}`,
    { signal },
  );

  await checkResponse(response);
  return readResponse(
    response,
    meetingsPageSchema,
    "The server returned an unexpected meeting list.",
  );
}

export async function getMeeting(
  id: string,
  signal: AbortSignal,
): Promise<Meeting> {
  const response = await apiRequest(`/api/meetings/${encodeURIComponent(id)}`, {
    signal,
  });

  await checkResponse(response);
  return readResponse(response, meetingSchema, "The server returned an unexpected meeting.");
}

export async function createMeeting(
  input: MeetingInput,
  key: string,
): Promise<Meeting> {
  const response = await apiRequest("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(input),
  });
  await checkResponse(response);
  return readResponse(response, meetingSchema, "The server returned an unexpected meeting.");
}

export async function saveEligibilitySetting(
  meetingId: string,
  policy: EligibilityPolicy,
  revision: number,
): Promise<Meeting> {

  const response = await apiRequest(

    `/api/meetings/${encodeURIComponent(meetingId)}/eligibility`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eligibility_policy: policy,
        expected_revision: revision,
      }),
    },
  );
  if (response.status === 409)
    throw new MeetingRequestError(
      "The setting changed or was locked by a ballot opening. Refresh and review the meeting.",
      409,
    );
  await checkResponse(response);

  return readResponse(
    response,
    meetingSchema,
    "Couldn’t confirm the setting. Refresh to check it.",
  );
}

export function meetingTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
