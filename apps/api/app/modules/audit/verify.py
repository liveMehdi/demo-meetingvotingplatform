"""Checking audit exports offline against a separate checkpoint"""

import argparse
import json
from pathlib import Path

from pydantic import ValidationError

from app.modules.audit.proof import AuditExport, Checkpoint, VerificationError, verify

MAX_FILE_BYTES = 64 * 1024 * 1024


def unique_keys(pairs):
    result = {}

    for key, value in pairs:
        if key in result:
            raise VerificationError("JSON contains duplicate keys.")

        result[key] = value

    return result


def load_json(path: Path):
    with path.open("rb") as source:
        data = source.read(MAX_FILE_BYTES + 1)

    if len(data) > MAX_FILE_BYTES:
        raise VerificationError("Verification file exceeds the 64 mb limit.")

    return json.loads(data, object_pairs_hook=unique_keys)


def main(argv=None) -> int:

    parser = argparse.ArgumentParser(
        description=(
            "Verify an audit export against an independently retained checkpoint, "
            "no database or network access."
        )
    )
    parser.add_argument("--export", type=Path, required=True)

    parser.add_argument(
        "--checkpoint",
        type=Path,
        required=True,
        help="Trusted file kept separately, don't blindly trust a checkpoint from the export.",
    )

    args = parser.parse_args(argv)
    try:
        result = verify(
            AuditExport.model_validate(load_json(args.export)),
            Checkpoint.model_validate(load_json(args.checkpoint)),
        )
    except VerificationError as exc:
        print(f"Verification failed: {exc}")
        return 1
    except (OSError, ValueError, ValidationError, RecursionError):
        print("Verification failed: unreadable or invalid input.")
        return 1
    print(f"Trusted checkpoint matched through event {result['anchored_through']}.")
    print(
        f"Events: {result['events']}; imported: {result['legacy_events']} "
        "(pre-import integrity not verified)."
    )
    if result["unanchored_events"]:
        print(
            f"Beyond checkpoint: {result['unanchored_events']} events (consistency checked only)."
        )
    print("Logging completeness and vote counting are not verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
