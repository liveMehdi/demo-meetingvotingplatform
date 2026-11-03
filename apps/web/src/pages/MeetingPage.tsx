import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { eligibilityLabels, getMeeting, meetingTime, meetingIsActive, meetingStateLabels } from "@/features/meetings/api";
import { AttendancePanel } from "@/features/meetings/AttendancePanel";
import { BallotsPanel } from "@/features/ballots/BallotsPanel";
import { EligibilityPanel } from "@/features/meetings/EligibilityPanel";
import { GuestJoiningPanel } from "@/features/meetings/GuestJoiningPanel";
import { PollsPanel } from "@/features/ballots/PollsPanel";

import { lazy, Suspense } from "react";
import { safeReturnTo } from "@/lib/navigation";

const MeetingManagement = lazy(() => import("@/features/meetings/ManagementPanel").then((module) => ({ default: module.MeetingManagement })));

const sections = [
  { id: "voting", label: "Formal voting", description: "Elections, motions and nominations" },
  { id: "polls", label: "Live polls", description: "Guest questions, joining and projector" },
  { id: "attendance", label: "Attendance", description: "Record which members are present" },
  { id: "settings", label: "Settings", description: "Meeting lifecycle, details and eligibility" },
] as const;

export function MeetingPage() {
  const { meetingId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const candidate = safeReturnTo(searchParams.get("returnTo"), "/meetings");
  const back = candidate.split("?")[0] === "/meetings" ? candidate : "/meetings";
  const selected = sections.find((section) => section.id === searchParams.get("section"))?.id ?? "voting";
  function sectionUrl(id: string) {
    const params = new URLSearchParams(searchParams);
    params.set("section", id);
    return `?${params.toString()}`;
  }
  const meeting = useQuery({
    queryKey: ["meeting", meetingId], queryFn: ({ signal }) => getMeeting(meetingId, signal),
    retry: false, networkMode: "always", gcTime: 0,
  });
  return (
    <main className="page-shell page-wide">
      <Link to={back} className="back-link">Back to meetings</Link>
      {meeting.isPending ? <p role="status" className="mt-8">Loading meeting…</p> : !meeting.data ? (
        <div className="mt-8">
          <p role="alert" className="text-destructive">{meeting.error?.message ?? "Meeting not available."}</p>
          <Link to="/account" className="mt-4 inline-block underline">Check your account</Link>
          <button className="ml-4 underline disabled:opacity-50" disabled={meeting.isFetching} onClick={() => void meeting.refetch()}>Try again</button>
        </div>
      ) : (
        <>
        {meeting.isError && <p role="alert" className="mt-4">Couldn’t refresh the meeting. Your edits are still here. <button className="underline" onClick={() => void meeting.refetch()}>Retry refresh</button></p>}
        <Card className="mt-8">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h1 className="min-w-0 flex-1 page-title">{meeting.data.title}</h1>
              <StatusBadge tone={meeting.data.state === "LIVE" ? "success" : meeting.data.state === "PLANNED" ? "accent" : "neutral"}>{meetingStateLabels[meeting.data.state]}</StatusBadge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 supporting-copy"><Icon name="calendar" className="size-4 shrink-0" /><time dateTime={meeting.data.scheduled_at}>{meetingTime(meeting.data.scheduled_at)}</time></p>
              <Link className="supporting-copy underline underline-offset-4" to={sectionUrl("settings")}>Manage meeting and details</Link>
            </div>
            {!meetingIsActive(meeting.data) && <p className="supporting-copy">Meeting activity has ended. Records are read-only; unpublished closed results still require explicit publication.</p>}
            {meeting.data.description && <details>
              <summary className="cursor-pointer text-sm font-medium">Meeting description</summary>
              <p className="mt-3 whitespace-pre-wrap break-words supporting-copy">{meeting.data.description}</p>
            </details>}
          </CardContent>
        </Card>
        <nav aria-label="Meeting sections" className="segmented-track mt-6">
          {sections.map((section) => <Link key={section.id} to={sectionUrl(section.id)}
            aria-current={selected === section.id ? "page" : undefined}
            className="segmented-item px-2 text-xs sm:px-4 sm:text-sm" title={section.description}>
            {section.label}
          </Link>)}
        </nav>
        {/* Keep panels mounted so section navigation preserves unfinished forms and live updates. */}
        <div hidden={selected !== "voting"}>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-4 text-sm">
            <p className="text-muted-foreground">Eligibility: <span className="font-medium text-foreground">{eligibilityLabels[meeting.data.eligibility_policy]}</span></p>
            <Link className="text-muted-foreground underline underline-offset-4 hover:text-foreground" to={sectionUrl("settings")}>Review eligibility</Link>
          </div>
          <BallotsPanel key={`ballots-${meetingId}`} meeting={meeting.data} />
        </div>
        <div hidden={selected !== "polls"}>
          <details key={`joining-${meetingId}`} className="mt-6 surface-panel">
            <summary className="cursor-pointer font-medium"><Icon name="qr" className="mr-3 inline-block text-accent-foreground" />Guest access and QR code</summary>
            <GuestJoiningPanel meetingId={meetingId} readOnly={!meetingIsActive(meeting.data)} />
          </details>
          <PollsPanel key={`polls-${meetingId}`} meetingId={meetingId} meeting={meeting.data} readOnly={!meetingIsActive(meeting.data)} />
        </div>
        <div hidden={selected !== "attendance"}>
          <AttendancePanel key={meetingId} meetingId={meetingId} readOnly={!meetingIsActive(meeting.data)} />
        </div>
        <div hidden={selected !== "settings"}>
          <Suspense fallback={<p role="status" className="mt-6">Loading meeting controls...</p>}><MeetingManagement meeting={meeting.data} /></Suspense>
          <EligibilityPanel key={`eligibility-${meetingId}`} meeting={meeting.data} />
        </div>
        </>
      )}
    </main>
  );
}
