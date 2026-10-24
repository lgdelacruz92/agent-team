session="${1:-}"
OPENCODE_SERVER_PASSWORD='password124'
curl -v -s -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  -X POST "http://localhost:4096/session/$session/message" \
  -H "Content-Type: application/json" \
  -d '{
    "parts": [
      {
        "type": "text",
        "text": "I want a website that first starts with common login using my google account. Like when I login to say canva.com I can use my google account to login to that website. Make the website content dummy website content for now. 1. You have 10 mins to get this done.\n2. Yes all of these meets my goals.\n3. Yes I already have an OAuth credentials. Give it a dummy one for now I can easily set in .env file."
      }
    ]
  }' | jq . > out.json