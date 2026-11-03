import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { actionLabels, getAudit } from "@/features/audit/api";
import { AuditExportControl } from "@/features/audit/Export";
import { EmptyState } from "@/components/ui/EmptyState";

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const events = useQuery({
    queryKey: ["audit", offset], queryFn: ({ signal }) => getAudit(offset, signal),
    retry: false, gcTime: 0, networkMode: "always",
  });
  return <main className="page-shell">
    <Link to="/" className="back-link">Home</Link>
    <h1 className="mt-4 page-title">Administrative activity</h1>
    <p className="mt-3 supporting-copy">Membership, access, meeting and ballot changes.</p>
    <button className="mt-4 ui-button" disabled={events.isFetching}
      onClick={() => { if (offset !== 0) setOffset(0); else void events.refetch(); }}>Refresh latest</button>
    {events.isPending ? <p role="status" className="mt-6">Loading activity…</p> : events.isError ?
      <p role="alert" className="mt-6 text-destructive">{events.error.message}</p> : <>
        <AuditExportControl />
        <p className="mt-6 supporting-copy">{events.data.total} recorded actions</p>
        {events.data.items.length === 0 && <EmptyState className="mt-4" title="No recorded activity" description={offset > 0 ? "Go back to see earlier actions." : "Successful administrative changes will appear here."} />}
        <ol className="mt-4 space-y-4">{events.data.items.map((event) => <li key={event.id} className="surface-inset">
          <p className="font-medium">{actionLabels[event.action]}</p>
          <time dateTime={event.occurred_at} className="mt-1 block supporting-copy">{new Date(event.occurred_at).toLocaleString()}</time>
          <details className="mt-3"><summary className="cursor-pointer text-sm underline">Record identifiers</summary>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted-foreground">Actor account ID</dt><dd className="break-all">{event.actor_id ?? "Local operator (first-admin setup)"}</dd></div>
            <div><dt className="text-muted-foreground">Affected record ID</dt><dd className="break-all">{event.target_id}</dd></div>
            {event.meeting_id && <div><dt className="text-muted-foreground">Meeting ID</dt><dd className="break-all">{event.meeting_id}</dd></div>}
          </dl></details>
        </li>)}</ol>
        {(events.data.total > 20 || offset > 0) && <nav aria-label="Activity pages" className="pagination">
          <button className="ui-button" disabled={offset === 0 || events.isFetching} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button>
          <span>Page {Math.floor(offset / 20) + 1}</span>
          <button className="ui-button" disabled={offset + 20 >= events.data.total || events.isFetching} onClick={() => setOffset(offset + 20)}>Next</button>
        </nav>}
      </>}
  </main>;
}
