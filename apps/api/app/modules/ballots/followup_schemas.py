from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class FollowupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["runoff", "replacement"]
    meeting_id: UUID
    expected_revision: Annotated[StrictInt, Field(ge=1)]
    expected_meeting_revision: Annotated[StrictInt, Field(ge=1)]


class ElectionLink(BaseModel):
    kind: str
    invalidated_at: str | None = None
    id: UUID
    meeting_id: UUID
    question: str
    state: str


class FollowupPreview(BaseModel):
    source: ElectionLink
    revision: int
    kind: Literal["runoff", "replacement"] | None
    candidates: list[str]
    candidate_source: Literal["manual", "nominations"]
    counting_method: Literal["standard", "irv_v1"]
    predecessor: ElectionLink | None
    successor: ElectionLink | None
