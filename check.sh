#!/usr/bin/env bash
# Check that every file docker-compose.yaml mounts or builds from exists on this machine, before
# `docker compose up`. If a mounted file is missing, Docker silently creates an empty directory in its
# place, and the container then fails later (for example OpenCode: EISDIR reading /workspace/opencode.json).
#
# Usage (on the instance, from anywhere):
#   ./check.sh
#
# Exits 1 if anything is wrong. Needs docker compose and python3.
set -euo pipefail

cd "$(dirname "$0")"

docker compose config --format json | python3 -c '
import json, os, sys

config = json.load(sys.stdin)
failures = 0

def ok(message):
    print(f"  ok    {message}")

def fail(message):
    global failures
    failures += 1
    print(f"  FAIL  {message}")

for name, service in config.get("services", {}).items():
    print(f"{name}:")

    build = service.get("build")
    if build:
        context = build["context"] if isinstance(build, dict) else build
        dockerfile = os.path.join(context, build.get("dockerfile", "Dockerfile") if isinstance(build, dict) else "Dockerfile")
        if os.path.isfile(dockerfile):
            ok(f"build file {dockerfile}")
        else:
            fail(f"build file {dockerfile} is missing")

    for volume in service.get("volumes", []):
        if volume.get("type") != "bind":
            continue
        source = volume["source"]
        # A source with an extension (opencode.json, cto.md) is a file; one without (workspace) is a folder.
        wants_file = "." in os.path.basename(source)
        if wants_file and os.path.isdir(source):
            fail(f"{source} is a directory but should be a file (Docker created it). Fix: sudo rmdir {source}, then copy in the real file")
        elif wants_file and not os.path.isfile(source):
            fail(f"{source} is missing")
        elif wants_file and not os.access(source, os.R_OK):
            fail(f"{source} is not readable")
        elif wants_file and source.endswith(".json"):
            try:
                json.load(open(source))
                ok(f"{source} (valid JSON)")
            except ValueError as err:
                fail(f"{source} is not valid JSON: {err}")
        elif wants_file:
            ok(source)
        else:
            ok(f"{source} (folder, Docker creates it if missing)")

print()
if failures:
    print(f"{failures} problem(s) found. Fix them, then run docker compose up -d --force-recreate.")
    sys.exit(1)
print("All mounted files are present.")
'
