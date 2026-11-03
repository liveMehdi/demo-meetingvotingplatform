from pathlib import Path

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class FrontendFiles(StaticFiles):

    def __init__(self, directory: Path):
        if not (directory / "index.html").is_file():
            raise RuntimeError("Missing index.html in WEB_DIST_DIR")
        super().__init__(directory=directory)

    async def get_response(self, path: str, scope: Scope) -> Response:
        parts = scope["path"].strip("/").split("/")
        if (
            parts[0] in {"api", "ws", "docs", "redoc", "openapi.json"}
            or any(part.startswith(".") for part in parts if part)
            or "\\" in scope["path"]
        ):
            raise HTTPException(status_code=404)

        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if (
                exc.status_code != 404
                or scope["method"] not in {"GET", "HEAD"}
                or "text/html" not in Headers(scope=scope).get("accept", "")
                or parts[0] == "assets"
                or Path(path).suffix
            ):
                raise
            response = await super().get_response("index.html", scope)

        response.headers["Cache-Control"] = (
            "no-store"
            if response.headers.get("content-type", "").startswith("text/html")
            else "no-cache"
        )
        return response
