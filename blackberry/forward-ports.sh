#!/usr/bin/env bash
# Run on the blackberry instance. Makes Mattermost (8065) and Vikunja (3456), which Docker publishes
# on 127.0.0.1 only, reachable on the instance's private IP, so the agent-team instance can use them.
# Uses socat relays run by systemd, so they survive reboots. Use this OR BIND_ADDRESS=0.0.0.0, not both.
#
# Usage (on the instance, e.g. in a Session Manager shell):
#   sudo ./forward-ports.sh            # install and start the relays
#   sudo ./forward-ports.sh remove     # stop and delete them
#
# Optional env vars: PORTS ("8065 3456")
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0 [install|remove]" >&2
  exit 1
fi

PORTS="${PORTS:-8065 3456}"
helper=/usr/local/bin/blackberry-forward

remove() {
  for port in $PORTS; do
    systemctl disable --now "blackberry-forward-$port.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/blackberry-forward-$port.service"
  done
  rm -f "$helper"
  systemctl daemon-reload
  echo "Removed the relays for: $PORTS"
}

install() {
  dnf install -y socat

  # Listens on the private IP (read from instance metadata) and relays to the same port on localhost.
  cat > "$helper" <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
port="$1"
token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
ip=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/local-ipv4)
exec socat "TCP-LISTEN:$port,bind=$ip,fork,reuseaddr" "TCP:127.0.0.1:$port"
HELPER
  chmod +x "$helper"

  for port in $PORTS; do
    cat > "/etc/systemd/system/blackberry-forward-$port.service" <<UNIT
[Unit]
Description=Relay private IP port $port to 127.0.0.1:$port
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$helper $port
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  done

  systemctl daemon-reload
  for port in $PORTS; do
    systemctl enable --now "blackberry-forward-$port.service"
  done

  token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  ip=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/local-ipv4)
  echo "Relays are up. From the agent-team instance use:"
  for port in $PORTS; do echo "  http://$ip:$port"; done
}

case "${1:-install}" in
  install) install ;;
  remove) remove ;;
  *) echo "Unknown option: $1 (use install or remove)" >&2; exit 1 ;;
esac
