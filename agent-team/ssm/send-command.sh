#!/usr/bin/env bash

instancd_id='i-05d8f3b910e4e567e' # agents team
aws_profile='uk'
aws_region='eu-west-2'
aws ssm send-command \
  --instance-ids $instancd_id \
  --document-name AWS-RunShellScript \
  --parameters '{"commands":["whoami","pwd","docker --version"]}' \
  --region "$aws_region" \
  --profile "$aws_profile"