from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.modules.audit import service
from app.modules.audit.proof import VerificationError
from app.modules.audit.schemas import AuditPage
from app.modules.members.router import Admin, Database, permission_error

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/export")
async def export(admin: Admin, session: Database):
    try:
        bundle = await service.export_events(session, admin.id)

    except service.AuditAccessDenied:

        raise permission_error() from None
    except service.AuditExportUnavailable as exc:

        raise HTTPException(status_code=409, detail=str(exc)) from None
    
    except VerificationError:

        raise HTTPException(
            status_code=409,
            detail=(
                "Audit checks failed and no export was created. "
                "Don't make any changes to db until investigated."
            ),
        ) from None
    
    filename = f"audit-{bundle.checkpoint.sequence}.json"

    return Response(
        content=bundle.model_dump_json(),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("", response_model=AuditPage)

async def listing(
    admin: Admin,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,

) -> AuditPage:
    
    try:
        return await service.list_events(session, admin.id, offset, limit)
    except service.AuditAccessDenied:
        raise permission_error() from None
