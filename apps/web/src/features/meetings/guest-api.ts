import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { meetingStateSchema } from "./api";
import { apiRequest, blockedRequestMessage } from "@/lib/api";

export const joiningStatusSchema = z.object({
  enabled: z.boolean(),
  code: z.string().nullable(),
  revision: z.number(),
});

export type JoiningStatus = z.infer<typeof joiningStatusSchema>;

export const guestMeetingSchema = z.object({
  state: meetingStateSchema,
  meeting_id: z.string(),
  title: z.string(),
  scheduled_at: z.string(),
  session_expires_at: z.string(),
});

export type GuestMeeting = z.infer<typeof guestMeetingSchema>;

async function check(response: Response) {
  if (response.ok) return;

  if (response.status === 401)
    throw new Error(
      "Your session is missing or expired. Sign in for officer controls, or join again as a guest.",
    );

  if (response.status === 403)
    throw new Error(
      `Access denied. Officer controls require officer access. ${blockedRequestMessage}`,
    );

  if (response.status === 404)
    throw new Error(
      "Meeting or code unavailable. Check the code or ask the organiser.",
    );

  if (response.status === 409)
    throw new Error("Guest joining changed. Refresh and try again.");

  if (response.status === 422)
    throw new Error("Enter the 10-character code supplied by the organiser.");
  throw new Error(
    "The request could not be confirmed. Refresh before trying again.",
  );
}

async function joiningResponse(response: Response): Promise<JoiningStatus> {
  await check(response);

  return readResponse(
    response,
    joiningStatusSchema,
    "Couldn’t confirm joining settings. Refresh to check them.",
  );
}

export function getJoining(meetingId: string, signal: AbortSignal) {
  return apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/guest-joining`,
    { signal },
  ).then(joiningResponse);
}

export function setJoining(
  meetingId: string,
  enabled: boolean,
  revision: number,
) {
  return apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/guest-joining`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, expected_revision: revision }),
    },
  ).then(joiningResponse);
}

async function guestResponse(response: Response): Promise<GuestMeeting> {
  await check(response);

  return readResponse(response, guestMeetingSchema, "Couldn’t load the meeting. Try again.");
}

export function joinMeeting(code: string) {
  return apiRequest("/api/guest/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  }).then(guestResponse);
}

export function getGuestMeeting(meetingId: string, signal: AbortSignal) {
  return apiRequest(`/api/guest/meetings/${encodeURIComponent(meetingId)}`, {
    signal,
  }).then(guestResponse);
}
