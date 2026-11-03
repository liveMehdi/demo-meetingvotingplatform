from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Header, HTTPException
from starlette.requests import HTTPConnection


async def require_csrf(
    request: HTTPConnection,
    csrf_protection: Annotated[
        str | None,
        Header(alias="X-CSRF-Protection", description="Send 1 for POST/PUT/PATCH/DELETE requests."),
    ] = None,
) -> None:
    """Protecting mutations"""
    if request.scope["type"] == "websocket":
        return
    if request.scope["method"] in {"GET", "HEAD", "OPTIONS"}:
        return

    origin = request.headers.get("origin")
    if origin is None:
        try:
            referer = urlsplit(request.headers.get("referer", ""))
            origin = f"{referer.scheme}://{referer.netloc}"
        except ValueError:
            origin = None

    if (
        csrf_protection != "1"
        or origin not in request.app.state.settings.allowed_origins
        or request.headers.get("sec-fetch-site") == "cross-site"
    ):
        raise HTTPException(
            status_code=403, detail="Request blocked. Refresh the page and try again."
        )
