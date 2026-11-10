import type { Poll } from "./poll-api";
import type { Meeting } from "@/features/meetings/api";
import { buttonClass } from "@/components/ui/control-styles";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { FollowupControl } from "./FollowupControl";
import { InvalidationControl, InvalidationNotice } from "./InvalidationControl";
import { WithdrawDraftControl } from "./WithdrawDraftControl";
import { PollControls } from "./PollControls";

export function PollCard({
  poll,
  meeting,
  focused,
  disabled,
  readOnly,
  onEdit,
}: {
  poll: Poll;
  meeting: Meeting;
  focused: boolean;
  disabled: boolean;
  readOnly: boolean;
  onEdit: () => void;
}) {
  const meetingId = meeting.id;

  return (
    <li className={`surface-inset ${focused ? "ring-1 ring-ring" : ""}`}>
      {focused && (
        <p className="mb-2 text-sm text-accent-foreground">Saved item</p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="pt-1 supporting-copy">
          {poll.kind === "poll_single" ? "Single choice" : "Multiple choice"}
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
      <details className="mt-5" open={poll.state === "OPEN" || focused}>
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
            disabled={readOnly || disabled}
            onClick={onEdit}
          >
            Edit poll draft
          </button>
        )}
        {poll.state === "DRAFT" && (
          <WithdrawDraftControl
            meetingId={meetingId}
            ballot={poll}
            disabled={readOnly || disabled}
          />
        )}
        <InvalidationNotice value={poll} />
        <InvalidationControl
          meetingId={meetingId}
          ballot={poll}
          disabled={disabled}
        />
        {(poll.invalidated_at || poll.followup_kind) && (
          <FollowupControl
            ballot={poll}
            meeting={meeting}
            disabled={disabled}
          />
        )}
        <PollControls
          key={`${poll.id}-${poll.state === "OPEN" ? "Poll open" : poll.state === "CLOSED" ? "Poll closed" : poll.state === "CANCELLED" ? "Cancelled draft" : "Draft"}-${poll.revision}`}
          meetingId={meetingId}
          poll={poll}
          disabled={readOnly || disabled}
        />
      </details>
    </li>
  );
}
