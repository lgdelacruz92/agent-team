#!/usr/bin/env bash
# Snapshot the instance's EBS volume(s). Docker keeps the Mattermost database and files and the Vikunja
# files on that disk, so one snapshot captures all of them. Run on your laptop, not on the instance.
#
# Usage:
#   AWS_PROFILE=dev AWS_REGION=us-east-1 INSTANCE_ID=i-0123456789abcdef0 ./backup.sh
#
# Required env vars: AWS_PROFILE, AWS_REGION, INSTANCE_ID
# Needs: ec2:DescribeVolumes, ec2:CreateSnapshot, ec2:CreateTags
set -euo pipefail

AWS_PROFILE='uk'
AWS_REGION='eu-west-2'
INSTANCE_ID='i-0b6161e66c3bfec74'
: "${AWS_PROFILE:?set AWS_PROFILE}"
: "${AWS_REGION:?set AWS_REGION}"
: "${INSTANCE_ID:?set INSTANCE_ID}"

aws_args=(--profile "$AWS_PROFILE" --region "$AWS_REGION")

volumes=$(aws "${aws_args[@]}" ec2 describe-volumes \
  --filters "Name=attachment.instance-id,Values=$INSTANCE_ID" \
  --query 'Volumes[].VolumeId' --output text)
if [[ -z "$volumes" ]]; then
  echo "No volumes attached to $INSTANCE_ID" >&2
  exit 1
fi

stamp=$(date -u +%Y%m%d-%H%M%S)
echo "Profile: $AWS_PROFILE  Region: $AWS_REGION  Instance: $INSTANCE_ID"

snapshots=""
for volume in $volumes; do
  snapshot=$(aws "${aws_args[@]}" ec2 create-snapshot \
    --volume-id "$volume" \
    --description "backup of $INSTANCE_ID $stamp" \
    --tag-specifications "ResourceType=snapshot,Tags=[{Key=Name,Value=backup-$INSTANCE_ID-$stamp},{Key=SourceInstance,Value=$INSTANCE_ID},{Key=SourceVolume,Value=$volume}]" \
    --query SnapshotId --output text)
  echo "Started $snapshot from $volume"
  snapshots="$snapshots $snapshot"
done

echo "Waiting for the snapshot(s) to finish (Ctrl+C is safe, they keep going in AWS)..."
# shellcheck disable=SC2086
if aws "${aws_args[@]}" ec2 wait snapshot-completed --snapshot-ids $snapshots; then
  echo "Done:$snapshots"
else
  echo "Still in progress after the wait limit. Check: aws ec2 describe-snapshots --snapshot-ids$snapshots" >&2
fi
