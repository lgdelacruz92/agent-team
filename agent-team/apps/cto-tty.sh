#!/usr/bin/env bash

cid=$(docker ps --format '{{.ID}}\t{{.Names}}' | grep cto | awk '{print $1}')
docker exec -it "$cid" /bin/bash