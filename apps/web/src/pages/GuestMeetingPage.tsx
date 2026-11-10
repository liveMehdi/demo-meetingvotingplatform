import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { getGuestMeeting } from "@/features/meetings/guest-api";
import { GuestPollsPanel } from "@/features/ballots/GuestPollsPanel";

export function GuestMeetingPage() {
  const { meetingId = "" } = useParams();
  const meeting = useQuery({
    queryKey: ["guest-meeting", meetingId],
    queryFn: ({ signal }) => getGuestMeeting(meetingId, signal),
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });
  return (
    <main className="page-shell page-narrow">
      <Link to="/join" className="text-sm underline">
        Join another meeting
      </Link>
      {meeting.isPending ? (
        <p role="status" className="mt-6">
          Checking guest access…
        </p>
      ) : meeting.isError ? (
        <p role="alert" className="mt-6">
          {meeting.error.message}
        </p>
      ) : (
        <>
          <p className="mt-6 supporting-copy">Joined as a guest</p>
          {["ENDED", "CANCELLED"].includes(meeting.data.state) && (
            <p role="status" className="mb-3 text-accent-foreground">
              Meeting {meeting.data.state.toLowerCase()}. Results are read-only.
            </p>
          )}
          <h1 className="mt-4 page-title">{meeting.data.title}</h1>
          <p className="mt-4 supporting-copy">
            Scheduled: {new Date(meeting.data.scheduled_at).toLocaleString()}
          </p>
          <GuestPollsPanel
            key={meetingId}
            meetingId={meetingId}
            readOnly={["ENDED", "CANCELLED"].includes(meeting.data.state)}
          />
        </>
      )}
      <button
        className="mt-6 underline disabled:opacity-50"
        disabled={meeting.isFetching}
        onClick={() => void meeting.refetch()}
      >
        Refresh guest access
      </button>
    </main>
  );
}
