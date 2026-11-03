import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePollState,
  getPollTotals,
  type Poll,
  type PollTotals,
} from "./poll-api";
import { buttonClass } from "@/components/ui/control-styles";

export function PollCounts({
  totals,
  multiple,
}: {
  totals: PollTotals;
  multiple: boolean;
}) {
  return (
    <div className="mt-6 text-sm">
      <p className="text-muted-foreground">
        Responses:{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {totals.participation_count}
        </span>
      </p>
      <ul className="mt-4 space-y-4">
        {totals.options.map((option) => (
          <li key={option.id}>
            <div className="mb-2 flex justify-between gap-4">
              <span className="break-words">{option.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {option.count}
              </span>
            </div>
            <div
              aria-hidden="true"
              className="h-2.5 overflow-hidden rounded-full bg-input"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${totals.participation_count ? Math.min(100, (100 * option.count) / totals.participation_count) : 0}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {multiple && (
        <p className="mt-4 supporting-copy">
          People can select more than one option, so totals may exceed the
          response count.
        </p>
      )}
    </div>
  );
}

export function PollControls({
  meetingId,
  poll,
  disabled,
}: {
  meetingId: string;
  poll: Poll;
  disabled: boolean;
}) {
  const client = useQueryClient();

  const [confirm, setConfirm] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      changePollState(
        meetingId,
        poll,
        poll.state === "DRAFT" ? "open" : "close",
      ),
    retry: false,
    networkMode: "always",
    onSuccess() {
      setConfirm(false);
    },
    async onSettled() {
      await client.invalidateQueries({ queryKey: ["polls", meetingId] });
      await client.invalidateQueries({
        queryKey: ["poll-totals", meetingId, poll.id],
      });
    },
  });

  const totals = useQuery({
    queryKey: ["poll-totals", meetingId, poll.id],
    queryFn: ({ signal }) => getPollTotals(meetingId, poll.id, signal),
    enabled: poll.state === "OPEN" || poll.state === "CLOSED",
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });

  const button = buttonClass;

  return (
    <div className="mt-3">
      {(poll.state === "DRAFT" || poll.state === "OPEN") &&
        (confirm ? (
          <div className="space-y-3">
            <p className="text-sm">
              {poll.state === "DRAFT"
                ? "Open this question for admitted guests? Its question, options and selection limits will be frozen."
                : "Close this poll? New responses will stop and it cannot reopen."}
            </p>
            <button
              className={button}
              disabled={disabled || change.isPending}
              onClick={() => change.mutate()}
            >
              Confirm {poll.state === "DRAFT" ? "opening" : "closure"}
            </button>{" "}
            <button
              className={button}
              disabled={change.isPending}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className={button}
            disabled={disabled || change.isPending}
            onClick={() => setConfirm(true)}
          >
            {poll.state === "DRAFT" ? "Open poll" : "Close poll"}
          </button>
        ))}
      {change.isError && (
        <p className="mt-3 text-sm" role="alert">
          {change.error.message} Refresh the poll list before trying again.
        </p>
      )}
      {(poll.state === "OPEN" || poll.state === "CLOSED") && (
        <>
          <Link
            to={`/meetings/${encodeURIComponent(meetingId)}/polls/${encodeURIComponent(poll.id)}/projector`}
            target="_blank"
            rel="noopener noreferrer"
            className="my-3 inline-block underline"
          >
            Open projector view
          </Link>
          {totals.isPending ? (
            <p role="status">Loading totals…</p>
          ) : totals.isError ? (
            <p role="alert">{totals.error.message}</p>
          ) : (
            <PollCounts
              totals={totals.data}
              multiple={poll.max_selections > 1}
            />
          )}
          <button
            className={`${button} mt-3`}
            disabled={totals.isFetching}
            onClick={() => void totals.refetch()}
          >
            Refresh totals
          </button>
        </>
      )}
    </div>
  );
}
