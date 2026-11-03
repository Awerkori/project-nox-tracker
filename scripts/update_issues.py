#!/usr/bin/env python3
"""Generate static tracker data from the official Project Nox Issues."""

import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

REPOSITORY = "Awerkori/project-nox-requests"
API_URL = f"https://api.github.com/repos/{REPOSITORY}/issues"
OUTPUT = Path("data/issues.json")
FIELDS = (
    "number",
    "title",
    "html_url",
    "state",
    "state_reason",
    "created_at",
    "updated_at",
    "closed_at",
    "comments",
    "labels",
    "reactions",
    "user",
)


def get_page(page: int, max_retries: int = 3) -> list[dict]:
    query = urlencode({
        "state": "all",
        "per_page": 100,
        "page": page,
        "sort": "created",
        "direction": "desc",
    })
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "project-nox-tracker",
    }
    if token := os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"

    request = Request(f"{API_URL}?{query}", headers=headers)

    for attempt in range(1, max_retries + 1):
        try:
            with urlopen(request, timeout=30) as response:  # nosec B310: fixed GitHub API URL
                data = json.load(response)
                if not isinstance(data, list):
                    raise ValueError(f"Formato inesperado na resposta da API (esperado list, obtido {type(data)})")
                return data
        except HTTPError as e:
            remaining = e.headers.get("X-RateLimit-Remaining", "unknown")
            reset_ts = e.headers.get("X-RateLimit-Reset", "unknown")
            print(
                f"Erro HTTP {e.code} na página {page} (tentativa {attempt}/{max_retries}). RateLimit-Remaining: {remaining}, Reset: {reset_ts}",
                file=sys.stderr,
            )
            if e.code in (403, 429):
                raise RuntimeError(
                    f"Rate limit atingido na GitHub API! Código {e.code}. Remaining: {remaining}, Reset: {reset_ts}"
                ) from e
            if attempt == max_retries:
                raise
            time.sleep(2**attempt)
        except (URLError, TimeoutError) as e:
            print(f"Erro de rede ({e}) na página {page} (tentativa {attempt}/{max_retries})", file=sys.stderr)
            if attempt == max_retries:
                raise
            time.sleep(2**attempt)
    return []


def main() -> None:
    print(f"Iniciando sincronização de Issues oficiais de {REPOSITORY}...")
    issues, page = [], 1
    total_pr_count = 0

    while True:
        batch = get_page(page)
        if not batch:
            break

        prs_in_batch = sum(1 for item in batch if "pull_request" in item)
        total_pr_count += prs_in_batch
        valid_issues = [item for item in batch if "pull_request" not in item]
        issues.extend(valid_issues)
        print(f"Página {page} processada: {len(batch)} itens recebidos ({len(valid_issues)} issues válidas, {prs_in_batch} PRs ignorados).")

        if len(batch) < 100:
            break
        page += 1
        if page > 50:
            print("Limite de segurança de 50 páginas atingido.", file=sys.stderr)
            break

    if not issues:
        raise ValueError("Nenhuma Issue válida foi obtida da API do GitHub! Abortando para evitar perda de dados.")

    compact = []
    for issue in issues:
        item = {field: issue.get(field) for field in FIELDS}
        item["author"] = {"login": (issue.get("user") or {}).get("login")}
        item.pop("user")
        item["labels"] = [
            {"name": label["name"], "color": label.get("color")}
            for label in issue.get("labels", [])
        ]
        reactions = issue.get("reactions") or {}
        item["reactions"] = {
            "total_count": reactions.get("total_count", 0),
            "+1": reactions.get("+1", 0),
        }
        compact.append(item)

    # Ordenação determinística: mais recentes por data de criação DESC, desempate por número DESC
    compact.sort(key=lambda x: (x.get("created_at") or "", int(x["number"])), reverse=True)

    # Validação de integridade contra snapshot anterior
    previous = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Aviso: Não foi possível ler snapshot anterior ({e}). Gerando novo arquivo.", file=sys.stderr)

    prev_issues = previous.get("issues", [])
    if prev_issues and len(compact) < len(prev_issues) * 0.5:
        raise ValueError(
            f"Alerta de perda de dados: Novo lote contém apenas {len(compact)} issues, enquanto o anterior continha {len(prev_issues)}. Abortando escrita!"
        )

    open_count = sum(1 for i in compact if i.get("state") == "open")
    closed_count = sum(1 for i in compact if i.get("state") == "closed")

    if previous.get("issues") == compact:
        generated_at = previous.get("generated_at")
        print(
            f"Nenhuma alteração nos dados das Issues (total: {len(compact)} | Abertas: {open_count} | Fechadas: {closed_count}). Mantendo timestamp {generated_at}."
        )
    else:
        generated_at = datetime.now(UTC).isoformat()
        print(
            f"Alterações detectadas! Gerando snapshot com {len(compact)} issues (Abertas: {open_count} | Fechadas: {closed_count}). Timestamp: {generated_at}"
        )

    payload = {"generated_at": generated_at, "repository": REPOSITORY, "issues": compact}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp_output = OUTPUT.with_suffix(".tmp")
    temp_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_output.replace(OUTPUT)
    print(f"Snapshot gravado com sucesso em {OUTPUT} ({len(compact)} issues).")


if __name__ == "__main__":
    main()
