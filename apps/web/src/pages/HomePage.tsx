import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { CurrentUser } from "@/features/auth/api";
import { useDemoAccount } from "@/features/auth/use-demo-account";
import { useAccount } from "@/features/auth/use-account";
import { getMyBallots } from "@/features/ballots/member-api";
import {
  getMeetings,
  meetingStateLabels,
  meetingTime,
} from "@/features/meetings/api";
import { JoinMeetingForm } from "@/features/meetings/JoinMeetingForm";
import { getMembers } from "@/features/members/api";
import { getContests } from "@/features/nominations/api";

// Refresh summaries while Home is visible; retain existing cache invalidation prefixes.
const overviewQuery = {
  retry: false,
  gcTime: 0,
  networkMode: "always",
  refetchInterval: 30_000,
} as const;

function LoadError({
  message,
  retry,
  pending,
}: {
  message: string;
  retry: () => void;
  pending: boolean;
}) {
  return (
    <div className="surface-inset">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <button className="mt-3 ui-button" disabled={pending} onClick={retry}>
        Try again
      </button>
    </div>
  );
}

function ReadyBallots({ userId }: { userId: string }) {
  const ballots = useQuery({
    ...overviewQuery,
    queryKey: ["my-ballots", "home", userId],
    queryFn: ({ signal }) => getMyBallots(0, signal, "ready"),
  });
  return (
    <section aria-labelledby="home-votes">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-votes" className="text-lg font-semibold">
          Your votes
        </h2>
        <Link to="/ballots" className="back-link">
          All ballots <Icon name="arrow" className="ml-2 size-4" />
        </Link>
      </div>
      {ballots.isPending ? (
        <p role="status" className="supporting-copy">
          Loading your votes…
        </p>
      ) : ballots.isError ? (
        <LoadError
          message={ballots.error.message}
          pending={ballots.isFetching}
          retry={() => void ballots.refetch()}
        />
      ) : ballots.data.total === 0 ? (
        <EmptyState
          title="No votes waiting for you"
          description="View your votes and published results."
          action={
            <Link to="/ballots?view=results" className="back-link">
              View results
            </Link>
          }
        />
      ) : (
        <>
          <ul className="space-y-4">
            {ballots.data.items.slice(0, 3).map((ballot) => (
              <li key={ballot.id} className="item-card">
                <p className="break-words supporting-copy">
                  {ballot.meeting_title}
                </p>
                <h3 className="mt-2 item-heading">{ballot.question}</h3>
                <div className="item-footer">
                  <StatusBadge tone="success">Voting open</StatusBadge>
                  <Link
                    to={
                      "/ballots/" +
                      ballot.id +
                      "?returnTo=" +
                      encodeURIComponent("/ballots?view=ready")
                    }
                    className="ui-button ui-button-primary"
                    aria-label={"Vote: " + ballot.question}
                  >
                    Vote <Icon name="arrow" className="size-4" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-4 action-row">
        {ballots.isSuccess && ballots.data.total > 3 && (
          <Link to="/ballots?view=ready" className="back-link">
            View all {ballots.data.total} ready ballots
          </Link>
        )}
        <Link to="/nominations" className="back-link">
          Your nominations <Icon name="arrow" className="ml-2 size-4" />
        </Link>
      </div>
    </section>
  );
}

function ConsentRequests({ userId }: { userId: string }) {
  const contests = useQuery({
    ...overviewQuery,
    queryKey: ["nomination-contests", userId, 0, "consent"],
    queryFn: ({ signal }) => getContests(0, signal, "consent"),
  });
  if (contests.isSuccess && contests.data.total === 0) return null;
  return (
    <section aria-labelledby="home-consent" className="mt-6">
      <h2 id="home-consent" className="mb-3 text-base font-medium">
        Awaiting your consent
      </h2>
      {contests.isPending ? (
        <p role="status" className="supporting-copy">
          Checking nomination requests…
        </p>
      ) : contests.isError ? (
        <LoadError
          message={contests.error.message}
          pending={contests.isFetching}
          retry={() => void contests.refetch()}
        />
      ) : (
        <div className="home-summary-row surface-inset">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
            <p className="text-sm font-medium">
              {contests.data.total}{" "}
              {contests.data.total === 1 ? "election needs" : "elections need"}{" "}
              your response
            </p>
            <p className="mt-1 break-words supporting-copy">
              {contests.data.items
                .slice(0, 2)
                .map((contest) => contest.question)
                .join(" · ")}
            </p>
          </div>
          <Link to="/nominations?view=consent" className="ui-button">
            Review requests
          </Link>
        </div>
      )}
    </section>
  );
}

function MeetingOverview({ userId }: { userId: string }) {
  const meetings = useQuery({
    ...overviewQuery,
    queryKey: ["meetings", "home", userId],
    queryFn: async ({ signal }) => {
      const [live, planned] = await Promise.all([
        getMeetings(0, 3, signal, "live"),
        getMeetings(0, 3, signal, "planned"),
      ]);
      // A transition between these reads can put the same meeting in both responses.
      const items = [...live.items, ...planned.items];
      return items
        .filter(
          (item, index) =>
            items.findIndex((other) => other.id === item.id) === index,
        )
        .slice(0, 3);
    },
  });
  return (
    <section aria-labelledby="home-meetings" className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-meetings" className="text-lg font-semibold">
          Manage meetings
        </h2>
        <Link to="/meetings?create=1" className="ui-button">
          New meeting
        </Link>
      </div>
      {meetings.isPending ? (
        <p role="status" className="supporting-copy">
          Loading active meetings…
        </p>
      ) : meetings.isError ? (
        <LoadError
          message={meetings.error.message}
          pending={meetings.isFetching}
          retry={() => void meetings.refetch()}
        />
      ) : meetings.data.length === 0 ? (
        <p className="supporting-copy">
          No Planned or Live meetings. Create one when you’re ready.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {meetings.data.map((meeting) => (
            <li key={meeting.id} className="home-summary-row py-4">
              <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                <h3 className="break-words text-base font-medium">
                  {meeting.title}
                </h3>
                <time
                  dateTime={meeting.scheduled_at}
                  className="mt-1 block supporting-copy"
                >
                  {meetingTime(meeting.scheduled_at)}
                </time>
                {meeting.needs_status_review && (
                  <p className="mt-1 text-sm text-warning">
                    Status review needed
                  </p>
                )}
              </div>
              <StatusBadge
                tone={meeting.state === "LIVE" ? "success" : "neutral"}
              >
                {meetingStateLabels[meeting.state]}
              </StatusBadge>
              <Link
                to={"/meetings/" + meeting.id}
                className="ui-button"
                aria-label={"Open meeting: " + meeting.title}
              >
                Open <Icon name="arrow" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/meetings" className="mt-3 back-link">
        All meetings <Icon name="arrow" className="ml-2 size-4" />
      </Link>
    </section>
  );
}

function PendingMembers({ userId }: { userId: string }) {
  const members = useQuery({
    ...overviewQuery,
    queryKey: ["members", "home", userId],
    queryFn: ({ signal }) => getMembers(0, 1, signal, "pending"),
  });
  return (
    <section aria-label="Membership approvals" className="mt-8">
      {members.isPending ? (
        <p role="status" className="supporting-copy">
          Checking membership requests…
        </p>
      ) : members.isError ? (
        <LoadError
          message={members.error.message}
          pending={members.isFetching}
          retry={() => void members.refetch()}
        />
      ) : (
        <div className="home-summary-row">
          <p className="supporting-copy">
            {members.data.total === 0
              ? "No membership requests awaiting review."
              : members.data.total +
                (members.data.total === 1
                  ? " membership request awaiting review"
                  : " membership requests awaiting review")}
          </p>
          <Link
            to={members.data.total ? "/members?view=pending" : "/members"}
            className="back-link"
          >
            {members.data.total ? "Review requests" : "Manage members"}{" "}
            <Icon name="arrow" className="ml-2 size-4" />
          </Link>
        </div>
      )}
    </section>
  );
}

function MemberOverview({ user }: { user: CurrentUser }) {
  return (
    <>
      {user.membership_status !== "approved" && (
        <div className="mb-6 surface-inset">
          <p className="text-sm font-medium">
            {user.membership_status === "pending"
              ? "Membership awaiting approval"
              : "Membership is not currently approved"}
          </p>
          <p className="mt-2 supporting-copy">
            Contact an administrator about your membership.
          </p>
          <Link to="/account" className="mt-2 back-link">
            Check membership status
          </Link>
        </div>
      )}
      <ReadyBallots userId={user.id} />
      {user.membership_status === "approved" && (
        <ConsentRequests userId={user.id} />
      )}
      {user.is_officer && <MeetingOverview userId={user.id} />}
      {user.is_admin && <PendingMembers userId={user.id} />}
    </>
  );
}

function DemoAccess() {
  const demo = useDemoAccount();

  if (!demo.data) return null;

  return (
    <section
      aria-labelledby="home-demo"
      className="mb-8 surface-panel border-primary/40"
    >
      <h2 id="home-demo" className="text-xl font-semibold">
        Explore the demo
      </h2>
      <p className="mt-3 supporting-copy">
        Explore with a shared admin account. Changes are visible to other
        visitors.
      </p>
      <Link to="/login" className="mt-5 ui-button ui-button-primary">
        Use demo admin account <Icon name="arrow" className="size-4" />
      </Link>
    </section>
  );
}

export function HomePage() {
  const account = useAccount();
  const user = account.isSuccess ? account.data : null;
  return (
    <main className="page-shell page-wide">
      <header className="mb-8">
        <h1 className="page-title">
          {user ? "Overview" : "Voting & live polls"}
        </h1>
      </header>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
        <div className="min-w-0">
          {account.isSuccess && !user && <DemoAccess />}
          {account.isPending ? (
            <p role="status" className="supporting-copy">
              Checking your session…
            </p>
          ) : account.isError ? (
            <LoadError
              message="We could not check your account. You can still join as a guest."
              pending={account.isFetching}
              retry={() => void account.refetch()}
            />
          ) : user ? (
            <MemberOverview key={user.id} user={user} />
          ) : (
            <section aria-labelledby="home-sign-in" className="py-2">
              <h2 id="home-sign-in" className="text-xl font-semibold">
                Take part in your organisation’s decisions.
              </h2>
              <p className="mt-3 max-w-md supporting-copy">
                Sign in for member votes, nominations and published results.
              </p>
              <Link to="/login" className="mt-6 ui-button ui-button-primary">
                Sign in to vote <Icon name="arrow" className="size-4" />
              </Link>
              <p className="mt-6 supporting-copy">
                New member?{" "}
                <Link to="/register" className="underline underline-offset-4">
                  Request an account
                </Link>
                .
              </p>
              <p className="mt-1 supporting-copy">
                Membership requires administrator approval.
              </p>
            </section>
          )}
        </div>
        <aside aria-labelledby="home-join" className="min-w-0 surface-panel">
          <h2 id="home-join" className="text-lg font-semibold">
            Join a live poll
          </h2>
          <p className="mt-2 mb-5 supporting-copy">
            Enter your organiser’s code. No account or name required.
          </p>
          <JoinMeetingForm />
        </aside>
      </div>
    </main>
  );
}
