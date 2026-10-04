#!/usr/bin/env python3
"""Local static-file server plus a server-side NVIDIA NIM chat proxy.

Keep NVIDIA_API_KEY in the process environment; never place it in the browser
or commit it to this project.
"""
from __future__ import annotations

import argparse
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "z-ai/glm-5.3-flash"
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
MAX_BODY_BYTES = 20 * 1024 * 1024


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        route = urlsplit(self.path).path
        if route.endswith(".php"):
            route = route[:-4]
        if route == "/api/nvidia/status":
            model = os.environ.get("NVIDIA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
            self._json(200, {"configured": bool(os.environ.get("NVIDIA_API_KEY", "").strip()), "model": model})
            return
        super().do_GET()

    def do_POST(self) -> None:
        route = urlsplit(self.path).path
        if route.endswith(".php"):
            route = route[:-4]
        if route not in {"/api/nvidia/chat", "/api/nvidia/test"}:
            self._json(404, {"error": {"message": "API endpoint not found."}})
            return
        self._nvidia_request(test=route.endswith("/test"))

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_payload(self) -> dict[str, Any] | None:
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"error": {"message": "Invalid request size."}})
            return None
        if size < 1:
            self._json(400, {"error": {"message": "Request body is empty."}})
            return None
        if size > MAX_BODY_BYTES:
            self._json(413, {"error": {"message": "Request is too large."}})
            return None
        try:
            payload = json.loads(self.rfile.read(size))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"error": {"message": "Request must contain valid JSON."}})
            return None
        if not isinstance(payload, dict):
            self._json(400, {"error": {"message": "Request must be a JSON object."}})
            return None
        return payload

    def _nvidia_request(self, *, test: bool) -> None:
        payload = self._read_payload()
        if payload is None:
            return

        api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
        if not api_key:
            self._json(424, {"error": {"message": "NVIDIA_API_KEY sunucu ortamında ayarlı değil. Yeni anahtarı ortam değişkeni olarak ekleyip Python sunucusunu yeniden başlat."}})
            return

        try:
            from openai import OpenAI
        except ImportError:
            self._json(424, {"error": {"message": "Python OpenAI paketi kurulu değil. `pip install -r requirements.txt` komutunu çalıştır."}})
            return

        configured_model = os.environ.get("NVIDIA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        model = str(payload.get("model") or configured_model)
        if model != configured_model:
            self._json(400, {"error": {"message": "İstenen model NVIDIA_MODEL sunucu ayarıyla eşleşmiyor."}})
            return

        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages or len(messages) > 60:
            self._json(400, {"error": {"message": "Sohbet mesajları eksik veya çok uzun."}})
            return
        for item in messages:
            if not isinstance(item, dict) or item.get("role") not in {"system", "user", "assistant"}:
                self._json(400, {"error": {"message": "Sohbet mesaj biçimi geçersiz."}})
                return
            if not isinstance(item.get("content"), (str, list)):
                self._json(400, {"error": {"message": "Sohbet mesaj içeriği geçersiz."}})
                return

        try:
            max_tokens = int(payload.get("max_tokens", 12 if test else 1800))
            temperature = float(payload.get("temperature", 0.5))
            top_p = float(payload.get("top_p", 1.0))
        except (TypeError, ValueError):
            self._json(400, {"error": {"message": "Model ayarları geçersiz."}})
            return
        if not 1 <= max_tokens <= 4096 or not 0 <= temperature <= 2 or not 0 < top_p <= 1:
            self._json(400, {"error": {"message": "Model ayarları izin verilen aralığın dışında."}})
            return

        try:
            client = OpenAI(
                base_url=NVIDIA_BASE_URL,
                api_key=api_key,
                timeout=90.0,
                max_retries=0,
            )
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
                stream=False,
            )
            text = completion.choices[0].message.content if completion.choices else ""
            if not isinstance(text, str):
                text = ""
            self._json(200, {"text": text, "model": model})
        except Exception as exc:  # Return sanitized provider errors; never echo credentials.
            status = getattr(exc, "status_code", None)
            if not isinstance(status, int) or status not in {400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504}:
                status = 502
            if status in {401, 403}:
                message = "NVIDIA API anahtarı reddedildi. Anahtarın geçerli ve NVIDIA endpoint erişiminin açık olduğunu kontrol et."
            elif status == 404:
                message = f"NVIDIA endpoint bu modeli bulamadı: {model}. NVIDIA_MODEL ayarını kontrol et."
            elif status == 429:
                message = "NVIDIA API hız sınırı veya kullanım kotasına ulaşıldı. Biraz bekleyip tekrar dene."
            elif status == 503:
                message = "NVIDIA modeli şu anda yoğun. Biraz bekleyip tekrar dene."
            elif status >= 500:
                message = f"NVIDIA servisi geçici bir hata döndürdü ({status})."
            else:
                message = f"NVIDIA isteği reddedildi ({status}). Modeli ve mesaj biçimini kontrol et."
            self.log_error("NVIDIA proxy request failed: %s (HTTP %s)", type(exc).__name__, status)
            self._json(status, {"error": {"message": message}})


class AppServer(ThreadingHTTPServer):
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF study app and NVIDIA NIM proxy")
    parser.add_argument("--host", default=os.environ.get("APP_HOST", "127.0.0.1"), help="Bind address (default: localhost)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5173")), help="Port (default: 5173)")
    args = parser.parse_args()
    server = AppServer((args.host, args.port), AppHandler)
    print(f"PDF study app serving on http://{args.host}:{args.port}")
    print("NVIDIA proxy is enabled only when NVIDIA_API_KEY is set in this process environment.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
