#!/usr/bin/env bash
# Open a Session Manager shell on the agent team's EC2 instance (no SSH port or key needed).
#
# Usage:
#   AWS_PROFILE=dev AWS_REGION=us-east-1 ./ssh-ec2.sh             # interactive shell (same as --shell)
#   AWS_PROFILE=dev AWS_REGION=us-east-1 ./ssh-ec2.sh --shell     # interactive shell, no port forward
#   AWS_PROFILE=dev AWS_REGION=us-east-1 ./ssh-ec2.sh --forward   # forward localhost:14096 to the CTO (instance:4096)
#   AWS_PROFILE=dev AWS_REGION=us-east-1 ./ssh-ec2.sh --forward backend   # also: frontend, aws-architect
#
# Forwarded apps (instance port -> default local port; local ports are offset by 10000 so they
# do not clash with the same stack running on your machine):
#   cto 4096 -> 14096, backend 4097 -> 14097, frontend 4098 -> 14098, aws-architect 4099 -> 14099
#
# Required env vars: AWS_PROFILE, AWS_REGION
# Optional env vars: STACK_NAME (agent-team), LOCAL_PORT (override the local port for --forward)
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE}"
: "${AWS_REGION:?set AWS_REGION}"

STACK_NAME="${STACK_NAME:-agent-team}"
aws_args=(--profile "$AWS_PROFILE" --region "$AWS_REGION")

case "${1:-}" in
  ""|--shell|--forward) ;;
  *) echo "Unknown option: $1 (use --shell or --forward [cto|backend|frontend|aws-architect])" >&2; exit 1 ;;
esac

if [[ "${1:-}" == "--forward" ]]; then
  case "${2:-cto}" in
    cto) remote_port=4096 ;;
    backend) remote_port=4097 ;;
    frontend) remote_port=4098 ;;
    aws-architect) remote_port=4099 ;;
    *) echo "Unknown app: $2 (use cto, backend, frontend or aws-architect)" >&2; exit 1 ;;
  esac
fi

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
  LOCAL_PORT="${LOCAL_PORT:-$((remote_port + 10000))}"
  echo "Forwarding http://localhost:$LOCAL_PORT -> instance:$remote_port (Ctrl+C to stop)"
  exec aws "${aws_args[@]}" ssm start-session \
    --target "$instance_id" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "portNumber=$remote_port,localPortNumber=$LOCAL_PORT"
fi

echo "Opening shell as ssm-user (run 'sudo -i' for root)"
exec aws "${aws_args[@]}" ssm start-session --target "$instance_id"
