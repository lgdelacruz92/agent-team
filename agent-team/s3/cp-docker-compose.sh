#!/usr/bin/env bash
s3_url='s3://s3-test-bucket-expl/docker-compose.yaml'
profile='uk'
region='eu-west-2'

aws s3 cp ../../docker-compose.yaml \
    --profile "$profile" \
    --region "$region" \
    "$s3_url"
