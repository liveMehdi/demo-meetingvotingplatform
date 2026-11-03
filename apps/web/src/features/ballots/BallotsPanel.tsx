import { FollowupControl } from "./FollowupControl";
import { RankedVotingHelp } from "./RankedVotingHelp";
import {
  InvalidationControl,
  InvalidationNotice,
} from "./InvalidationControl";
import { useSearchParams } from "react-router";
import { useCreationAttempt } from "@/lib/use-creation-attempt";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useUnsavedChanges, useUnsavedNavigation } from "@/lib/UnsavedChanges";
import {
  actionButtonClass as buttonClass,
  inputClass as sharedInputClass,
} from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  closeBallot,
  getBallots,
  openBallot,
  saveBallot,
  type Ballot,
  type BallotInput,
} from "@/features/ballots/api";
import { eligibilityLabels, type Meeting } from "@/features/meetings/api";
import { ResultsPanel } from "@/features/ballots/ResultsPanel";
import { PublicationControl } from "@/features/ballots/PublicationControl";
import { OfficerNominations } from "@/features/nominations/NominationsPanel";

import { WithdrawDraftControl } from "./WithdrawDraftControl";
import { meetingIsActive } from "@/features/meetings/api";
import { ballotStateLabels } from "@/lib/navigation";

const inputClass = `${sharedInputClass} mt-2`;

function DraftForm({
  editing,
  pending,
  locked,
  onSave,
  onCancel,
}: {
  editing: Ballot | null;
  pending: boolean;
  locked: boolean;
  onSave: (input: BallotInput) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<BallotInput["kind"]>(
    editing?.kind ?? "election",
  );

  const [source, setSource] = useState<BallotInput["candidate_source"]>(
    editing?.candidate_source ?? "manual",
  );

  const [method, setMethod] = useState<BallotInput["counting_method"]>(
    editing?.counting_method ?? "standard",
  );

  const [question, setQuestion] = useState(editing?.question ?? "");

  const [description, setDescription] = useState(editing?.description ?? "");

  const [options, setOptions] = useState(
    editing?.kind === "election"
      ? editing.options.map((o) => o.label).join("\n")
      : "",
  );

  const [error, setError] = useState<string | null>(null);

  const initial = useRef(
    JSON.stringify([kind, source, method, question, description, options]),
  );

  const confirmDiscard = useUnsavedChanges(
    locked ||
      initial.current !==
        JSON.stringify([kind, source, method, question, description, options]),
    pending,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const manualElection = kind === "election" && source === "manual";
    const labels = manualElection
      ? options
          .trim()
          .split(/\r?\n/)
          .map((label) => label.trim())
      : [];
    if (
      !question.trim() ||
      (manualElection &&
        (labels.length < 2 ||
          labels.length > 50 ||
          labels.some((label) => !label || label.length > 200)))
    ) {
      setError(
        "Enter a question and, for an election, 2–50 nonempty options (up to 200 characters each).",
      );
      return;
    }
    setError(null);
    onSave({
      kind,
      question: question.trim(),
      description: description.trim(),
      options: labels,
      candidate_source: source,
      counting_method: kind === "election" ? method : "standard",
    });
  }

  return (
    <form onSubmit={submit} className="my-6 surface-inset" aria-busy={pending}>
      <h3 className="text-lg font-semibold tracking-tight">
        {editing ? "Edit draft" : "Create a draft ballot"}
      </h3>
      <fieldset
        disabled={pending || locked}
        className="mt-4 space-y-4 disabled:opacity-60"
      >
        <div>
          <label htmlFor="ballot-kind" className="text-sm font-medium">
            Ballot type
          </label>
          <select
            id="ballot-kind"
            value={kind}
            disabled={
              editing?.candidate_source === "nominations" ||
              !!editing?.followup_kind
            }
            onChange={(e) => {
              setKind(e.target.value as BallotInput["kind"]);
              if (e.target.value === "motion") setSource("manual");
            }}
            className={inputClass}
          >
            <option value="election">Election</option>
            <option value="motion">Motion</option>
          </select>
        </div>
        <div>
          <label htmlFor="ballot-question" className="text-sm font-medium">
            Question
          </label>
          <input
            id="ballot-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={500}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ballot-description" className="text-sm font-medium">
            Description (optional)
          </label>
          <textarea
            id="ballot-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            rows={3}
            className={inputClass}
          />
        </div>
        {kind === "election" && (
          <div>
            <label htmlFor="counting-method" className="text-sm font-medium">
              Voting method
            </label>
            <select
              id="counting-method"
              className={inputClass}
              value={method}
              onChange={(e) =>
                setMethod(e.target.value as BallotInput["counting_method"])
              }
            >
              <option value="standard">Single choice (most votes wins)</option>
              <option value="irv_v1">Ranked choice (one winner)</option>
            </select>
            {method === "irv_v1" && <RankedVotingHelp />}
          </div>
        )}
        {kind === "election" && (
          <div>
            <label htmlFor="candidate-source" className="text-sm font-medium">
              Candidates
            </label>
            <select
              id="candidate-source"
              className={inputClass}
              value={source}
              disabled={editing !== null}
              onChange={(e) =>
                setSource(e.target.value as BallotInput["candidate_source"])
              }
            >
              <option value="manual">Enter candidates manually</option>
              <option value="nominations">
                Member nominations and officer approval
              </option>
            </select>
            <p className="mt-2 supporting-copy">
              Cannot be changed after creation.
            </p>
          </div>
        )}
        {kind === "election" && source === "manual" ? (
          <div>
            <label htmlFor="ballot-options" className="text-sm font-medium">
              Options — one per line
            </label>
            <textarea
              id="ballot-options"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              required
              maxLength={10050}
              rows={5}
              className={inputClass}
              aria-describedby="options-help"
            />
            <p id="options-help" className="mt-2 supporting-copy">
              2–50 distinct options.{" "}
              {method === "irv_v1"
                ? "Members will rank one or more."
                : "Members will select one."}
            </p>
          </div>
        ) : (
          <p className="supporting-copy">
            {kind === "motion"
              ? "Choices: For / Against / Abstain. Members will select one."
              : "Create the draft, open nominations and approve consenting candidates before opening voting."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      <div className="mt-6 action-row">
        <button
          className={`${buttonClass} ui-button-primary`}
          type="submit"
          disabled={pending || locked}
        >
          {pending ? "Saving…" : editing ? "Save draft" : "Create draft"}
        </button>
        <button
          className={buttonClass}
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirmDiscard()) onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

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
      setFailure(
        `${error.message} Your input is retained. Retry an uncertain creation below; cancel editing to reload a changed draft.`,
      );
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
              <li
                key={ballot.id}
                className={`surface-inset ${focusId === ballot.id ? "ring-1 ring-ring" : ""}`}
              >
                {focusId === ballot.id && (
                  <p className="mb-2 text-sm text-accent-foreground">
                    Saved item
                  </p>
                )}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="pt-1 supporting-copy">
                    {ballot.kind === "motion"
                      ? "Motion"
                      : ballot.counting_method === "irv_v1"
                        ? "Ranked election (one winner)"
                        : "Single-choice election"}
                  </p>
                  <StatusBadge
                    tone={
                      ballot.invalidated_at
                        ? "danger"
                        : ballot.state === "OPEN"
                          ? "success"
                          : ballot.state === "PUBLISHED"
                            ? "accent"
                            : "neutral"
                    }
                  >
                    {ballot.invalidated_at
                      ? "Invalidated"
                      : ballotStateLabels[ballot.state]}
                  </StatusBadge>
                </div>
                <h4 className="item-heading mt-3">{ballot.question}</h4>
                {ballot.opened_at !== null && (
                  <p className="mt-3 supporting-copy tabular-nums">
                    {ballot.participation_count}{" "}
                    {ballot.participation_count === 1
                      ? "submission"
                      : "submissions"}{" "}
                    · {ballot.eligible_count} eligible{" "}
                    {ballot.eligible_count === 1 ? "member" : "members"}
                  </p>
                )}
                <details
                  className="mt-5"
                  open={ballot.state === "OPEN" || focusId === ballot.id}
                >
                  <summary className="w-fit cursor-pointer py-2 text-sm font-medium">
                    {ballot.state === "PUBLISHED"
                      ? "View published results"
                      : ballot.candidate_source === "nominations" &&
                          ballot.state === "DRAFT"
                        ? "Manage nominations and voting"
                        : "Details and voting controls"}
                  </summary>
                  {ballot.description && (
                    <p className="mt-3 whitespace-pre-wrap break-words supporting-copy">
                      {ballot.description}
                    </p>
                  )}
                  {ballot.candidate_source === "nominations" && (
                    <OfficerNominations
                      ballot={ballot}
                      disabled={
                        busy ||
                        showForm ||
                        review !== null ||
                        closeReview !== null
                      }
                    />
                  )}
                  <ol className="my-3 list-decimal space-y-1 pl-5 text-sm">
                    {ballot.options.map((option) => (
                      <li key={option.id} className="break-words">
                        {option.label}
                      </li>
                    ))}
                  </ol>
                  {ballot.opened_at && (
                    <p className="my-3 supporting-copy">
                      Eligible members present at opening:{" "}
                      <span className="font-medium text-foreground">
                        {ballot.eligible_attendance_count}
                      </span>
                      .
                    </p>
                  )}
                  <InvalidationNotice value={ballot} />
                  <InvalidationControl
                    meetingId={meetingId}
                    ballot={ballot}
                    disabled={
                      busy ||
                      showForm ||
                      review !== null ||
                      closeReview !== null
                    }
                  />
                  {ballot.state === "CLOSED" && !ballot.invalidated_at && (
                    <PublicationControl
                      ballot={ballot}
                      disabled={
                        busy ||
                        showForm ||
                        review !== null ||
                        closeReview !== null
                      }
                    />
                  )}
                  {(ballot.kind === "election" ||
                    ballot.invalidated_at ||
                    ballot.followup_kind) && (
                    <FollowupControl
                      ballot={ballot}
                      meeting={meeting}
                      disabled={
                        busy ||
                        showForm ||
                        review !== null ||
                        closeReview !== null
                      }
                    />
                  )}
                  {ballot.state === "PUBLISHED" && (
                    <ResultsPanel ballotId={ballot.id} meetingId={meetingId} />
                  )}
                  {ballot.state === "OPEN" && (
                    <button
                      className={buttonClass}
                      disabled={
                        busy ||
                        showForm ||
                        review !== null ||
                        closeReview !== null
                      }
                      onClick={() => {
                        setCloseReview(ballot);
                        setFeedback(null);
                        setFailure(null);
                      }}
                    >
                      Close voting
                    </button>
                  )}
                  {ballot.state === "DRAFT" && (
                    <div className="action-row">
                      {ballot.followup_kind !== "runoff" &&
                        !(
                          ballot.candidate_source === "nominations" &&
                          ballot.nomination_state !== "NOT_OPEN"
                        ) && (
                          <button
                            className={buttonClass}
                            disabled={
                              busy ||
                              showForm ||
                              review !== null ||
                              closeReview !== null
                            }
                            onClick={() => {
                              setEditing(ballot);
                              setShowForm(true);
                              setFeedback(null);
                              setFailure(null);
                            }}
                          >
                            Edit draft
                          </button>
                        )}
                      <button
                        className={buttonClass}
                        disabled={
                          busy ||
                          showForm ||
                          review !== null ||
                          closeReview !== null
                        }
                        onClick={() => {
                          setReview({ ballot, meeting });
                          setFeedback(null);
                          setFailure(null);
                        }}
                      >
                        Review opening
                      </button>
                    </div>
                  )}
                  {ballot.state === "DRAFT" && (
                    <WithdrawDraftControl
                      meetingId={meetingId}
                      ballot={ballot}
                      disabled={
                        !meetingIsActive(meeting) ||
                        busy ||
                        showForm ||
                        review !== null ||
                        closeReview !== null
                      }
                    />
                  )}
                </details>
              </li>
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
