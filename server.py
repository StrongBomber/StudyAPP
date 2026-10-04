#!/usr/bin/env python3
"""Local static-file server plus a server-side NVIDIA NIM chat proxy.

Keep NVIDIA_API_KEY in the process environment; never place it in the browser
or commit it to this project.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "z-ai/glm-5.3-flash"
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
MAX_BODY_BYTES = 20 * 1024 * 1024
RATE_WINDOW_SECONDS = 60 * 60
_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _api_route(self) -> str:
        route = urlsplit(self.path).path
        return route[:-4] if route.endswith(".php") else route

    def _cors_origins(self) -> set[str]:
        configured = os.environ.get("APP_CORS_ORIGINS", "")
        return {origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()}

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin", "").strip()
        if not origin:
            return True
        normalized = origin.rstrip("/")
        if normalized in self._cors_origins():
            return True
        try:
            parsed = urlsplit(normalized)
        except ValueError:
            return False
        request_host = self.headers.get("Host", "").strip().casefold()
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc) and parsed.netloc.casefold() == request_host

    def _ensure_api_origin(self) -> bool:
        if self._origin_allowed():
            return True
        self._json(403, {"error": {"message": "Bu alan adına API erişimi izinli değil."}})
        return False

    def _add_cors_headers(self) -> None:
        origin = self.headers.get("Origin", "").strip()
        if origin and self._origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _client_ip(self) -> str:
        candidate = self.headers.get("X-Real-IP", "").strip()
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            return self.client_address[0]

    def _rate_limit_allowed(self) -> bool:
        try:
            limit = int(os.environ.get("APP_RATE_LIMIT_PER_HOUR", "30"))
        except ValueError:
            limit = 30
        limit = max(1, min(500, limit))
        client_ip = self._client_ip()
        now = time.monotonic()
        cutoff = now - RATE_WINDOW_SECONDS

        with _rate_lock:
            for key, timestamps in list(_rate_buckets.items()):
                recent = [timestamp for timestamp in timestamps if timestamp > cutoff]
                if recent:
                    _rate_buckets[key] = recent
                else:
                    del _rate_buckets[key]
            timestamps = _rate_buckets.get(client_ip, [])
            if len(timestamps) >= limit:
                return False
            timestamps.append(now)
            _rate_buckets[client_ip] = timestamps
            return True

    def do_GET(self) -> None:
        route = self._api_route()
        if route == "/api/nvidia/status":
            if not self._ensure_api_origin():
                return
            model = os.environ.get("NVIDIA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
            self._json(200, {"configured": bool(os.environ.get("NVIDIA_API_KEY", "").strip()), "model": model})
            return
        super().do_GET()

    def do_POST(self) -> None:
        route = self._api_route()
        if route not in {"/api/nvidia/chat", "/api/nvidia/test"}:
            self._json(404, {"error": {"message": "API endpoint not found."}})
            return
        if not self._ensure_api_origin():
            return
        self._nvidia_request(test=route.endswith("/test"))

    def do_OPTIONS(self) -> None:
        route = self._api_route()
        route_methods = {
            "/api/nvidia/status": {"GET"},
            "/api/nvidia/chat": {"POST"},
            "/api/nvidia/test": {"POST"},
        }
        if route not in route_methods:
            self._json(404, {"error": {"message": "API endpoint not found."}})
            return
        if not self._ensure_api_origin():
            return

        requested_method = self.headers.get("Access-Control-Request-Method", "").upper()
        if requested_method and requested_method not in route_methods[route]:
            self._json(405, {"error": {"message": "İstenen HTTP yöntemi izinli değil."}})
            return
        requested_headers = {
            header.strip().lower()
            for header in self.headers.get("Access-Control-Request-Headers", "").split(",")
            if header.strip()
        }
        if not requested_headers.issubset({"content-type", "cache-control", "pragma"}):
            self._json(403, {"error": {"message": "İstenen HTTP başlığı izinli değil."}})
            return

        self.send_response(204)
        self._add_cors_headers()
        self.send_header("Access-Control-Allow-Methods", ", ".join(sorted(route_methods[route] | {"OPTIONS"})))
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, status: int, payload: dict[str, Any], extra_headers: dict[str, str] | None = None) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._add_cors_headers()
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
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

        if not self._rate_limit_allowed():
            self._json(
                429,
                {"error": {"message": "Bu IP için saatlik AI kullanım sınırına ulaşıldı. Daha sonra tekrar dene."}},
                {"Retry-After": "3600"},
            )
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
