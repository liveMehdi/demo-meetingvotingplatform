import { PollCard } from "./PollCard";
import { draftSaveError } from "./draft-save-error";
import { PollForm } from "./PollForm";
import type { Meeting } from "@/features/meetings/api";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { useCreationAttempt } from "@/lib/use-creation-attempt";
import { EmptyState } from "@/components/ui/EmptyState";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import { buttonClass } from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLivePolls } from "./use-live-polls";
import {
  getPolls,
  savePoll,
  type Poll,
  type PollInput,
} from "@/features/ballots/poll-api";

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
        draftSaveError(error, editing !== null, !!attempt.retryInput),
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
              <PollCard
                key={poll.id}
                poll={poll}
                meeting={meeting}
                focused={focusId === poll.id}
                disabled={save.isPending || showForm}
                readOnly={readOnly}
                onEdit={() => {
                  setEditing(poll);
                  setShowForm(true);
                  setFeedback(null);
                }}
              />
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
