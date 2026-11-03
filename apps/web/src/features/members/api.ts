import { z } from "zod";
import { readErrorDetail, readResponse } from "@/lib/validation";
import { currentUserSchema } from "@/features/auth/api";
import { apiRequest, blockedRequestMessage } from "@/lib/api";

export const memberSchema = currentUserSchema.extend({
  created_at: z.string(),
  is_suspended: z.boolean(),
  security_revision: z.number(),
});

export type Member = z.infer<typeof memberSchema>;

export const membersPageSchema = z.object({
  items: z.array(memberSchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
});

export type MembersPage = z.infer<typeof membersPageSchema>;

export type MemberChange =
  | { kind: "membership"; id: string; status: "approved" | "revoked" }
  | { kind: "officer"; id: string; isOfficer: boolean };

export class MemberRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;

  if (response.status === 401)

    throw new MemberRequestError("Sign in to manage members.", 401);

  if (response.status === 403) {

    const csrfBlocked =
      (await readErrorDetail(response)) === "Request blocked. Refresh the page and try again.";

    throw new MemberRequestError(

      csrfBlocked ? blockedRequestMessage : "Administrator access is required.",
      403,
    );
  }
  if (response.status === 404)
    throw new MemberRequestError(
      "This account or membership was not found. Refresh the list.",
      404,
    );

  throw new MemberRequestError(
    "The request could not be completed. Refresh and try again.",

    response.status,
  );
}

export async function getMembers(
  offset: number,
  limit: number,
  signal: AbortSignal,
  view = "all",
  q = "",
): Promise<MembersPage> {

  const response = await apiRequest(
    `/api/members?offset=${offset}&limit=${limit}&view=${encodeURIComponent(view)}&q=${encodeURIComponent(q)}`,
    { signal },
  );

  await checkResponse(response);
  return readResponse(
    response,
    membersPageSchema,
    "The server returned an unexpected member list.",
  );
}

export async function changeMember(change: MemberChange): Promise<Member> {
  const body =
    change.kind === "membership"

      ? { status: change.status }
      : { is_officer: change.isOfficer };
      
  const response = await apiRequest(
    `/api/members/${encodeURIComponent(change.id)}/${change.kind}`,
    {

      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  await checkResponse(response);
  return readResponse(
    response,
    memberSchema,
    "The server returned an unexpected member response.",
  );
}
