import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { getMyBallot, submitVote, type MemberBallot } from "@/features/ballots/member-api";
import { RankingInput } from "@/features/ballots/RankingInput";
import { ResultsPanel } from "@/features/ballots/ResultsPanel";
import { InvalidationNotice } from "@/features/ballots/InvalidationControl";
import { StatusBadge } from "@/components/ui/StatusBadge";

import { ballotStateLabels, safeReturnTo, loginUrl } from "@/lib/navigation";

function VoteForm({ ballot }: { ballot: MemberBallot }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const ranked = ballot.counting_method === "irv_v1";
  const [review, setReview] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const vote = useMutation({
    mutationFn: (optionIds: string[]) => submitVote(ballot.id, optionIds),
    retry: false, networkMode: "always", gcTime: 0,
    onSuccess(receipt) {
      setSelected([]); setReview(false);
      setFeedback(receipt.already_submitted ? "A submission was already recorded. This request did not change it." : "Your submission is recorded. Your selection is not returned or displayed.");
      client.setQueryData(["my-ballot", ballot.id], (old: MemberBallot | undefined) => old ? { ...old, submitted: true } : old);
    },
    onError(error) {
      setSelected([]); setReview(false);
      setFailure(`${error.message} A lost response may still mean your vote was saved. Check your participation status before trying again.`);
    },
    async onSettled() {
      // Remove submitted option IDs from mutation state; never persist selections in browser storage.
      await Promise.all([
        client.invalidateQueries({ queryKey: ["my-ballot", ballot.id] }),
        client.invalidateQueries({ queryKey: ["my-ballots"] }),
      ]);
      vote.reset();
    },
  });
  const choices = selected.map((id) => ballot.options.find((o) => o.id === id)!);
  const choice = choices[0];
  return <div className="mt-6">
    {feedback && <p role="status" className="mb-4">{feedback}</p>}
    {failure && <p role="alert" className="mb-4 text-destructive">{failure}</p>}
    {ballot.submitted ? <p className="text-sm font-medium text-success">Your submission is recorded. It cannot be changed.</p> : ballot.state !== "OPEN" ?
      <p className="supporting-copy">Voting is closed. You did not submit a vote.</p> : <form onSubmit={(event) => {
        event.preventDefault(); if (choice && !vote.isPending) setReview(true);
      }}>
        <fieldset disabled={vote.isPending || review} className="space-y-3">
          <legend className="mb-3 font-medium">{ranked ? "Rank candidates in order of preference" : "Choose one option"}</legend>
          {ranked ? <RankingInput options={ballot.options} value={selected} onChange={(ids) => { setSelected(ids); setFailure(null); }} /> : <>
          {ballot.options.map((option) => <label key={option.id} className="choice-row">
            <input type="radio" name="option" required value={option.id} checked={selected[0] === option.id}
              onChange={() => { setSelected([option.id]); setFailure(null); }} className="mt-1" />
            <span className="break-words">{option.label}</span>
          </label>)} </>}
        </fieldset>
        {!review ? <button type="submit" disabled={!choice || vote.isPending} className="mt-4 ui-button">Review submission</button> :
          <div className="mt-5 surface-inset" role="region" aria-label="Confirm vote">
            <p>Submit {ranked ? "this ranking, in this order" : "this choice"}? Your vote cannot be changed after submission.</p>
            <ol className="my-3 list-decimal pl-5">{choices.map((o) => <li key={o.id} className="break-words">{o.label}</li>)}</ol>
            <div className="mt-4 action-row">
              <button type="button" disabled={vote.isPending || !choice} className="ui-button ui-button-primary"
                onClick={() => { if (choice && !vote.isPending) { setFailure(null); vote.mutate([...selected]); } }}>{vote.isPending ? "Submitting…" : "Confirm submission"}</button>
              <button type="button" disabled={vote.isPending} className="underline" onClick={() => setReview(false)}>Back</button>
            </div>
          </div>}
      </form>}
  </div>;
}

export function VotePage() {
  const { ballotId = "" } = useParams();
  const [params] = useSearchParams();
  const candidate = safeReturnTo(params.get("returnTo"), "/ballots");
  const back = candidate.split("?")[0] === "/ballots" ? candidate : "/ballots";
  const ballot = useQuery({ queryKey: ["my-ballot", ballotId], queryFn: ({ signal }) => getMyBallot(ballotId, signal), retry: false, networkMode: "always", gcTime: 0 });
  return <main className="page-shell page-narrow">
    <Link to={back} className="back-link">Back to your ballots</Link>
    {ballot.isPending ? <p role="status" className="mt-6">Loading ballot…</p> : ballot.isError ? <div className="mt-6">
      <p role="alert">{ballot.error.message}</p><Link to={loginUrl(`/ballots/${ballotId}?${params}`)} className="mt-3 inline-block underline">Sign in</Link>
      <button className="ml-4 underline" disabled={ballot.isFetching} onClick={() => void ballot.refetch()}>Refresh status</button>
    </div> : <>
      <div className="mt-8 flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words pt-1 supporting-copy">{ballot.data.meeting_title}</p>
        <StatusBadge tone={ballot.data.invalidated_at ? "danger" : ballot.data.state === "OPEN" ? "success" : ballot.data.state === "PUBLISHED" ? "accent" : "neutral"}>{ballot.data.invalidated_at ? "Invalidated" : ballotStateLabels[ballot.data.state]}</StatusBadge>
      </div>
      <h1 className="mt-4 page-title">{ballot.data.question}</h1>
      {ballot.data.description && <p className="mt-4 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">{ballot.data.description}</p>}
      <p className="mt-5 supporting-copy"><span className="font-medium text-foreground">{ballot.data.participation_count}</span> {ballot.data.participation_count === 1 ? "submission" : "submissions"}{ballot.data.state !== "PUBLISHED" && " · Results haven’t been published"}</p>
      <button className="mt-3 text-sm underline disabled:opacity-50" disabled={ballot.isFetching} onClick={() => void ballot.refetch()}>Refresh status</button>
      <VoteForm key={ballotId} ballot={ballot.data} />
      <InvalidationNotice value={ballot.data} />
      {ballot.data.state === "PUBLISHED" && <ResultsPanel ballotId={ballotId} />}
      <details className="mt-8 supporting-copy"><summary className="w-fit cursor-pointer">Vote privacy</summary><p className="mt-2">Your choice isn’t shown to other members or officers. It is not cryptographically anonymous from the people operating the server or database.</p></details>
    </>}
  </main>;
}
