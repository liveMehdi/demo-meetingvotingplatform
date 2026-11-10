import type { Ballot } from "./api";
import { meetingIsActive, type Meeting } from "@/features/meetings/api";
import { actionButtonClass as buttonClass } from "@/components/ui/control-styles";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ballotStateLabels } from "@/lib/navigation";
import { FollowupControl } from "./FollowupControl";
import { InvalidationControl, InvalidationNotice } from "./InvalidationControl";
import { ResultsPanel } from "./ResultsPanel";
import { PublicationControl } from "./PublicationControl";
import { OfficerNominations } from "@/features/nominations/NominationsPanel";
import { WithdrawDraftControl } from "./WithdrawDraftControl";

export function BallotCard({
  ballot,
  meeting,
  focused,
  disabled,
  onEdit,
  onOpen,
  onClose,
}: {
  ballot: Ballot;
  meeting: Meeting;
  focused: boolean;
  disabled: boolean;
  onEdit: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const meetingId = meeting.id;

  return (
    <li className={`surface-inset ${focused ? "ring-1 ring-ring" : ""}`}>
      {focused && (
        <p className="mb-2 text-sm text-accent-foreground">Saved item</p>
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
          {ballot.participation_count === 1 ? "submission" : "submissions"} ·{" "}
          {ballot.eligible_count} eligible{" "}
          {ballot.eligible_count === 1 ? "member" : "members"}
        </p>
      )}
      <details className="mt-5" open={ballot.state === "OPEN" || focused}>
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
          <OfficerNominations ballot={ballot} disabled={disabled} />
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
          disabled={disabled}
        />
        {ballot.state === "CLOSED" && !ballot.invalidated_at && (
          <PublicationControl ballot={ballot} disabled={disabled} />
        )}
        {(ballot.kind === "election" ||
          ballot.invalidated_at ||
          ballot.followup_kind) && (
          <FollowupControl
            ballot={ballot}
            meeting={meeting}
            disabled={disabled}
          />
        )}
        {ballot.state === "PUBLISHED" && (
          <ResultsPanel ballotId={ballot.id} meetingId={meetingId} />
        )}
        {ballot.state === "OPEN" && (
          <button className={buttonClass} disabled={disabled} onClick={onClose}>
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
                  disabled={disabled}
                  onClick={onEdit}
                >
                  Edit draft
                </button>
              )}
            <button
              className={buttonClass}
              disabled={disabled}
              onClick={onOpen}
            >
              Review opening
            </button>
          </div>
        )}
        {ballot.state === "DRAFT" && (
          <WithdrawDraftControl
            meetingId={meetingId}
            ballot={ballot}
            disabled={!meetingIsActive(meeting) || disabled}
          />
        )}
      </details>
    </li>
  );
}
