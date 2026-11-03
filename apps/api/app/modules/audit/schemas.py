from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.modules.audit.models import AuditAction


class AuditResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    occurred_at: datetime
    action: AuditAction
    actor_id: UUID | None
    target_id: UUID
    meeting_id: UUID | None

    @field_validator("occurred_at")
    
    @classmethod
    def utc_time(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)


class AuditPage(BaseModel):
    items: list[AuditResponse]
    total: int
    offset: int
    limit: int
