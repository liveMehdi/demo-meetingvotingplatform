from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

from app.modules.members.models import MembershipStatus


class MemberResponse(BaseModel):
    is_demo_account: bool = False
    id: UUID
    email: str
    is_admin: bool
    is_officer: bool
    is_suspended: bool
    security_revision: int
    membership_status: MembershipStatus | None
    created_at: datetime


class MembersPage(BaseModel):
    items: list[MemberResponse]
    total: int
    offset: int
    limit: int


class MembershipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["approved", "revoked"]


class OfficerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_officer: StrictBool


class SecurityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal[
        "suspend", "restore", "grant_admin", "remove_admin", "revoke_sessions", "issue_reset"
    ]
    expected_revision: StrictInt = Field(ge=1)
