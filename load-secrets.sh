#!/usr/bin/env bash

env_local='../secret-files/.env.local'
opencode_json='../secret-files/opencode.json'
echo "$env_local", "$opencode_json"
[[ -f "$env_local" ]] && cp "$env_local" ./agent-team/apps
[[ -f "$opencode_json" ]] && cp "$opencode_json" ./agent-team/apps