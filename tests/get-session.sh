OPENCODE_SERVER_PASSWORD='password124'
curl -s -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  http://localhost:4096/session | jq '.[].id'