#!/usr/bin/env python3
"""Desktop host for the Mario vs. Donkey Kong: Tipping Stars web port.

The port must be served over HTTP (not file://), so this launcher starts a
small localhost web server for the bundled ``web/`` folder and then shows the
game in a native window using pywebview (which renders with the OS's built-in
Chromium/WebKit webview). If no webview backend is available it falls back to
opening the default browser, so the app always works.

It runs both standalone for testing::

    python host.py --web /path/to/build/chromium-port

and frozen by PyInstaller, where the ``web/`` folder sits next to the
executable.
"""

import argparse
import functools
import http.server
import os
import socketserver
import sys
import threading

# When frozen by PyInstaller as a windowed app there is no console, so
# sys.stdout / sys.stderr are None and any print()/.flush() would raise
# "AttributeError: 'NoneType' object has no attribute 'flush'". Route them to a
# null stream so the host runs the same with or without a console.
for _name in ("stdout", "stderr"):
    if getattr(sys, _name, None) is None:
        try:
            setattr(sys, _name, open(os.devnull, "w"))
        except Exception:
            pass

# The QR save-transfer feature uses the webcam. On Windows the WebView2
# (Edge/Chromium) MediaFoundation capture backend often fails to start some
# cameras ("NotReadableError: Could not start video source"); forcing the
# DirectShow backend fixes it. Must be set before WebView2 initialises.
_wv2_args = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "")
if "MediaFoundationVideoCapture" not in _wv2_args:
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = (
        (_wv2_args + " " if _wv2_args else "") + "--disable-features=MediaFoundationVideoCapture"
    )

APP_TITLE = "Mario vs. Donkey Kong: Tipping Stars"
WINDOW_W = 960
WINDOW_H = 600


def _candidate_roots():
    roots = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        roots += [
            os.path.join(exe_dir, "web"),
            os.path.join(exe_dir, "_internal", "web"),
            os.path.join(exe_dir, os.pardir, "Resources", "web"),  # macOS .app
        ]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(os.path.join(meipass, "web"))
    here = os.path.dirname(os.path.abspath(__file__))
    roots += [os.path.join(here, "web"), here]
    return [os.path.normpath(r) for r in roots]


def find_web_root(explicit=None):
    if explicit:
        return os.path.abspath(explicit)
    for root in _candidate_roots():
        if os.path.isfile(os.path.join(root, "index.html")):
            return root
    return _candidate_roots()[0]


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # keep the console clean
        pass

    def end_headers(self):
        # Never let the embedded webview cache the game files. Otherwise the OS
        # webview (e.g. WebView2) serves stale scripts after a rebuild because
        # the asset URLs don't change, and fixes never take effect.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class _ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_server(root, port=0):
    handler = functools.partial(_QuietHandler, directory=root)
    httpd = _ThreadingServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def main():
    ap = argparse.ArgumentParser(description="Host the MvDK: Tipping Stars web port.")
    ap.add_argument("--web", help="Path to the web folder (default: auto-detect next to the app).")
    ap.add_argument("--port", type=int, default=0, help="Fixed port (default: a free port).")
    ap.add_argument("--no-window", action="store_true",
                    help="Always use the default browser instead of a native window.")
    args = ap.parse_args()

    root = find_web_root(args.web)
    if not os.path.isfile(os.path.join(root, "index.html")):
        sys.stderr.write("ERROR: could not find the game's web files (index.html) near %s\n" % root)
        return 2

    port = start_server(root, args.port)
    url = "http://127.0.0.1:%d/" % port
    print("Hosting %s\n  -> %s" % (root, url))
    sys.stdout.flush()

    if not args.no_window:
        try:
            import webview
            webview.create_window(APP_TITLE, url, width=WINDOW_W, height=WINDOW_H)
            webview.start()
            return 0
        except Exception as ex:  # noqa: BLE001
            print("Native window unavailable (%s); opening the default browser instead." % ex)

    import webbrowser
    webbrowser.open(url)
    print("The game opened in your browser. Close this window (or press Ctrl+C) to stop the host.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
