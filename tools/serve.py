"""Serve the project folder for local work, telling the browser to check every file each time.

`python3 -m http.server` sends no Cache-Control, so browsers reuse files for a while without asking. After an
edit the page can then mix a new index.html with an old module (a new button with no handler), which looks
like a bug that isn't there. This server is the same, plus `Cache-Control: no-cache`.

    python3 tools/serve.py [port]      # default 8000
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = Path(__file__).resolve().parent.parent
    srv = ThreadingHTTPServer(('', port), partial(NoCache, directory=str(root)))
    print(f'Serving {root} at http://localhost:{port}/')
    srv.serve_forever()
