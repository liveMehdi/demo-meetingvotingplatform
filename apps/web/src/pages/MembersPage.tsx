import { actionButtonClass as buttonClass } from "@/components/ui/control-styles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { currentUserKey } from "@/features/auth/api";
import { changeMember, getMembers, MemberRequestError, type MemberChange } from "@/features/members/api";

import { useListNavigation } from "@/lib/use-list-navigation";
import { ListSearch, ListViews } from "@/components/ListTools";
import { SecurityControls } from "@/features/members/SecurityControls";
import { EmptyState } from "@/components/ui/EmptyState";

const PAGE_SIZE = 20;
const membershipLabels = { pending: "Pending approval", approved: "Approved", revoked: "Revoked" };

export function MembersPage() {
  const queryClient = useQueryClient();
  const { offset, setOffset, view, setView, q, setSearch } = useListNavigation(["all", "pending", "approved", "officers"]);
  const [review, setReview] = useState<{ input: MemberChange; email: string } | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (review) reviewRef.current?.focus(); }, [review]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const members = useQuery({
    queryKey: ["members", offset, view, q],
    queryFn: ({ signal }) => getMembers(offset, PAGE_SIZE, signal, view, q),
    retry: false,
    networkMode: "always",
    gcTime: 0,
  });
  const mutation = useMutation({
    mutationFn: changeMember,
    retry: false,
    networkMode: "always",
    async onSuccess(member) {
      setFeedback(`Updated ${member.email}.`); setReview(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: currentUserKey }),
      ]);
    },
    async onError(error) {
      setFailure(error.message); setReview(null);
      // Recheck authoritative state after failures, including permission changes or lost responses.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members"] }),
        queryClient.invalidateQueries({ queryKey: currentUserKey }),
      ]);
    },
  });

  function change(input: MemberChange) {
    if (mutation.isPending) return;
    setFeedback(null);
    setFailure(null);
    mutation.mutate(input);
  }

  const denied = members.error instanceof MemberRequestError &&
    (members.error.status === 401 || members.error.status === 403);

  return (
    <main className="page-shell">
      <Link to="/" className="back-link">Home</Link>
      <h1 className="mt-4 page-title">Members and officers</h1>
      <ListViews value={view} onChange={(next) => { setReview(null); setView(next); }} choices={[["all", "All members"], ["pending", "Pending approvals"], ["approved", "Approved"], ["officers", "Officers"]]} />
      <ListSearch key={q} value={q} onSearch={(value) => { setReview(null); setSearch(value); }} label="Search registered email" />
      {members.isPending ? (
        <p role="status" className="mt-8">Loading members…</p>
      ) : members.isError ? (
        <div className="mt-8">
          <p role="alert" className="text-destructive">{members.error.message}</p>
          {denied ? (
            <Link to="/account" className="mt-4 inline-block underline underline-offset-4">Check your administrator access</Link>
          ) : (
            <button type="button" className={`${buttonClass} mt-4`} disabled={members.isFetching}
              onClick={() => void members.refetch()}>Try again</button>
          )}
        </div>
      ) : (
        <>
          <div className="list-toolbar">
            <p className="supporting-copy">{members.data.total} matching accounts</p>
            <button type="button" className={buttonClass} disabled={members.isFetching || mutation.isPending}
              onClick={() => void members.refetch()}>Refresh list</button>
          </div>
          {feedback && <p role="status" className="mb-4 text-sm">{feedback}</p>}
          {failure && <p role="alert" className="mb-4 text-sm text-destructive">{failure}</p>}
          {review && <div ref={reviewRef} tabIndex={-1} role="region" aria-label="Confirm access removal" className="mb-5 rounded-2xl bg-card ring-1 ring-destructive/60 p-4">
            <p className="break-words font-medium">{review.input.kind === "membership" ? "Revoke membership" : "Remove officer access"} for {review.email}?</p>
            <p className="mt-2 text-sm">{review.input.kind === "membership" ? "Officer access is unchanged." : "Membership is unchanged."} Eligibility for votes already opened is unchanged.</p>
            <div className="mt-3 action-row"><button className={`${buttonClass} text-destructive`} disabled={mutation.isPending} onClick={() => change(review.input)}>Confirm removal</button><button className={buttonClass} disabled={mutation.isPending} onClick={() => setReview(null)}>Cancel</button></div>
          </div>}
          <div className="space-y-4" aria-busy={mutation.isPending}>
            {members.data.items.map((member) => (
              <Card key={member.id}>
                <CardHeader>
                  <CardTitle className="break-words text-lg">{member.email}</CardTitle>
                  <CardDescription>
                    {member.membership_status ? membershipLabels[member.membership_status] : "No membership record"}
                    {member.is_admin && " · Admin"}{member.is_officer && " · Officer"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="action-row">
                    <button type="button" className={buttonClass}
                      disabled={mutation.isPending || review !== null || member.membership_status === null || member.membership_status === "approved"}
                      onClick={() => change({ kind: "membership", id: member.id, status: "approved" })}>
                      Approve membership
                    </button>
                    <button type="button" className={buttonClass}
                      disabled={mutation.isPending || review !== null || member.membership_status === null || member.membership_status === "revoked"}
                      onClick={() => setReview({ input: { kind: "membership", id: member.id, status: "revoked" }, email: member.email })}>
                      Revoke membership
                    </button>
                    <button type="button" className={buttonClass} disabled={mutation.isPending || review !== null}
                      onClick={() => member.is_officer ? setReview({ input: { kind: "officer", id: member.id, isOfficer: false }, email: member.email }) : change({ kind: "officer", id: member.id, isOfficer: true })}>
                      {member.is_officer ? "Remove officer access" : "Grant officer access"}
                    </button>
                  </div>
                  <SecurityControls member={member} />
                </CardContent>
              </Card>
            ))}
            {members.data.items.length === 0 && <EmptyState title={offset > 0 ? "No accounts on this page" : "No matching accounts"} description={offset > 0 ? "Go back to see earlier accounts." : "Try All members or a different email search."} />}
          </div>
          {(members.data.total > PAGE_SIZE || offset > 0) && <nav aria-label="Member list pages" className="pagination">
            <button type="button" className={buttonClass} disabled={offset === 0 || mutation.isPending || review !== null}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <span className="text-sm">Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
            <button type="button" className={buttonClass}
              disabled={offset + PAGE_SIZE >= members.data.total || mutation.isPending || review !== null}
              onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
          </nav>}
        </>
      )}
    </main>
  );
}
