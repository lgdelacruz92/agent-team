OPENCODE_SERVER_PASSWORD='password124'
ID="${1:-}"
curl -sv -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  -X DELETE "http://localhost:4096/session/$ID"

echo " deleted $ID"