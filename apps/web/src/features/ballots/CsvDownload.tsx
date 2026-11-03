import { useEffect, useRef, useState } from "react";
import { downloadResults } from "@/features/ballots/results-api";

export function CsvDownload({
  ballotId,
  meetingId,
}: {
  ballotId: string;
  meetingId?: string;
}) {
  const active = useRef<AbortController | null>(null);

  const [pending, setPending] = useState(false);

  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [ballotId, meetingId],
  );

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const blob = await downloadResults(
        ballotId,
        meetingId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ballot-${ballotId}-results.csv`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Download failed. Please try again.",
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => void download()}
        className="ui-button"
      >
        {pending ? "Preparing CSV…" : "Download CSV"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
