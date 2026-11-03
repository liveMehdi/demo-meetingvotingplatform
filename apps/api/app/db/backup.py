"""Custom archive backup, existing files won't be overwritten"""

import argparse
import os
import shutil
import subprocess
from pathlib import Path

from sqlalchemy.engine import make_url

from app.core.config import Settings


def executable(name: str, directory: Path | None = None) -> str:
    candidate = directory / (name + (".exe" if os.name == "nt" else "")) if directory else None
    found = str(candidate) if candidate and candidate.is_file() else shutil.which(name)
    if not found:
        raise RuntimeError(f"{name} not found, check PATH or --pg-bin.")
    return found


def pg_environment(url: str) -> dict[str, str]:
    parsed = make_url(url)
    return {
        **os.environ,
        "PGHOST": parsed.host or "localhost",
        "PGPORT": str(parsed.port or 5432),
        "PGUSER": parsed.username or "",
        "PGPASSWORD": parsed.password or "",
        "PGDATABASE": parsed.database or "",
        "PGCONNECT_TIMEOUT": "5",
    }


def backup(url: str, path: Path, pg_bin: Path | None = None, *, schema: str | None = None):
    command = [
        executable("pg_dump", pg_bin),
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--no-password",
    ]
    if schema:
        command.append(f"--schema={schema}")
    with path.open("xb") as archive:
        result = subprocess.run(
            command,
            env=pg_environment(url),
            stdout=archive,
            stderr=subprocess.PIPE,
            timeout=300,
            check=False,
        )
    if result.returncode:
        raise RuntimeError("Backup failed, output is incomplete. Don't restore.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path)
    args = parser.parse_args()
    try:
        backup(Settings().require_database_url(), args.output, args.pg_bin)
    except FileExistsError:
        print("Output file already exists")
        return 1
    except Exception as exc:
        print(f"Backup failed ({type(exc).__name__})- output may be incomplete. Don't restore.")
        return 1
    print("Backup saved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
