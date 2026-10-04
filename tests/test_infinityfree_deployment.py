import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class InfinityFreeDeploymentTests(unittest.TestCase):
    def test_railpack_has_public_python_start_command(self):
        import json

        config = json.loads((ROOT / "railpack.json").read_text(encoding="utf-8"))
        self.assertIn("python server.py", config["deploy"]["startCommand"])
        self.assertIn("0.0.0.0", config["deploy"]["startCommand"])

    def test_builder_creates_uploadable_php_site_without_local_secrets(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "htdocs"
            result = subprocess.run(
                ["bash", str(ROOT / "scripts" / "build-infinityfree.sh"), str(output)],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

            for relative_path in (
                "index.html",
                "app-config.js",
                "assets/demo.pdf",
                "vendor/pdf.min.mjs",
                "api/nvidia/.htaccess",
                "api/nvidia/chat.php",
                "api/nvidia/common.php",
                "api/nvidia/config.example.php",
                "api/nvidia/status.php",
            ):
                self.assertTrue((output / relative_path).is_file(), relative_path)

            self.assertFalse((output / "server.py").exists())
            self.assertFalse((output / "requirements.txt").exists())
            self.assertFalse((output / "api/nvidia/config.php").exists())
            self.assertFalse((output / ".git").exists())

    def test_builder_refuses_repository_and_git_metadata_paths(self):
        for unsafe_path in (ROOT, ROOT / ".git", ROOT / ".git" / "objects"):
            result = subprocess.run(
                ["bash", str(ROOT / "scripts" / "build-infinityfree.sh"), str(unsafe_path)],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            self.assertEqual(result.returncode, 2, str(unsafe_path))
        self.assertTrue((ROOT / ".git" / "HEAD").is_file())

    def test_server_secret_and_rate_limit_state_are_ignored_by_git(self):
        for path in ("api/nvidia/config.php", "api/nvidia/.rate-limit.json"):
            result = subprocess.run(
                ["git", "check-ignore", "-q", path],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, f"{path} must be ignored by Git")

    @unittest.skipUnless(shutil.which("php"), "PHP CLI is not installed")
    def test_php_proxy_files_pass_php_lint(self):
        for path in sorted((ROOT / "api" / "nvidia").glob("*.php")):
            result = subprocess.run(["php", "-l", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
