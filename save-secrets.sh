#!/usr/bin/env bash

[[ -f ./agent-team/apps/.env.local ]] && cp "agent-team/apps/.env.local" ../secret-file
[[ -f ./agent-team/apps/.env ]] && cp "agent-team/apps/.env" ../secret-file
[[ -f ./agent-team/apps/.env ]] && cp "agent-team/apps/opencode.json" ../secret-file
