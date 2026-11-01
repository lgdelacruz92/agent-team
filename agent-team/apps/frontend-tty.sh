#!/usr/bin/env bash

cid=$(docker ps --format '{{.ID}}\t{{.Names}}' | grep frontend | awk '{print $1}')
docker exec -it "$cid" /bin/bash