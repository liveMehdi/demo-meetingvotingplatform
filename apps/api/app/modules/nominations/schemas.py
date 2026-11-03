from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictInt, model_validator

from app.modules.ballots.schemas import OptionLabel


class NominationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nominee_email: EmailStr
    candidate_name: OptionLabel


class WindowUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Literal["OPEN", "CLOSED"]
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class NomineeDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["accept", "withdraw"]
    expected_revision: Annotated[StrictInt, Field(ge=1)]
    candidate_name: OptionLabel | None = None

    @model_validator(mode="after")
    def consent_name(self) -> Self:
        if (self.action == "accept") != (self.candidate_name is not None):
            raise ValueError("Provide the candidate name only when accepting a nomination.")
        return self


class OfficerDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["approve", "reject"]
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class NominationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    ballot_id: UUID
    nominee_id: UUID
    nominator_id: UUID
    candidate_name: str
    status: Literal["PENDING_CONSENT", "PENDING_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"]
    revision: int
    nominee_email: str | None = None


class NominationsPage(BaseModel):
    items: list[NominationResponse]
    total: int


class NominationContest(BaseModel):
    is_runoff: bool = False
    ballot_state: Literal["DRAFT", "CANCELLED"]
    id: UUID
    question: str
    nomination_state: Literal["OPEN", "CLOSED"]
    meeting_title: str


class ContestsPage(BaseModel):
    items: list[NominationContest]
    total: int
