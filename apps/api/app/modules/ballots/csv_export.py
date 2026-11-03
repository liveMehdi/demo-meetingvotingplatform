import csv
import io
import unicodedata
from datetime import UTC

from fastapi import Response

from app.modules.ballots.schemas import PublishedResults


def spreadsheet_label(value: str) -> str:
    probe = value
    while probe and (
        probe[0].isspace() or unicodedata.category(probe[0]).startswith("C") or probe[0] == "'"
    ):
        probe = probe[1:]

    if value and (
        value[0] in "\t\r\n'"
        or unicodedata.category(value[0]).startswith("C")
        or probe.startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))
    ):
        return "Text: " + value
    return value


def with_invalidation(contents: str, result: PublishedResults) -> bytes:
    if result.invalidated_at is None:
        return contents.encode("utf-8-sig")
    
    rows = list(csv.reader(io.StringIO(contents)))
    output = io.StringIO(newline="")

    writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(rows[0] + ["invalidated_at_utc", "invalidation_reason"])
    
    for row in rows[1:]:
        writer.writerow(
            row
            + [
                result.invalidated_at.astimezone(UTC).isoformat(),
                spreadsheet_label(result.invalidation_reason or ""),
            ]
        )

    return output.getvalue().encode("utf-8-sig")


def render_results_csv(result: PublishedResults) -> bytes:
    """Exporting published totals after access has been checked"""
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    if result.counting_method == "irv_v1":
        writer.writerow(
            [
                "ballot_id",
                "counting_method",
                "published_at_utc",
                "outcome",
                "participation_count",
                "eligible_count",
                "eligible_attendance_count",
                "quorum_status",
                "round",
                "continuing_votes",
                "exhausted_ballots",
                "majority_required",
                "option_id",
                "option_label",
                "votes",
                "eliminated",
                "winner_or_new_election_candidate",
            ]
        )

        for round_ in result.rounds or [None]:
            for option in result.options:
                if round_ is not None and option.id not in round_.counts:
                    continue

                writer.writerow(
                    [
                        str(result.ballot_id),
                        result.counting_method,
                        result.published_at.astimezone(UTC).isoformat(),
                        result.outcome,
                        result.participation_count,
                        result.eligible_count,
                        result.eligible_attendance_count,
                        result.quorum_status,
                        round_.number if round_ else 0,
                        round_.continuing_count if round_ else 0,
                        round_.exhausted_count if round_ else 0,
                        round_.majority_required if round_ else "",
                        str(option.id),
                        spreadsheet_label(option.label),
                        round_.counts[option.id] if round_ else 0,
                        "true" if round_ and round_.eliminated_option_id == option.id else "false",
                        "true" if option.id in result.leading_option_ids else "false",
                    ]
                )
        return with_invalidation(output.getvalue(), result)
    writer.writerow(
        [
            "ballot_id",
            "kind",
            "published_at_utc",
            "outcome",
            "participation_count",
            "eligible_count",
            "eligible_attendance_count",
            "quorum_status",
            "option_id",
            "option_label",
            "option_code",
            "votes",
            "is_leading_option",
        ]
        
    )

    for option in result.options:
        writer.writerow(
            [
                str(result.ballot_id),
                result.kind,
                result.published_at.astimezone(UTC).isoformat(),
                result.outcome,
                result.participation_count,
                result.eligible_count,
                result.eligible_attendance_count,
                result.quorum_status,
                str(option.id),
                spreadsheet_label(option.label),
                option.code or "",
                option.count,
                "true" if option.id in result.leading_option_ids else "false",
            ]
        )
    return with_invalidation(output.getvalue(), result)


def csv_response(result: PublishedResults) -> Response:

    return Response(

        content=render_results_csv(result),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="ballot-{result.ballot_id}-results.csv"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
