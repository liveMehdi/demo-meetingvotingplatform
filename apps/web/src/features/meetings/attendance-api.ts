import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { apiRequest } from "@/lib/api";
import { checkResponse, MeetingRequestError } from "@/features/meetings/api";

export const attendanceMemberSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  membership_status: z.enum(["pending", "approved", "revoked"]),
  present: z.boolean(),
  revision: z.number(),
});

export type AttendanceMember = z.infer<typeof attendanceMemberSchema>;

export const attendancePageSchema = z.object({
  items: z.array(attendanceMemberSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  present_count: z.number(),
  approved_present_count: z.number(),
  final_present_count: z.number().nullable().default(null),
  final_approved_present_count: z.number().nullable().default(null),
});

export type AttendancePage = z.infer<typeof attendancePageSchema>;

async function checkAttendanceResponse(response: Response): Promise<void> {
  if (response.status === 409)
    throw new MeetingRequestError(
      "Attendance, membership or meeting status changed. Review the refreshed record before trying again.",
      409,
    );
  if (response.status === 404)
    throw new MeetingRequestError(
      "Meeting or member not found. Refresh the page.",
      404,
    );
  if (response.status === 422)
    throw new MeetingRequestError(
      "Invalid attendance update. Refresh the page and try again.",
      422,
    );
  await checkResponse(response);
}

export async function getAttendance(
  meetingId: string,
  offset: number,
  signal: AbortSignal,
): Promise<AttendancePage> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/attendance?offset=${offset}&limit=20`,
    { signal },
  );
  await checkAttendanceResponse(response);
  return readResponse(
    response,
    attendancePageSchema,
    "The server returned an unexpected attendance list.",
  );
}

export async function setAttendance(
  meetingId: string,
  userId: string,

  present: boolean,
  revision: number,
): Promise<AttendanceMember> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/attendance/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ present, expected_revision: revision }),
    },
  );
  
  await checkAttendanceResponse(response);
  return readResponse(
    response,
    attendanceMemberSchema,
    "The server returned an unexpected attendance record.",
  );
}

export const attendanceChangeSchema = z.object({
  user_id: z.string(),
  revision: z.number(),
  present: z.boolean(),
  recorded_by: z.string(),
  recorded_at: z.string(),
});

export type AttendanceChange = z.infer<typeof attendanceChangeSchema>;
export async function getAttendanceHistory(
  meetingId: string,
  offset: number,
  signal: AbortSignal,
): Promise<{ items: AttendanceChange[]; total: number }> {
  const response = await apiRequest(
    `/api/meetings/${encodeURIComponent(meetingId)}/attendance-history?offset=${offset}&limit=20`,
    { signal },
  );
  await checkAttendanceResponse(response);
  return readResponse(
    response,
    z.object({ items: z.array(attendanceChangeSchema), total: z.number() }),
    "Couldn’t load attendance history. Try again.",
  );
}
