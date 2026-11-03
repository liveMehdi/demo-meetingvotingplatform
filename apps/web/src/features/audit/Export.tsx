import { parseData, readErrorDetail } from "@/lib/validation";
import { auditExportSchema } from "./export-schema";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function AuditExportControl() {
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<{
    json: string;
    filename: string;
    sequence: number;
  } | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  async function prepare() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);

    setError(null);
    setCheckpoint(null);
    try {
      const response = await apiRequest("/api/audit/export", {
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Sign in with current administrator access to export history.",
        );

      if (response.status === 409) {
        throw new Error(
          (await readErrorDetail(response)) ??
            "Audit export is unavailable. Preserve the database and investigate.",
        );
      }

      if (!response.ok)
        throw new Error("Could not export history. Please try again.");

      const raw = await response.text();
      // checking the format here, leaving hash verification to the offline verifier
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("Couldn’t verify the audit export. Try again.");
      }
      const data = parseData(auditExportSchema, json, "Couldn’t verify the audit export. Try again.");
      const c = data.checkpoint;

      if (controller.signal.aborted) return;

      const name = `audit-${c.chain_id}-${c.sequence}`;

      download(new Blob([raw], { type: "application/json" }), `${name}.json`);

      setCheckpoint({
        json: JSON.stringify(c, null, 2),
        filename: `${name}-checkpoint.json`,
        sequence: c.sequence,
      });
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Export failed.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }
  return (
    <section
      className="mt-6 surface-inset"
      aria-label="Audit export and checkpoint"
    >
      <h2 className="font-semibold">Export audit history</h2>
      <p className="mt-2 supporting-copy">
        Download the history and matching checkpoint. Keep the checkpoint
        separately from app backups.
      </p>

      <details className="mt-3 supporting-copy">
        <summary className="w-fit cursor-pointer">
          Backup and verification help
        </summary>

        <div className="mt-2 space-y-2">
          <p>
            Ask someone responsible to keep checkpoints separately from the app
            and database backups. Save one after each meeting and before
            upgrades or restores, and keep previous copies.
          </p>
          <p>
            Follow the README to check an export against a saved checkpoint. It
            covers only the history up to that point. Without a separately saved
            checkpoint, someone with database access could rewrite the history
            without detection.
          </p>
          <p>
            Checks cannot confirm whether older records were changed before the
            audit chain was added, whether every action was recorded, or whether
            votes were counted correctly. Individual votes and choices are not
            included.
          </p>
        </div>
      </details>

      <button
        type="button"
        className="mt-3 ui-button"
        disabled={pending}
        onClick={() => void prepare()}
      >
        {pending ? "Preparing export…" : "Download audit history"}
      </button>
      {checkpoint && (
        <div className="mt-3">
          <p role="status" className="text-sm">
            History downloaded. Save its matching checkpoint below.
          </p>

          <button
            type="button"
            className="mt-2 ui-button"
            onClick={() =>
              download(
                new Blob([checkpoint.json], { type: "application/json" }),
                checkpoint.filename,
              )
            }
          >
            Save matching checkpoint
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
