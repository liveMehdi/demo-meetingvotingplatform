"""Counting ranked votes using irv_v1, without db access or identity data."""

from uuid import UUID

from app.modules.ballots.schemas import RankedRound


def count_irv(
    candidates: list[UUID], rankings: list[list[UUID]]
) -> tuple[str, list[UUID], list[RankedRound]]:
    if not 2 <= len(candidates) <= 50 or len(set(candidates)) != len(candidates):
        raise ValueError("Invalid candidates")
    
    allowed = set(candidates)
    if any(not r or len(set(r)) != len(r) or not set(r) <= allowed for r in rankings):
        raise ValueError("Invalid ranking")
    
    if not rankings:
        return "no_votes", [], []
    
    continuing = list(candidates)

    rounds = []

    while continuing:
        counts = dict.fromkeys(continuing, 0)

        for ranking in rankings:
            choice = next((c for c in ranking if c in counts), None)
            if choice is not None:
                counts[choice] += 1

        active = sum(counts.values())
        round_ = RankedRound(
            number=len(rounds) + 1,
            counts=counts,
            continuing_count=active,
            exhausted_count=len(rankings) - active,
            majority_required=active // 2 + 1,
        )

        rounds.append(round_)
        if active == 0:
            raise ValueError("No continuing votes in a nonempty valid count")
        
        winners = [c for c in continuing if counts[c] * 2 > active]

        if winners:
            return "winner", winners, rounds
        lowest = min(counts.values())

        tied = [c for c in continuing if counts[c] == lowest]

        if len(tied) != 1:
            # new election includes all continuing candidates and not just tied lowest candidates.
            return "unresolved_tie", continuing, rounds
        round_.eliminated_option_id = tied[0]
        continuing.remove(tied[0])

    raise ValueError("Invalid count")
