import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buttonClass } from "@/components/ui/control-styles";
import { withdrawDraft } from "./api";

export function WithdrawDraftControl({
  meetingId,
  ballot,
  disabled,
}: {
  meetingId: string;
  ballot: { id: string; revision: number; question: string };
  disabled: boolean;
}) {
  const [review, setReview] = useState(false);

  const client = useQueryClient();

  const change = useMutation({
    mutationFn: () => withdrawDraft(meetingId, ballot),
    retry: false,
    networkMode: "always",
    onSuccess() {
      setReview(false);
    },
    async onSettled() {
      await Promise.all(
        ["ballots", "polls", "nominations", "nomination-contests"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });

  return (
    <div className="mt-3 text-sm">
      {change.isError && (
        <p role="alert" className="mb-2">
          {change.error.message} Refresh before trying again.
        </p>
      )}

      {review ? (
        <div
          role="region"
          aria-label="Confirm draft withdrawal"
          className="space-y-3 surface-inset"
        >
          <p>
            Cancel “{ballot.question}” and any nominations? Records remain, but
            the draft cannot reopen. This cannot cancel a vote that has opened.
          </p>

          <button
            className={buttonClass}
            disabled={disabled || change.isPending}
            onClick={() => change.mutate()}
          >
            Confirm withdrawal
          </button>
          <button
            className={`${buttonClass} ml-2`}
            disabled={change.isPending}
            onClick={() => setReview(false)}
          >
            Back
          </button>
        </div>
        
      ) : (
        <button
          className={buttonClass}
          disabled={disabled || change.isPending}
          onClick={() => setReview(true)}
        >
          Withdraw unused draft
        </button>
      )}
    </div>
  );
}
