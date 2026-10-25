#!/usr/bin/env bash
# Open a Session Manager shell on the stack's EC2 instance (no SSH port or key needed).
#
# Usage:
#   AWS_PROFILE=dev AWS_REGION=us-east-1 ./ssh-ec2.sh             # interactive shell
#   AWS_PROFILE=dev AWS_REGION=us-east-1 ./ssh-ec2.sh --forward   # forward localhost:8065 to the instance
#
# Required env vars: AWS_PROFILE, AWS_REGION
# Optional env vars: STACK_NAME (blackberry), LOCAL_PORT (8065)
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE}"
: "${AWS_REGION:?set AWS_REGION}"

STACK_NAME="${STACK_NAME:-blackberry}"
LOCAL_PORT="${LOCAL_PORT:-8065}"
aws_args=(--profile "$AWS_PROFILE" --region "$AWS_REGION")

if ! command -v session-manager-plugin >/dev/null; then
  echo "session-manager-plugin not found. On macOS: brew install --cask session-manager-plugin" >&2
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

echo "Profile: $AWS_PROFILE  Region: $AWS_REGION  Instance: $instance_id"

if [[ "${1:-}" == "--forward" ]]; then
  echo "Forwarding http://localhost:$LOCAL_PORT -> instance:8065 (Ctrl+C to stop)"
  exec aws "${aws_args[@]}" ssm start-session \
    --target "$instance_id" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "portNumber=8065,localPortNumber=$LOCAL_PORT"
fi

exec aws "${aws_args[@]}" ssm start-session --target "$instance_id"
