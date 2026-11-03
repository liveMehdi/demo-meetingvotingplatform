import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  eligibilityLabels,
  meetingIsActive,
  saveEligibilitySetting,
  type EligibilityPolicy,
  type Meeting,
} from "@/features/meetings/api";

export function EligibilityPanel({ meeting }: { meeting: Meeting }) {
  const client = useQueryClient();

  const [draft, setDraft] = useState<{
    policy: EligibilityPolicy;
    revision: number;
  } | null>(null);

  const [feedback, setFeedback] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (change: { policy: EligibilityPolicy; revision: number }) =>
      saveEligibilitySetting(meeting.id, change.policy, change.revision),
    retry: false,
    networkMode: "always",
    async onSuccess(updated) {
      setDraft(null);
      setFeedback("Eligibility setting saved.");
      client.setQueryData(["meeting", meeting.id], updated);
      await client.invalidateQueries({ queryKey: ["meetings"] });
    },

    async onError(error) {
      setFeedback(error.message);
      setDraft(null);
      await client.invalidateQueries({ queryKey: ["meeting", meeting.id] });
    },

  });

  return (
    <section className="mt-6 surface-panel" aria-labelledby="eligibility-title">
      <h2 id="eligibility-title" className="text-xl font-semibold">
        Meeting eligibility
      </h2>
      <p className="mt-3 supporting-copy">
        Each vote uses the eligible members recorded when it opens. This setting
        locks after the first vote opens.
      </p>
      {meeting.eligibility_locked_at || !meetingIsActive(meeting) ? (
        <p className="mt-4 font-medium">
          Locked: {eligibilityLabels[meeting.eligibility_policy]}
        </p>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending && draft) {
              setFeedback(null);
              mutation.mutate(draft);
            }
          }}

        >
          <label
            htmlFor="eligibility-policy"
            className="block text-sm font-medium"
          >
            Who may vote?
          </label>
          <select
            id="eligibility-policy"
            className="ui-input"
            disabled={mutation.isPending}
            value={draft?.policy ?? meeting.eligibility_policy}
            onChange={(event) =>
              setDraft({
                policy: event.target.value as EligibilityPolicy,
                revision: meeting.eligibility_revision,
              })
            }
          >
            
            <option value="all_approved">
              {eligibilityLabels.all_approved}
            </option>
            <option value="attending_approved">
              {eligibilityLabels.attending_approved}
            </option>
          </select>
          <button
            type="submit"
            disabled={mutation.isPending || !draft}
            className="ui-button"
          >
            {mutation.isPending ? "Saving…" : "Save eligibility setting"}
          </button>
        </form>
      )}
      {feedback && (
        <p
          role={mutation.isError ? "alert" : "status"}
          className="mt-3 text-sm"
        >
          {feedback}
        </p>
      )}
    </section>
  );
}
