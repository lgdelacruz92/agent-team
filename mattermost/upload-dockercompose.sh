#!/usr/bin/env bash
# Upload docker-compose.yaml to the stack's EC2 instance via SSM Run Command (no SSH needed).
# The file is base64-encoded and written on the instance. Run Command limits parameters to ~100 KB.
#
# Usage:
#   ./upload-dockercompose.sh --profile dev --region us-east-1
#
# Required flags: --profile, --region
# Optional env vars: STACK_NAME (blackberry), LOCAL_FILE (./docker-compose.yaml),
#                    REMOTE_PATH (/home/ec2-user/docker-compose.yaml)
set -euo pipefail

AWS_PROFILE="uk"
AWS_REGION="eu-west-2"
REMOTE_PATH="/home/ssm-user/docker-compose.yaml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) AWS_PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --region) AWS_REGION="${2:?--region needs a value}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

: "${AWS_PROFILE:?pass --profile <name>}"
: "${AWS_REGION:?pass --region <region>}"

STACK_NAME="${STACK_NAME:-blackberry}"
LOCAL_FILE="${LOCAL_FILE:-$(dirname "$0")/docker-compose.yaml}"
REMOTE_PATH="${REMOTE_PATH:-/home/ec2-user/docker-compose.yaml}"
aws_args=(--profile "$AWS_PROFILE" --region "$AWS_REGION")

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "File not found: $LOCAL_FILE" >&2
  exit 1
fi

instance_id=$(aws "${aws_args[@]}" cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text)

if [[ -z "$instance_id" || "$instance_id" == "None" ]]; then
  echo "No InstanceId output found on stack $STACK_NAME" >&2
  exit 1
fi

b64=$(base64 < "$LOCAL_FILE" | tr -d '\n')

echo "Profile: $AWS_PROFILE  Region: $AWS_REGION  Instance: $instance_id"
echo "Uploading $LOCAL_FILE -> $REMOTE_PATH"

command_id=$(aws "${aws_args[@]}" ssm send-command \
  --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $b64 | base64 -d > $REMOTE_PATH && chown ec2-user:ec2-user $REMOTE_PATH\"]" \
  --query 'Command.CommandId' \
  --output text)

aws "${aws_args[@]}" ssm wait command-executed \
  --command-id "$command_id" \
  --instance-id "$instance_id" || true

aws "${aws_args[@]}" ssm get-command-invocation \
  --command-id "$command_id" \
  --instance-id "$instance_id" \
  --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' \
  --output table
