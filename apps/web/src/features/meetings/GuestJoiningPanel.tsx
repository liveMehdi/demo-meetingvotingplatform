import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getJoining,
  setJoining,
  type JoiningStatus,
} from "@/features/meetings/guest-api";
import { GuestJoinCard } from "./GuestJoinCard";

export function GuestJoiningPanel({
  meetingId,
  readOnly = false,
}: {
  meetingId: string;
  readOnly?: boolean;
}) {
  const client = useQueryClient();

  const [review, setReview] = useState<JoiningStatus | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ["guest-joining", meetingId],
    queryFn: ({ signal }) => getJoining(meetingId, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    refetchInterval: 30000,
  });

  const change = useMutation({
    mutationFn: (previous: JoiningStatus) =>
      setJoining(meetingId, !previous.enabled, previous.revision),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    onSuccess(data) {
      setFeedback(
        data.enabled ? "Guest joining enabled." : "New guest joining disabled.",
      );
    },

    onError(error) {
      setFeedback(
        `${error.message} Check the refreshed settings before trying again.`,
      );
    },

    async onSettled() {
      setReview(null);
      await client.invalidateQueries({
        queryKey: ["guest-joining", meetingId],
      });
    },
  });

  return (
    <section className="mt-6" aria-label="Guest joining">
      <h2 className="text-xl font-semibold">Guest joining</h2>
      <p className="mt-3 supporting-copy">Anyone with the code can join.</p>
      <details className="mt-2 supporting-copy">
        <summary className="w-fit cursor-pointer">About guest access</summary>
        <p className="mt-2">
          Guests can answer polls without an account. Joining does not grant
          member voting access or record attendance.
        </p>
        <p className="mt-2">
          A browser cookie helps prevent repeat responses. Clearing cookies or
          using another browser can allow another response, so this does not
          guarantee one response per person or device.
        </p>
      </details>
      {settings.isPending ? (
        <p role="status" className="mt-4">
          Loading joining settings…
        </p>
      ) : settings.isError ? (
        <p role="alert" className="mt-4">
          {settings.error.message}
        </p>
      ) : (
        <>
          <p className="mt-4 font-medium">
            {settings.data.enabled
              ? "New guests can join"
              : "New guest joining is disabled"}
          </p>
          {settings.data.enabled && settings.data.code && (
            <div className="mt-4">
              <GuestJoinCard code={settings.data.code} />
            </div>
          )}
          {review ? (
            <div
              className="mt-4 surface-inset"
              role="region"
              aria-label="Confirm guest joining change"
            >
              <p>
                {review.enabled
                  ? "Disable new joins? The code will stop working. Existing guests can still respond; close the polls to stop voting."
                  : "Enable guest joining? A new code will let anyone holding it see this meeting's title and scheduled time."}
              </p>
              <div className="mt-3 action-row">
                <button
                  disabled={readOnly || change.isPending}
                  className="ui-button"
                  onClick={() => {
                    if (!change.isPending) change.mutate(review);
                  }}
                >
                  {change.isPending ? "Saving…" : "Confirm"}
                </button>
                <button
                  disabled={readOnly || change.isPending}
                  className="underline"
                  onClick={() => setReview(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="mt-4 ui-button"
              disabled={readOnly || change.isPending}
              onClick={() => {
                setFeedback(null);
                setReview(settings.data);
              }}
            >
              {settings.data.enabled
                ? "Disable new joins"
                : "Enable guest joining"}
            </button>
          )}
        </>
      )}
      <button
        className="ml-4 mt-4 text-sm underline disabled:opacity-50"
        disabled={settings.isFetching || change.isPending}
        onClick={() => void settings.refetch()}
      >
        Refresh joining settings
      </button>
      {feedback && (
        <p className="mt-3 text-sm" role={change.isError ? "alert" : "status"}>
          {feedback}
        </p>
      )}
    </section>
  );
}
