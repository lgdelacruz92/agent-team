session="${1:-}"
OPENCODE_SERVER_PASSWORD='password124'
curl -v -s -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  -X POST "http://localhost:4096/session/$session/message" \
  -H "Content-Type: application/json" \
  -d '{
    "parts": [
      {
        "type": "text",
        "text": "1. You have 10 mins to get this done.\n2. Yes all of these meets my goals.\n3. Yes I already have an OAuth credentials. Give it a dummy one for now I can easily set in .env file."
      }
    ]
  }'