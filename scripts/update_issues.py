#!/usr/bin/env python3
"""Generate static tracker data from the official Project Nox Issues."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

REPOSITORY = "Awerkori/project-nox-requests"
API_URL = f"https://api.github.com/repos/{REPOSITORY}/issues"
OUTPUT = Path("data/issues.json")
FIELDS = ("number", "title", "html_url", "state", "state_reason", "created_at", "updated_at", "closed_at", "comments", "labels", "reactions", "user")


def get_page(page: int) -> list[dict]:
    query = urlencode({"state": "all", "per_page": 100, "page": page})
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "project-nox-tracker"}
    if token := os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{API_URL}?{query}", headers=headers)
    with urlopen(request) as response:  # nosec B310: fixed GitHub API URL
        return json.load(response)


def main() -> None:
    issues, page = [], 1
    while batch := get_page(page):
        issues.extend(issue for issue in batch if "pull_request" not in issue)
        page += 1

    compact = []
    for issue in issues:
        item = {field: issue.get(field) for field in FIELDS}
        item["author"] = {"login": (issue.get("user") or {}).get("login")}
        item.pop("user")
        item["labels"] = [{"name": label["name"], "color": label.get("color")} for label in issue.get("labels", [])]
        reactions = issue.get("reactions") or {}
        item["reactions"] = {"total_count": reactions.get("total_count", 0), "+1": reactions.get("+1", 0)}
        compact.append(item)

    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    generated_at = previous.get("generated_at") if previous.get("issues") == compact else datetime.now(UTC).isoformat()
    payload = {"generated_at": generated_at, "repository": REPOSITORY, "issues": compact}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
