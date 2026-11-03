import { z } from "zod";
import { readErrorDetail, readResponse } from "@/lib/validation";
import { apiRequest } from "@/lib/api";

export const nominationSchema = z.object({
  id: z.string(),
  ballot_id: z.string(),
  nominee_id: z.string(),
  nominator_id: z.string(),
  candidate_name: z.string(),
  revision: z.number(),
  nominee_email: z.string().nullable(),
  status: z.enum(["PENDING_CONSENT", "PENDING_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"]),
});

export type Nomination = z.infer<typeof nominationSchema>;
export const contestSchema = z.object({
  ballot_state: z.enum(["DRAFT", "CANCELLED"]),
  is_runoff: z.boolean(),
  meeting_title: z.string(),
  id: z.string(),
  question: z.string(),
  nomination_state: z.enum(["OPEN", "CLOSED"]),
});

export type Contest = z.infer<typeof contestSchema>;

export const statusLabels: Record<Nomination["status"], string> = {
  PENDING_CONSENT: "Awaiting nominee consent",
  PENDING_REVIEW: "Awaiting officer review",
  APPROVED: "Approved candidate",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

async function check(response: Response) {
  if (response.ok) return;
  if (response.status === 401) throw new Error("Sign in to use nominations.");
  if (response.status === 422)
    throw new Error(
      "Check the registered email, candidate name and reviewed version.",
    );
  if ([403, 404, 409].includes(response.status)) {
    const detail = await readErrorDetail(response);
    if (detail !== undefined) throw new Error(detail);
  }
  throw new Error(
    "Nominations could not be loaded or changed. Refresh and try again.",
  );
}

async function page<T>(
  path: string,
  signal: AbortSignal,
  schema: z.ZodType<T>,
): Promise<{ items: T[]; total: number }> {
  const response = await apiRequest(path, { signal });
  await check(response);
  return readResponse(
    response,
    z.object({ items: z.array(schema), total: z.number() }),
    "Couldn’t load nominations. Try again.",
  );
}

export function getContests(offset: number, signal: AbortSignal, view = "all") {
  return page(
    `/api/nominations/contests?offset=${offset}&limit=20&view=${encodeURIComponent(view)}`,
    signal,
    contestSchema,
  );
}

export function getNominations(
  ballotId: string,
  officer: boolean,
  offset: number,
  signal: AbortSignal,
) {
  return page(
    `/api/nominations/${encodeURIComponent(ballotId)}${officer ? "/officer" : ""}?offset=${offset}&limit=20`,
    signal,
    nominationSchema,
  );
}

export async function nominate(
  ballotId: string,
  input: { nominee_email: string; candidate_name: string },
) {
  const response = await apiRequest(
    `/api/nominations/${encodeURIComponent(ballotId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  await check(response);
  return readResponse(
    response,
    nominationSchema,
    "Couldn’t confirm the nomination change. Refresh before trying again.",
  );
}

////////////
export async function decide(
  nomination: Nomination,
  action: "accept" | "withdraw" | "approve" | "reject",
  candidate_name?: string,
) {
  const route =
    action === "approve" || action === "reject" ? "review" : "consent";
  const response = await apiRequest(
    `/api/nominations/${encodeURIComponent(nomination.ballot_id)}/${encodeURIComponent(nomination.id)}/${route}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        expected_revision: nomination.revision,
        ...(candidate_name === undefined ? {} : { candidate_name }),
      }),
    },
  );

  await check(response);
  return readResponse(
    response,
    nominationSchema,
    "Couldn’t confirm the nomination change. Refresh before trying again.",
  );
}

export async function setWindow(
  ballotId: string,
  state: "OPEN" | "CLOSED",
  revision: number,
) {
  const response = await apiRequest(
    `/api/nominations/${encodeURIComponent(ballotId)}/window`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, expected_revision: revision }),
    },
  );
  await check(response);
}
