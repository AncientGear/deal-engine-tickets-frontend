#!/usr/bin/env bash
set -euo pipefail

: "${BUCKET:?BUCKET is required}"
: "${RELEASE_ID:?RELEASE_ID is required}"
: "${DISTRIBUTION_ID:?DISTRIBUTION_ID is required}"

[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ ]] || {
	printf '%s\n' 'Invalid bucket name.' >&2
	exit 1
}
[[ "$RELEASE_ID" =~ ^[0-9]+-[0-9]+$ ]] || {
	printf '%s\n' 'Invalid release ID; expected run_id-run_attempt.' >&2
	exit 1
}
[[ "$DISTRIBUTION_ID" =~ ^[A-Z0-9]+$ ]] || {
	printf '%s\n' 'Invalid CloudFront distribution ID.' >&2
	exit 1
}

workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT

if aws s3 cp \
	"s3://${BUCKET}/releases/${RELEASE_ID}/" \
	"${workdir}/" \
	--recursive \
	--only-show-errors; then
	:
else
	status=$?
	printf '%s\n' 'Failed to download release; promotion aborted.' >&2
	exit "$status"
fi

python3 - "$workdir" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

root = Path(sys.argv[1]).resolve()
index = root / "index.html"
assets = root / "assets"


def fail(message):
	print(message, file=sys.stderr)
	sys.exit(1)


if not index.is_file() or index.stat().st_size == 0:
	fail("Release requires a non-empty index.html.")

if not assets.is_dir() or not any(
	path.is_file() and path.stat().st_size > 0
	for path in assets.rglob("*")
):
	fail("Release requires non-empty assets.")


class ValidateHTML(HTMLParser):
	def handle_starttag(self, tag, attributes):
		attributes = dict(attributes)
		references = []

		if tag in ("script", "img", "source"):
			references.append(attributes.get("src"))
		elif tag == "link":
			relations = attributes.get("rel", "").lower().split()
			if any(item in relations for item in (
				"stylesheet", "icon", "modulepreload", "preload"
			)):
				references.append(attributes.get("href"))

		for reference in filter(None, references):
			url = urlsplit(reference)
			if url.scheme or url.netloc:
				continue
			relative = unquote(url.path).lstrip("/")
			if not relative:
				continue
			target = (root / relative).resolve()
			if not target.is_relative_to(root):
				fail("HTML references a path outside the release.")
			if not target.is_file() or target.stat().st_size == 0:
				fail(f"HTML references a missing or empty file: {relative}")


ValidateHTML().feed(index.read_text(encoding="utf-8"))
PY

# Publish dependencies first; keep older objects for previous HTML.
aws s3 cp \
	"${workdir}/" \
	"s3://${BUCKET}/current/" \
	--recursive \
	--exclude "index.html" \
	--only-show-errors

# Publish the entry point only after its dependencies are available.
aws s3 cp \
	"${workdir}/index.html" \
	"s3://${BUCKET}/current/index.html" \
	--only-show-errors

aws cloudfront create-invalidation \
	--distribution-id "$DISTRIBUTION_ID" \
	--paths "/" "/index.html" \
	--query 'Invalidation.Id' \
	--output text

printf 'Promoted release: %s\n' "$RELEASE_ID"