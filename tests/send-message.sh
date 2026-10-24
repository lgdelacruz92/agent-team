session="${1:-}"
OPENCODE_SERVER_PASSWORD='password124'
curl -v -s -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  -X POST "http://localhost:4096/session/$session/message" \
  -H "Content-Type: application/json" \
  -d '{
    "parts": [
      {
        "type": "text",
        "text": "Create a hello.js file that prints Hello World"
      }
    ]
  }'