#!/usr/bin/env bash
# Deploy cloudformation.yaml (the agent team's EC2 instance).
#
# Required env vars:
#   AWS_PROFILE             AWS CLI profile, passed as --profile to every aws call
#   AWS_REGION              region, passed as --region to every aws call
#   VPC_ID                  existing VPC (can be the blackberry stack's VPC)
#   SUBNET_ID               existing public subnet for the instance
# Optional env vars:
#   STACK_NAME (agent-team), INSTANCE_TYPE (t3.large), VOLUME_SIZE_GIB (50)
#   BLACKBERRY_STACK_NAME (blackberry)   stack whose InstanceSecurityGroupId output is used to let the
#                                        agent instance reach Mattermost and Vikunja
#   BLACKBERRY_SECURITY_GROUP_ID         use this security group instead of looking it up
set -euo pipefail

cd "$(dirname "$0")"


: "${AWS_PROFILE:?set AWS_PROFILE}"
: "${AWS_REGION:?set AWS_REGION}"
: "${VPC_ID:?set VPC_ID}"
: "${SUBNET_ID:?set SUBNET_ID}"

STACK_NAME="${STACK_NAME:-agent-team}"

overrides=(
  "VpcId=$VPC_ID"
  "SubnetId=$SUBNET_ID"
)
[[ -n "${INSTANCE_TYPE:-}" ]] && overrides+=("InstanceType=$INSTANCE_TYPE")
[[ -n "${VOLUME_SIZE_GIB:-}" ]] && overrides+=("VolumeSizeGiB=$VOLUME_SIZE_GIB")

aws_args=(--profile "$AWS_PROFILE" --region "$AWS_REGION")

# Let the agent instance reach Mattermost and Vikunja on the blackberry instance.
blackberry_sg="${BLACKBERRY_SECURITY_GROUP_ID:-}"
if [[ -z "$blackberry_sg" ]]; then
  blackberry_sg=$(aws "${aws_args[@]}" cloudformation describe-stacks \
    --stack-name "${BLACKBERRY_STACK_NAME:-blackberry}" \
    --query 'Stacks[0].Outputs[?OutputKey==`InstanceSecurityGroupId`].OutputValue' \
    --output text 2>/dev/null || true)
fi
if [[ -n "$blackberry_sg" && "$blackberry_sg" != "None" ]]; then
  overrides+=("BlackberrySecurityGroupId=$blackberry_sg")
  echo "Allowing the agent instance to reach Mattermost and Vikunja via $blackberry_sg"
else
  echo "No blackberry security group found (deploy the blackberry stack first, or set BLACKBERRY_SECURITY_GROUP_ID); skipping the rules." >&2
fi

echo "Profile: $AWS_PROFILE  Region: $AWS_REGION"
aws "${aws_args[@]}" sts get-caller-identity --query '[Account,Arn]' --output text

aws "${aws_args[@]}" cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${overrides[@]}"

aws "${aws_args[@]}" cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
