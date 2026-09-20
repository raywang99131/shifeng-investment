import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

from app.config import Settings
from app.main import create_app


@pytest.mark.parametrize('request_options', [{}, {'timeout': None}])
def test_provider_http_calls_cannot_wait_indefinitely(tmp_path, monkeypatch, request_options):
    class SlowHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            threading.Event().wait(0.3)
            try:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'ok')
            except BrokenPipeError:
                pass

        def log_message(self, *args):
            pass

    # Restore the process HTTP policy after testing this app's short deadline.
    monkeypatch.setattr(requests.sessions.Session, 'request', requests.sessions.Session.request)
    create_app(
        db_path=tmp_path / 'http.db', scheduler_enabled=False,
        settings=Settings(http_request_timeout_seconds=0.05),
    )
    server = ThreadingHTTPServer(('127.0.0.1', 0), SlowHandler)
    worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    worker.start()
    try:
        with pytest.raises(requests.exceptions.Timeout):
            requests.get(f'http://127.0.0.1:{server.server_port}/', **request_options)
        # A provider's explicit finite timeout still takes precedence.
        response = requests.get(f'http://127.0.0.1:{server.server_port}/', timeout=1)
        assert response.text == 'ok'
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=1)
