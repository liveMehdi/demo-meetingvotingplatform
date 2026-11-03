import { InvalidationNotice } from "@/features/ballots/InvalidationControl";
import { useQuery } from "@tanstack/react-query";
import { getResults } from "@/features/ballots/results-api";
import { CsvDownload } from "@/features/ballots/CsvDownload";
import { RankedVotingHelp } from "./RankedVotingHelp";

export function ResultsPanel({
  ballotId,
  meetingId,
}: {
  ballotId: string;
  meetingId?: string;
}) {
  const results = useQuery({
    queryKey: ["published-results", meetingId ?? "member", ballotId],
    queryFn: ({ signal }) => getResults(ballotId, meetingId, signal),
    retry: false,
    networkMode: "always",
    gcTime: 0,
  });

  if (results.isPending)
    return (
      <p role="status" className="mt-4">
        Loading published results…
      </p>
    );

  if (results.isError)
    return (
      <div className="mt-4">
        <p role="alert">{results.error.message}</p>
        <button
          className="mt-2 underline"
          disabled={results.isFetching}
          onClick={() => void results.refetch()}
        >
          Refresh results
        </button>
      </div>
    );

  const result = results.data;

  const leaders = result.options
    .filter((option) => result.leading_option_ids.includes(option.id))
    .map((option) => option.label)
    .join(", ");

  const explanation = {
    passed: "Motion passed.",
    failed: "Motion failed.",
    winner:
      result.counting_method === "irv_v1"
        ? `Winner: ${leaders}, with a majority of continuing votes.`
        : `Most votes: ${leaders}.`,
    runoff: `Tie — a new runoff is required between: ${leaders}.`,
    no_votes: "No votes were cast. There is no election result.",
    unresolved_tie: `No winner: tied elimination or final tie. A new election is required among all remaining candidates: ${leaders}.`,
  }[result.outcome];

  return (
    <section className="mt-5 surface-inset" aria-label="Published results">
      <h3 className="text-lg font-semibold tracking-tight">
        Published results
      </h3>
      <InvalidationNotice value={result} />
      <CsvDownload
        key={`${meetingId ?? "member"}-${ballotId}`}
        ballotId={ballotId}
        meetingId={meetingId}
      />

      <p className="mt-4 break-words text-base leading-relaxed font-medium">
        {explanation}
      </p>

      <p className="mt-2 supporting-copy">
        Published {new Date(result.published_at).toLocaleString()}
      </p>
      {result.counting_method === "irv_v1" && <RankedVotingHelp />}
      {result.kind === "motion" && (
        <details className="mt-3 supporting-copy">
          <summary className="w-fit cursor-pointer">How motions pass</summary>
          <p className="mt-2">
            For must exceed Against. Ties fail. Abstentions are reported
            separately and do not count toward the majority.
          </p>
        </details>
      )}

      <table className="mt-4 w-full text-left text-sm">
        <caption
          className={
            result.counting_method === "irv_v1"
              ? "pb-2 text-left font-medium"
              : "sr-only"
          }
        >
          {result.counting_method === "irv_v1"
            ? "First preferences"
            : "Option totals"}
        </caption>

        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-3 font-medium">
              Option
            </th>

            <th scope="col" className="py-3 text-right font-medium">
              Votes
            </th>
          </tr>
        </thead>
        <tbody>
          {result.options.map((option) => (
            <tr key={option.id} className="border-t">
              <th scope="row" className="break-words py-3 font-normal">
                {option.label}
              </th>
              <td className="py-3 text-right font-medium tabular-nums">
                {option.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.rounds.map((round) => (
        <section
          key={round.number}
          className="mt-5"
          aria-label={`Round ${round.number}`}
        >
          <h4 className="font-medium">Round {round.number}</h4>
          <p className="mt-2 supporting-copy">
            Votes still in count: {round.continuing_count} · No remaining
            preference: {round.exhausted_count} · Needed to win:{" "}
            {round.majority_required}
          </p>

          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">
              Round {round.number} candidate totals
            </caption>

            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Candidate
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Votes
                </th>
              </tr>
            </thead>
            <tbody>
              {result.options
                .filter((o) => o.id in round.counts)
                .map((o) => (
                  <tr key={o.id} className="border-t">
                    <th scope="row" className="break-words py-2 font-normal">
                      {o.label}
                      {round.eliminated_option_id === o.id
                        ? " (eliminated)"
                        : ""}
                    </th>
                    <td className="text-right">{round.counts[o.id]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="mt-5 supporting-copy">
        Turnout:{" "}
        <span className="font-medium text-foreground">
          {result.participation_count} of {result.eligible_count}
        </span>{" "}
        eligible members.
      </p>
      <p className="mt-2 supporting-copy">
        Eligible members present at opening: {result.eligible_attendance_count}{" "}
        · Quorum not configured
      </p>
    </section>
  );
}
