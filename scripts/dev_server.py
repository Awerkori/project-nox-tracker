#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys

PORT = 8088
DIRECTORY = "/home/awerkori/.Projects/Project-Nox-Tracker"

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, post-check=0, pre-check=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
        print(f"Serving Project Nox Tracker at http://localhost:{PORT} with strict no-cache headers...", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
