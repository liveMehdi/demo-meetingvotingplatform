import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { apiRequest } from "@/lib/api";

export const actionLabels = {
  "admin.bootstrapped": "First administrator configured",
  "admin.granted": "Admin access granted",
  "admin.revoked": "Admin access removed",
  "account.suspended": "Account suspended",
  "account.restored": "Account restored",
  "account.sessions_revoked": "Account sessions signed out",
  "account.reset_issued": "Recovery code issued",
  "account.password_reset": "Password reset",
  "membership.approved": "Membership approved",
  "membership.revoked": "Membership revoked",
  "officer.granted": "Officer access granted",
  "officer.revoked": "Officer access removed",
  "meeting.created": "Meeting created",
  "meeting.guest_joining_enabled": "Guest joining enabled",
  "meeting.guest_joining_disabled": "Guest joining disabled",
  "meeting.eligibility_all_approved": "Eligibility set to all approved members",
  "meeting.eligibility_attending_approved":
    "Eligibility set to attending approved members",
  "attendance.present": "Member recorded present",
  "attendance.absent": "Member recorded absent",
  "ballot.created": "Ballot or poll draft created",
  "ballot.updated": "Ballot or poll draft updated",
  "ballot.opened": "Ballot or poll opened",
  "ballot.closed": "Ballot or poll closed",
  "meeting.updated": "Meeting details changed",
  "meeting.started": "Meeting started",
  "meeting.ended": "Meeting ended",
  "meeting.cancelled": "Meeting cancelled",
  "ballot.cancelled": "Unused draft cancelled",
  "ballot.invalidated": "Ballot or poll invalidated",
  "ballot.published": "Results published",
  "nominations.opened": "Nominations opened",
  "nominations.closed": "Nominations closed",
  "nomination.created": "Nomination submitted",
  "nomination.accepted": "Candidate consent/name confirmed",
  "nomination.approved": "Candidate approved",
  "nomination.rejected": "Nomination rejected",
  "nomination.withdrawn": "Nomination withdrawn",
};

export const auditEventSchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  action: z.enum(Object.keys(actionLabels) as [keyof typeof actionLabels, ...(keyof typeof actionLabels)[]]),
  actor_id: z.string().nullable(),
  target_id: z.string(),
  meeting_id: z.string().nullable(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export async function getAudit(offset: number, signal: AbortSignal) {
  const response = await apiRequest(`/api/audit?offset=${offset}&limit=20`, {
    signal,
  });
  if (response.status === 401)
    throw new Error("Sign in again to view activity.");

  if (response.status === 403)
    throw new Error("Administrator access is required to view activity.");

  if (!response.ok)
    throw new Error("Could not load activity. Please try again.");
  
  return readResponse(
    response,
    z.object({ items: z.array(auditEventSchema), total: z.number() }),
    "Couldn’t load activity. Try again.",
  );
}
