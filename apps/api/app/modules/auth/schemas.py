from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator

from app.modules.members.models import MembershipStatus


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    email: Annotated[EmailStr, Field(max_length=254)]
    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, email: str) -> str:
        return email.strip().lower()


class RegistrationRequest(LoginRequest):

    password: Annotated[SecretStr, Field(min_length=12, max_length=128)]


class RegistrationResponse(BaseModel):
    id: UUID
    email: str
    membership_status: Literal["pending"]


class CurrentUserResponse(BaseModel):
    id: UUID
    email: str
    is_admin: bool
    is_officer: bool
    membership_status: MembershipStatus | None



class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    code: Annotated[SecretStr, Field(min_length=43, max_length=43)]
    password: Annotated[SecretStr, Field(min_length=12, max_length=128)]
