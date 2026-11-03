import { actionButtonClass as buttonClass } from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getAttendance,
  getAttendanceHistory,
  setAttendance,
} from "@/features/meetings/attendance-api";
import { EmptyState } from "@/components/ui/EmptyState";

export function AttendancePanel({
  meetingId,
  readOnly = false,
}: {
  meetingId: string;
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [failure, setFailure] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);

  const history = useQuery({
    queryKey: ["attendance-history", meetingId, historyOffset],
    queryFn: ({ signal }) =>
      getAttendanceHistory(meetingId, historyOffset, signal),
    enabled: showHistory,
    retry: false,
    gcTime: 0,
  });

  const attendance = useQuery({
    queryKey: ["attendance", meetingId, offset],
    queryFn: ({ signal }) => getAttendance(meetingId, offset, signal),
    retry: false,
    networkMode: "always",
    gcTime: 0,
  });

  const change = useMutation({
    mutationFn: ({
      userId,
      present,
      revision,
    }: {
      userId: string;
      present: boolean;
      revision: number;
    }) => setAttendance(meetingId, userId, present, revision),

    retry: false,
    networkMode: "always",
    async onSuccess(member) {
      setFeedback(
        `${member.email} marked ${member.present ? "present" : "absent"}.`,
      );

      await client.invalidateQueries({ queryKey: ["attendance", meetingId] });
      await client.invalidateQueries({
        queryKey: ["attendance-history", meetingId],
      });
    },
    async onError(error) {
      setFailure(
        `${error.message} Check the refreshed attendance before trying again.`,
      );
      await client.invalidateQueries({ queryKey: ["attendance", meetingId] });
    },
  });

  return (
    <section aria-labelledby="attendance-title" className="mt-6 surface-panel">
      <h2 id="attendance-title" className="text-xl font-semibold">
        Member attendance
      </h2>

      {attendance.isPending ? (
        <p role="status" className="mt-4">
          Loading attendance…
        </p>
      ) : attendance.isError ? (
        <div className="mt-4">
          <p role="alert" className="text-destructive">
            {attendance.error.message}
          </p>
          <button
            type="button"
            className={`${buttonClass} mt-3`}
            disabled={attendance.isFetching}
            onClick={() => void attendance.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="my-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Present: <strong>{attendance.data.present_count}</strong>
              {" · "}Present and currently approved:{" "}
              <strong>{attendance.data.approved_present_count}</strong>
            </p>

            <button
              type="button"
              className={buttonClass}
              disabled={attendance.isFetching || change.isPending}
              onClick={() => void attendance.refetch()}
            >
              Refresh attendance
            </button>
          </div>
          <p className="mb-3 supporting-copy">
            Quorum not configured.{" "}
            {attendance.data.final_present_count !== null
              ? `At meeting end: ${attendance.data.final_present_count} present; ${attendance.data.final_approved_present_count} approved at that time.`
              : readOnly
                ? "Final attendance summary unavailable."
                : ""}
          </p>

          {feedback && (
            <p role="status" className="mb-3 text-sm">
              {feedback}
            </p>
          )}

          {failure && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {failure}
            </p>
          )}

          <ul className="space-y-3" aria-busy={change.isPending}>
            {attendance.data.items.map((member) => (
              <li
                key={member.user_id}
                className="flex flex-wrap items-center justify-between gap-4 surface-inset"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium">{member.email}</p>
                  <p className="supporting-copy">
                    {member.present ? "Present" : "Absent / not recorded"} ·
                    Membership: {member.membership_status}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Mark ${member.email} ${member.present ? "absent" : "present"}`}
                  disabled={
                    readOnly ||
                    change.isPending ||
                    (!member.present && member.membership_status !== "approved")
                  }
                  onClick={() => {
                    if (change.isPending) return;
                    setFeedback(null);
                    setFailure(null);
                    change.mutate({
                      userId: member.user_id,
                      present: !member.present,
                      revision: member.revision,
                    });
                  }}
                >
                  {member.present ? "Mark absent" : "Mark present"}
                </button>
              </li>
            ))}
          </ul>

          {attendance.data.items.length === 0 && (
            <EmptyState
              title="No members on this page"
              description={
                offset > 0
                  ? "Go back to see earlier members."
                  : "Approved members appear here for attendance recording."
              }
            />
          )}
          {(attendance.data.total > 20 || offset > 0) && (
            <nav aria-label="Attendance pages" className="pagination">
              <button
                type="button"
                className={buttonClass}
                disabled={offset === 0 || change.isPending}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous
              </button>

              <span className="text-sm">
                Page {Math.floor(offset / 20) + 1} · {attendance.data.total}{" "}
                members
              </span>

              <button
                type="button"
                className={buttonClass}
                disabled={
                  offset + 20 >= attendance.data.total || change.isPending
                }
                onClick={() => setOffset(offset + 20)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
      <button
        className={`${buttonClass} mt-5`}
        aria-expanded={showHistory}
        onClick={() => setShowHistory(!showHistory)}
      >
        Attendance change history
      </button>
      {showHistory && (
        <div className="mt-4 space-y-3">
          {history.isPending ? (
            <p role="status">Loading history...</p>
          ) : history.isError ? (
            <p role="alert">{history.error.message}</p>
          ) : (
            <>
              <p className="supporting-copy">
                Changes are retained with member/officer account IDs. The first
                entry for an older record is its imported baseline.
              </p>
              <ul className="space-y-3">
                {history.data.items.map((entry) => (
                  <li
                    className="surface-inset text-sm"
                    key={`${entry.user_id}-${entry.revision}`}
                  >
                    <p>
                      {entry.present ? "Present" : "Absent"} ·{" "}
                      {new Date(entry.recorded_at).toLocaleString()} · revision{" "}
                      {entry.revision}
                    </p>
                    <details className="mt-1 break-all text-muted-foreground">
                      <summary>Account references</summary>Member:{" "}
                      {entry.user_id}
                      <br />
                      Recorded by: {entry.recorded_by}
                    </details>
                  </li>
                ))}
              </ul>
              {history.data.items.length === 0 && (
                <EmptyState
                  title="No attendance changes"
                  description={
                    historyOffset > 0
                      ? "Go back to see earlier changes."
                      : "Recorded attendance changes will appear here."
                  }
                />
              )}
              {(history.data.total > 20 || historyOffset > 0) && (
                <nav
                  aria-label="Attendance history pages"
                  className="pagination"
                >
                  <button
                    className={buttonClass}
                    disabled={historyOffset === 0}
                    onClick={() =>
                      setHistoryOffset(Math.max(0, historyOffset - 20))
                    }
                  >
                    Previous
                  </button>
                  <button
                    className={buttonClass}
                    disabled={historyOffset + 20 >= history.data.total}
                    onClick={() => setHistoryOffset(historyOffset + 20)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
