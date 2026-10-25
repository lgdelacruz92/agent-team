#!/usr/bin/env bash

tar -zcf blackberry.tar.gz \
    --exclude='node_modules' \
    --exclude='.env' \
    --exclude='package-lock.json' \
    --exclude='*.md' \
    blackberry