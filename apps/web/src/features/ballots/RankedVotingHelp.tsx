export function RankedVotingHelp() {
  return (
    <details className="mt-3 supporting-copy">
      <summary className="w-fit cursor-pointer">
        How ranked votes are counted
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          A candidate wins with more than half the votes still in the count.
          Otherwise, the sole lowest candidate is eliminated and votes transfer
          to each voter’s next remaining choice.
        </p>
        <p>
          If none of your ranked candidates remain, your vote leaves the count.
          You can leave candidates unranked, but there is no separate abstain
          option.
        </p>
        <p>
          A tie for elimination or a final tie stops the count. A new election
          is needed among all remaining candidates. No votes means no result.
        </p>
      </div>
    </details>
  );
}
