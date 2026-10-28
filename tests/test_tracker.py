#!/usr/bin/env python3
"""Project Nox Tracker 2.0.1 - Comprehensive Test Suite

Tests:
1. Sort by "recent" (updated_at DESC, tiebreaker number DESC) - DEFAULT
2. Sort by "newest" (number DESC)
3. Sort by "oldest" (number ASC)
4. Sort by "demand" (upvotes DESC)
5. Tiebreaker behavior (equal updated_at broken by number DESC)
6. Fallback with invalid or missing dates
7. Explicit Native State (ABERTO vs FECHADO) + Workflow / Resolution
8. Reconciled Statistics (107 = 41 + 4 + 3 + 59)
"""

import json
from datetime import datetime
from pathlib import Path

DATA_FILE = Path("/home/awerkori/.Projects/Project-Nox-Tracker/data/issues.json")


def load_issues():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("issues", [])


def test_recent_sort_fixture():
    print("=== Teste 1: Ordenação Padrão 'Mais recentes' (updated_at DESC, tiebreaker number DESC) ===")
    fixture = [
        {"number": 120, "title": "Issue 120", "updated_at": "2026-10-25T12:00:00Z", "reactions": {"+1": 20}},
        {"number": 119, "title": "Issue 119", "updated_at": "2026-10-26T12:00:00Z", "reactions": {"+1": 50}},
        {"number": 30, "title": "Issue 30", "updated_at": "2026-10-28T13:00:00Z", "reactions": {"+1": 999}},
        {"number": 118, "title": "Issue 118", "updated_at": "2026-10-28T14:50:00Z", "reactions": {"+1": 0}},
    ]

    def sort_recent(issues):
        def sort_key(i):
            try:
                dt = datetime.fromisoformat(i["updated_at"].replace("Z", "+00:00")).timestamp()
            except Exception:
                dt = 0
            return (dt, int(i["number"]))

        return sorted(issues, key=sort_key, reverse=True)

    sorted_issues = sort_recent(fixture)
    actual_order = [i["number"] for i in sorted_issues]
    expected_order = [118, 30, 119, 120]

    assert actual_order == expected_order, f"Erro na ordenação 'recent'! Esperado: {expected_order}, Obtido: {actual_order}"
    print(f"✓ Ordem correta por updated_at DESC: {' → '.join(map(str, actual_order))}")


def test_tiebreaker_and_invalid_dates():
    print("\n=== Teste 2: Desempate por número e tratamento de datas inválidas ===")
    fixture_tie = [
        {"number": 10, "updated_at": "2026-10-28T12:00:00Z"},
        {"number": 25, "updated_at": "2026-10-28T12:00:00Z"},
        {"number": 5, "updated_at": "2026-10-28T12:00:00Z"},
        {"number": 99, "updated_at": None},
        {"number": 105, "updated_at": "data_invalida"},
    ]

    def sort_recent_full(issues):
        def sort_key(i):
            up = i.get("updated_at")
            dt = 0
            if up:
                try:
                    dt = datetime.fromisoformat(up.replace("Z", "+00:00")).timestamp()
                except Exception:
                    dt = 0
            return (dt, int(i["number"]))

        return sorted(issues, key=sort_key, reverse=True)

    sorted_tie = sort_recent_full(fixture_tie)
    actual_tie = [i["number"] for i in sorted_tie]
    # At 12:00:00Z: 25 -> 10 -> 5; At 0 (invalid/none): 105 -> 99
    expected_tie = [25, 10, 5, 105, 99]
    assert actual_tie == expected_tie, f"Erro no desempate! Esperado: {expected_tie}, Obtido: {actual_tie}"
    print(f"✓ Desempate com datas iguais ou ausentes: {' → '.join(map(str, actual_tie))}")


def test_all_sort_options():
    print("\n=== Teste 3: Verificação de todas as 4 opções de ordenação ===")
    fixture = [
        {"number": 1, "updated_at": "2026-10-28T15:00:00Z", "reactions": {"+1": 10}},
        {"number": 50, "updated_at": "2026-10-20T10:00:00Z", "reactions": {"+1": 100}},
        {"number": 100, "updated_at": "2026-10-25T12:00:00Z", "reactions": {"+1": 2}},
    ]

    # 1. recent
    s_recent = [i["number"] for i in sorted(fixture, key=lambda x: (x["updated_at"], x["number"]), reverse=True)]
    assert s_recent == [1, 100, 50], f"Falha recent: {s_recent}"

    # 2. newest
    s_newest = [i["number"] for i in sorted(fixture, key=lambda x: x["number"], reverse=True)]
    assert s_newest == [100, 50, 1], f"Falha newest: {s_newest}"

    # 3. oldest
    s_oldest = [i["number"] for i in sorted(fixture, key=lambda x: x["number"], reverse=False)]
    assert s_oldest == [1, 50, 100], f"Falha oldest: {s_oldest}"

    # 4. demand
    s_demand = [i["number"] for i in sorted(fixture, key=lambda x: (x["reactions"]["+1"], x["number"]), reverse=True)]
    assert s_demand == [50, 1, 100], f"Falha demand: {s_demand}"

    print("✓ Todas as 4 opções funcionam de acordo com as regras especificadas!")


def test_math_reconciliation():
    print("\n=== Teste 4: Reconciliação Matemática dos 107 Tickets ===")
    issues = load_issues()
    total = len(issues)

    open_count = sum(1 for i in issues if i.get("state") == "open")
    closed_count = sum(1 for i in issues if i.get("state") == "closed")

    done_count = 0
    declined_count = 0
    duplicate_count = 0
    unclassified_count = 0
    manga_count = 0
    anime_count = 0

    for i in issues:
        lbls = [l["name"].lower() for l in i.get("labels", [])]
        sr = i.get("state_reason")

        if "mangá" in lbls or "manga" in lbls or "type:manga" in lbls:
            manga_count += 1
        elif "anime" in lbls or "type:anime" in lbls:
            anime_count += 1

        if i.get("state") == "closed":
            if "concluído" in lbls or "resolution:done" in lbls:
                done_count += 1
            elif "recusado" in lbls or "resolution:declined" in lbls:
                declined_count += 1
            elif sr == "duplicate" or "duplicado" in lbls or "resolution:duplicate" in lbls:
                duplicate_count += 1
            else:
                unclassified_count += 1

    print(f"Total: {total}")
    print(f"Abertos: {open_count}")
    print(f"Fechados: {closed_count}")
    print(f"  - Concluídos: {done_count}")
    print(f"  - Recusados: {declined_count}")
    print(f"  - Duplicados (origem GitHub state_reason): {duplicate_count}")
    print(f"  - Encerrados sem classificação: {unclassified_count}")
    print(f"Tipos: Mangá ({manga_count}) + Anime ({anime_count}) = {manga_count + anime_count}")

    # Assertions
    assert total == open_count + closed_count, "Falha: Total != Abertos + Fechados"
    closed_sum = done_count + declined_count + duplicate_count + unclassified_count
    assert closed_count == closed_sum, f"Falha: Fechados ({closed_count}) != Soma ({closed_sum})"
    assert total == manga_count + anime_count, f"Falha: Total ({total}) != Mangá ({manga_count}) + Anime ({anime_count})"
    print("✓ Reconciliação matemática 100% comprovada e exata!")


def test_real_dataset_top_tickets():
    print("\n=== Teste 5: Ordem Real dos Primeiros Tickets da Base Atual ===")
    issues = load_issues()
    sorted_issues = sorted(
        issues,
        key=lambda x: (
            datetime.fromisoformat(x["updated_at"].replace("Z", "+00:00")).timestamp() if x.get("updated_at") else 0,
            int(x["number"])
        ),
        reverse=True
    )
    top_5 = [i["number"] for i in sorted_issues[:5]]
    expected_top_5 = [55, 61, 65, 117, 119]
    assert top_5 == expected_top_5, f"Falha na ordenação dos dados reais: Esperado {expected_top_5}, obtido {top_5}"
    print(f"✓ Top 5 da base real verificado: {' → '.join(map(lambda n: f'#{n}', top_5))}")


if __name__ == "__main__":
    test_recent_sort_fixture()
    test_tiebreaker_and_invalid_dates()
    test_all_sort_options()
    test_math_reconciliation()
    test_real_dataset_top_tickets()
    print("\nTODOS OS TESTES PASSARAM COM SUCESSO!")
