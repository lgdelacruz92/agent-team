#!/usr/bin/env bash
# Install Node.js (which includes npm) on Amazon Linux from the official nodejs.org build. Safe to run again.
#
# Usage (on the instance, e.g. in a Session Manager shell):
#   sudo ./install-node.sh
#
# Optional env vars: NODE_MAJOR (22), the Node.js major version; the latest release of it is installed.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

NODE_MAJOR="${NODE_MAJOR:-22}"
base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64) arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

# SHASUMS256.txt names the current release and carries each file's checksum.
curl -fsSL "$base/SHASUMS256.txt" -o SHASUMS256.txt
file=$(grep -oE "node-v[0-9.]+-linux-$arch\.tar\.xz" SHASUMS256.txt | head -n1)
[[ -n "$file" ]] || { echo "No Node.js $NODE_MAJOR build found for linux-$arch" >&2; exit 1; }

curl -fsSL "$base/$file" -o "$file"
grep " $file\$" SHASUMS256.txt | sha256sum -c -

# Replace any previous copy, then link node, npm and npx into /usr/local/bin.
rm -rf /usr/local/lib/nodejs
mkdir -p /usr/local/lib/nodejs
tar -xJf "$file" -C /usr/local/lib/nodejs --strip-components=1
for bin in node npm npx; do
  ln -sf "/usr/local/lib/nodejs/bin/$bin" "/usr/local/bin/$bin"
done

node --version
npm --version
