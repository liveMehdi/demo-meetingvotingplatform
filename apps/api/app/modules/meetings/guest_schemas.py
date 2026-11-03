from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
)


class GuestJoiningUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: StrictBool
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class GuestJoiningStatus(BaseModel):
    enabled: bool
    code: str | None
    revision: int


class GuestJoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Annotated[
        str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=10, max_length=10)
    ]

    @field_validator("code")
    @classmethod
    def valid_code(cls, value: str) -> str:
        if len(value) != 10 or any(
            char not in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" for char in value
        ):
            raise ValueError("Enter the 10-character meeting code.")

        return value


class GuestMeetingResponse(BaseModel):
    state: str
    meeting_id: UUID
    title: str

    scheduled_at: datetime
    session_expires_at: datetime

    @field_validator("scheduled_at", "session_expires_at")
    @classmethod
    def utc_time(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)
