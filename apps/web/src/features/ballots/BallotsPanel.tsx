import { BallotCard } from "./BallotCard";
import { draftSaveError } from "./draft-save-error";
import { DraftForm } from "./DraftForm";
import { useSearchParams } from "react-router";
import { useCreationAttempt } from "@/lib/use-creation-attempt";
import { EmptyState } from "@/components/ui/EmptyState";
import { useUnsavedChanges, useUnsavedNavigation } from "@/lib/UnsavedChanges";
import { actionButtonClass as buttonClass } from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  closeBallot,
  getBallots,
  openBallot,
  saveBallot,
  type Ballot,
  type BallotInput,
} from "@/features/ballots/api";
import { eligibilityLabels, type Meeting } from "@/features/meetings/api";

import { meetingIsActive } from "@/features/meetings/api";

export function BallotsPanel({ meeting }: { meeting: Meeting }) {
  const meetingId = meeting.id;

  const [params] = useSearchParams();

  const requestedBallot = params.get("ballot");

  const client = useQueryClient();

  const attempt = useCreationAttempt<BallotInput>();

  const [offset, setOffset] = useState(0);

  const [focusId, setFocusId] = useState<string | null>(requestedBallot);
  useEffect(() => {
    setFocusId(requestedBallot);
  }, [requestedBallot]);

  const unsaved = useUnsavedNavigation();
  function changePage(next: number) {
    if (unsaved.confirmLeave()) {
      setFocusId(null);
      setOffset(next);
    }
  }

  const [editing, setEditing] = useState<Ballot | null>(null);

  const [showForm, setShowForm] = useState(false);

  const formRef = useRef<HTMLDivElement>(null);

  const reviewRef = useRef<HTMLDivElement>(null);

  const [formVersion, setFormVersion] = useState(0);

  const [feedback, setFeedback] = useState<string | null>(null);

  const [failure, setFailure] = useState<string | null>(null);

  const [review, setReview] = useState<{
    ballot: Ballot;
    meeting: Meeting;
  } | null>(null);

  const [closeReview, setCloseReview] = useState<Ballot | null>(null);
  useEffect(() => {
    if (showForm) formRef.current?.focus();
  }, [showForm, editing]);
  useEffect(() => {
    if (review || closeReview) reviewRef.current?.focus();
  }, [review, closeReview]);

  const ballots = useQuery({
    queryKey: ["ballots", meetingId, offset, focusId],
    queryFn: ({ signal }) => getBallots(meetingId, offset, signal, focusId),
    retry: false,
    networkMode: "always",
    gcTime: 0,
  });

  const save = useMutation({
    mutationFn: (input: BallotInput) =>
      editing
        ? saveBallot(meetingId, input, editing)
        : attempt.run(input, (body, key) =>
            saveBallot(meetingId, body, null, key),
          ),
    retry: false,
    networkMode: "always",
    async onSuccess(ballot) {
      setFeedback(`Draft saved: ${ballot.question}`);
      setFocusId(ballot.id);
      setEditing(null);

      setShowForm(false);
      setFormVersion((v) => v + 1);
      await client.invalidateQueries({ queryKey: ["ballots", meetingId] });
    },

    async onError(error) {
      setFailure(draftSaveError(error, editing !== null, !!attempt.retryInput));
      await client.invalidateQueries({ queryKey: ["ballots", meetingId] });
    },
  });
  useUnsavedChanges(!!attempt.retryInput, save.isPending);

  const opening = useMutation({
    mutationFn: (candidate: { ballot: Ballot; meeting: Meeting }) =>
      openBallot(
        meetingId,
        candidate.ballot,
        candidate.meeting.eligibility_revision,
      ),
    retry: false,
    networkMode: "always",

    async onSuccess(ballot) {
      setReview(null);
      setFeedback(
        `Ballot opened with ${ballot.eligible_count} eligible members.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["ballots", meetingId] }),
        client.invalidateQueries({ queryKey: ["meeting", meetingId] }),
        client.invalidateQueries({ queryKey: ["meetings"] }),
      ]);
    },

    async onError(error) {
      setReview(null);
      setFailure(
        `${error.message} Check the refreshed ballot before trying again.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["ballots", meetingId] }),
        client.invalidateQueries({ queryKey: ["meeting", meetingId] }),
      ]);
    },
  });

  const closing = useMutation({
    mutationFn: (ballot: Ballot) => closeBallot(meetingId, ballot.id),
    retry: false,
    networkMode: "always",

    onSuccess() {
      setCloseReview(null);
      setFeedback("Voting closed. Results remain unpublished.");
    },

    onError(error) {
      setCloseReview(null);
      setFailure(`${error.message} Refresh to check the ballot state.`);
    },

    async onSettled() {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["ballots", meetingId] }),
        client.invalidateQueries({ queryKey: ["my-ballots"] }),
        client.invalidateQueries({ queryKey: ["my-ballot"] }),
      ]);
    },
  });

  const busy = save.isPending || opening.isPending || closing.isPending;

  return (
    <section className="mt-6 surface-panel" aria-labelledby="ballots-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ballots-title" className="text-xl font-semibold">
          Formal voting
        </h2>

        {attempt.retryInput && (
          <div className="space-y-2 text-sm">
            <p>
              Creation wasn’t confirmed. Retry here before leaving to check
              whether it was saved.
            </p>

            <button
              className={buttonClass}
              disabled={save.isPending}
              onClick={() => save.mutate(attempt.retryInput!)}
            >
              Retry original creation
            </button>
          </div>
        )}

        <button
          className={`${buttonClass} ui-button-primary`}
          disabled={
            !meetingIsActive(meeting) ||
            !ballots.isSuccess ||
            busy ||
            showForm ||
            review !== null ||
            closeReview !== null
          }

          aria-expanded={showForm}
          aria-controls="ballot-draft-editor"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
            setFeedback(null);
            setFailure(null);
          }}
        >
          Create election or motion
        </button>
      </div>
      <div id="ballot-draft-editor" ref={formRef} tabIndex={-1}>
        {showForm && meetingIsActive(meeting) && (
          <DraftForm
            locked={!!attempt.retryInput}
            key={`${editing?.id ?? "new"}-${formVersion}`}
            editing={editing}
            pending={busy || review !== null || closeReview !== null}
            onCancel={() => {
              attempt.reset();
              setEditing(null);
              setShowForm(false);

              setFailure(null);
            }}
            onSave={(input) => {
              if (save.isPending) return;
              setFeedback(null);
              setFailure(null);
              save.mutate(input);
            }}
          />
        )}
      </div>
      {feedback && (
        <p role="status" className="mt-4 text-sm">
          {feedback}
        </p>
      )}

      {failure && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {failure}
        </p>
      )}

      {ballots.isPending ? (
        <p role="status" className="mt-4">
          Loading ballots…
        </p>
      ) : ballots.isError ? (
        <div className="mt-4">
          <p role="alert" className="text-destructive">
            {ballots.error.message}
          </p>
          <button
            className={`${buttonClass} mt-3`}
            disabled={ballots.isFetching}
            onClick={() => void ballots.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {review && (
            <div
              ref={reviewRef}
              tabIndex={-1}
              className="my-4 surface-inset"
              role="region"
              aria-label="Confirm ballot opening"
            >
              <h3 className="font-medium">Open “{review.ballot.question}”?</h3>
              <p className="mt-2 text-sm">
                Method:{" "}
                {review.ballot.counting_method === "irv_v1"
                  ? "Ranked choice, one winner. Tied elimination requires a new election among all remaining candidates."
                  : "Single choice"}
                . The method freezes when voting opens.
              </p>
              {review.ballot.candidate_source === "nominations" && (
                <p className="mt-2 text-sm">
                  Review all approved candidates before opening. Nominations
                  must be closed. Candidates cannot change their names or
                  withdraw afterward.
                </p>
              )}
              <p className="mt-2 text-sm">
                Eligibility:{" "}
                {eligibilityLabels[review.meeting.eligibility_policy]}. Eligible
                members and attendance are fixed at opening. The ballot and
                meeting eligibility setting cannot be changed afterward.
              </p>
              <div className="mt-3 action-row">
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    if (!busy) {
                      setFailure(null);
                      setFeedback(null);
                      opening.mutate(review);
                    }
                  }}
                >
                  {opening.isPending ? "Opening…" : "Confirm opening"}
                </button>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {closeReview && (
            <div
              ref={reviewRef}
              tabIndex={-1}
              className="my-4 surface-inset"
              role="region"
              aria-label="Confirm closing"
            >
              <h3 className="font-medium">Close “{closeReview.question}”?</h3>
              <p className="mt-2 text-sm">
                New submissions will stop. This ballot cannot reopen. Closing
                does not publish results.
              </p>
              <div className="mt-3 action-row">
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    if (!busy) {
                      setFailure(null);
                      setFeedback(null);
                      closing.mutate(closeReview);
                    }
                  }}
                >
                  {closing.isPending ? "Closing…" : "Confirm closing"}
                </button>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => setCloseReview(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="list-toolbar">
            <h3 className="text-sm font-medium text-muted-foreground">
              Ballots ({ballots.data.total})
            </h3>
            <button
              className={buttonClass}
              disabled={ballots.isFetching || busy}
              onClick={() => void ballots.refetch()}
            >
              Refresh ballots
            </button>
          </div>
          <ul className="space-y-4">
            {ballots.data.items.map((ballot) => (
              <BallotCard
                key={ballot.id}
                ballot={ballot}
                meeting={meeting}
                focused={focusId === ballot.id}
                disabled={
                  busy || showForm || review !== null || closeReview !== null
                }
                onEdit={() => {
                  setEditing(ballot);
                  setShowForm(true);
                  setFeedback(null);
                  setFailure(null);
                }}
                onOpen={() => {
                  setReview({ ballot, meeting });
                  setFeedback(null);
                  setFailure(null);
                }}
                onClose={() => {
                  setCloseReview(ballot);
                  setFeedback(null);
                  setFailure(null);
                }}
              />
            ))}
          </ul>
          {ballots.data.items.length === 0 && (
            <EmptyState
              title={
                ballots.data.total === 0
                  ? "No formal ballots yet"
                  : "No ballots on this page"
              }
              description={
                ballots.data.offset > 0
                  ? "Go back to see earlier ballots."
                  : meetingIsActive(meeting)
                    ? "Choose Create election or motion to prepare a draft."
                    : "This meeting has no formal ballots."
              }
            />
          )}
          {(ballots.data.total > 20 || ballots.data.offset > 0) && (
            <nav aria-label="Ballot pages" className="pagination">
              <button
                className={buttonClass}
                disabled={
                  ballots.data.offset === 0 ||
                  busy ||
                  showForm ||
                  review !== null ||
                  closeReview !== null
                }
                onClick={() =>
                  changePage(Math.max(0, ballots.data.offset - 20))
                }
              >
                Previous
              </button>
              <span className="text-sm">
                Page {Math.floor(ballots.data.offset / 20) + 1}
              </span>
              <button
                className={buttonClass}
                disabled={
                  ballots.data.offset + 20 >= ballots.data.total ||
                  busy ||
                  showForm ||
                  review !== null ||
                  closeReview !== null
                }
                onClick={() => changePage(ballots.data.offset + 20)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
