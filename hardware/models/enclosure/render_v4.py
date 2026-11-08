"""Картинки корпусов v4 из korpus-v4-vid.html: Chrome без окна снимает сцены в korpus-v4-*.png.

Запуск: сначала python vid_v4.py, потом python render_v4.py (поднимает локальный сервер сам).
"""

from __future__ import annotations

import http.server
import os
import subprocess
import threading
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = next((c for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                           r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") if os.path.exists(c)), None)
SHOTS = {
    "korpus-v4-datchik.png": ("Датчик — закрыт", "", "0.25"),
    "korpus-v4-datchik-razbor.png": ("Датчик — разбор", "", "0.2"),
    "korpus-v4-datchik-snizu.png": ("Датчик снизу — ремешок 5 см", "", "0.2"),
    "korpus-v4-esp32.png": ("ESP32 — закрыт", "", "0.2"),
    "korpus-v4-esp32-razbor.png": ("ESP32 — разбор", "", "0.25"),
    "korpus-v4-esp32-vnutri.png": ("ESP32 — без крышки", "", "0.55"),
    "korpus-v4-esp32-usb.png": ("ESP32 — USB-C", "", "0.1"),
}


def main() -> None:
    os.chdir(HERE)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 5239), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    for png, (scene, cut, zoom) in SHOTS.items():
        h = {"s": scene, "z": zoom}
        if cut:
            h["cut"] = cut
        url = "http://127.0.0.1:5239/korpus-v4-vid.html#" + urllib.parse.urlencode(h)
        subprocess.run([CHROME, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars",
                        "--window-size=1400,900", "--virtual-time-budget=20000", f"--screenshot={os.path.join(HERE, png)}", url],
                       capture_output=True, timeout=180)
        print(png, os.path.exists(png))
    srv.shutdown()


if __name__ == "__main__":
    main()
