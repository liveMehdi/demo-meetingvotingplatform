from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
)

from app.modules.members.models import MembershipStatus

EligibilityPolicy = Literal["all_approved", "attending_approved"]
MeetingState = Literal["PLANNED", "LIVE", "ENDED", "CANCELLED"]


class EligibilitySettingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eligibility_policy: EligibilityPolicy
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class MeetingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    scheduled_at: AwareDatetime

    @field_validator("scheduled_at", mode="before")
    @classmethod
    def require_datetime(cls, value):
        # accepting date strings or datetime values, not numeric timestamps
        if not isinstance(value, str | datetime):
            raise ValueError("Include a timezone offset with the date and time.")

        return value

    @field_validator("scheduled_at")
    @classmethod
    def representable_utc(cls, value: datetime) -> datetime:
        try:
            return value.astimezone(UTC)

        except (OverflowError, ValueError):
            raise ValueError("The date and time are outside the supported range.") from None


class MeetingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: str
    scheduled_at: datetime
    created_at: datetime

    eligibility_policy: EligibilityPolicy
    eligibility_revision: int
    eligibility_locked_at: datetime | None

    state: MeetingState
    revision: int
    needs_status_review: bool

    started_at: datetime | None
    ended_at: datetime | None
    cancelled_at: datetime | None

    @field_validator("eligibility_locked_at", "started_at", "ended_at", "cancelled_at")
    @classmethod
    def optional_utc(cls, value: datetime | None) -> datetime | None:
        return value.astimezone(UTC) if value else None

    @field_validator("scheduled_at", "created_at")
    @classmethod
    def utc_response(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)


class MeetingsPage(BaseModel):
    items: list[MeetingResponse]
    total: int
    offset: int
    limit: int


class MeetingUpdate(MeetingCreate):
    expected_revision: Annotated[StrictInt, Field(ge=1)]


class MeetingTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["start", "end", "cancel"]
    expected_revision: Annotated[StrictInt, Field(ge=1)]
    preview_token: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")] | None = None
    confirm_cancel_drafts: StrictBool = False


class DraftWithdrawal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: Annotated[StrictInt, Field(ge=1)]


class CompletionSummary(BaseModel):
    open_formal: int
    open_polls: int
    drafts: int
    nomination_windows: int
    unpublished_results: int
    ever_opened: bool
    preview_token: str


class MeetingChangeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    revision: int
    title: str
    description: str
    scheduled_at: datetime

    state: MeetingState
    kind: str

    recorded_by: UUID | None
    recorded_at: datetime


class MeetingHistory(BaseModel):
    items: list[MeetingChangeResponse]
    total: int
    offset: int
    limit: int


class AttendanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    present: StrictBool
    expected_revision: Annotated[StrictInt, Field(ge=0)]


class AttendanceMember(BaseModel):
    user_id: UUID
    email: str
    membership_status: MembershipStatus
    present: bool
    revision: int


class AttendanceChangeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    revision: int
    present: bool

    recorded_by: UUID
    recorded_at: datetime


class AttendanceHistory(BaseModel):
    items: list[AttendanceChangeResponse]
    total: int
    offset: int
    limit: int


class AttendancePage(BaseModel):
    items: list[AttendanceMember]
    total: int
    offset: int
    limit: int

    present_count: int
    approved_present_count: int

    final_present_count: int | None = None
    final_approved_present_count: int | None = None

    quorum_status: Literal["not_configured"] = "not_configured"
