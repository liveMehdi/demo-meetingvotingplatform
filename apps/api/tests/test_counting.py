from uuid import UUID

import pytest

from app.modules.ballots.ranked import count_irv
from app.modules.ballots.results_service import outcome
from app.modules.ballots.schemas import OptionTotal

A, B, C, OTHER = [UUID(int=i) for i in (2, 4, 6, 8)]


def test_irv_without_votes_has_no_winner():
    assert count_irv([A, B, C], []) == ("no_votes", [], [])


def test_irv_first_preference_majority():
    result, leaders, rounds = count_irv([A, B, C], [[A], [A, B], [B]])

    assert (result, leaders) == ("winner", [A])
    assert len(rounds) == 1
    assert rounds[0].counts == {A: 2, B: 1, C: 0}
    assert rounds[0].majority_required == 2


def test_irv_transfers_preferences_to_a_new_winner():
    rankings = [[A]] * 4 + [[B]] * 3 + [[C, B]] * 2

    result, leaders, rounds = count_irv([A, B, C], rankings)

    assert (result, leaders) == ("winner", [B])
    assert [r.counts for r in rounds] == [{A: 4, B: 3, C: 2}, {A: 4, B: 5}]
    assert rounds[0].eliminated_option_id == C


def test_irv_exhausted_ballots_reduce_majority_denominator():
    result, leaders, rounds = count_irv([A, B, C], [[A]] * 3 + [[B]] * 2 + [[C]])

    assert (result, leaders) == ("winner", [A])
    assert rounds[-1].exhausted_count == 1
    assert rounds[-1].continuing_count == 5
    assert rounds[-1].majority_required == 3


def test_irv_elimination_tie_preserves_all_continuing_candidates():
    # candidate a leads but needs more votes to win, while b and c tie for last place
    result, leaders, rounds = count_irv([A, B, C], [[A]] * 4 + [[B]] * 3 + [[C]] * 3)

    assert result == "unresolved_tie"
    assert leaders == [A, B, C]
    assert len(rounds) == 1
    assert rounds[0].eliminated_option_id is None


@pytest.mark.parametrize("ranking", [[], [A, A], [OTHER]])
def test_irv_rejects_invalid_rankings(ranking):
    with pytest.raises(ValueError, match="Invalid ranking"):
        count_irv([A, B, C], [ranking])


@pytest.mark.parametrize(
    "counts, expected", [([0, 0], "no_votes"), ([2, 2], "runoff"), ([3, 2], "winner")]
)
def test_standard_election_outcomes(counts, expected):
    options = [
        OptionTotal(id=id_, label=str(id_), position=i, code=None, count=count)
        for i, (id_, count) in enumerate(zip([A, B], counts, strict=True))
    ]

    result, leaders = outcome("election", options)
    assert result == expected
    assert leaders == {"no_votes": [], "runoff": [A, B], "winner": [A]}[expected]


@pytest.mark.parametrize(
    "counts, expected", [([3, 2, 10], "passed"), ([2, 2, 0], "failed"), ([0, 0, 5], "failed")]
)
def test_motion_requires_more_for_than_against(counts, expected):
    options = [
        OptionTotal(id=id_, label=code, position=i, code=code, count=count)
        for i, (id_, code, count) in enumerate(
            zip([A, B, C], ["for", "against", "abstain"], counts, strict=True)
        )
    ]

    assert outcome("motion", options) == (expected, [])
