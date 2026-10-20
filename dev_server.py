"""Serve the website and prediction API locally for review."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from api.predict import handler as PredictHandler


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent), **kwargs)

    def do_POST(self):
        if self.path != "/api/predict":
            self.send_error(404)
            return
        PredictHandler.do_POST(self)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), LocalHandler)
    print("Local website: http://127.0.0.1:8000", flush=True)
    server.serve_forever()
