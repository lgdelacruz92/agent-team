#!/usr/bin/env bash

tar -czf bundle.tar.gz \
  --exclude='node_modules' --exclude='.git' --exclude='*.out' \
  --exclude='.env*' --exclude='.dockerignore' \
  --exclude='blackberry' \
  --exclude='agent-team' \
  --exclude='tests' \
  docker-compose.yaml opencode.json agents tools bridge
