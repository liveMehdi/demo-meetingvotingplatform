"""starting the backend with test accounts and a temporary database area"""

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager

import uvicorn

from app.core.config import Settings
from app.main import create_app
from app.modules.auth.models import User
from app.modules.auth.service import password_hasher
from app.modules.members.models import Membership, MembershipStatus
from tests.database import isolated_database


async def main():
    async with AsyncExitStack() as resources:
        
        factory = await resources.enter_async_context(isolated_database())

        password = password_hasher.hash("purpleblue4112")

        async with factory() as session, session.begin():
            for role, name in (("officer", "shan"), ("member", "jonny"), ("admin", "tyrone")):
                user = User(
                    email=f"{name}@example.org",
                    password_hash=password,
                    is_officer=role in {"officer", "admin"},
                    is_admin=role == "admin",
                )

                session.add(user)

                await session.flush()

                session.add(Membership(user_id=user.id, status=MembershipStatus.APPROVED))

        app = create_app(
            Settings(
                _env_file=None,
                database_url=None,
                app_env="development",
                web_dist_dir=None,
                allowed_origins=["http://127.0.0.1:5174"],
                demo_admin_email="tyrone@example.org",
                demo_admin_password="purpleblue4112",
            )
        )

        original = app.router.lifespan_context

        @asynccontextmanager
        async def lifespan(app):
            async with original(app):
                app.state.session_factory = factory

                yield

        app.router.lifespan_context = lifespan

        server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=8001, access_log=False, log_level="warning")
        )

        # removing the test data before stopping the servers
        # windows can stop the server before python gets to clean up
        @app.post("/__test__/shutdown")
        async def shutdown():
            await resources.aclose()

            server.should_exit = True

            return {"stopped": True}

        await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
