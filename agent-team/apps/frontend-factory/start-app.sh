#!/bin/sh
set -eu

# The shared environment uses CTR_* for the existing frontend board settings.
export VIKUNJA_PROJECT_ID="${VIKUNJA_PROJECT_ID:-${CTR_PROJECT_ID:-}}"
export VIKUNJA_VIEW_ID="${VIKUNJA_VIEW_ID:-${CTR_VIEW_ID:-}}"

exec "$@"
