import { InvalidationNotice } from "@/features/ballots/InvalidationControl";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { getPollPresentation } from "@/features/ballots/poll-api";
import { useLivePolls } from "@/features/ballots/use-live-polls";
import { getJoining } from "@/features/meetings/guest-api";
import { GuestJoinCard } from "@/features/meetings/GuestJoinCard";

import { loginUrl } from "@/lib/navigation";

export function ProjectorPage() {
  const { meetingId = "", pollId = "" } = useParams();
  // Reset fullscreen/local state when navigating to a different presentation.
  return (
    <Presentation
      key={`${meetingId}-${pollId}`}
      meetingId={meetingId}
      pollId={pollId}
    />
  );
}

function Presentation({
  meetingId,
  pollId,
}: {
  meetingId: string;
  pollId: string;
}) {
  const container = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const liveStatus = useLivePolls(meetingId, "officer");
  const poll = useQuery({
    queryKey: ["poll-presentation", meetingId, pollId],
    queryFn: ({ signal }) => getPollPresentation(meetingId, pollId, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: 30000,
  });
  const joining = useQuery({
    queryKey: ["guest-joining", meetingId],
    queryFn: ({ signal }) => getJoining(meetingId, signal),
    enabled: poll.isSuccess,
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: 30000,
  });
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const refresh = () => {
    void poll.refetch();
    if (poll.isSuccess) void joining.refetch();
  };
  return (
    <main
      ref={container}
      className="min-h-svh overflow-y-auto bg-background px-4 py-8 text-foreground sm:px-8 lg:px-12"
    >
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 text-sm">
        <Link
          to={`/meetings/${encodeURIComponent(meetingId)}?section=polls`}
          className="underline"
        >
          Back to meeting
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <ConnectionStatus message={liveStatus} />
          <button
            className="ui-button"
            disabled={poll.isFetching || joining.isFetching}
            onClick={refresh}
          >
            Refresh
          </button>
          {document.fullscreenEnabled && (
            <button
              className="ui-button"
              onClick={async () => {
                setFullscreenError(null);
                try {
                  if (document.fullscreenElement)
                    await document.exitFullscreen();
                  else await container.current?.requestFullscreen();
                } catch {
                  setFullscreenError(
                    "Fullscreen is unavailable. You can use this view in a normal window.",
                  );
                }
              }}
            >
              {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            </button>
          )}
        </div>
      </header>
      {fullscreenError && (
        <p role="alert" className="mb-5">
          {fullscreenError}
        </p>
      )}
      {poll.isPending ? (
        <p role="status" className="text-2xl">
          Loading presentation…
        </p>
      ) : poll.isError ? (
        <div role="alert" className="space-y-4 text-xl">
          <p>{poll.error.message}</p>
          <p>
            This view requires officer access and an open or closed informal
            poll.
          </p>
          <Link
            to={loginUrl(`/meetings/${meetingId}/polls/${pollId}/projector`)}
            className="underline"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-label="Poll results" className="min-w-0 surface-panel lg:p-8">
            <InvalidationNotice value={poll.data} />
            <p className="mb-3 break-words text-xl text-muted-foreground">
              {poll.data.meeting_title}
            </p>
            {["ENDED", "CANCELLED"].includes(poll.data.meeting_state) && (
              <p className="mb-3 text-xl text-accent-foreground">
                Meeting {poll.data.meeting_state.toLowerCase()} · Results view
                only
              </p>
            )}
            <h1 className="break-words text-2xl font-semibold leading-tight sm:text-4xl xl:text-5xl">
              {poll.data.question}
            </h1>
            {poll.data.description && (
              <p className="mt-5 whitespace-pre-wrap break-words text-xl text-foreground">
                {poll.data.description}
              </p>
            )}
            <p className="mt-6 text-xl font-semibold">
              {poll.data.state === "OPEN" ? "Voting open" : "Poll closed"} ·{" "}
              {poll.data.participation_count} responses
            </p>
            <p className="mt-2 text-lg text-muted-foreground">
              Choose{" "}
              {poll.data.min_selections === poll.data.max_selections
                ? `exactly ${poll.data.min_selections}`
                : `${poll.data.min_selections}–${poll.data.max_selections}`}
              .
            </p>
            <ol className="mt-8 space-y-6">
              {poll.data.options.map((option) => {
                const percent =
                  poll.data.participation_count === 0
                    ? 0
                    : (100 * option.count) / poll.data.participation_count;
                return (
                  <li key={option.id}>
                    <div className="mb-2 flex items-baseline justify-between gap-4 text-lg sm:text-2xl">
                      <span className="min-w-0 break-words">{option.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {option.count}{" "}
                        <span className="text-lg font-normal text-muted-foreground">
                          ({percent.toFixed(0)}%)
                        </span>
                      </span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="h-4 overflow-hidden rounded-full bg-input"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.min(100, Math.max(0, percent))}%`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            {poll.data.max_selections > 1 && <p className="mt-8 text-base text-muted-foreground">
              People can select more than one option, so percentages may total over 100%.
            </p>}
          </section>
          <aside aria-label="Meeting joining" className="min-w-0 self-start">
            {joining.isPending ? (
              <p role="status">Loading joining details…</p>
            ) : joining.isError ? (
              <p role="alert">
                Joining details unavailable. Refresh to check them.
              </p>
            ) : joining.data.enabled && joining.data.code ? (
              <GuestJoinCard code={joining.data.code} />
            ) : (
              <p className="surface-panel text-lg">
                New guest joining is disabled.
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
