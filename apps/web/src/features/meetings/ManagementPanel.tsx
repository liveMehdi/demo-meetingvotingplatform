import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actionButtonClass as button,
  inputClass,
} from "@/components/ui/control-styles";
import { meetingTimeChoices } from "@/lib/meeting-time";
import {
  meetingIsActive,
  meetingStateLabels,
  meetingTime,
  type Meeting,
  type MeetingInput,
} from "./api";
import {
  completionSummary,
  getMeetingHistory,
  transitionMeeting,
  updateMeeting,
  type Completion,
} from "./management-api";

function localInput(iso: string) {
  const date = new Date(iso);

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DetailsForm({
  meeting,
  pending,
  save,
  cancel,
}: {
  meeting: Meeting;
  pending: boolean;
  save: (input: MeetingInput) => void;
  cancel: () => void;
}) {
  const [title, setTitle] = useState(meeting.title);

  const [description, setDescription] = useState(meeting.description);

  const [date, setDate] = useState(localInput(meeting.scheduled_at));

  const [dateEdited, setDateEdited] = useState(false);

  const [occurrence, setOccurrence] = useState(
    new Date(meeting.scheduled_at).toISOString(),
  );

  const [error, setError] = useState("");

  const confirmDiscard = useUnsavedChanges(
    title !== meeting.title ||
      description !== meeting.description ||
      dateEdited,
    pending,
  );

  const choices = meetingTimeChoices(date);

  const selected = !dateEdited
    ? meeting.scheduled_at
    : choices.length === 1
      ? choices[0]
      : choices.find((time) => time === occurrence);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!title.trim() || !selected) {
      setError(
        "Enter a valid date and title, and choose an occurrence if the time repeats.",
      );
      return;
    }
    setError("");
    save({
      title: title.trim(),
      description: description.trim(),
      scheduled_at: selected,
    });
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4 surface-inset">
      <h3 className="font-semibold">Edit meeting details</h3>
      <fieldset disabled={pending} className="space-y-4">
        <label className="block text-sm font-medium">
          Title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClass} mt-2`}
          />
        </label>
        <label className="block text-sm font-medium">
          Description
          <textarea
            maxLength={5000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} mt-2`}
          />
        </label>
        <label className="block text-sm font-medium">
          Scheduled time
          <input
            type="datetime-local"
            max="9999-12-31T23:59"
            required
            value={date}
            disabled={meeting.state !== "PLANNED"}
            onChange={(e) => {
              setDate(e.target.value);
              setDateEdited(true);
              setOccurrence("");
            }}
            className={`${inputClass} mt-2`}
          />
        </label>
        <p className="supporting-copy">
          Your time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.{" "}
          {meeting.state === "LIVE" && "Live meetings cannot be rescheduled."}
        </p>
        {meeting.state === "PLANNED" && dateEdited && choices.length > 1 && (
          <label className="block text-sm font-medium">
            This local time occurs twice
            <select
              required
              value={occurrence}
              onChange={(e) => {
                setOccurrence(e.target.value);
                setDateEdited(true);
              }}
              className={`${inputClass} mt-2`}
            >
              <option value="">Choose an occurrence</option>
              {choices.map((time, index) => (
                <option key={time} value={time}>
                  {index === 0 ? "First" : "Second"}: {meetingTime(time)}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && Date.parse(selected) < Date.now() && (
          <p className="supporting-copy">This date is in the past.</p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="action-row">
          <button className={button}>Save details</button>
          <button
            type="button"
            className={button}
            onClick={() => {
              if (confirmDiscard()) cancel();
            }}
          >
            Cancel editing
          </button>
        </div>
      </fieldset>
    </form>
  );
}

type Review = {
  action: "end" | "cancel";
  meeting: Meeting;
  summary: Completion;
};

export function MeetingManagement({ meeting }: { meeting: Meeting }) {
  const client = useQueryClient();

  const [editing, setEditing] = useState<Meeting | null>(null);

  const [review, setReview] = useState<Review | null>(null);

  const [confirmed, setConfirmed] = useState(false);

  const [feedback, setFeedback] = useState("");

  const [showHistory, setShowHistory] = useState(false);

  const [offset, setOffset] = useState(0);

  const history = useQuery({
    queryKey: ["meeting-history", meeting.id, offset],
    enabled: showHistory,
    queryFn: ({ signal }) => getMeetingHistory(meeting.id, offset, signal),
    retry: false,
    gcTime: 0,
  });

  async function refresh(updated?: Meeting) {
    if (updated) client.setQueryData(["meeting", meeting.id], updated);
    await Promise.all(
      [
        "meeting",
        "meetings",
        "meeting-history",
        "ballots",
        "polls",
        "attendance",
        "guest-joining",
        "nomination-contests",
        "nominations",
        "my-ballots",
        "my-ballot",
        "poll-presentation",
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
  }

  const save = useMutation({
    mutationFn: (input: MeetingInput) => updateMeeting(editing!, input),
    retry: false,
    networkMode: "always",
    async onSuccess(updated) {
      setEditing(null);
      setFeedback("Meeting details saved.");
      await refresh(updated);
    },
    async onError(error) {
      setFeedback(
        `${error.message} Your entries are still here. To load the latest details, cancel editing and reopen the form.`,
      );
      await refresh();
    },
  });

  const change = useMutation({
    mutationFn: (input: {
      meeting: Meeting;
      action: "start" | "end" | "cancel";
      summary?: Completion;
      confirm?: boolean;
    }) =>
      transitionMeeting(
        input.meeting,
        input.action,
        input.summary,
        input.confirm,
      ),
    retry: false,
    networkMode: "always",
    async onSuccess(updated) {
      setReview(null);
      setFeedback(
        `Meeting ${meetingStateLabels[updated.state].toLowerCase()}.`,
      );
      await refresh(updated);
    },
    async onError(error) {
      setReview(null);
      setFeedback(
        `${error.message} Review the current meeting before trying again.`,
      );
      await refresh();
    },
  });

  const preview = useMutation({
    mutationFn: async (input: {
      action: "end" | "cancel";
      meeting: Meeting;
    }) => ({ ...input, summary: await completionSummary(input.meeting.id) }),
    retry: false,
    networkMode: "always",
    onSuccess(result) {
      setConfirmed(false);
      setReview(result);
    },
    onError(error) {
      setFeedback(error.message);
    },
  });

  const busy = save.isPending || change.isPending || preview.isPending;

  const blocked =
    review &&
    (review.summary.open_formal + review.summary.open_polls > 0 ||
      (review.action === "cancel" && review.summary.ever_opened));

  return (
    <section className="mt-6 surface-panel" aria-label="Meeting management">
      <h2 className="text-xl font-semibold">Meeting management</h2>
      {meeting.state === "PLANNED" && (
        <p className="mt-2 supporting-copy">
          Starting locks the scheduled time. Votes must be opened separately.
        </p>
      )}
      {meeting.needs_status_review && (
        <details className="mt-3 supporting-copy">
          <summary className="w-fit cursor-pointer">
            Meeting status needs review
          </summary>
          <p className="mt-2">
            This older meeting has no recorded lifecycle status. Review its
            history before starting, ending or cancelling it. Status changes use
            today’s date.
          </p>
        </details>
      )}
      {feedback && (
        <p
          role={
            save.isError || change.isError || preview.isError
              ? "alert"
              : "status"
          }
          className="mt-4 text-sm"
        >
          {feedback}
        </p>
      )}
      {meetingIsActive(meeting) ? (
        <div className="mt-4 action-row">
          <button
            className={button}
            disabled={busy || !!editing || !!review}
            onClick={() => {
              setEditing(meeting);
              setFeedback("");
            }}
          >
            Edit details
          </button>
          {meeting.state === "PLANNED" && (
            <button
              className={button}
              disabled={busy || !!editing || !!review}
              onClick={() => change.mutate({ meeting, action: "start" })}
            >
              Start meeting
            </button>
          )}
          <button
            className={button}
            disabled={busy || !!editing || !!review}
            onClick={() => {
              setFeedback("");
              preview.mutate({
                meeting,
                action: meeting.state === "LIVE" ? "end" : "cancel",
              });
            }}
          >
            {preview.isPending
              ? "Checking activity…"
              : meeting.state === "LIVE"
                ? "Review ending meeting"
                : "Review cancellation"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm">
          This meeting is read-only and cannot reopen. Closed results can still
          be explicitly published from Formal voting.
        </p>
      )}
      {editing && meetingIsActive(meeting) && (
        <DetailsForm
          meeting={editing}
          pending={busy}
          save={(input) => save.mutate(input)}
          cancel={() => {
            setEditing(null);
            setFeedback("");
          }}
        />
      )}
      {review && meetingIsActive(meeting) && (
        <div
          className="mt-5 space-y-3 surface-inset"
          role="region"
          aria-label="Review meeting completion"
        >
          <h3 className="font-semibold">
            {review.action === "end" ? "End" : "Cancel"} {review.meeting.title}?
          </h3>
          <ul className="list-inside list-disc text-sm">
            <li>
              {review.summary.open_formal} open formal votes ·{" "}
              {review.summary.open_polls} open polls
            </li>
            <li>
              {review.summary.drafts} unused drafts ·{" "}
              {review.summary.nomination_windows} open nomination windows
            </li>
            <li>
              {review.summary.unpublished_results} closed formal results
              awaiting publication
            </li>
          </ul>
          {blocked && (
            <p role="alert" className="text-sm text-destructive">
              {review.action === "cancel" && review.summary.ever_opened
                ? "A vote or poll already opened, so this meeting cannot be cancelled. Start it, close any open votes/polls, then end it."
                : "Close every open vote and poll before ending. Return here for a fresh review afterward."}
            </p>
          )}
          <p className="text-sm">
            This cannot be undone. New activity and guest joining will stop;
            existing guests can still view results. Records stay saved. Results
            are not automatically published.
          </p>
          {review.summary.drafts > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              I confirm cancellation of these {review.summary.drafts} unused
              drafts and their nominations. They cannot reopen.
            </label>
          )}
          <div className="action-row">
            <button
              className={button}
              disabled={
                busy || !!blocked || (review.summary.drafts > 0 && !confirmed)
              }
              onClick={() => change.mutate({ ...review, confirm: confirmed })}
            >
              Confirm {review.action === "end" ? "ending" : "cancellation"}
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Back
            </button>
          </div>
          {review.action === "end" && (
            <p className="supporting-copy">
              Ask an administrator to save the audit history and checkpoint
              afterward.
            </p>
          )}
        </div>
      )}
      <button
        className={`${button} mt-6`}
        aria-expanded={showHistory}
        onClick={() => setShowHistory(!showHistory)}
      >
        {showHistory ? "Hide" : "Show"} details history
      </button>
      {showHistory && (
        <div className="mt-4">
          {history.isPending ? (
            <p role="status">Loading history…</p>
          ) : history.isError ? (
            <p role="alert">{history.error.message}</p>
          ) : (
            <>
              <ol className="space-y-3">
                {history.data.items.map((entry) => (
                  <li key={entry.revision} className="surface-inset text-sm">
                    <p className="font-medium">
                      Revision {entry.revision} · {entry.kind} ·{" "}
                      {meetingStateLabels[entry.state]}
                    </p>
                    <p>{meetingTime(entry.recorded_at)}</p>
                    <p className="mt-2 break-words">
                      {entry.title} · Scheduled:{" "}
                      {meetingTime(entry.scheduled_at)}
                    </p>
                    {entry.description && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                        {entry.description}
                      </p>
                    )}
                    {entry.kind === "imported" && (
                      <p className="mt-2 text-muted-foreground">
                        Initial record when history tracking was added.
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              {(history.data.total > 20 || offset > 0) && (
                <nav aria-label="Meeting history pages" className="pagination">
                  <button
                    className={button}
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    Previous
                  </button>
                  <button
                    className={button}
                    disabled={offset + 20 >= history.data.total}
                    onClick={() => setOffset(offset + 20)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
