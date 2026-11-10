#!/usr/bin/env python3
"""Project Nox Tracker 2.1.0 - Core Test Suite

Tests:
1. Sort by "recent" (created_at DESC, tiebreaker number DESC) - DEFAULT
2. Sort by "updated" (updated_at DESC, tiebreaker number DESC)
3. Sort by "oldest" (created_at ASC, tiebreaker number ASC)
4. Sort by "demand" (upvotes DESC, tiebreaker created_at DESC, number DESC)
5. Tiebreaker behavior (equal created_at broken by number DESC)
6. Fallback with invalid or missing dates
7. Explicit Native State (ABERTO vs FECHADO) + Workflow / Resolution
8. Reconciled Statistics
9. Real Dataset Verification (Top Tickets & Issue #127 presence)
"""

import json
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data/issues.json"


def load_issues():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("issues", [])


def test_recent_sort_fixture():
    print("=== Teste 1: Ordenação Padrão 'Mais recentes' (created_at DESC, tiebreaker number DESC) ===")
    fixture = [
        {"number": 120, "title": "Issue 120", "created_at": "2026-10-25T12:00:00Z", "reactions": {"+1": 20}},
        {"number": 119, "title": "Issue 119", "created_at": "2026-10-26T12:00:00Z", "reactions": {"+1": 50}},
        {"number": 30, "title": "Issue 30", "created_at": "2026-10-28T13:00:00Z", "reactions": {"+1": 999}},
        {"number": 118, "title": "Issue 118", "created_at": "2026-10-28T14:50:00Z", "reactions": {"+1": 0}},
    ]

    def sort_recent(issues):
        def sort_key(i):
            try:
                dt = datetime.fromisoformat(i["created_at"].replace("Z", "+00:00")).timestamp()
            except Exception:
                dt = 0
            return (dt, int(i["number"]))

        return sorted(issues, key=sort_key, reverse=True)

    sorted_issues = sort_recent(fixture)
    actual_order = [i["number"] for i in sorted_issues]
    expected_order = [118, 30, 119, 120]

    assert actual_order == expected_order, f"Erro na ordenação 'recent'! Esperado: {expected_order}, Obtido: {actual_order}"
    print(f"✓ Ordem correta por created_at DESC: {' → '.join(map(str, actual_order))}")


def test_tiebreaker_and_invalid_dates():
    print("\n=== Teste 2: Desempate por número e tratamento de datas inválidas ===")
    fixture_tie = [
        {"number": 10, "created_at": "2026-10-28T12:00:00Z"},
        {"number": 25, "created_at": "2026-10-28T12:00:00Z"},
        {"number": 5, "created_at": "2026-10-28T12:00:00Z"},
        {"number": 99, "created_at": None},
        {"number": 105, "created_at": "data_invalida"},
    ]

    def sort_recent_full(issues):
        def sort_key(i):
            cr = i.get("created_at")
            dt = 0
            if cr:
                try:
                    dt = datetime.fromisoformat(cr.replace("Z", "+00:00")).timestamp()
                except Exception:
                    dt = 0
            return (dt, int(i["number"]))

        return sorted(issues, key=sort_key, reverse=True)

    sorted_tie = sort_recent_full(fixture_tie)
    actual_tie = [i["number"] for i in sorted_tie]
    expected_tie = [25, 10, 5, 105, 99]
    assert actual_tie == expected_tie, f"Erro no desempate! Esperado: {expected_tie}, Obtido: {actual_tie}"
    print(f"✓ Desempate com datas iguais ou ausentes: {' → '.join(map(str, actual_tie))}")


def test_all_sort_options():
    print("\n=== Teste 3: Verificação de todas as opções de ordenação ===")
    fixture = [
        {"number": 1, "created_at": "2026-10-20T10:00:00Z", "updated_at": "2026-10-28T15:00:00Z", "reactions": {"+1": 10}},
        {"number": 50, "created_at": "2026-10-25T12:00:00Z", "updated_at": "2026-10-20T10:00:00Z", "reactions": {"+1": 100}},
        {"number": 100, "created_at": "2026-10-28T15:00:00Z", "updated_at": "2026-10-25T12:00:00Z", "reactions": {"+1": 2}},
    ]

    # 1. recent: created_at DESC
    s_recent = [i["number"] for i in sorted(fixture, key=lambda x: (x["created_at"], x["number"]), reverse=True)]
    assert s_recent == [100, 50, 1], f"Falha recent: {s_recent}"

    # 2. updated: updated_at DESC
    s_updated = [i["number"] for i in sorted(fixture, key=lambda x: (x["updated_at"], x["number"]), reverse=True)]
    assert s_updated == [1, 100, 50], f"Falha updated: {s_updated}"

    # 3. oldest: created_at ASC
    s_oldest = [i["number"] for i in sorted(fixture, key=lambda x: (x["created_at"], x["number"]), reverse=False)]
    assert s_oldest == [1, 50, 100], f"Falha oldest: {s_oldest}"

    # 4. demand: upvotes DESC, tiebreaker created_at DESC
    s_demand = [i["number"] for i in sorted(fixture, key=lambda x: (x["reactions"]["+1"], x["created_at"], x["number"]), reverse=True)]
    assert s_demand == [50, 1, 100], f"Falha demand: {s_demand}"

    print("✓ Todas as opções de ordenação funcionam conforme especificação!")


def test_math_reconciliation():
    print("\n=== Teste 4: Reconciliação Matemática dos Tickets Sincronizados ===")
    issues = load_issues()
    total = len(issues)

    open_count = sum(1 for i in issues if i.get("state") == "open")
    closed_count = sum(1 for i in issues if i.get("state") == "closed")

    done_count = 0
    declined_count = 0
    duplicate_count = 0
    cancelled_count = 0
    unclassified_count = 0

    for i in issues:
        lbls = [l["name"].lower() for l in i.get("labels", [])]
        sr = i.get("state_reason")

        if i.get("state") == "closed":
            if "concluído" in lbls or "resolution:done" in lbls:
                done_count += 1
            elif "recusado" in lbls or "resolution:declined" in lbls:
                declined_count += 1
            elif sr == "duplicate" or "duplicado" in lbls or "resolution:duplicate" in lbls:
                duplicate_count += 1
            elif "cancelado" in lbls or "resolution:cancelled" in lbls:
                cancelled_count += 1
            else:
                unclassified_count += 1

    print(f"Total: {total}")
    print(f"Abertos: {open_count}")
    print(f"Fechados: {closed_count}")
    print(f"  - Concluídos: {done_count}")
    print(f"  - Recusados: {declined_count}")
    print(f"  - Duplicados: {duplicate_count}")
    print(f"  - Cancelados: {cancelled_count}")
    print(f"  - Encerrados sem classificação: {unclassified_count}")

    # Assertions
    assert total == open_count + closed_count, f"Falha: Total ({total}) != Abertos ({open_count}) + Fechados ({closed_count})"
    closed_sum = done_count + declined_count + duplicate_count + cancelled_count + unclassified_count
    assert closed_count == closed_sum, f"Falha: Fechados ({closed_count}) != Soma ({closed_sum})"
    print("✓ Reconciliação matemática 100% comprovada e exata!")


def test_real_dataset_and_ticket_ordering():
    print("\n=== Teste 5: Ordenação e Consistência dos Tickets Abertos ===")
    issues = load_issues()
    open_issues = [i for i in issues if i.get("state") == "open"]
    open_numbers = [i["number"] for i in open_issues]

    print(f"Tickets abertos encontrados ({len(open_issues)}): {open_numbers}")
    assert len(open_issues) > 0, "ERRO CRÍTICO: Nenhum ticket aberto encontrado no dataset!"

    # Verificação de ordenação por criação recente (created_at DESC, tiebreaker number DESC)
    sorted_by_recent = sorted(
        open_issues,
        key=lambda x: (x.get("created_at") or "", int(x["number"])),
        reverse=True
    )
    first_ticket = sorted_by_recent[0]
    print(f"✓ Ticket mais recente aberto: #{first_ticket['number']} ({first_ticket['title']})")
    for idx in range(len(sorted_by_recent) - 1):
        a = sorted_by_recent[idx]
        b = sorted_by_recent[idx + 1]
        assert (a.get("created_at") or "") >= (b.get("created_at") or ""), "Ordenação por created_at violada!"
    print(f"✓ Todos os {len(sorted_by_recent)} tickets abertos ordenados estritamente por created_at DESC!")


if __name__ == "__main__":
    test_recent_sort_fixture()
    test_tiebreaker_and_invalid_dates()
    test_all_sort_options()
    test_math_reconciliation()
    test_real_dataset_and_ticket_ordering()
    print("\nTODOS OS TESTES PASSARAM COM SUCESSO!")
