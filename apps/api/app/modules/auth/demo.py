from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User


class DemoAccountProtected(Exception):
    pass


def is_demo_account(session: AsyncSession, user: User) -> bool:
    email = session.info.get("demo_admin_email")
    return bool(email and user.email.lower() == email.lower())


def protect_demo_account(session: AsyncSession, user: User) -> None:
    if is_demo_account(session, user):
        raise DemoAccountProtected("The shared demo admin account is protected from this change.")
