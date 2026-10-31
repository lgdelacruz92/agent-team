# Connecting to the EC2 instance

The instance has no SSH port open and no key pair. You connect through
AWS Systems Manager (SSM) Session Manager, using [ssh-ec2.sh](ssh-ec2.sh).

## Prerequisites

- The stack is deployed (see `deploy.sh`) and has an `InstanceId` output.
- AWS CLI v2 with a profile that can use SSM on the instance (`ssm:StartSession`) and read the stack (`cloudformation:DescribeStacks`).
- The Session Manager plugin:

  ```bash
  brew install --cask session-manager-plugin
  ```

## Open a shell

```bash
AWS_PROFILE=<profile> AWS_REGION=<region> ./ssh-ec2.sh --shell
```

`--shell` is the default, so running the script with no arguments does the same. The script looks up the instance ID from the stack outputs and starts a
session. You land as `ssm-user`; run `sudo -i` for root (needed to install
Docker and run the application).

## Reach the apps

```bash
AWS_PROFILE=<profile> AWS_REGION=<region> ./ssh-ec2.sh --forward
```

This forwards `http://localhost:8065` (Mattermost) to port 8065 on the instance.
Add `vikunja` to forward `http://localhost:3456` (Vikunja) instead:

```bash
AWS_PROFILE=<profile> AWS_REGION=<region> ./ssh-ec2.sh --forward vikunja
```

Use `all` to forward both at once (Mattermost and Vikunja), which is what the CTO
bridge and the Vikunja tool need. Press Ctrl+C to stop.

## Options

| Variable      | Required | Default     | Purpose                                              |
| ------------- | -------- | ----------- | ---------------------------------------------------- |
| `AWS_PROFILE` | yes      |             | AWS CLI profile, passed as `--profile`               |
| `AWS_REGION`  | yes      |             | Region, passed as `--region`                         |
| `STACK_NAME`  | no       | `blackberry`| Stack to read the instance ID from                   |
| `LOCAL_PORT`  | no       | app's port  | Your machine's port for `--forward` (8065 for Mattermost, 3456 for Vikunja) |

## Manual equivalent

```bash
aws --profile <profile> --region <region> cloudformation describe-stacks \
  --stack-name blackberry \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text

aws --profile <profile> --region <region> ssm start-session --target <instance-id>
```

## Troubleshooting

- **`TargetNotConnected`**: the SSM agent hasn't registered. Wait a few minutes after launch, and check the instance can reach the internet over HTTPS (public IP, internet gateway route, no blocking network ACL). The instance profile with `AmazonSSMManagedInstanceCore` must be attached; the template does this.
- **`session-manager-plugin not found`**: install the plugin (see Prerequisites).
- **`No InstanceId output found`**: wrong `STACK_NAME`, profile or region, or the stack isn't finished deploying.
- **Expired credentials / access denied**: refresh the profile's credentials, then retry.
- **Local port already in use** with `--forward`: set `LOCAL_PORT` to a free port.

## Real SSH, scp or SSH tunnels

Not available as deployed: the template creates no key pair. Adding one needs
a `KeyName` parameter on the instance plus an SSH `ProxyCommand` through SSM.
