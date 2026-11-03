from datetime import UTC, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.modules.meetings.schemas import EligibilityPolicy

OptionLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class DraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["election", "motion"]
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    options: Annotated[list[OptionLabel], Field(max_length=50)] = []
    candidate_source: Literal["manual", "nominations"] = "manual"
    counting_method: Literal["standard", "irv_v1"] = "standard"

    @model_validator(mode="after")
    def valid_options(self) -> Self:
        if self.counting_method != "standard" and self.kind != "election":
            raise ValueError("Ranked counting is only available for elections.")
        
        if self.candidate_source == "nominations":
            if self.kind != "election" or self.options:
                raise ValueError("Add candidates through nominations, not the options field.")
            return self
        
        if self.kind == "motion" and self.options:
            raise ValueError("Motion options are automatic. Leave the options field empty.")
        
        if self.kind == "election":
            if len(self.options) < 2:
                raise ValueError("Elections require 2–50 options.")
            
            if len({label.casefold() for label in self.options}) != len(self.options):
                raise ValueError(
                    "Use unique candidate names, ignoring capitals and surrounding spaces."
                )
            
        return self


class DraftUpdate(DraftInput):
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class PollDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["poll_single", "poll_multiple"]
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    options: Annotated[list[OptionLabel], Field(min_length=2, max_length=50)]
    min_selections: Annotated[StrictInt, Field(ge=1, le=50)] = 1
    max_selections: Annotated[StrictInt, Field(ge=1, le=50)] = 1

    @model_validator(mode="after")
    def valid_poll(self) -> Self:
        if len({label.casefold() for label in self.options}) != len(self.options):
            raise ValueError("Use unique option names, ignoring capitals and surrounding spaces.")
        
        if not self.min_selections <= self.max_selections <= len(self.options):
            raise ValueError("Check the minimum and maximum choices against the available options.")
        
        if self.kind == "poll_single" and (self.min_selections, self.max_selections) != (1, 1):
            raise ValueError("Single-choice polls require exactly one selection.")
        
        if self.kind == "poll_multiple" and self.max_selections < 2:
            raise ValueError("Multiple-choice polls must allow at least two selections.")
        return self


class PollDraftUpdate(PollDraftInput):
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class PollOpen(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class BallotOpen(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Annotated[StrictInt, Field(ge=1)]
    expected_eligibility_revision: Annotated[StrictInt, Field(ge=1)]


class OptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    label: str
    position: int
    code: Literal["for", "against", "abstain"] | None


class InvalidationInfo(BaseModel):
    invalidated_at: datetime | None = None
    invalidation_reason: str | None = None


class InvalidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Annotated[StrictInt, Field(ge=1)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    confirm: Literal[True]


class BallotResponse(InvalidationInfo):
    predecessor_id: UUID | None = None
    followup_kind: Literal["runoff", "replacement"] | None = None
    id: UUID
    meeting_id: UUID
    kind: Literal["election", "motion", "poll_single", "poll_multiple"]
    state: Literal["DRAFT", "OPEN", "CLOSED", "PUBLISHED", "CANCELLED"]
    question: str
    description: str
    min_selections: int
    max_selections: int
    revision: int
    candidate_source: Literal["manual", "nominations"] = "manual"
    counting_method: Literal["standard", "irv_v1"] = "standard"
    nomination_state: Literal["NOT_OPEN", "OPEN", "CLOSED"] = "NOT_OPEN"
    options: list[OptionResponse]
    opened_at: datetime | None
    eligibility_policy: EligibilityPolicy | None
    eligible_count: int | None
    eligible_attendance_count: int | None
    participation_count: int = 0
    closed_at: datetime | None = None
    published_at: datetime | None = None

    @field_validator("opened_at", "closed_at", "published_at")
    @classmethod
    def utc_opened_at(cls, value: datetime | None) -> datetime | None:
        return value.astimezone(UTC) if value else None


class BallotsPage(BaseModel):
    items: list[BallotResponse]
    total: int
    offset: int
    limit: int


class VoteSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    option_ids: Annotated[list[UUID], Field(min_length=1, max_length=50)]


class SubmissionReceipt(BaseModel):
    submitted: Literal[True] = True
    already_submitted: bool


class MemberBallot(InvalidationInfo):
    id: UUID
    meeting_title: str
    question: str
    description: str
    kind: Literal["election", "motion"]
    counting_method: Literal["standard", "irv_v1"] = "standard"
    state: Literal["OPEN", "CLOSED", "PUBLISHED"]
    options: list[OptionResponse]
    submitted: bool
    participation_count: int


class MemberBallotsPage(BaseModel):
    items: list[MemberBallot]
    total: int
    offset: int
    limit: int


class OptionTotal(OptionResponse):
    count: int


class GuestPoll(InvalidationInfo):
    id: UUID
    question: str
    description: str
    kind: Literal["poll_single", "poll_multiple"]
    state: Literal["OPEN", "CLOSED"]
    min_selections: int
    max_selections: int
    options: list[OptionTotal]
    submitted: bool
    participation_count: int


class GuestPollsPage(BaseModel):
    items: list[GuestPoll]
    total: int
    offset: int
    limit: int


class PollResults(InvalidationInfo):
    ballot_id: UUID
    state: Literal["OPEN", "CLOSED"]
    participation_count: int
    options: list[OptionTotal]


class PollPresentation(PollResults):
    meeting_state: str
    meeting_title: str
    question: str
    description: str
    kind: Literal["poll_single", "poll_multiple"]
    min_selections: int
    max_selections: int


class RankedRound(BaseModel):
    number: int
    counts: dict[UUID, int]
    continuing_count: int
    exhausted_count: int
    majority_required: int
    eliminated_option_id: UUID | None = None


class PublishedResults(InvalidationInfo):
    ballot_id: UUID
    kind: Literal["election", "motion"]
    published_at: datetime
    options: list[OptionTotal]
    participation_count: int
    eligible_count: int
    eligible_attendance_count: int
    quorum_status: Literal["not_configured"] = "not_configured"
    outcome: Literal["passed", "failed", "winner", "runoff", "no_votes", "unresolved_tie"]
    leading_option_ids: list[UUID]
    counting_method: Literal["standard", "irv_v1"] = "standard"
    rounds: list[RankedRound] = []
