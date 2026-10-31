#!/usr/bin/env bash

[[ -f ./agent-team/apps/.env.local ]] && cp "agent-team/apps/.env.local" ../secrets-file
[[ -f ./agent-team/apps/.env ]] && cp "agent-team/apps/.env" ../secrets-file
[[ -f ./agent-team/apps/.env ]] && cp "agent-team/apps/opencode.json" ../secrets-file
