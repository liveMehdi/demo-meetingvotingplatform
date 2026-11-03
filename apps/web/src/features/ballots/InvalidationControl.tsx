import { readErrorDetail } from "@/lib/validation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import {
  actionButtonClass as button,
  inputClass,
} from "@/components/ui/control-styles";

export function InvalidationNotice({
  value,
}: {
  value: {
    invalidated_at?: string | null;
    invalidation_reason?: string | null;
  };
}) {
  return value.invalidated_at ? (
    <div
      role="note"
      className="my-3 rounded-lg bg-surface ring-1 ring-destructive/60 p-4 text-sm"
    >
      <p className="font-semibold">
        Invalidated · {new Date(value.invalidated_at).toLocaleString()}
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words">
        {value.invalidation_reason}
      </p>
      <p className="mt-2">
        This outcome is invalid. Previously published results remain visible for
        reference.
      </p>
    </div>
  ) : null;
}

export function InvalidationControl({
  meetingId,
  ballot,
  disabled,
}: {
  meetingId: string;
  ballot: {
    id: string;
    revision: number;
    state: string;
    invalidated_at?: string | null;
  };
  disabled: boolean;
}) {
  const client = useQueryClient();

  const [review, setReview] = useState(false);

  const [reason, setReason] = useState("");

  const [error, setError] = useState("");

  const change = useMutation({
    retry: false,
    networkMode: "always",
    mutationFn: async () => {
      const response = await apiRequest(
        `/api/meetings/${meetingId}/ballots/${ballot.id}/invalidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reason.trim(),
            expected_revision: ballot.revision,
            confirm: true,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          (await readErrorDetail(response)) ?? "Invalidation could not be confirmed. Refresh first.",
        );
      }
    },
    onSuccess() {
      setReview(false);
      setReason("");
    },
    onError(failure) {
      setError(failure.message);
    },
    async onSettled() {
      await Promise.all(
        [
          "ballots",
          "polls",
          "poll-totals",
          "my-ballots",
          "my-ballot",
          "published-results",
          "election-followup",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });

  const discard = useUnsavedChanges(
    review && reason !== "" && !ballot.invalidated_at,
    change.isPending && !ballot.invalidated_at,
  );

  if (
    ballot.invalidated_at ||
    !["OPEN", "CLOSED", "PUBLISHED"].includes(ballot.state)
  )
    return null;

  return (
    <div className="my-4">
      {!review ? (
        <button
          className={button}
          disabled={disabled}
          onClick={() => setReview(true)}
        >
          Invalidate ballot

        </button>

      ) : (
        <div
          className="space-y-3 rounded-lg bg-surface ring-1 ring-destructive/60 p-4"
          role="region"
          aria-label="Confirm invalidatio
          n"
        >
          <p className="text-sm">
            This permanently invalidates the outcome and stops voting. Records
            and published results remain. Existing follow-ups are unaffected; no
            replacement is created automatically.
          </p>
          <label className="block text-sm font-medium">

            Reason visible to participants
            <textarea
              className={`${inputClass} mt-2`}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={change.isPending}
            />
          </label>

          <p className="supporting-copy">

            Describe the procedural issue; do not include anyone’s selections or
            private account details.
          </p>

          <button
            className={button}
            disabled={disabled || change.isPending || !reason.trim()}
            onClick={() => change.mutate()}
          >
            Confirm permanent invalidation
          </button>{" "}
          <button
            className={button}
            disabled={change.isPending}
            onClick={() => {
              if (discard()) {
                
                setReview(false);
                setReason("");
              }
            }}
          >
            Cancel
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
