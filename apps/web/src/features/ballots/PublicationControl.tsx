import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { publishBallot, type Ballot } from "@/features/ballots/api";

export function PublicationControl({
  ballot,
  disabled,
}: {
  ballot: Ballot;
  disabled: boolean;
}) {
  const client = useQueryClient();

  const [review, setReview] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const publication = useMutation({
    mutationFn: () => publishBallot(ballot.meeting_id, ballot.id),
    retry: false,
    networkMode: "always",
    onSuccess() {
      setReview(false);
    },
    onError(error) {
      setFailure(
        `${error.message} Check the refreshed state before trying again.`,
      );
    },
    async onSettled() {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["ballots", ballot.meeting_id] }),
        client.invalidateQueries({ queryKey: ["my-ballots"] }),
        client.invalidateQueries({ queryKey: ["my-ballot", ballot.id] }),
      ]);
    },
  });

  const busy = disabled || publication.isPending;

  return (
    <div className="mt-3">
      {failure && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {failure}
        </p>
      )}
      {!review ? (
        <button
          className="ui-button"
          disabled={busy}
          onClick={() => {
            setFailure(null);
            setReview(true);
          }}
        >
          Review publication
        </button>
      ) : (
        <div
          role="region"
          aria-label="Confirm publication"
          className="surface-inset"
        >
          <p className="break-words font-medium">
            Publish results for “{ballot.question}”?
          </p>
          <p className="mt-2 text-sm">
            Results will be visible to eligible members and officers.
            Publication cannot be undone. Quorum is not configured.
          </p>
          <div className="mt-3 action-row">
            <button
              className="ui-button"
              disabled={busy}
              onClick={() => {
                if (!busy) {
                  setFailure(null);
                  publication.mutate();
                }
              }}
            >
              {publication.isPending ? "Publishing…" : "Confirm publication"}
            </button>
            <button
              className="ui-button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
