import type { Meeting } from "@/features/meetings/api";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import {
  InvalidationControl,
  InvalidationNotice,
} from "./InvalidationControl";
import { FollowupControl } from "./FollowupControl";
import { useCreationAttempt } from "@/lib/use-creation-attempt";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import { WithdrawDraftControl } from "./WithdrawDraftControl";
import { buttonClass } from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PollControls } from "./PollControls";
import { useLivePolls } from "./use-live-polls";
import {
  getPolls,
  savePoll,
  type Poll,
  type PollInput,
} from "@/features/ballots/poll-api";

const fieldClass = "mt-2 ui-input";

function PollForm({
  editing,
  pending,
  locked,
  onSave,
  onCancel,
}: {
  editing: Poll | null;
  pending: boolean;
  locked: boolean;
  onSave: (input: PollInput) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PollInput["kind"]>(
    editing?.kind ?? "poll_single",
  );

  const [question, setQuestion] = useState(editing?.question ?? "");

  const [description, setDescription] = useState(editing?.description ?? "");
  const [options, setOptions] = useState(
    editing?.options.map((option) => option.label).join("\n") ?? "",
  );
  const [minimum, setMinimum] = useState(String(editing?.min_selections ?? 1));

  const [maximum, setMaximum] = useState(String(editing?.max_selections ?? 2));

  const [error, setError] = useState<string | null>(null);

  const initial = useRef(
    JSON.stringify([kind, question, description, options, minimum, maximum]),
  );

  const confirmDiscard = useUnsavedChanges(
    locked ||
      initial.current !==
        JSON.stringify([
          kind,
          question,
          description,
          options,
          minimum,
          maximum,
        ]),
    pending,
  );

  return (
    <form
      className="mt-5 surface-inset"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const labels = options
          .trim()
          .split(/\r?\n/)
          .map((label) => label.trim());
        const min = kind === "poll_single" ? 1 : Number(minimum);
        const max = kind === "poll_single" ? 1 : Number(maximum);
        if (
          !question.trim() ||
          labels.length < 2 ||
          labels.length > 50 ||
          labels.some((label) => !label || label.length > 200) ||
          !Number.isInteger(min) ||
          !Number.isInteger(max) ||
          min < 1 ||
          min > max ||
          max > labels.length ||
          (kind === "poll_multiple" && max < 2)
        ) {
          setError(
            "Enter a question, 2–50 nonempty options, and valid selection limits within the option count.",
          );
          return;
        }
        setError(null);
        onSave({
          kind,
          question: question.trim(),
          description: description.trim(),
          options: labels,
          min_selections: min,
          max_selections: max,
        });
      }}
    >
      <h3 className="text-lg font-semibold tracking-tight">
        {editing ? "Edit poll draft" : "Create a poll draft"}
      </h3>
      <fieldset disabled={pending || locked} className="mt-4 space-y-4">
        <label className="block text-sm font-medium">
          Question type
          <select
            value={kind}
            className={fieldClass}
            onChange={(event) => {
              setKind(event.target.value as PollInput["kind"]);
              if (event.target.value === "poll_multiple" && Number(maximum) < 2)
                setMaximum("2");
            }}
          >
            <option value="poll_single">Single choice</option>
            <option value="poll_multiple">Multiple choice</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          Question
          <input
            required
            maxLength={500}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Description (optional)
          <textarea
            maxLength={5000}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Options — one per line
          <textarea
            required
            maxLength={10050}
            rows={4}
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            className={fieldClass}
          />
        </label>
        <p className="supporting-copy">
          2–50 distinct options, up to 200 characters each.
        </p>
        {kind === "poll_multiple" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Minimum selections
              <input
                type="number"
                required
                min={1}
                max={50}
                step={1}
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="text-sm">
              Maximum selections
              <input
                type="number"
                required
                min={2}
                max={50}
                step={1}
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
        ) : null}
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
          {pending
            ? "Saving…"
            : editing
              ? "Save poll draft"
              : "Create poll draft"}
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

export function PollsPanel({
  meetingId,
  meeting,
  readOnly = false,
}: {
  meetingId: string;
  meeting: Meeting;
  readOnly?: boolean;
}) {
  const liveStatus = useLivePolls(meetingId, "officer");

  const client = useQueryClient();

  const attempt = useCreationAttempt<PollInput>();

  const [offset, setOffset] = useState(0);

  const [focusId, setFocusId] = useState<string | null>(null);
  function changePage(next: number) {
    setFocusId(null);
    setOffset(next);
  }

  const [editing, setEditing] = useState<Poll | null>(null);

  const [showForm, setShowForm] = useState(false);

  const formRef = useRef<HTMLDivElement>(null);

  const [formVersion, setFormVersion] = useState(0);

  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    if (showForm) formRef.current?.focus();
  }, [showForm, editing]);

  const polls = useQuery({
    queryKey: ["polls", meetingId, offset, focusId],
    queryFn: ({ signal }) => getPolls(meetingId, offset, signal, focusId),
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });

  const save = useMutation({
    mutationFn: (input: PollInput) =>
      editing
        ? savePoll(meetingId, input, editing)
        : attempt.run(input, (body, key) =>
            savePoll(meetingId, body, null, key),
          ),
    retry: false,
    networkMode: "always",
    onSuccess(poll) {
      setFocusId(poll.id);
      setEditing(null);
      setShowForm(false);
      setFormVersion((value) => value + 1);
      setFeedback("Poll draft saved.");
    },
    onError(error) {
      setFeedback(
        `${error.message} Your input is retained. Retry an uncertain creation below. Cancel editing to reload a changed draft.`,
      );
    },
    async onSettled() {
      await client.invalidateQueries({ queryKey: ["polls", meetingId] });
    },
  });
  useUnsavedChanges(!!attempt.retryInput, save.isPending);

  return (
    <section className="mt-6 surface-panel" aria-label="Live polls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Live polls</h2>
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
          disabled={readOnly || !polls.isSuccess || save.isPending || showForm}
          aria-expanded={showForm}
          aria-controls="poll-draft-editor"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
            setFeedback(null);
          }}
        >
          Create live poll
        </button>
      </div>
      <div className="mt-2">
        <ConnectionStatus message={liveStatus} />
      </div>
      <div id="poll-draft-editor" ref={formRef} tabIndex={-1}>
        {showForm && !readOnly && (
          <PollForm
            locked={!!attempt.retryInput}
            key={`${editing?.id ?? "new"}-${formVersion}`}
            editing={editing}
            pending={save.isPending}
            onSave={(input) => {
              if (!save.isPending) {
                setFeedback(null);
                save.mutate(input);
              }
            }}
            onCancel={() => {
              attempt.reset();
              setEditing(null);
              setShowForm(false);
              setFeedback(null);
            }}
          />
        )}
      </div>
      {feedback && (
        <p className="mt-4 text-sm" role={save.isError ? "alert" : "status"}>
          {feedback}
        </p>
      )}
      {polls.isPending ? (
        <p role="status" className="mt-4">
          Loading polls…
        </p>
      ) : polls.isError ? (
        <div className="mt-4">
          <p role="alert">{polls.error.message}</p>
          <button
            className={`${buttonClass} mt-3`}
            onClick={() => void polls.refetch()}
            disabled={polls.isFetching}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="list-toolbar">
            <h3 className="text-sm font-medium text-muted-foreground">
              Polls ({polls.data.total})
            </h3>
            <button
              className={buttonClass}
              disabled={polls.isFetching || save.isPending}
              onClick={() => void polls.refetch()}
            >
              Refresh polls
            </button>
          </div>
          <ul className="space-y-4">
            {polls.data.items.map((poll) => (
              <li
                key={poll.id}
                className={`surface-inset ${focusId === poll.id ? "ring-1 ring-ring" : ""}`}
              >
                {focusId === poll.id && (
                  <p className="mb-2 text-sm text-accent-foreground">
                    Saved item
                  </p>
                )}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="pt-1 supporting-copy">
                    {poll.kind === "poll_single"
                      ? "Single choice"
                      : "Multiple choice"}
                  </p>
                  <StatusBadge
                    tone={
                      poll.invalidated_at
                        ? "danger"
                        : poll.state === "OPEN"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {poll.invalidated_at
                      ? "Invalidated"
                      : poll.state === "OPEN"
                        ? "Poll open"
                        : poll.state === "CLOSED"
                          ? "Poll closed"
                          : poll.state === "CANCELLED"
                            ? "Cancelled draft"
                            : "Draft"}
                  </StatusBadge>
                </div>
                <h4 className="item-heading mt-3">{poll.question}</h4>
                <details
                  className="mt-5"
                  open={poll.state === "OPEN" || focusId === poll.id}
                >
                  <summary className="w-fit cursor-pointer py-2 text-sm font-medium">
                    {poll.state === "DRAFT"
                      ? "Details and opening controls"
                      : "Results and poll controls"}
                  </summary>
                  {poll.description && (
                    <p className="mt-3 whitespace-pre-wrap break-words supporting-copy">
                      {poll.description}
                    </p>
                  )}
                  <ol className="my-3 list-inside list-decimal text-sm">
                    {poll.options.map((option) => (
                      <li className="break-words" key={option.id}>
                        {option.label}
                      </li>
                    ))}
                  </ol>
                  <p className="mb-4 supporting-copy">
                    Select{" "}
                    {poll.min_selections === poll.max_selections
                      ? `exactly ${poll.min_selections}`
                      : `${poll.min_selections}–${poll.max_selections}`}
                    .
                  </p>
                  {poll.state === "DRAFT" && (
                    <button
                      className={buttonClass}
                      disabled={readOnly || save.isPending || showForm}
                      onClick={() => {
                        setEditing(poll);
                        setShowForm(true);
                        setFeedback(null);
                      }}
                    >
                      Edit poll draft
                    </button>
                  )}
                  {poll.state === "DRAFT" && (
                    <WithdrawDraftControl
                      meetingId={meetingId}
                      ballot={poll}
                      disabled={readOnly || save.isPending || showForm}
                    />
                  )}
                  <InvalidationNotice value={poll} />
                  <InvalidationControl
                    meetingId={meetingId}
                    ballot={poll}
                    disabled={save.isPending || showForm}
                  />
                  {(poll.invalidated_at || poll.followup_kind) && (
                    <FollowupControl
                      ballot={poll}
                      meeting={meeting}
                      disabled={save.isPending || showForm}
                    />
                  )}
                  <PollControls
                    key={`${poll.id}-${poll.state === "OPEN" ? "Poll open" : poll.state === "CLOSED" ? "Poll closed" : poll.state === "CANCELLED" ? "Cancelled draft" : "Draft"}-${poll.revision}`}
                    meetingId={meetingId}
                    poll={poll}
                    disabled={readOnly || save.isPending || showForm}
                  />
                </details>
              </li>
            ))}
          </ul>
          {polls.data.items.length === 0 && (
            <EmptyState
              title={
                polls.data.total === 0
                  ? "No polls yet"
                  : "No polls on this page"
              }
              description={
                polls.data.offset > 0
                  ? "Go back to see earlier polls."
                  : readOnly
                    ? "This meeting has no polls."
                    : "Choose Create live poll to prepare your first question."
              }
            />
          )}
          {(polls.data.total > 20 || polls.data.offset > 0) && (
            <nav aria-label="Poll pages" className="pagination">
              <button
                className={buttonClass}
                disabled={polls.data.offset === 0 || save.isPending || showForm}
                onClick={() => changePage(Math.max(0, polls.data.offset - 20))}
              >
                Previous
              </button>
              <span className="text-sm">
                Page {Math.floor(polls.data.offset / 20) + 1}
              </span>
              <button
                className={buttonClass}
                disabled={
                  polls.data.offset + 20 >= polls.data.total ||
                  save.isPending ||
                  showForm
                }
                onClick={() => changePage(polls.data.offset + 20)}
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
