FROM ghcr.io/anomalyco/opencode:latest

RUN apk add --no-cache bash git github-cli curl openssh-client

# git over https uses $GITHUB_TOKEN at runtime; gh uses $GH_TOKEN on its own.
RUN git config --system credential.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f' \
 && git config --system user.name "frontend-agent" \
 && git config --system user.email "frontend-agent@users.noreply.github.com" \
 && git config --system --add safe.directory /workspace
