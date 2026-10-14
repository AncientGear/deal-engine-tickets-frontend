import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "promote-release.sh"

MOCK_AWS = """#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shutil
import sys

args = sys.argv[1:]
with open(os.environ["AWS_CALLS"], "a") as log:
       log.write(json.dumps(args) + "\\n")

if args[:2] == ["s3", "cp"] and "/releases/" in args[2]:
    if os.environ.get("FAIL_DOWNLOAD") == "1":
        sys.exit(23)
    shutil.copytree(os.environ["FIXTURE"], args[3], dirs_exist_ok=True)

elif args[:2] == ["s3", "cp"] and "/current/" in args[3]:
    failure = os.environ.get("FAIL_WRITE", "")
    if failure == "assets" and "--recursive" in args:
        print("Simulated assets upload failure.", file=sys.stderr)
        sys.exit(31)
    if failure == "html" and args[3].endswith("/index.html"):
        print("Simulated HTML upload failure.", file=sys.stderr)
        sys.exit(32)

elif args[:2] == ["cloudfront", "create-invalidation"]:
    pass

else:
    print("Unexpected AWS command.", file=sys.stderr)
    sys.exit(24)
"""


class PromotionTests(unittest.TestCase):
    def run_promotion(self, invalid=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture"
            assets = fixture / "assets"
            assets.mkdir(parents=True)
            (fixture / "index.html").write_text(
                '<script type="module" src="/assets/index-test123.js"></script>'
            )
            (assets / "index-test123.js").write_text("console.log('fixture');")

            if invalid == "missing_index":
                (fixture / "index.html").unlink()
            elif invalid == "missing_asset":
                (assets / "index-test123.js").unlink()

            binary = root / "bin"
            binary.mkdir()
            aws = binary / "aws"
            aws.write_text(MOCK_AWS)
            aws.chmod(0o755)
            calls_path = root / "calls.jsonl"

            env = {
                **os.environ,
                "PATH": f"{binary}:{os.environ['PATH']}",
                "FIXTURE": str(fixture),
                "AWS_CALLS": str(calls_path),
                "FAIL_DOWNLOAD": "1" if invalid == "download_failure" else "0",
                "BUCKET": "test-bucket",
                "RELEASE_ID": "123-1",
                "DISTRIBUTION_ID": "ETEST123",
                "FAIL_WRITE": {
                    "assets_failure": "assets",
                    "html_failure": "html",
                }.get(invalid, ""),
            }
            result = subprocess.run(
                ["bash", str(SCRIPT)],
                env=env, capture_output=True, text=True,
            )
            calls = [
                json.loads(line)
                for line in calls_path.read_text().splitlines()
            ] if calls_path.exists() else []
            return result, calls

    def test_success_publishes_assets_before_html_without_deleting(self):
        result, calls = self.run_promotion()
        self.assertEqual(result.returncode, 0, result.stderr)

        writes = [
            call for call in calls
            if call[:2] == ["s3", "cp"]
            and call[3].startswith("s3://test-bucket/current/")
        ]
        self.assertGreaterEqual(len(writes), 2)
        self.assertIn("--recursive", writes[0])
        self.assertIn("--exclude", writes[0])
        self.assertIn("index.html", writes[0])
        self.assertEqual(writes[-1][3], "s3://test-bucket/current/index.html")
        self.assertEqual(calls[-1][:2], ["cloudfront", "create-invalidation"])
        self.assertIn("ETEST123", calls[-1])
        self.assertTrue(all("--delete" not in call for call in calls))

    def test_invalid_release_does_not_write_or_invalidate(self):
        for invalid in ("missing_index", "missing_asset", "download_failure"):
            with self.subTest(invalid=invalid):
                result, calls = self.run_promotion(invalid)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(result.stderr.strip())
                if invalid == "download_failure":
                    self.assertEqual(result.returncode, 23)
                    self.assertEqual(
                        result.stderr,
                        "Failed to download release; promotion aborted.\n",
                    )
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][:2], ["s3", "cp"])
                self.assertTrue(calls[0][2].startswith(
                    "s3://test-bucket/releases/"
                ))

    def test_write_failure_stops_following_operations(self):
        for invalid, code, message, expected_writes in (
            ("assets_failure", 31,
            "Simulated assets upload failure.\n", 1),
            ("html_failure", 32,
            "Simulated HTML upload failure.\n", 2),
        ):
            with self.subTest(invalid=invalid):
                result, calls = self.run_promotion(invalid)
                self.assertEqual(result.returncode, code)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, message)

                writes = [
                    call for call in calls
                    if call[:2] == ["s3", "cp"]
                    and "/current/" in call[3]
                ]
                self.assertEqual(len(writes), expected_writes)
                self.assertFalse(any(
                    call[:2] == ["cloudfront", "create-invalidation"]
                    for call in calls
                ))
                if invalid == "assets_failure":
                    self.assertFalse(any(
                        call[3].endswith("/index.html")
                        for call in writes
                    ))

if __name__ == "__main__":
    unittest.main()