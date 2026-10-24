OPENCODE_SERVER_PASSWORD='password124'
curl -s -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  -X POST http://localhost:4096/session \
  -H "Content-Type: application/json" \
  -d '{"title":"First Task"}' | jq '.id' | sed 's/"//g'