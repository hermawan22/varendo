#!/usr/bin/env python3
"""Run the repository's required quality commands and emit source-bound evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "quality" / "commands.json"
REPORT = ROOT / "artifacts" / "product-ci" / "ci.json"
LOGS = ROOT / "artifacts" / "product-ci" / "logs"
REQUIRED_KINDS = {
    "typecheck",
    "unit",
    "browser",
    "packages",
    "performance",
    "lint",
    "security",
    "boundaries",
}


def git(*arguments: str) -> str:
    return subprocess.run(
        ["git", *arguments], cwd=ROOT, check=True, text=True, capture_output=True
    ).stdout.strip()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def terminate(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=2)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def run_timed_logged_command(
    arguments: list[str], cwd: Path, stream, timeout_seconds: int, environment: dict | None = None
) -> tuple[int, float]:
    """Run one command, capture its exit code, and report monotonic elapsed time."""
    started = time.monotonic()
    code = 127
    try:
        process = subprocess.Popen(
            arguments,
            cwd=cwd,
            stdout=stream,
            stderr=subprocess.STDOUT,
            env=environment,
            start_new_session=True,
        )
        try:
            code = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            terminate(process)
            code = 124
    except OSError as error:
        stream.write(str(error).encode())
    return code, round(time.monotonic() - started, 3)


def write_report(
    source: str, status: str, changed: bool, results: list[dict], report: Path = REPORT
) -> None:
    report.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "sourceRevision": source,
        "status": status,
        "sourceChangedDuringRun": changed,
        "results": results,
    }
    with tempfile.NamedTemporaryFile(
        "w", dir=report.parent, prefix=".ci-", suffix=".json", delete=False
    ) as stream:
        temporary = Path(stream.name)
        json.dump(payload, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, report)


def validate(commands: object) -> list[dict]:
    if not isinstance(commands, list) or not commands:
        raise ValueError("quality.commands.json requires a non-empty commands array")
    kinds: set[str] = set()
    for command in commands:
        if not isinstance(command, dict):
            raise ValueError("each quality command must be an object")
        kind = command.get("kind")
        arguments = command.get("argv")
        timeout = command.get("timeoutSeconds")
        if not isinstance(kind, str) or not kind:
            raise ValueError("each quality command requires a kind")
        if not isinstance(arguments, list) or not arguments or any(
            not isinstance(value, str) or not value for value in arguments
        ):
            raise ValueError("each quality command requires a non-empty argv array")
        if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 3600:
            raise ValueError("quality command timeouts must be between 1 and 3600 seconds")
        kinds.add(kind)
    missing = REQUIRED_KINDS - kinds
    if missing:
        raise ValueError(f"quality configuration is missing: {', '.join(sorted(missing))}")
    return commands


def shard_indexes(commands: list[dict], shard: int, shards: int) -> list[int]:
    """Deal each kind round-robin so heavy kinds spread across shards; keep source order within a shard."""
    ordered = sorted(range(len(commands)), key=lambda index: (commands[index]["kind"], index))
    return sorted(index for position, index in enumerate(ordered) if position % shards == shard)


def shard_report(shard: int) -> Path:
    return REPORT.parent / f"ci-shard-{shard}.json"


def run_commands(commands: list[dict], indexes: list[int], report: Path) -> int:
    source = git("rev-parse", "HEAD")
    before = git("status", "--porcelain=v1", "--untracked-files=all")
    if before:
        print("Quality requires a clean source checkout.", file=sys.stderr)
        return 1

    LOGS.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    write_report(source, "running", False, results, report)
    with tempfile.TemporaryDirectory(prefix="aeliqo-build-reuse-") as reuse:
        environment = {**os.environ, "AELIQO_BUILD_REUSE_DIRECTORY": reuse}
        for position, index in enumerate(indexes):
            command = commands[index]
            output = LOGS / f"{index:02d}-{command['kind']}.log"
            with output.open("wb") as stream:
                code, elapsed = run_timed_logged_command(
                    command["argv"], ROOT, stream, command["timeoutSeconds"], environment
                )
            results.append(
                {
                    "index": index,
                    "kind": command["kind"],
                    "argv": command["argv"],
                    "exitCode": code,
                    "elapsedSeconds": elapsed,
                    "log": {
                        "path": output.relative_to(ROOT).as_posix(),
                        "sha256": digest(output),
                    },
                }
            )
            changed = git("status", "--porcelain=v1", "--untracked-files=all") != before
            status = "running" if code == 0 and not changed else "failed"
            write_report(source, status, changed, results, report)
            print(f"{position + 1}/{len(indexes)} {command['kind']}: exit {code} ({elapsed:.3f}s)", flush=True)
            if code != 0 or changed:
                return 1

    write_report(source, "passed", False, results, report)
    return 0


def merge_shards(commands: list[dict], shards: int) -> int:
    """Combine shard evidence into one report only when every command passed exactly once on this source."""
    source = git("rev-parse", "HEAD")
    results: list[dict] = []
    for shard in range(shards):
        evidence = json.loads(shard_report(shard).read_text(encoding="utf-8"))
        if evidence.get("sourceRevision") != source or evidence.get("status") != "passed":
            print(f"Shard {shard} evidence is missing, failed, or from another source.", file=sys.stderr)
            return 1
        if evidence.get("sourceChangedDuringRun") is not False:
            print(f"Shard {shard} changed the source during its run.", file=sys.stderr)
            return 1
        results.extend(evidence["results"])
    results.sort(key=lambda result: result["index"])
    if [result["index"] for result in results] != list(range(len(commands))):
        print("Shard evidence does not cover every quality command exactly once.", file=sys.stderr)
        return 1
    for result in results:
        command = commands[result["index"]]
        if result["argv"] != command["argv"] or result["kind"] != command["kind"] or result["exitCode"] != 0:
            print(f"Shard evidence for command {result['index']} does not match the configuration.", file=sys.stderr)
            return 1
        if digest(ROOT / result["log"]["path"]) != result["log"]["sha256"]:
            print(f"Log digest mismatch for command {result['index']}.", file=sys.stderr)
            return 1
    write_report(source, "passed", False, results)
    print(f"Merged {len(results)} quality commands from {shards} shards.", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard", type=int, help="run one shard of the matrix (0-based)")
    parser.add_argument("--shards", type=int, help="total shard count for --shard")
    parser.add_argument("--merge", type=int, metavar="SHARDS", help="merge passed shard evidence into one report")
    options = parser.parse_args()
    configuration = json.loads(CONFIG.read_text(encoding="utf-8"))
    commands = validate(configuration.get("commands"))
    if options.merge is not None:
        return merge_shards(commands, options.merge)
    if options.shard is None:
        return run_commands(commands, list(range(len(commands))), REPORT)
    if options.shards is None or not 0 <= options.shard < options.shards:
        parser.error("--shard requires --shards and 0 <= shard < shards")
    return run_commands(commands, shard_indexes(commands, options.shard, options.shards), shard_report(options.shard))


if __name__ == "__main__":
    raise SystemExit(main())
