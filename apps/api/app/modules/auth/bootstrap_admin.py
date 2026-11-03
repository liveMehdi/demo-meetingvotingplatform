"""Setting up the first admin manually, not during registration or app startup"""

import argparse
import asyncio
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import build_engine
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.models import User


class BootstrapRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=254)]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, email: str) -> str:
        return email.strip().lower()


class BootstrapError(Exception):
    """A reason admin setup cannot continue."""


async def bootstrap_first_admin(session: AsyncSession, request: BootstrapRequest) -> None:
    async with session.begin():
        # Locking users so two setup commands cant both create the first admin
        await session.execute(text("LOCK TABLE users IN EXCLUSIVE MODE"))
        if await session.scalar(select(User.id).where(User.is_admin).limit(1)) is not None:
            raise BootstrapError("Admin already exists.")
        
        user = await session.scalar(select(User).where(User.email == str(request.email)))

        if user is None:
            raise BootstrapError("Account not found. Register it first.")
        
        user.is_admin = True

        await record(session, AuditAction.ADMIN_BOOTSTRAPPED, None, user.id)
        # Membership apprtoval and officer access stay unchanged


async def run_bootstrap(request: BootstrapRequest) -> None:
    engine = build_engine(Settings().require_database_url())
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            await bootstrap_first_admin(session, request)
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Promote an existing registered account only when no administrator exists."
    )
    parser.add_argument(
        "--email", required=True, help="The registered email to promote explicitly."
    )
    args = parser.parse_args()
    try:
        request = BootstrapRequest(email=args.email)
    except ValidationError:
        print("Invalid email address.")
        return 1
    
    try:
        asyncio.run(run_bootstrap(request))
    except BootstrapError as exc:
        print(str(exc))
        return 1
    
    except Exception as exc:
        print(f"Admin setup failed ({type(exc).__name__}).")
        return 1
    
    print("Admin access granted. Membership and officer access remainunchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
