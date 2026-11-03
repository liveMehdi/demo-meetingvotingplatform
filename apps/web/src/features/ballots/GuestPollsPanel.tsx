import { InvalidationNotice } from "@/features/ballots/InvalidationControl";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getGuestPolls, submitPollResponse, type GuestPoll } from "./poll-api";
import { PollCounts } from "./PollControls";
import { useLivePolls } from "./use-live-polls";

function GuestQuestion({
  meetingId,
  poll,
  readOnly,
}: {
  meetingId: string;
  poll: GuestPoll;
  readOnly: boolean;
}) {
  const client = useQueryClient();

  const [selected, setSelected] = useState<string[]>([]);

  const [confirmed, setConfirmed] = useState(false);

  const submit = useMutation({
    mutationFn: () => submitPollResponse(meetingId, poll.id, selected),
    retry: false,
    networkMode: "always",
    onSuccess() {
      setConfirmed(true);
      setSelected([]);
    },
    async onSettled() {
      await client.invalidateQueries({ queryKey: ["guest-polls", meetingId] });
    },
  });

  const submitted = poll.submitted || confirmed;

  return (
    <li className="item-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="supporting-copy">
          {poll.kind === "poll_single" ? "Single choice" : "Multiple choice"}
        </p>
        <StatusBadge
          tone={
            poll.invalidated_at
              ? "danger"
              : poll.state === "OPEN" && !readOnly
                ? "success"
                : "neutral"
          }
        >
          {poll.invalidated_at
            ? "Invalidated"
            : poll.state === "CLOSED" || readOnly
              ? "Poll closed"
              : poll.state === "OPEN"
                ? "Poll open"
                : "Draft"}
        </StatusBadge>
      </div>
      <h3 className="item-heading mt-4">{poll.question}</h3>
      {poll.description && (
        <p className="mt-3 whitespace-pre-wrap break-words supporting-copy">
          {poll.description}
        </p>
      )}
      <p className="mt-3 supporting-copy">
        Choose{" "}
        {poll.min_selections === poll.max_selections
          ? `exactly ${poll.min_selections}`
          : `${poll.min_selections}–${poll.max_selections}`}
        .
      </p>
      {submitted ? (
        <p role="status" className="mt-5 text-sm font-medium text-success">
          Your response has been recorded. It cannot be changed.
        </p>
      ) : poll.state === "CLOSED" || readOnly ? (
        <p className="mt-5 supporting-copy">
          This poll is closed or the meeting has ended.
        </p>
      ) : (
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!submit.isPending) submit.mutate();
          }}
        >
          <fieldset disabled={submit.isPending} className="space-y-3">
            <legend className="sr-only">Choose your response</legend>
            {poll.options.map((option) => (
              <label key={option.id} className="choice-row text-sm">
                <input
                  type={poll.kind === "poll_single" ? "radio" : "checkbox"}
                  name={`poll-${poll.id}`}
                  value={option.id}
                  checked={selected.includes(option.id)}
                  onChange={(event) =>
                    setSelected(
                      poll.kind === "poll_single"
                        ? [option.id]
                        : event.target.checked
                          ? [...selected, option.id]
                          : selected.filter((id) => id !== option.id),
                    )
                  }
                />
                <span className="break-words">{option.label}</span>
              </label>
            ))}
            <p className="supporting-copy">
              Your response cannot be changed after submitting.
            </p>
            <button
              className="ui-button"
              type="submit"
              disabled={
                selected.length < poll.min_selections ||
                selected.length > poll.max_selections
              }
            >
              {submit.isPending ? "Submitting…" : "Submit response"}
            </button>
          </fieldset>
        </form>
      )}
      {submit.isError && !submitted && (
        <p role="alert" className="mt-3 text-sm">
          {submit.error.message} Refresh to check whether your response was
          recorded.
        </p>
      )}
      <PollCounts totals={poll} multiple={poll.max_selections > 1} />
      <InvalidationNotice value={poll} />
    </li>
  );
}

export function GuestPollsPanel({
  meetingId,
  readOnly = false,
}: {
  meetingId: string;
  readOnly?: boolean;
}) {
  const liveStatus = useLivePolls(meetingId, "guest");

  const [offset, setOffset] = useState(0);

  const polls = useQuery({
    queryKey: ["guest-polls", meetingId, offset],
    queryFn: ({ signal }) => getGuestPolls(meetingId, offset, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });

  return (
    <section className="mt-8" aria-label="Guest polls">
      <h2 className="text-xl font-semibold">Poll questions</h2>
      <div className="mt-2">
        <ConnectionStatus message={liveStatus} />
      </div>
      <button
        className="my-6 ui-button"
        disabled={polls.isFetching}
        onClick={() => void polls.refetch()}
      >
        Refresh questions and totals
      </button>
      {polls.isPending ? (
        <p role="status">Loading questions…</p>
      ) : polls.isError ? (
        <p role="alert">{polls.error.message}</p>
      ) : (
        <>
          <ul className="space-y-4">
            {polls.data.items.map((poll) => (
              <GuestQuestion
                key={poll.id}
                meetingId={meetingId}
                poll={poll}
                readOnly={readOnly}
              />
            ))}
          </ul>
          {polls.data.items.length === 0 && (
            <EmptyState
              title={
                offset > 0
                  ? "No questions on this page"
                  : readOnly
                    ? "No poll results available"
                    : "Waiting for the next question"
              }
              description={
                offset > 0
                  ? "Go back to see earlier questions."
                  : readOnly
                    ? "This meeting has ended."
                    : "Questions appear when the organiser opens a poll."
              }
            />
          )}
          {(polls.data.total > 20 || offset > 0) && (
            <nav aria-label="Guest poll pages" className="pagination">
              <button
                className="ui-button"
                disabled={offset === 0 || polls.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous
              </button>
              <span>Page {Math.floor(offset / 20) + 1}</span>
              <button
                className="ui-button"
                disabled={offset + 20 >= polls.data.total || polls.isFetching}
                onClick={() => setOffset(offset + 20)}
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
