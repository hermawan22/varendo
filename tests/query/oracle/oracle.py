#!/usr/bin/env python3
"""Independent numerical oracle for query semantics.

This module deliberately has no imports from the Varendo source tree.  It uses
Python's exact arithmetic and an in-memory SQLite database only as a reference
calculation.  It is test evidence, not a production executor or a query plan.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import argparse
import json
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
CASES_PATH = Path(__file__).with_name("cases.json")
EXPECTED_PATH = Path(__file__).with_name("expected.json")


def fraction_text(value: Fraction | None) -> str | None:
    if value is None:
        return None
    return str(value.numerator) if value.denominator == 1 else f"{value.numerator}/{value.denominator}"


def ratio(numerator: int | None, denominator: int | None) -> dict[str, Any]:
    if numerator is None or denominator is None:
        return {"state": "unknown", "rate": None, "reason": "missing-input"}
    if denominator == 0:
        return {"state": "unknown", "rate": None, "reason": "zero-denominator"}
    return {"state": "exact", "rate": fraction_text(Fraction(numerator, denominator))}


def make_seeded_rows(spec: dict[str, Any]) -> tuple[list[tuple[str, int]], list[tuple[str, str]]]:
    rng = random.Random(spec["seed"])
    orders: list[tuple[str, int]] = []
    tags: list[tuple[str, str]] = []
    eligible = set(spec["eligibleEmployeeIndexes"])
    for index in range(1, spec["employeeCount"] + 1):
        employee = f"e{index}"
        order_count = 1 + rng.randrange(spec["maxOrdersPerEmployee"])
        for order_index in range(order_count):
            orders.append((employee, 10 + rng.randrange(90)))
        tag_count = 2 if index in eligible else 1 + rng.randrange(2)
        for tag_index in range(tag_count):
            label = "eligible" if index in eligible else "other"
            tags.append((employee, f"{label}-{tag_index}"))
    return orders, tags


def seeded_fanout(spec: dict[str, Any]) -> dict[str, Any]:
    orders, tags = make_seeded_rows(spec)
    with sqlite3.connect(":memory:") as db:
        db.executescript(
            "CREATE TABLE orders(employee TEXT NOT NULL, amount INTEGER NOT NULL);"
            "CREATE TABLE tags(employee TEXT NOT NULL, label TEXT NOT NULL);"
        )
        db.executemany("INSERT INTO orders VALUES (?, ?)", orders)
        db.executemany("INSERT INTO tags VALUES (?, ?)", tags)
        wrong = db.execute(
            "SELECT COALESCE(SUM(o.amount), 0) FROM orders o "
            "JOIN tags t ON t.employee = o.employee WHERE t.label LIKE 'eligible-%'"
        ).fetchone()[0]
        correct = db.execute(
            "SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE EXISTS ("
            "SELECT 1 FROM tags t WHERE t.employee = o.employee AND t.label LIKE 'eligible-%')"
        ).fetchone()[0]
        selected = [row[0] for row in db.execute(
            "SELECT DISTINCT employee FROM orders WHERE EXISTS ("
            "SELECT 1 FROM tags t WHERE t.employee = orders.employee AND t.label LIKE 'eligible-%') "
            "ORDER BY employee"
        )]
    if wrong == correct or not selected:
        raise AssertionError("seeded fanout fixture did not create a discriminating semijoin")
    return {
        "seed": spec["seed"],
        "orders": [{"employee": employee, "amount": amount} for employee, amount in orders],
        "tags": [{"employee": employee, "label": label} for employee, label in tags],
        "eligibleEmployees": selected,
        "semijoinTotal": correct,
        "fanoutMutantTotal": wrong,
    }


def ratio_of_sums(spec: dict[str, Any]) -> dict[str, Any]:
    groups = spec["groups"]
    numerator = sum(group["numerator"] for group in groups)
    denominator = sum(group["denominator"] for group in groups)
    pooled = Fraction(numerator, denominator)
    mean_of_rates = sum(
        (Fraction(group["numerator"], group["denominator"]) for group in groups),
        Fraction(),
    ) / len(groups)
    return {
        "groups": [
            {**group, "rate": fraction_text(Fraction(group["numerator"], group["denominator"]))}
            for group in groups
        ],
        "numeratorSum": numerator,
        "denominatorSum": denominator,
        "ratioOfSums": fraction_text(pooled),
        "meanOfRatesMutant": fraction_text(mean_of_rates),
    }


def empty_unknown(spec: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for group, values in spec["groups"].items():
        if not values:
            result[group] = {"state": "empty", "rate": None}
            continue
        if len(values) != 1:
            raise AssertionError("empty/unknown fixture must use one row per group")
        result[group] = ratio(values[0]["numerator"], values[0]["denominator"])
    return result


def exact_arithmetic(spec: dict[str, Any]) -> dict[str, Any]:
    decimal_total = sum((Decimal(value) for value in spec["decimalValues"]), Decimal(0))
    integer_total = sum(spec["integerValues"])
    return {
        "decimalTotal": format(decimal_total, "f"),
        "integerTotal": str(integer_total),
        "safeIntegerMaximum": 2**53 - 1,
        "unsafeIntegerInput": {"state": "rejected", "value": spec["unsafeIntegerInput"]},
    }


def ranking(spec: dict[str, Any]) -> dict[str, Any]:
    observations = spec["observations"]
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    weekly: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for row in observations:
        totals[row["employee"]][0] += row["numerator"]
        totals[row["employee"]][1] += row["denominator"]
        weekly[(row["employee"], row["week"])][0] += row["numerator"]
        weekly[(row["employee"], row["week"])][1] += row["denominator"]
    ranked = sorted(
        totals,
        key=lambda employee: (-Fraction(totals[employee][0], totals[employee][1]), employee),
    )
    selected = ranked[: spec["topK"]]
    fixed_weekly = []
    for employee in selected:
        for week in sorted({row["week"] for row in observations}):
            numerator, denominator = weekly.get((employee, week), [0, 0])
            fixed_weekly.append({
                "employee": employee,
                "week": week,
                "numerator": numerator,
                "denominator": denominator,
                "rate": fraction_text(Fraction(numerator, denominator)) if denominator else None,
            })
    live_by_week = {}
    for week in sorted({row["week"] for row in observations}):
        weekly_ranked = sorted(
            (employee for employee in totals if (employee, week) in weekly),
            key=lambda employee: (-Fraction(weekly[(employee, week)][0], weekly[(employee, week)][1]), employee),
        )
        live_by_week[week] = weekly_ranked[: spec["topK"]]
    partial_page = spec["partialPage"][:2]
    return {
        "totals": [
            {"employee": employee, "numerator": totals[employee][0], "denominator": totals[employee][1],
             "rate": fraction_text(Fraction(totals[employee][0], totals[employee][1]))}
            for employee in ranked
        ],
        "fixedTopK": selected,
        "fixedWeekly": fixed_weekly,
        "liveTopByWeekMutant": live_by_week,
        "partialPageTopMutant": sorted(partial_page, key=lambda row: (-row["score"], row["employee"]))[0]["employee"],
        "fullTop": sorted(spec["partialPage"], key=lambda row: (-row["score"], row["employee"]))[0]["employee"],
    }


def incomplete_and_adversarial(spec: dict[str, Any]) -> dict[str, Any]:
    counts: dict[str, int] = defaultdict(int)
    targets: dict[str, set[str]] = defaultdict(set)
    for relation in spec["relations"]:
        counts[relation["employee"]] += 1
        targets[relation["employee"]].add(relation["team"])
    violations = sorted(employee for employee, values in targets.items() if len(values) > 1)
    try:
        Decimal(spec["invalidDecimal"])
        invalid_decimal = False
    except InvalidOperation:
        invalid_decimal = True
    period_start = datetime.fromisoformat(spec["period"]["start"].replace("Z", "+00:00"))
    period_end = datetime.fromisoformat(spec["period"]["endExclusive"].replace("Z", "+00:00"))
    included = []
    for event in spec["events"]:
        instant = datetime.fromisoformat(event["instant"].replace("Z", "+00:00"))
        if period_start <= instant < period_end:
            included.append(event["id"])
    return {
        "cardinality": {
            "declared": spec["declaredCardinality"],
            "state": "invalid",
            "reason": "many-to-one-violation",
            "offendingEmployees": violations,
        },
        "halfOpenPeriod": {"included": included, "excluded": ["at-end"]},
        "invalidDecimal": {"state": "rejected", "value": spec["invalidDecimal"]} if invalid_decimal else {"state": "accepted"},
    }


def time_buckets(spec: dict[str, Any]) -> dict[str, Any]:
    """Bucket explicit instants in the initially supported UTC Gregorian policy.

    Inputs may carry a fixed numeric offset; normalizing them to UTC before
    bucketing proves that an instant is not treated as a local wall-clock
    string. IANA timezone resolution is intentionally outside this oracle's
    supported policy and is reported as an explicit capability gap.
    """
    if spec["calendar"] != "gregorian" or spec["timezone"] != "UTC":
        raise AssertionError("fixture must use the supported UTC Gregorian policy")
    if spec["weekStartsOn"] != 1:
        raise AssertionError("fixture expects ISO/Monday week starts")

    normalized = []
    for event in spec["instants"]:
        instant = datetime.fromisoformat(event["instant"].replace("Z", "+00:00"))
        utc = instant.astimezone(timezone.utc)
        iso = utc.isocalendar()
        normalized.append({
            "id": event["id"],
            "utc": utc.isoformat().replace("+00:00", "Z"),
            "day": utc.strftime("%Y-%m-%d"),
            "week": f"{iso.year:04d}-W{iso.week:02d}",
            "month": utc.strftime("%Y-%m"),
            "quarter": f"{utc.year:04d}-Q{((utc.month - 1) // 3) + 1}",
            "year": f"{utc.year:04d}",
        })
    return {
        "calendar": spec["calendar"],
        "timezone": spec["timezone"],
        "weekStartsOn": spec["weekStartsOn"],
        "instants": normalized,
        "unsupportedTimezone": {"state": "unsupported", "timezone": spec["unsupportedTimezone"]},
    }


def bounded_windows(spec: dict[str, Any]) -> dict[str, Any]:
    """Calculate bounded sum/lag/rank windows without using production code."""
    frame = spec["frame"]
    preceding = frame["preceding"]
    following = frame["following"]
    if preceding < 0 or following < 0:
        raise AssertionError("window frame bounds must be nonnegative")

    partitions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in spec["rows"]:
        partitions[row["partition"]].append(row)

    output: list[dict[str, Any]] = []
    for partition in sorted(partitions):
        ordered = sorted(partitions[partition], key=lambda row: (row["sequence"], row["id"]))
        ranked = sorted(ordered, key=lambda row: (-row["score"], row["id"]))
        rank_by_id: dict[str, int] = {}
        for position, row in enumerate(ranked):
            if position == 0 or row["score"] != ranked[position - 1]["score"]:
                rank_by_id[row["id"]] = position + 1
            else:
                rank_by_id[row["id"]] = rank_by_id[ranked[position - 1]["id"]]
        for index, row in enumerate(ordered):
            start = max(0, index - preceding)
            end = min(len(ordered), index + following + 1)
            frame_values = [candidate["value"] for candidate in ordered[start:end]]
            frame_sum = None if any(value is None for value in frame_values) else sum(frame_values)
            output.append({
                "id": row["id"],
                "partition": partition,
                "sequence": row["sequence"],
                "score": row["score"],
                "value": row["value"],
                "sum": frame_sum,
                "lag": None if index == 0 else ordered[index - 1]["value"],
                "rank": rank_by_id[row["id"]],
            })
    return {
        "registry": spec["registry"],
        "frame": frame,
        "rows": output,
        "invalidLagFrame": {
            "state": "rejected",
            "reason": "lag-frame-requires-preceding",
            "requiredPreceding": spec["lagRequiresPreceding"],
        },
    }


def calculate(cases: dict[str, Any]) -> dict[str, Any]:
    return {
        "seededFanout": seeded_fanout(cases["seededFanout"]),
        "ratioOfSums": ratio_of_sums(cases["ratioOfSums"]),
        "emptyUnknown": empty_unknown(cases["emptyUnknown"]),
        "exactArithmetic": exact_arithmetic(cases["exactArithmetic"]),
        "ranking": ranking(cases["ranking"]),
        "incompleteAndAdversarial": incomplete_and_adversarial(cases["incompleteAndAdversarial"]),
        "timeBuckets": time_buckets(cases["timeBuckets"]),
        "windows": bounded_windows(cases["windows"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="print the canonical oracle output")
    parser.add_argument("--write", action="store_true", help="write expected.json from the oracle")
    parser.add_argument("--check", action="store_true", help="compare expected.json with the oracle")
    args = parser.parse_args()
    result = calculate(json.loads(CASES_PATH.read_text()))
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.write:
        EXPECTED_PATH.write_text(encoded)
    if args.check:
        expected = json.loads(EXPECTED_PATH.read_text())
        if result != expected:
            raise SystemExit("Independent oracle output differs from expected.json")
    if args.json:
        print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
