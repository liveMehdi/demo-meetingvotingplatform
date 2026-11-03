import { buttonClass as button } from "@/components/ui/control-styles";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  decide,
  getNominations,
  setWindow,
  statusLabels,
  type Nomination,
} from "./api";
import type { Ballot } from "@/features/ballots/api";
import { useUnsavedChanges, useUnsavedNavigation } from "@/lib/UnsavedChanges";

function NomineeControls({
  nomination,
  busy,
  canConsent,
  onDecide,
}: {
  nomination: Nomination;
  busy: boolean;
  canConsent: boolean;
  onDecide: (action: "accept" | "withdraw", name?: string) => void;
}) {
  const [name, setName] = useState(nomination.candidate_name);
  const [withdraw, setWithdraw] = useState(false);
  useUnsavedChanges(canConsent && name !== nomination.candidate_name, busy);
  function accept(event: FormEvent) {
    event.preventDefault();
    if (!busy && name.trim()) onDecide("accept", name.trim());
  }
  return (
    <div className="mt-3 space-y-3">
      {canConsent && (
        <form onSubmit={accept}>
          <label
            className="block text-sm font-medium"
            htmlFor={`candidate-${nomination.id}`}
          >
            Your name on the ballot
          </label>
          <input
            id={`candidate-${nomination.id}`}
            className="my-2 ui-input"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <p className="mb-2 supporting-copy">
            Confirm your name and consent to stand. A name change needs officer
            approval again.
          </p>
          <button
            className={button}
            disabled={
              busy ||
              (nomination.status !== "PENDING_CONSENT" &&
                name.trim() === nomination.candidate_name)
            }
          >
            Confirm consent and name
          </button>
        </form>
      )}
      {withdraw ? (
        <div role="region" aria-label="Confirm withdrawal">
          <p className="text-sm">
            Withdraw permanently from this contest? You cannot be nominated
            again for this ballot.
          </p>
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={busy}
            onClick={() => onDecide("withdraw")}
          >
            Confirm withdrawal
          </button>
          <button
            type="button"
            className={`${button} ml-2`}
            disabled={busy}
            onClick={() => setWithdraw(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => setWithdraw(true)}
        >
          Decline or withdraw
        </button>
      )}
    </div>
  );
}

export function NominationsPanel({
  ballotId,
  officer = false,
  userId,
  editable = true,
  disabled = false,
  canConsent = true,
}: {
  ballotId: string;
  officer?: boolean;
  userId?: string;
  editable?: boolean;
  disabled?: boolean;
  canConsent?: boolean;
}) {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const navigation = useUnsavedNavigation();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Nomination | null>(null);
  const query = useQuery({
    queryKey: ["nominations", ballotId, officer, offset, canConsent],
    queryFn: ({ signal }) => getNominations(ballotId, officer, offset, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: (input: {
      nomination: Nomination;
      action: "accept" | "withdraw" | "approve" | "reject";
      name?: string;
    }) => decide(input.nomination, input.action, input.name),

    retry: false,
    networkMode: "always",
    onSuccess() {
      setFeedback("Nomination updated.");
      setRejecting(null);
    },
    onError(error) {
      setFeedback(
        `${error.message} Check the refreshed status before retrying.`,
      );
      setRejecting(null);
    },

    async onSettled() {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["nominations", ballotId] }),
        client.invalidateQueries({ queryKey: ["ballots"] }),
        client.invalidateQueries({ queryKey: ["nomination-contests"] }),
      ]);
    },
  });
  const busy = disabled || mutation.isPending;
  return (
    <div className="mt-6">
      <h5 className="text-sm font-medium text-muted-foreground">

        {officer
          ? "Candidate review"
          : canConsent
            ? "Nominations you made or received"
            : "Your existing candidacy"}
      </h5>
      {feedback && (
        <p role="status" className="my-2 text-sm">
          {feedback}
        </p>
      )}

      <button
        type="button"
        className={`${button} my-3`}
        disabled={busy || query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh nominations
      </button>
      {query.isPending ? (
        <p role="status">Loading nominations…</p>
      ) : query.isError ? (
        <p role="alert">{query.error.message}</p>
      ) : (

        <>
          {rejecting && (
            <div
              className="mb-3 surface-inset"
              role="region"
              aria-label="Confirm rejection"
            >
              <p>
                Reject {rejecting.candidate_name}? This is final for this
                ballot.
              </p>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  mutation.mutate({ nomination: rejecting, action: "reject" })
                }
              >
                Confirm rejection
              </button>
              <button
                className={`${button} ml-2`}
                disabled={busy}
                onClick={() => setRejecting(null)}
              >
                Cancel
              </button>
            </div>
          )}

          <ul className="space-y-3">
            {query.data.items.map((n) => (
              <li key={n.id} className="rounded-lg bg-input p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 break-words font-semibold">
                    {n.candidate_name}
                  </p>
                  <StatusBadge
                    tone={
                      n.status === "APPROVED"
                        ? "success"
                        : n.status === "PENDING_CONSENT" ||
                            n.status === "PENDING_REVIEW"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {statusLabels[n.status]}
                  </StatusBadge>
                </div>

                {officer && n.nominee_email && (
                  <p className="mt-1 break-words supporting-copy">
                    Nominee account: {n.nominee_email}
                  </p>
                )}

                {editable &&
                  !["REJECTED", "WITHDRAWN"].includes(n.status) &&
                  (officer ? (
                    <div className="mt-2 flex gap-2">
                      {n.status === "PENDING_REVIEW" && (
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            mutation.mutate({
                              nomination: n,
                              action: "approve",
                            })
                          }
                        >
                          Approve candidate
                        </button>
                      )}

                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => setRejecting(n)}
                      >
                        Reject nomination
                      </button>
                    </div>
                  ) : (

                    n.nominee_id === userId && (
                      <NomineeControls
                        key={`${n.id}-${n.revision}`}
                        nomination={n}
                        busy={busy}
                        canConsent={canConsent}
                        onDecide={(action, name) =>
                          mutation.mutate({ nomination: n, action, name })
                        }
                      />
                    )
                  ))}
              </li>
            ))}

          </ul>

          {query.data.items.length === 0 && (
            <EmptyState
              title="No nominations yet"
              description={
                offset > 0
                  ? "Go back to see earlier nominations."
                  : officer
                    ? "Submitted candidates will appear here for review."
                    : "Your nominations and consent requests will appear here."
              }
            />
          )}

          {(query.data.total > 20 || offset > 0) && (
            <nav
              aria-label={
                officer ? "Candidate review pages" : "Your nomination pages"
              }
              className="pagination"
            >
              <button
                className={button}
                disabled={offset === 0 || busy}
                onClick={() => {
                  if (navigation.confirmLeave())
                    setOffset(Math.max(0, offset - 20));
                }}
              >
                Previous
              </button>
              <span>Page {Math.floor(offset / 20) + 1}</span>
              <button
                className={button}
                disabled={busy || offset + 20 >= query.data.total}
                onClick={() => {
                  if (navigation.confirmLeave()) setOffset(offset + 20);
                }}

              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export function OfficerNominations({
  ballot,
  disabled,
}: {
  ballot: Ballot;
  disabled: boolean;
}) {
  const client = useQueryClient();

  const [closeReview, setCloseReview] = useState(false);
  const change = useMutation({
    mutationFn: (state: "OPEN" | "CLOSED") =>
      setWindow(ballot.id, state, ballot.revision),
    retry: false,
    networkMode: "always",
    onSuccess() {
      setCloseReview(false);
    },

    async onSettled() {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["ballots", ballot.meeting_id] }),
        client.invalidateQueries({ queryKey: ["nomination-contests"] }),
      ]);
    },
  });
  const busy = disabled || change.isPending;
  return (
    <section
      className="my-4 surface-inset"
      aria-label={`Nominations for ${ballot.question}`}
    >
      <p className="text-sm">
        Nominations:{" "}
        {ballot.nomination_state === "NOT_OPEN"
          ? "Not open"
          : ballot.nomination_state === "OPEN"
            ? "Open"
            : "Closed"}

      </p>

      {ballot.state === "DRAFT" && (
        <p className="mt-2 supporting-copy">
          Close nominations and approve 2–50 candidates before opening voting.
        </p>
      )}

      <details className="mt-2 supporting-copy">
        <summary className="w-fit cursor-pointer">Nomination process</summary>
        <p className="mt-2">
          Members nominate from Your nominations. Candidates must consent and
          receive officer approval. Closing nominations stops new entries;
          consent, review and withdrawal remain possible until voting opens.
        </p>
      </details>
      {ballot.nomination_state === "NOT_OPEN" && ballot.state === "DRAFT" && (
        <p className="mt-2 supporting-copy">
          Opening nominations locks the question, description and voting method.
        </p>
      )}

      {change.isError && (
        <p role="alert" className="mt-2">
          {change.error.message}
        </p>
      )}

      {ballot.state === "DRAFT" && (
        <div className="mt-3">
          {ballot.nomination_state === "NOT_OPEN" && (
            <button
              className={button}
              disabled={busy}
              onClick={() => change.mutate("OPEN")}
            >
              Open nominations
            </button>
          )}

          {ballot.nomination_state === "OPEN" &&
            (closeReview ? (
              <>
                <p className="mb-2">
                  Stop new nominations? The nomination window cannot reopen.
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => change.mutate("CLOSED")}
                >
                  Confirm closing nominations
                </button>

                <button
                  className={`${button} ml-2`}
                  disabled={busy}
                  onClick={() => setCloseReview(false)}
                >
                  Cancel
                </button>
              </>
            ) : (

              <button
                className={button}
                disabled={busy}
                onClick={() => setCloseReview(true)}
              >
                Close nominations
              </button>
            ))}
        </div>
      )}
      {ballot.followup_kind === "runoff" && (
        <p className="mt-3 text-sm">
          Prior consent and approval carry forward. The roster is fixed;
          withdrawal or loss of approved membership blocks opening.
        </p>
      )}
      
      <NominationsPanel
        ballotId={ballot.id}
        officer
        editable={ballot.state === "DRAFT" && ballot.followup_kind !== "runoff"}
        disabled={busy}
      />
    </section>
  );
}
