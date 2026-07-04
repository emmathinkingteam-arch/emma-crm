# Vercel Python serverless function: POST {name, body, template} -> PNG bytes.
# Renders an Emma Thinking client-feedback post (1080x1080). Parts of the body
# wrapped *like this* come out in brand pink.
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gen.feedback import generate_feedback, list_feedback_templates


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"templates": list_feedback_templates()}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            n = int(self.headers.get("content-length") or 0)
            payload = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            png = generate_feedback(
                payload.get("name", ""),
                payload.get("body", ""),
                payload.get("template", ""),
            )
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
        except Exception as e:  # noqa: BLE001
            body = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
