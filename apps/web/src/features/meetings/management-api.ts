import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { apiRequest } from "@/lib/api";
import {
  checkResponse,
  meetingSchema,
  meetingStateSchema,
  type Meeting,
  type MeetingInput,
} from "./api";

export const completionSchema = z.object({
  open_formal: z.number(),
  open_polls: z.number(),
  drafts: z.number(),
  nomination_windows: z.number(),
  unpublished_results: z.number(),
  ever_opened: z.boolean(),
  preview_token: z.string(),
});

export type Completion = z.infer<typeof completionSchema>;

export const meetingChangeSchema = z.object({
  title: z.string(),
  description: z.string(),
  scheduled_at: z.string(),
  revision: z.number(),
  state: meetingStateSchema,
  kind: z.string(),
  recorded_by: z.string().nullable(),
  recorded_at: z.string(),
});

export type MeetingChange = z.infer<typeof meetingChangeSchema>;

const path = (id: string) => `/api/meetings/${encodeURIComponent(id)}`;

async function meetingResponse(response: Response): Promise<Meeting> {
  await checkResponse(response);

  return readResponse(
    response,
    meetingSchema,
    "Couldn’t confirm the change. Refresh the meeting before trying again.",
  );
}

export function updateMeeting(meeting: Meeting, input: MeetingInput) {
  return apiRequest(path(meeting.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, expected_revision: meeting.revision }),
  }).then(meetingResponse);
}

export function transitionMeeting(
  meeting: Meeting,
  action: "start" | "end" | "cancel",
  summary?: Completion,
  confirm = false,
) {
  return apiRequest(`${path(meeting.id)}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      expected_revision: meeting.revision,
      preview_token: summary?.preview_token ?? null,
      confirm_cancel_drafts: confirm,
    }),
  }).then(meetingResponse);
}

export async function completionSummary(id: string): Promise<Completion> {
  const response = await apiRequest(`${path(id)}/completion`);

  await checkResponse(response);

  return readResponse(
    response,
    completionSchema,
    "Couldn’t check meeting activity. Try again.",
  );
}

export async function getMeetingHistory(
  id: string,
  offset: number,
  signal: AbortSignal,
): Promise<{ items: MeetingChange[]; total: number }> {
  const response = await apiRequest(
    `${path(id)}/history?offset=${offset}&limit=20`,
    { signal },
  );

  await checkResponse(response);

  return readResponse(
    response,
    z.object({ items: z.array(meetingChangeSchema), total: z.number() }),
    "Couldn’t load meeting history. Try again.",
  );
}
