import { useCreationAttempt } from "@/lib/use-creation-attempt";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import type { MeetingInput } from "@/features/meetings/api";
import {
  actionButtonClass as buttonClass,
  inputClass as sharedInputClass,
} from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createMeeting,
  getMeetings,
  meetingTime,
  MeetingRequestError,
  meetingStateLabels,
  type Meeting,
} from "@/features/meetings/api";

import { useListNavigation } from "@/lib/use-list-navigation";
import { ListSearch, ListViews } from "@/components/ListTools";
import { meetingTimeChoices } from "@/lib/meeting-time";

const PAGE_SIZE = 20;
const inputClass = `${sharedInputClass} mt-2`;

export function MeetingsPage() {
  const client = useQueryClient();
  const attempt = useCreationAttempt<MeetingInput>();
  const { offset, setOffset, view, setView, q, setSearch, search } =
    useListNavigation([
      "all",
      "upcoming",
      "past",
      "planned",
      "live",
      "ended",
      "cancelled",
    ]);
  const [showCreate, setShowCreate] = useState(
    () => new URLSearchParams(search).get("create") === "1",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [occurrence, setOccurrence] = useState("");
  const timeChoices = useMemo(
    () => meetingTimeChoices(scheduledAt),
    [scheduledAt],
  );
  const selectedTime =
    timeChoices.length === 1
      ? timeChoices[0]
      : timeChoices.find((time) => time === occurrence);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [created, setCreated] = useState<Meeting | null>(null);
  const meetings = useQuery({
    queryKey: ["meetings", offset, view, q],
    queryFn: ({ signal }) => getMeetings(offset, PAGE_SIZE, signal, view, q),
    retry: false,
    networkMode: "always",
    gcTime: 0,
  });
  const creation = useMutation({
    mutationFn: (input: MeetingInput) => attempt.run(input, createMeeting),
    retry: false,
    networkMode: "always",
    async onSuccess(meeting) {
      setCreated(meeting);
      setShowCreate(false);
      setTitle("");
      setDescription("");
      setScheduledAt("");
      setOffset(0);
      await client.invalidateQueries({ queryKey: ["meetings"] });
    },
    async onError(error) {
      setFeedback(
        `${error.message} Your input is retained. If the result is uncertain, retry the original creation below.`,
      );
      await client.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const confirmDiscard = useUnsavedChanges(
    showCreate &&
      (!!title || !!description || !!scheduledAt || !!attempt.retryInput),
    creation.isPending,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creation.isPending) return;
    setFeedback(null);
    setCreated(null);
    if (!title.trim() || timeChoices.length === 0) {
      setFeedback(
        "Enter a title and a valid local date and time. This time may not exist during a clock change.",
      );
      return;
    }
    if (!selectedTime) {
      setFeedback(
        "This time occurs twice when the clocks change. Choose which occurrence you mean.",
      );
      return;
    }
    creation.mutate({
      title: title.trim(),
      description: description.trim(),
      scheduled_at: selectedTime,
    });
  }

  const denied =
    meetings.error instanceof MeetingRequestError &&
    [401, 403].includes(meetings.error.status);
  return (
    <main className="page-shell">
      <Link to="/" className="back-link">
        Home
      </Link>
      <h1 className="mt-4 page-title">Meetings</h1>
      <div className="mt-6 action-row">
        <button
          className={`${buttonClass} ui-button-primary`}
          aria-expanded={showCreate}
          onClick={() => {
            if (showCreate) {
              if (!confirmDiscard()) return;
              attempt.reset();
              setTitle("");
              setDescription("");
              setScheduledAt("");
              setFeedback(null);
            }
            setShowCreate(!showCreate);
          }}
          disabled={creation.isPending || (!showCreate && !meetings.isSuccess)}
        >
          {showCreate ? "Cancel creation" : "Create meeting"}
        </button>
      </div>
      {created && (
        <p role="status" className="mt-4">
          Meeting created.{" "}
          <Link className="underline" to={`/meetings/${created.id}`}>
            Open {created.title}
          </Link>
        </p>
      )}
      {showCreate && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Create a meeting</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={submit}
              className="space-y-4"
              aria-busy={creation.isPending}
            >
              <div>
                <label htmlFor="meeting-title" className="text-sm font-medium">
                  Title
                </label>
                <input
                  id="meeting-title"
                  required
                  maxLength={200}
                  value={title}
                  disabled={creation.isPending || !!attempt.retryInput}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="meeting-description"
                  className="text-sm font-medium"
                >
                  Description (optional)
                </label>
                <textarea
                  id="meeting-description"
                  maxLength={5000}
                  rows={3}
                  value={description}
                  disabled={creation.isPending || !!attempt.retryInput}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="meeting-time" className="text-sm font-medium">
                  Scheduled date and time
                </label>
                <input
                  id="meeting-time"
                  type="datetime-local"
                  required
                  max="9999-12-31T23:59"
                  value={scheduledAt}
                  disabled={creation.isPending || !!attempt.retryInput}
                  onChange={(e) => {
                    setScheduledAt(e.target.value);
                    setOccurrence("");
                  }}
                  aria-describedby="time-help"
                  className={inputClass}
                />
                <p id="time-help" className="mt-2 supporting-copy">
                  Your time zone:{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                  {selectedTime &&
                    ` Scheduled for ${meetingTime(selectedTime)}.`}
                </p>
                {timeChoices.length > 1 && (
                  <label className="mt-3 block text-sm">
                    This time occurs twice. Choose an occurrence:
                    <select
                      required
                      value={occurrence}
                      disabled={creation.isPending || !!attempt.retryInput}
                      onChange={(e) => setOccurrence(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Choose a time</option>
                      {timeChoices.map((time) => (
                        <option key={time} value={time}>
                          {meetingTime(time)} ({time})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedTime && Date.parse(selectedTime) < Date.now() && (
                  <p className="mt-2 supporting-copy">
                    This date is in the past.
                  </p>
                )}
              </div>
              {feedback && (
                <p role="alert" className="text-sm text-destructive">
                  {feedback}
                </p>
              )}
              <button
                type="submit"
                disabled={creation.isPending || !!attempt.retryInput}
                className={buttonClass}
              >
                {creation.isPending ? "Creating…" : "Create meeting"}
              </button>
              {attempt.retryInput && (
                <div className="space-y-2 text-sm">
                  <p>
                    Creation wasn’t confirmed. Retry here before leaving to
                    check whether it was saved.
                  </p>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={creation.isPending}
                    onClick={() => creation.mutate(attempt.retryInput!)}
                  >
                    Retry original creation
                  </button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      )}
      {meetings.isPending ? (
        <p role="status" className="mt-8">
          Loading meetings…
        </p>
      ) : meetings.isError ? (
        <div className="mt-8">
          <p role="alert" className="text-destructive">
            {meetings.error.message}
          </p>
          {denied ? (
            <Link to="/account" className="mt-4 inline-block underline">
              Check your account access
            </Link>
          ) : (
            <button
              className={`${buttonClass} mt-4`}
              disabled={meetings.isFetching}
              onClick={() => void meetings.refetch()}
            >
              Try again
            </button>
          )}
        </div>
      ) : (
        <>
          <ListViews
            value={view}
            onChange={setView}
            choices={[
              ["all", "All meetings"],
              ["upcoming", "Upcoming"],
              ["past", "Past"],
              ["planned", "Planned"],
              ["live", "Live"],
              ["ended", "Ended"],
              ["cancelled", "Cancelled"],
            ]}
          />
          {(view === "upcoming" || view === "past") && (
            <p className="mb-4 supporting-copy">
              Past dates can still have open votes.
            </p>
          )}
          <ListSearch
            key={q}
            value={q}
            onSearch={setSearch}
            label="Search meeting titles"
          />
          <div className="list-toolbar">
            <h2 className="text-base font-semibold">
              Matching meetings{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                ({meetings.data.total})
              </span>
            </h2>
            <button
              className={buttonClass}
              disabled={meetings.isFetching || creation.isPending}
              onClick={() => void meetings.refetch()}
            >
              Refresh list
            </button>
          </div>
          <p className="mb-4 supporting-copy">
            {view === "upcoming" ? "Soonest first" : "Latest date first"}
          </p>
          <ul className="space-y-4">
            {meetings.data.items.map((meeting) => (
              <li key={meeting.id} className="item-card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <h3 className="item-heading min-w-0 flex-1">
                    {meeting.title}
                  </h3>
                  <StatusBadge
                    tone={
                      meeting.state === "LIVE"
                        ? "success"
                        : meeting.state === "PLANNED"
                          ? "accent"
                          : "neutral"
                    }
                  >
                    {meetingStateLabels[meeting.state]}
                  </StatusBadge>
                </div>
                <div className="item-footer">
                  <p className="flex items-center gap-2 supporting-copy">
                    <Icon name="calendar" className="size-4 shrink-0" />
                    <time dateTime={meeting.scheduled_at}>
                      {meetingTime(meeting.scheduled_at)}
                    </time>
                  </p>
                  <Link
                    to={`/meetings/${meeting.id}?returnTo=${encodeURIComponent(`/meetings?${search}`)}`}
                    className="ui-button"
                    aria-label={`Open meeting: ${meeting.title}`}
                  >
                    Open meeting <Icon name="arrow" className="size-4" />
                  </Link>
                </div>
                {meeting.needs_status_review && (
                  <p className="mt-4 text-sm text-warning">
                    Status review needed
                  </p>
                )}
              </li>
            ))}
          </ul>
          {meetings.data.items.length === 0 && (
            <EmptyState
              title={
                offset > 0 ? "No meetings on this page" : "No meetings found"
              }
              description={
                offset > 0
                  ? "Go back to see earlier meetings."
                  : q || view !== "all"
                    ? "Try another search or choose All meetings."
                    : "Create a meeting to start preparing votes and polls."
              }
            />
          )}
          {(meetings.data.total > PAGE_SIZE || offset > 0) && (
            <nav aria-label="Meeting list pages" className="pagination">
              <button
                className={buttonClass}
                disabled={offset === 0 || creation.isPending}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <span className="text-sm">
                Page {Math.floor(offset / PAGE_SIZE) + 1}
              </span>
              <button
                className={buttonClass}
                disabled={
                  offset + PAGE_SIZE >= meetings.data.total ||
                  creation.isPending
                }
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
