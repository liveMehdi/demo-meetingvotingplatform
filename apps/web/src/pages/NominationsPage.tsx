import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { currentUserKey, getCurrentUser } from "@/features/auth/api";
import {
  getContests,
  nominate,
  type Contest,
} from "@/features/nominations/api";
import { NominationsPanel } from "@/features/nominations/NominationsPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";

import { useListNavigation } from "@/lib/use-list-navigation";
import { ListViews } from "@/components/ListTools";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";

function ContestCard({
  contest,
  userId,
  email,
  canNominate,
}: {
  contest: Contest;
  userId: string;
  email: string;
  canNominate: boolean;
}) {
  const client = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [nomineeEmail, setNomineeEmail] = useState(email);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () =>
      nominate(contest.id, {
        nominee_email: nomineeEmail.trim(),
        candidate_name: name.trim(),
      }),
    retry: false,
    networkMode: "always",
    onSuccess() {
      setName("");
      setShowForm(false);
    },
    async onSettled() {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["nominations", contest.id] }),
        client.invalidateQueries({ queryKey: ["nomination-contests"] }),
      ]);
    },
  });
  const discard = useUnsavedChanges(
    showForm && (name !== "" || nomineeEmail !== email),
    create.isPending,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!create.isPending && name.trim()) create.mutate();
  }
  return (
    <section className="item-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words pt-1 supporting-copy">
          {contest.meeting_title}
        </p>
        <StatusBadge
          tone={
            contest.ballot_state === "CANCELLED"
              ? "neutral"
              : contest.nomination_state === "OPEN"
                ? "success"
                : "neutral"
          }
        >
          {contest.ballot_state === "CANCELLED"
            ? "Cancelled"
            : contest.nomination_state === "OPEN"
              ? "Nominations open"
              : "Nominations closed"}
        </StatusBadge>
      </div>
      <h2 className="item-heading mt-4">{contest.question}</h2>
      {contest.is_runoff && (
        <p className="mt-3 supporting-copy">
          Runoff: previous consent and approval carry forward. You may withdraw
          before opening; the full required roster must remain available.
        </p>
      )}
      {contest.ballot_state === "CANCELLED" && (
        <p className="mt-3 supporting-copy">
          This election was cancelled. Nominations can no longer be changed.
        </p>
      )}
      <NominationsPanel
        editable={contest.ballot_state === "DRAFT"}
        ballotId={contest.id}
        userId={userId}
        disabled={create.isPending}
        canConsent={canNominate && !contest.is_runoff}
      />
      {canNominate &&
        contest.ballot_state === "DRAFT" &&
        contest.nomination_state === "OPEN" && (
          <button
            className="mt-5 ui-button"
            disabled={create.isPending}
            aria-expanded={showForm}
            onClick={() => {
              if (showForm) {
                if (!discard()) return;
                setName("");
                setNomineeEmail(email);
              }
              setShowForm(!showForm);
            }}
          >
            {showForm ? "Cancel nomination" : "Nominate a candidate"}
          </button>
        )}
      {canNominate &&
        contest.ballot_state === "DRAFT" &&
        contest.nomination_state === "OPEN" &&
        showForm && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <fieldset disabled={create.isPending} className="space-y-3">
              <div>
                <label
                  className="block text-sm font-medium"
                  htmlFor={`email-${contest.id}`}
                >
                  Nominee's registered email
                </label>
                <input
                  id={`email-${contest.id}`}
                  className="mt-1 ui-input"
                  type="email"
                  maxLength={254}
                  required
                  value={nomineeEmail}
                  onChange={(e) => setNomineeEmail(e.target.value)}
                />
              </div>
              <div>
                <label
                  className="block text-sm font-medium"
                  htmlFor={`name-${contest.id}`}
                >
                  Proposed candidate name
                </label>
                <input
                  id={`name-${contest.id}`}
                  className="mt-1 ui-input"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <p className="supporting-copy">
                Self-nomination confirms your consent. Other nominees must
                consent themselves. All candidates need officer approval.
              </p>
              <button className="ui-button">
                {create.isPending ? "Submitting…" : "Submit nomination"}
              </button>
            </fieldset>
          </form>
        )}
      {create.isError && (
        <p role="alert" className="mt-3">
          {create.error.message} Check the refreshed list before retrying.
        </p>
      )}
      {create.isSuccess && (
        <p role="status" className="mt-3">
          Nomination recorded. Review its status above.
        </p>
      )}
    </section>
  );
}

export function NominationsPage() {
  const { offset, setOffset, view, setView } = useListNavigation(
    ["all", "consent", "mine", "open"],
    "consent",
  );
  const account = useQuery({
    queryKey: currentUserKey,
    queryFn: ({ signal }) => getCurrentUser(signal),
    retry: false,
  });
  const user = account.data;
  const approved = user?.membership_status === "approved";
  const effectiveView = approved ? view : "withdraw";
  const contests = useQuery({
    queryKey: ["nomination-contests", user?.id, offset, effectiveView],
    queryFn: ({ signal }) => getContests(offset, signal, effectiveView),
    enabled: !!user,
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });
  return (
    <main className="page-shell">
      <Link to="/" className="back-link">
        Home
      </Link>
      <h1 className="mt-4 page-title">Nominations</h1>
      <details className="mt-3 supporting-copy">
        <summary className="w-fit cursor-pointer">About nominations</summary>
        <p className="mt-2">
          Approved members can nominate themselves or another approved member.
          You see only nominations you made or received. Candidates may withdraw
          before voting opens. Eligible members vote from Your ballots.
        </p>
      </details>
      {account.isPending ? (
        <p role="status">Loading account…</p>
      ) : account.isError ? (
        <p role="alert">{account.error.message}</p>
      ) : !user ? (
        <p>
          Sign in to see your nominations.{" "}
          <Link className="underline" to="/account">
            Check membership status
          </Link>
        </p>
      ) : (
        <>
          {!approved && (
            <p className="my-6 surface-panel text-sm">
              Approval is required to nominate or consent. You can still view
              and withdraw your own existing candidacy before voting opens.
            </p>
          )}
          {approved && (
            <ListViews
              value={view}
              onChange={setView}
              choices={[
                ["consent", "Awaiting your consent"],
                ["mine", "My nominations"],
                ["open", "Open contests"],
                ["all", "All contests"],
              ]}
            />
          )}
          <div className="list-toolbar">
            <p className="supporting-copy">Your nomination contests</p>
            <button
              className="ui-button"
              disabled={contests.isFetching}
              onClick={() => void contests.refetch()}
            >
              Refresh contests
            </button>
          </div>
          {contests.isPending ? (
            <p role="status">Loading contests…</p>
          ) : contests.isError ? (
            <p role="alert">{contests.error.message}</p>
          ) : (
            <>
              <div className="space-y-4">
                {contests.data.items.map((contest) => (
                  <ContestCard
                    key={contest.id}
                    contest={contest}
                    userId={user.id}
                    email={user.email}
                    canNominate={approved}
                  />
                ))}
              </div>
              {contests.data.items.length === 0 && (
                <EmptyState
                  title={
                    offset > 0
                      ? "No contests on this page"
                      : approved && view === "consent"
                        ? "No consent requests"
                        : "No nominations to show"
                  }
                  description={
                    offset > 0
                      ? "Go back to see earlier contests."
                      : approved
                        ? "Browse open contests to nominate someone, or check My nominations."
                        : "You have no nominations you can withdraw from. You can only withdraw before voting opens."
                  }
                  action={
                    approved &&
                    view !== "open" && (
                      <button
                        className="ui-button"
                        onClick={() => setView("open")}
                      >
                        Browse open contests
                      </button>
                    )
                  }
                />
              )}
              {(contests.data.total > 20 || offset > 0) && (
                <nav
                  aria-label="Nomination contest pages"
                  className="pagination"
                >
                  <button
                    className="ui-button"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    Previous
                  </button>
                  <span>Page {Math.floor(offset / 20) + 1}</span>
                  <button
                    className="ui-button"
                    disabled={offset + 20 >= contests.data.total}
                    onClick={() => setOffset(offset + 20)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
