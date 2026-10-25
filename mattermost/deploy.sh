#!/usr/bin/env bash
# Deploy cloudformation.yaml.
#
# Required env vars:
#   VPC_ID                  existing VPC
#   PUBLIC_SUBNET_IDS       comma-separated existing public subnets (2+ AZs); the load balancer
#                           spans all of them and the EC2 instance goes in the first
# Optional env vars:
#   STACK_NAME (blackberry), AWS_REGION, INSTANCE_TYPE, VOLUME_SIZE_GIB,
#   ALLOWED_CIDR, CERTIFICATE_ARN, SITE_URL
set -euo pipefail

cd "$(dirname "$0")"

: "${VPC_ID:?set VPC_ID}"
: "${PUBLIC_SUBNET_IDS:?set PUBLIC_SUBNET_IDS}"

STACK_NAME="${STACK_NAME:-blackberry}"

overrides=(
  "VpcId=$VPC_ID"
  "PublicSubnetIds=$PUBLIC_SUBNET_IDS"
)
[[ -n "${INSTANCE_TYPE:-}" ]] && overrides+=("InstanceType=$INSTANCE_TYPE")
[[ -n "${VOLUME_SIZE_GIB:-}" ]] && overrides+=("VolumeSizeGiB=$VOLUME_SIZE_GIB")
[[ -n "${ALLOWED_CIDR:-}" ]] && overrides+=("AllowedCidr=$ALLOWED_CIDR")
[[ -n "${CERTIFICATE_ARN:-}" ]] && overrides+=("CertificateArn=$CERTIFICATE_ARN")
[[ -n "${SITE_URL:-}" ]] && overrides+=("SiteUrl=$SITE_URL")

region_args=()
[[ -n "${AWS_REGION:-}" ]] && region_args=(--region "$AWS_REGION")

aws cloudformation deploy \
  "${region_args[@]}" \
  --stack-name "$STACK_NAME" \
  --template-file cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${overrides[@]}"

aws cloudformation describe-stacks \
  "${region_args[@]}" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
