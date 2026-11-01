"""Локальный сервер: uv run python -m tools.serve [--no-browser] [--port 8000]."""

import argparse
import os
import webbrowser
from wsgiref.simple_server import make_server

from django.contrib.staticfiles.handlers import StaticFilesHandler
from django.core.wsgi import get_wsgi_application


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")
    # Локальный запуск без DEBUG: статику отдаёт обработчик staticfiles, без отдельного веб-сервера.
    application = StaticFilesHandler(get_wsgi_application())
    try:
        server = make_server("127.0.0.1", args.port, application)
    except OSError as exc:
        print(f"Cannot start local server on port {args.port}: {exc}", flush=True)
        print("Close the other server window, or use --port 8001.", flush=True)
        return 1
    with server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Open {url}", flush=True)
        print("Keep this window open. Press Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            try:
                webbrowser.open(url)
            except webbrowser.Error:
                print("Open the address above in your browser.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
