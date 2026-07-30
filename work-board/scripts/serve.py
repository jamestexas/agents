#!/usr/bin/env python3
"""Tiny static server for work-board, plus POST /refresh → runs scripts/refresh.sh.

Serves the project root over HTTP so index.html can fetch data/board.json, and
exposes one action endpoint so the in-page "↻ refresh (live)" button can pull
fresh gh state without a shell. Local only; binds loopback.

    python3 scripts/serve.py            # http://localhost:8787
    PORT=9000 python3 scripts/serve.py
"""
import http.server, os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "8787"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/refresh":
            self.send_error(404); return
        try:
            subprocess.run([os.path.join(ROOT, "scripts", "refresh.sh")],
                           cwd=ROOT, check=True, timeout=60,
                           capture_output=True, text=True)
            body = open(os.path.join(ROOT, "data", "board.json"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except subprocess.CalledProcessError as e:
            self.send_error(500, f"refresh.sh failed: {e.stderr[:300]}")
        except Exception as e:  # noqa: BLE001
            self.send_error(500, str(e))

    def log_message(self, *a):  # quiet
        pass

if __name__ == "__main__":
    print(f"work-board → http://localhost:{PORT}  (POST /refresh runs refresh.sh)")
    http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
