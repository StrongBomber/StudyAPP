import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class InfinityFreeDeploymentTests(unittest.TestCase):
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
                ".htaccess",
                "config.example.php",
                "index.html",
                "assets/demo.pdf",
                "vendor/pdf.min.mjs",
                "api/nvidia/.htaccess",
                "api/nvidia/chat.php",
                "api/nvidia/common.php",
                "api/nvidia/status.php",
                "api/nvidia/test.php",
            ):
                self.assertTrue((output / relative_path).is_file(), relative_path)

            self.assertIn("AddType text/javascript .mjs", (output / ".htaccess").read_text())
            self.assertIn("<FilesMatch \"^\\.env", (output / ".htaccess").read_text())
            self.assertIn("<FilesMatch \"^config", (output / ".htaccess").read_text())
            self.assertFalse((output / ".env").exists())
            self.assertFalse((output / ".env.example").exists())
            self.assertFalse((output / "config.php").exists())
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
        for path in (".env", "config.php", "api/nvidia/config.php", "api/nvidia/.rate-limit.json"):
            result = subprocess.run(
                ["git", "check-ignore", "-q", path],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, f"{path} must be ignored by Git")
        template = subprocess.run(
            ["git", "check-ignore", "-q", ".env.example"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(template.returncode, 0, ".env.example must remain distributable")

    @unittest.skipUnless(shutil.which("php"), "PHP CLI is not installed")
    def test_php_proxy_files_pass_php_lint(self):
        php_files = [ROOT / "config.example.php", *sorted((ROOT / "api" / "nvidia").glob("*.php"))]
        for path in php_files:
            result = subprocess.run(["php", "-l", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(shutil.which("php"), "PHP CLI is not installed")
    def test_php_dotenv_parser_reads_key_values_without_shell_execution(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            dotenv = Path(temporary_directory) / ".env"
            dotenv.write_text(
                "\n".join(
                    [
                        "# comment",
                        "AI_ENABLED=true",
                        'API_KEY="generic-private-test"',
                        'NVIDIA_API_KEY="nvapi-private-test"',
                        "export NVIDIA_MODEL=z-ai/glm-5.3-flash",
                        "INVALID LINE",
                    ]
                ),
                encoding="utf-8",
            )
            probe = Path(temporary_directory) / "probe.php"
            probe.write_text(
                "<?php require $argv[1]; echo json_encode(studyapp_parse_env_file($argv[2]));",
                encoding="utf-8",
            )
            result = subprocess.run(
                ["php", str(probe), str(ROOT / "api" / "nvidia" / "common.php"), str(dotenv)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                json.loads(result.stdout),
                {
                    "AI_ENABLED": "true",
                    "API_KEY": "generic-private-test",
                    "NVIDIA_API_KEY": "nvapi-private-test",
                    "NVIDIA_MODEL": "z-ai/glm-5.3-flash",
                },
            )

    @unittest.skipUnless(shutil.which("php"), "PHP CLI is not installed")
    def test_php_config_accepts_generic_key_and_keeps_model_out_of_status(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            probe = Path(temporary_directory) / "probe.php"
            probe.write_text(
                "<?php "
                "require $argv[1]; "
                "putenv('API_KEY=generic-test-key'); putenv('AI_ENABLED='); "
                "putenv('AI_API_KEY='); putenv('NVIDIA_API_KEY='); "
                "putenv('AI_MODEL=private-model'); putenv('NVIDIA_MODEL='); "
                "$config=studyapp_config(); "
                "if (($config['nvidia_api_key'] ?? '') !== 'generic-test-key' || studyapp_model($config) !== 'private-model' || ($config['enabled'] ?? false) !== true) exit(3); "
                "$_SERVER['REQUEST_METHOD']='GET'; studyapp_status();",
                encoding="utf-8",
            )
            result = subprocess.run(
                ["php", str(probe), str(ROOT / "api" / "nvidia" / "common.php")],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            status = json.loads(result.stdout)
            self.assertEqual(set(status), {"configured", "reason"})
            self.assertNotIn("private-model", result.stdout)

    @unittest.skipUnless(shutil.which("php"), "PHP CLI is not installed")
    def test_php_reads_key_from_root_config_without_dotenv(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project = Path(temporary_directory)
            api_directory = project / "api" / "nvidia"
            api_directory.mkdir(parents=True)
            shutil.copyfile(ROOT / "api" / "nvidia" / "common.php", api_directory / "common.php")
            (project / "config.php").write_text(
                "<?php return ['enabled' => true, 'api_key' => 'server-side-test-key', 'rate_limit_per_hour' => 30];",
                encoding="utf-8",
            )
            probe = project / "probe.php"
            probe.write_text(
                "<?php require $argv[1]; $config=studyapp_config(); "
                "echo json_encode(['enabled'=>$config['enabled']??false, 'key'=>$config['nvidia_api_key']??'', 'limit'=>$config['rate_limit_per_hour']??0]);",
                encoding="utf-8",
            )
            clean_env = os.environ.copy()
            for name in ("API_KEY", "AI_API_KEY", "NVIDIA_API_KEY", "AI_ENABLED", "AI_MODEL", "NVIDIA_MODEL", "AI_RATE_LIMIT_PER_HOUR"):
                clean_env.pop(name, None)
            result = subprocess.run(
                ["php", str(probe), str(api_directory / "common.php")],
                capture_output=True,
                text=True,
                env=clean_env,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                json.loads(result.stdout),
                {"enabled": True, "key": "server-side-test-key", "limit": 30},
            )


if __name__ == "__main__":
    unittest.main()
