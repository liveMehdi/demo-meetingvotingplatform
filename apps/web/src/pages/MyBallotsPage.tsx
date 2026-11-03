import { useQuery } from "@tanstack/react-query";
import { useListNavigation } from "@/lib/use-list-navigation";
import { ListViews } from "@/components/ListTools";
import { ballotStateLabels, loginUrl } from "@/lib/navigation";
import { Link } from "react-router";
import { getMyBallots } from "@/features/ballots/member-api";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";

export function MyBallotsPage() {
  const { offset, setOffset, view, setView, search } = useListNavigation(["all", "ready", "submitted", "results"]);
  const ballots = useQuery({ queryKey: ["my-ballots", offset, view], queryFn: ({ signal }) => getMyBallots(offset, signal, view), retry: false, networkMode: "always", gcTime: 0 });
  return <main className="page-shell">
    <Link to="/" className="back-link">Home</Link>
    <h1 className="mt-4 page-title">Your ballots</h1>
    <details className="mt-3 supporting-copy"><summary className="w-fit cursor-pointer">How eligibility works</summary><p className="mt-2">Who can vote is fixed when voting opens. Later membership or attendance changes do not affect your access to that vote.</p></details>
    <ListViews value={view} onChange={setView} choices={[["all", "All ballots"], ["ready", "Ready to vote"], ["submitted", "Submitted"], ["results", "Results"]]} />
    {ballots.isPending ? <p role="status" className="mt-6">Loading ballots…</p> : ballots.isError ? <div className="mt-6">
      <p role="alert">{ballots.error.message}</p><Link to={loginUrl(`/ballots?${search}`)} className="mt-3 inline-block underline">Sign in</Link>
      <button className="ml-4 underline" disabled={ballots.isFetching} onClick={() => void ballots.refetch()}>Try again</button>
    </div> : <>
      <div className="list-toolbar"><p className="supporting-copy">{ballots.data.total} {ballots.data.total === 1 ? "ballot" : "ballots"} in this view</p><button className="ui-button" disabled={ballots.isFetching} onClick={() => void ballots.refetch()}>Refresh ballots</button></div>
      <ul className="space-y-4">{ballots.data.items.map((ballot) => <li key={ballot.id} className="item-card">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <p className="min-w-0 flex-1 break-words pt-1 supporting-copy">{ballot.meeting_title}</p>
          <StatusBadge tone={ballot.invalidated_at ? "danger" : ballot.state === "OPEN" ? "success" : ballot.state === "PUBLISHED" ? "accent" : "neutral"}>
            {ballot.invalidated_at ? "Invalidated" : ballotStateLabels[ballot.state]}
          </StatusBadge>
        </div>
        <h2 className="item-heading mt-4">{ballot.question}</h2>
        <div className="item-footer">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusBadge tone={ballot.submitted ? "success" : "warning"}>
              <Icon name={ballot.submitted ? "check" : "clock"} className="size-4" />
              {ballot.submitted ? "Submitted" : "Not submitted"}
            </StatusBadge>
            <span className="text-sm tabular-nums text-muted-foreground">{ballot.participation_count} {ballot.participation_count === 1 ? "submission" : "submissions"}</span>
          </div>
          <Link to={`/ballots/${ballot.id}?returnTo=${encodeURIComponent(`/ballots?${search}`)}`} className="ui-button"
            aria-label={`${ballot.invalidated_at ? "View history" : ballot.state === "PUBLISHED" ? "View results" : ballot.state === "OPEN" && !ballot.submitted ? "Vote now" : "View ballot"}: ${ballot.question}`}>
            {ballot.invalidated_at ? "View history" : ballot.state === "PUBLISHED" ? "View results" : ballot.state === "OPEN" && !ballot.submitted ? "Vote now" : "View ballot"}
            <Icon name="arrow" className="size-4" />
          </Link>
        </div>
      </li>)}</ul>
      {ballots.data.items.length === 0 && <EmptyState
        title={offset > 0 ? "No ballots on this page" : view === "ready" ? "You're all caught up" : view === "submitted" ? "No submissions yet" : view === "results" ? "No published results yet" : "No ballots available yet"}
        description={offset > 0 ? "Go back to see earlier ballots." : view === "ready" ? "There are no ballots waiting for your vote." : view === "submitted" ? "Your recorded submissions will appear here." : view === "results" ? "Results appear after an officer publishes them." : "Ballots you are eligible for appear here when voting opens."}
        action={view !== "all" && <button className="ui-button" onClick={() => setView("all")}>View all ballots</button>} />}
      {(ballots.data.total > 20 || offset > 0) && <nav aria-label="Your ballot pages" className="pagination">
        <button disabled={offset === 0} className="ui-button" onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button>
        <span className="text-muted-foreground">Page {Math.floor(offset / 20) + 1}</span>
        <button disabled={offset + 20 >= ballots.data.total} className="ui-button" onClick={() => setOffset(offset + 20)}>Next</button>
      </nav>}
    </>}
  </main>;
}
