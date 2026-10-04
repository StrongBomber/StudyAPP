import json
import os
import sys
import threading
import types
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server as app_server  # noqa: E402


class QuietHandler(app_server.AppHandler):
    def log_message(self, *_args):
        pass


class ServerContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request(self, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"} if data is not None else {}
        request = Request(self.base_url + path, data=data, headers=headers)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def fake_openai(self, captured):
        class FakeOpenAI:
            def __init__(self, **kwargs):
                captured["client"] = kwargs
                self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

            def create(self, **kwargs):
                captured["request"] = kwargs
                message = SimpleNamespace(content="Test yanıtı")
                return SimpleNamespace(choices=[SimpleNamespace(message=message)])

        module = types.ModuleType("openai")
        module.OpenAI = FakeOpenAI
        return module

    def test_status_reports_configuration_without_leaking_key(self):
        secret = "test-secret-not-a-real-key"
        with patch.dict(os.environ, {"NVIDIA_API_KEY": secret, "NVIDIA_MODEL": "test/model"}):
            status, body = self.request("/api/nvidia/status")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"configured": True, "model": "test/model"})
        self.assertNotIn(secret, json.dumps(body))

    def test_status_reports_unconfigured_environment(self):
        with patch.dict(os.environ, {"NVIDIA_API_KEY": ""}):
            status, body = self.request("/api/nvidia/status")
        self.assertEqual(status, 200)
        self.assertFalse(body["configured"])

    def test_valid_chat_is_proxied_with_server_model(self):
        captured = {}
        payload = {
            "model": "test/model",
            "messages": [{"role": "user", "content": "Merhaba"}],
            "max_tokens": 32,
            "temperature": 0.2,
            "top_p": 1,
        }
        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-secret", "NVIDIA_MODEL": "test/model"}), patch.dict(sys.modules, {"openai": self.fake_openai(captured)}):
            status, body = self.request("/api/nvidia/chat", payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["text"], "Test yanıtı")
        self.assertEqual(body["model"], "test/model")
        self.assertEqual(captured["request"]["messages"], payload["messages"])
        self.assertEqual(captured["client"]["api_key"], "test-secret")

    def test_rejects_unconfigured_server_without_provider_call(self):
        payload = {"messages": [{"role": "user", "content": "Hi"}]}
        with patch.dict(os.environ, {"NVIDIA_API_KEY": ""}):
            status, body = self.request("/api/nvidia/chat", payload)
        self.assertEqual(status, 424)
        self.assertIn("error", body)

    def test_rejects_model_mismatch(self):
        payload = {"model": "wrong/model", "messages": [{"role": "user", "content": "Hi"}]}
        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-secret", "NVIDIA_MODEL": "test/model"}), patch.dict(sys.modules, {"openai": self.fake_openai({})}):
            status, body = self.request("/api/nvidia/chat", payload)
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_rejects_invalid_message_role(self):
        payload = {"model": "test/model", "messages": [{"role": "system-override", "content": "Hi"}]}
        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-secret", "NVIDIA_MODEL": "test/model"}), patch.dict(sys.modules, {"openai": self.fake_openai({})}):
            status, body = self.request("/api/nvidia/chat", payload)
        self.assertEqual(status, 400)
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()
