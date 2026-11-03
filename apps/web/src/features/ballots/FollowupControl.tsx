import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actionButtonClass as button,
  inputClass,
} from "@/components/ui/control-styles";
import { apiRequest } from "@/lib/api";
import { useCreationAttempt } from "@/lib/use-creation-attempt";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import {
  checkResponse,
  getMeeting,
  getMeetings,
  meetingIsActive,
  meetingTime,
  type Meeting,
} from "@/features/meetings/api";

export const electionLinkSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  question: z.string(),
  state: z.string(),
  kind: z.string().optional(),
  invalidated_at: z.string().nullish(),
});

export type ElectionLink = z.infer<typeof electionLinkSchema>;

export const followupPreviewSchema = z.object({
  source: electionLinkSchema,
  revision: z.number(),
  kind: z.enum(["runoff", "replacement"]).nullable(),
  candidates: z.array(z.string()),
  candidate_source: z.enum(["manual", "nominations"]),
  counting_method: z.enum(["standard", "irv_v1"]),
  predecessor: electionLinkSchema.nullable(),
  successor: electionLinkSchema.nullable(),
});

export type Preview = z.infer<typeof followupPreviewSchema>;

interface Input {
  kind: "runoff" | "replacement";
  meeting_id: string;
  expected_revision: number;
  expected_meeting_revision: number;
}

export function electionHref(election: ElectionLink) {
  return `/meetings/${election.meeting_id}?section=${election.kind?.startsWith("poll_") ? "polls" : "voting"}&ballot=${election.id}`;
}

async function preview(source: string, signal: AbortSignal): Promise<Preview> {
  const response = await apiRequest(`/api/elections/${source}/follow-up`, {
    signal,
  });

  await checkResponse(response);

  return readResponse(
    response,
    followupPreviewSchema,
    "Couldn’t load the follow-up election. Try again.",
  );
}

async function create(
  source: string,
  input: Input,
  key: string,
): Promise<ElectionLink> {
  const response = await apiRequest(`/api/elections/${source}/follow-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(input),
  });

  await checkResponse(response);

  return readResponse(
    response,
    electionLinkSchema.required({ kind: true }),
    "Creation could not be confirmed. Retry the original request.",
  );
}

export function FollowupControl({
  ballot,
  meeting,
  disabled,
}: {
  ballot: { id: string; followup_kind?: string | null };
  meeting: Meeting;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const [selecting, setSelecting] = useState(false);

  const [destination, setDestination] = useState<Meeting | null>(
    meetingIsActive(meeting) ? meeting : null,
  );

  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [created, setCreated] = useState<ElectionLink | null>(null);

  const [error, setError] = useState("");

  const client = useQueryClient();

  const attempt = useCreationAttempt<Input>();

  const info = useQuery({
    queryKey: ["election-followup", ballot.id],
    enabled: expanded,
    queryFn: ({ signal }) => preview(ballot.id, signal),
    retry: false,
    gcTime: 0,
  });

  const destinations = useQuery({
    queryKey: ["followup-meetings", offset, q],
    enabled: selecting,
    queryFn: ({ signal }) => getMeetings(offset, 20, signal, "all", q),
    retry: false,
    gcTime: 0,
  });

  const save = useMutation({
    mutationFn: (input: Input) =>
      attempt.run(input, (body, key) => create(ballot.id, body, key)),
    retry: false,
    networkMode: "always",
    async onSuccess(result) {
      setCreated(result);
      setSelecting(false);
      setError("");
      await Promise.all(
        ["election-followup", "ballots", "polls", "nomination-contests"].map(
          (key) => client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    async onError(error) {
      setError(error.message);
      await client.invalidateQueries({
        queryKey: ["election-followup", ballot.id],
      });
    },
  });

  const confirmDiscard = useUnsavedChanges(
    selecting || !!attempt.retryInput,
    save.isPending,
  );
  function close() {
    if (confirmDiscard()) {
      attempt.reset();
      setSelecting(false);
      setExpanded(false);
    }
  }

  const busy = disabled || save.isPending;

  return (
    <section className="my-4 surface-inset" aria-label="Election follow-up">
      {ballot.followup_kind === "runoff" && (
        <p className="mb-3 text-sm">
          Runoff details and candidates are fixed. Eligible members are recorded
          when it opens.
        </p>
      )}
      <button
        className={button}
        disabled={save.isPending}
        aria-expanded={expanded}
        onClick={() => (expanded ? close() : setExpanded(true))}
      >
        Ballot history and follow-up
      </button>
      {created && (
        <p role="status" className="mt-3">
          Follow-up draft saved.{" "}
          <Link className="underline" to={electionHref(created)}>
            Open saved ballot
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error} Your destination is retained; refresh the review if it
          changed.
        </p>
      )}
      {expanded && (
        <div className="mt-4 space-y-3 text-sm">
          {info.isPending ? (
            <p role="status">Loading election history...</p>
          ) : info.isError ? (
            <p role="alert">{info.error.message}</p>
          ) : (
            <>
              {info.data.predecessor && (
                <p>
                  Previous election:{" "}
                  <Link
                    className="underline"
                    to={electionHref(info.data.predecessor)}
                  >
                    {info.data.predecessor.question}
                  </Link>
                </p>
              )}
              {info.data.successor ? (
                <p>
                  Follow-up:{" "}
                  <Link
                    className="underline"
                    to={electionHref(info.data.successor)}
                  >
                    {info.data.successor.question} (
                    {info.data.successor.state.toLowerCase()})
                  </Link>
                  . Continue any further replacement from that election.
                </p>
              ) : info.data.kind ? (
                <>
                  <p>
                    {info.data.kind === "runoff"
                      ? "Create a runoff with the same voting method and the candidates below."
                      : "Create a replacement draft. Review and edit the copied details before opening."}
                  </p>
                  <p>
                    {info.data.candidate_source === "nominations"
                      ? info.data.kind === "runoff"
                        ? "Previous nominee consent and officer approval carry forward. Candidates cannot be added or renamed. If anyone withdraws or loses membership approval, cancel and replace the draft."
                        : "Nominations restart empty. New nominations, consent and officer approval are required."
                      : "Options are copied for review; no submissions are copied."}
                  </p>
                  {info.data.candidates.length > 0 && (
                    <ul className="list-inside list-disc">
                      {info.data.candidates.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                  {!selecting && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => {
                        setSelecting(true);
                        setError("");
                      }}
                    >
                      Choose destination meeting
                    </button>
                  )}
                </>
              ) : (
                <p>
                  Runoffs require published tied election results. Replacements
                  require an invalidated ballot or cancelled, never-opened
                  election.
                </p>
              )}
            </>
          )}
          <button
            className={button}
            disabled={busy || info.isFetching || !!attempt.retryInput}
            onClick={async () => {
              await info.refetch();
              if (destination)
                try {
                  setDestination(
                    await getMeeting(
                      destination.id,
                      new AbortController().signal,
                    ),
                  );
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not refresh destination.",
                  );
                }
              await destinations.refetch();
            }}
          >
            Refresh review
          </button>
          {selecting && (
            <div className="space-y-3 surface-inset">
              <p>
                Choose a Planned or Live meeting. Members qualify again when
                voting opens; previous votes are not copied.
              </p>
              {destination && (
                <p>
                  Selected: <strong>{destination.title}</strong> (
                  {meetingTime(destination.scheduled_at)})
                </p>
              )}
              <label className="block">
                Search meetings
                <input
                  className={`${inputClass} mt-2`}
                  value={q}
                  disabled={busy || !!attempt.retryInput}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              {destinations.isPending ? (
                <p role="status">Loading meetings...</p>
              ) : destinations.isError ? (
                <p role="alert">{destinations.error.message}</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {destinations.data.items.map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          className={`${button} text-left`}
                          disabled={
                            busy ||
                            !!attempt.retryInput ||
                            !meetingIsActive(candidate)
                          }
                          onClick={() => setDestination(candidate)}
                        >
                          {candidate.title} - {candidate.state.toLowerCase()} -{" "}
                          {meetingTime(candidate.scheduled_at)}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="action-row">
                    <button
                      className={button}
                      disabled={busy || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      Previous
                    </button>
                    <button
                      className={button}
                      disabled={busy || offset + 20 >= destinations.data.total}
                      onClick={() => setOffset(offset + 20)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
              <button
                className={button}
                disabled={
                  busy ||
                  !!attempt.retryInput ||
                  !destination ||
                  !meetingIsActive(destination) ||
                  !info.data?.kind ||
                  !!info.data?.successor ||
                  info.isFetching
                }
                onClick={() => {
                  if (destination && info.data?.kind)
                    save.mutate({
                      kind: info.data.kind,
                      meeting_id: destination.id,
                      expected_revision: info.data.revision,
                      expected_meeting_revision: destination.revision,
                    });
                }}
              >
                Confirm creation of follow-up draft
              </button>
            </div>
          )}
          {attempt.retryInput && (
            <div>
              <p>
                Creation wasn’t confirmed. Retry here before leaving to check
                whether it was saved.
              </p>
              <button
                className={button}
                disabled={save.isPending}
                onClick={() => save.mutate(attempt.retryInput!)}
              >
                Retry original creation
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
