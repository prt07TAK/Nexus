from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os


class NexusRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    os.chdir(root)
    host = os.environ.get("NEXUS_HOST", "127.0.0.1")
    port = int(os.environ.get("NEXUS_PORT", "8000"))
    print(f"Serving Nexus Fashion at http://{host}:{port}")
    print("Open this URL in your browser for Google auth and camera access.")
    ThreadingHTTPServer((host, port), NexusRequestHandler).serve_forever()
