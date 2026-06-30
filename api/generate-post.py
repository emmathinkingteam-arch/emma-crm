# Vercel Python serverless function: POST {brief, package, code} -> PNG bytes.
# Renders an Emma Thinking profile post (1080x1080) from the brief text.
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gen.generator import generate


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        from _gen.emma_config import list_platinum
        body = json.dumps({"platinum": list_platinum()}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            n = int(self.headers.get("content-length") or 0)
            payload = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            host = self.headers.get("x-forwarded-host") or self.headers.get("host") or ""
            base = ("https://" + host) if host else ""
            png = generate(
                payload.get("brief", ""),
                payload.get("package", ""),
                payload.get("code", ""),
                payload.get("opts") or {},
                base,
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
