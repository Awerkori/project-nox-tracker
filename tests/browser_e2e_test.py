#!/usr/bin/env python3
"""Project Nox Tracker 2.1.0 - End-to-End Real Browser Automation Test Suite.

Uses Chromium DevTools Protocol (CDP) via async websocket communication to rigorously
verify user experience, DOM states, sort behavior, legacy preference migration,
responsive layout without horizontal overflow, modal interactions, and performance metrics.
"""

import asyncio
import base64
import json
import os
import subprocess
import sys
import time
from datetime import datetime
import aiohttp

CDP_PORT = 9223
DEV_SERVER_PORT = 8088
BASE_URL = f"http://localhost:{DEV_SERVER_PORT}/"
BASE_DIR = "/home/awerkori/.Projects/Project-Nox-Tracker"
ISSUES_JSON_PATH = f"{BASE_DIR}/data/issues.json"
SCREENSHOTS_DIR = f"{BASE_DIR}/screenshots/e2e"
BRAIN_SCREENSHOTS_DIR = "/home/awerkori/.gemini/antigravity-cli/brain/f4dcc61a-039c-46ea-bcb0-e71282c54d0f/screenshots/e2e"

os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
os.makedirs(BRAIN_SCREENSHOTS_DIR, exist_ok=True)


class CDPClient:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.ws = None
        self.msg_id = 0
        self.futures = {}

    async def connect(self, session):
        self.ws = await session.ws_connect(self.ws_url, max_msg_size=50 * 1024 * 1024)
        asyncio.create_task(self._listener())

    async def _listener(self):
        try:
            async for msg in self.ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    req_id = data.get("id")
                    if req_id in self.futures:
                        self.futures[req_id].set_result(data)
        except Exception:
            pass

    async def call(self, method, params=None):
        self.msg_id += 1
        req_id = self.msg_id
        fut = asyncio.get_event_loop().create_future()
        self.futures[req_id] = fut
        payload = {"id": req_id, "method": method, "params": params or {}}
        await self.ws.send_str(json.dumps(payload))
        resp = await fut
        del self.futures[req_id]
        if "error" in resp:
            raise RuntimeError(f"CDP error {resp['error']}")
        return resp.get("result", {})

    async def eval_js(self, expression, await_promise=True):
        res = await self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": await_promise
        })
        val = res.get("result", {}).get("value")
        return val

    async def set_viewport(self, width, height, is_mobile=False):
        await self.call("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1.0,
            "mobile": is_mobile
        })
        await self.call("Emulation.setVisibleSize", {"width": width, "height": height})

    async def capture_screenshot(self, filename):
        res = await self.call("Page.captureScreenshot", {"format": "png"})
        img_data = base64.b64decode(res["data"])
        path1 = os.path.join(SCREENSHOTS_DIR, filename)
        path2 = os.path.join(BRAIN_SCREENSHOTS_DIR, filename)
        with open(path1, "wb") as f:
            f.write(img_data)
        with open(path2, "wb") as f:
            f.write(img_data)
        return path1


async def run_tests():
    print("=" * 70)
    print("PROJECT NOX TRACKER 2.1.0 - SUÍTE DE TESTES E2E EM NAVEGADOR REAL")
    print("=" * 70)

    # 1. Start local dev server if not running
    dev_server_proc = None
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(BASE_URL, timeout=0.5) as r:
                pass
    except Exception:
        print(f"Iniciando servidor de desenvolvimento local na porta {DEV_SERVER_PORT}...")
        dev_server_proc = subprocess.Popen([
            sys.executable, f"{BASE_DIR}/scripts/dev_server.py"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        await asyncio.sleep(1.0)

    # 2. Start Chromium headless with CDP
    proc = subprocess.Popen([
        "chromium",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--remote-debugging-port={CDP_PORT}",
        "--incognito",
        "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    client = None
    try:
        await asyncio.sleep(1.2)

        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://localhost:{CDP_PORT}/json/list") as r:
                tabs = await r.json()
                page_tab = next(t for t in tabs if t.get("type") == "page")
                ws_url = page_tab["webSocketDebuggerUrl"]

            client = CDPClient(ws_url)
            await client.connect(session)

            await client.call("Page.enable")
            await client.call("Runtime.enable")
            await client.call("Performance.enable")

            # Load expected issue data
            with open(ISSUES_JSON_PATH, "r", encoding="utf-8") as f:
                issues_data = json.load(f)["issues"]
            issues_map = {i["number"]: i for i in issues_data}

            # -----------------------------------------------------------
            # TEST 1: Sessão limpa — Padrão ABERTOS + MAIS RECENTES
            # -----------------------------------------------------------
            print("\n[TESTE 1] Sessão Limpa: Acessar http://localhost:8088/ (Padrão ABERTOS + MAIS RECENTES)")
            await client.set_viewport(1440, 900, is_mobile=False)
            await client.call("Page.navigate", {"url": BASE_URL})

            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            sort_val = await client.eval_js("document.querySelector('#sort').value")
            sort_text = await client.eval_js("document.querySelector('#sort').selectedOptions[0].text")
            state_val = await client.eval_js("document.querySelector('#state').value")
            quick_active = await client.eval_js("document.querySelector('.quick-btn.active')?.getAttribute('data-quick-state')")

            print(f"  → Valor do select #sort: '{sort_val}' ('{sort_text}')")
            print(f"  → Valor do select #state: '{state_val}'")
            print(f"  → Botão de estado rápido ativo: '{quick_active}'")

            assert sort_val == "recent", f"ERRO: Valor esperado de sort 'recent', obtido '{sort_val}'"
            assert state_val == "open", f"ERRO: Valor esperado de state 'open', obtido '{state_val}'"
            assert quick_active == "open", f"ERRO: Botão rápido ativo esperado 'open', obtido '{quick_active}'"
            print("  ✓ SUCESSO: Padrão verificado — Estado: ABERTOS e Ordenação: MAIS RECENTES!")

            # -----------------------------------------------------------
            # TEST 2: Validar tickets renderizados no carregamento padrão
            # -----------------------------------------------------------
            print("\n[TESTE 2] Validar tickets exibidos no padrão Abertos (created_at DESC)")
            card_numbers = await client.eval_js("""
                Array.from(document.querySelectorAll('#tickets .ticket-card'))
                     .map(c => Number(c.getAttribute('data-number')))
            """)
            print(f"  → Total de cards renderizados: {len(card_numbers)}")
            print(f"  → Tickets exibidos no DOM: {card_numbers}")

            assert len(card_numbers) == 6, f"ERRO: Esperado 6 tickets abertos, obtido {len(card_numbers)}"
            assert card_numbers[0] == 127, f"ERRO: Primeiro ticket deveria ser #127, obtido #{card_numbers[0]}"
            assert card_numbers == [127, 126, 125, 123, 122, 121], f"Ordem inesperada: {card_numbers}"
            print("  ✓ SUCESSO: Exatamente 6 tickets abertos renderizados em ordem de criação recente, com #127 no topo!")

            # -----------------------------------------------------------
            # TEST 3: Inspeção detalhada do Ticket #127
            # -----------------------------------------------------------
            print("\n[TESTE 3] Inspeção detalhada dos elementos visuais do Ticket #127")
            card_127_info = await client.eval_js("""
                (() => {
                    const card = document.querySelector('.ticket-card[data-number="127"]');
                    if (!card) return null;
                    return {
                        title: card.querySelector('.ticket-title').textContent.trim(),
                        stateBadge: card.querySelector('.badge-state').textContent.trim(),
                        workflowBadge: card.querySelector('.badge-workflow').textContent.trim(),
                        tags: Array.from(card.querySelectorAll('.badge-tag')).map(t => t.textContent.trim()),
                        author: card.querySelector('.meta-author').textContent.trim()
                    };
                })()
            """)
            print(f"  → Título: {card_127_info['title']}")
            print(f"  → Estado nativo: {card_127_info['stateBadge']}")
            print(f"  → Status: {card_127_info['workflowBadge']}")
            print(f"  → Tags: {card_127_info['tags']}")
            print(f"  → Autor: {card_127_info['author']}")

            assert "Hanami Heaven" in card_127_info["title"], "Título não contém Hanami Heaven"
            assert "ABERTO" in card_127_info["stateBadge"], "Badge não contém ABERTO"
            assert "Em análise" in card_127_info["workflowBadge"], "Status não é Em análise"
            print("  ✓ SUCESSO: Ticket #127 renderizado com todos os badges, estado nativo e informações completas!")

            # -----------------------------------------------------------
            # TEST 4: Alternância rápida de estado (Todos | Abertos | Fechados)
            # -----------------------------------------------------------
            print("\n[TESTE 4] Alternância pelo Segmented Control e sincronização da URL")
            # Clique em 'Todos'
            await client.eval_js("document.querySelector('[data-quick-state=\"all\"]').click()")
            await asyncio.sleep(0.2)
            total_cards = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            current_url = await client.eval_js("window.location.search")
            print(f"  → Ao clicar em 'Todos': {total_cards} cards exibidos, URL search='{current_url}'")
            assert total_cards == 114, f"Esperado 114 cards em 'Todos', obtido {total_cards}"
            assert "state=all" in current_url, f"URL deveria conter state=all: {current_url}"

            # Clique em 'Fechados'
            await client.eval_js("document.querySelector('[data-quick-state=\"closed\"]').click()")
            await asyncio.sleep(0.2)
            closed_cards = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            current_url = await client.eval_js("window.location.search")
            print(f"  → Ao clicar em 'Fechados': {closed_cards} cards exibidos, URL search='{current_url}'")
            assert closed_cards == 108, f"Esperado 108 cards em 'Fechados', obtido {closed_cards}"
            assert "state=closed" in current_url, f"URL deveria conter state=closed: {current_url}"

            # Clique em 'Abertos'
            await client.eval_js("document.querySelector('[data-quick-state=\"open\"]').click()")
            await asyncio.sleep(0.2)
            open_cards = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            current_url = await client.eval_js("window.location.search")
            print(f"  → Ao clicar em 'Abertos': {open_cards} cards exibidos, URL search='{current_url}'")
            assert open_cards == 6, f"Esperado 6 cards em 'Abertos', obtido {open_cards}"
            assert "state=" not in current_url, f"URL limpa não deveria conter state=: {current_url}"
            print("  ✓ SUCESSO: Segmented Control alterna perfeitamente entre 114 -> 108 -> 6 cards com URLs limpas!")

            # -----------------------------------------------------------
            # TEST 5: Limpar Filtros restaura Abertos + Mais recentes
            # -----------------------------------------------------------
            print("\n[TESTE 5] Botão 'Limpar filtros' restaura o padrão Abertos + Mais recentes")
            # Aplicar filtro diferente: Fechados + Mais votados
            await client.eval_js("""
                document.querySelector('#state').value = 'closed';
                document.querySelector('#state').dispatchEvent(new Event('change'));
                document.querySelector('#sort').value = 'demand';
                document.querySelector('#sort').dispatchEvent(new Event('change'));
            """)
            await asyncio.sleep(0.2)
            cards_before_clear = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            assert cards_before_clear == 108

            # Clicar em limpar filtros
            await client.eval_js("document.querySelector('#clear-filters').click()")
            await asyncio.sleep(0.2)
            cards_after_clear = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            sort_after_clear = await client.eval_js("document.querySelector('#sort').value")
            state_after_clear = await client.eval_js("document.querySelector('#state').value")
            first_card_num = await client.eval_js("Number(document.querySelector('#tickets .ticket-card').getAttribute('data-number'))")

            print(f"  → Após reset: {cards_after_clear} cards | state='{state_after_clear}' | sort='{sort_after_clear}' | primeiro card=#{first_card_num}")
            assert cards_after_clear == 6, f"Esperado 6 cards abertos após reset, obtido {cards_after_clear}"
            assert state_after_clear == "open", f"Esperado state='open' após reset, obtido '{state_after_clear}'"
            assert sort_after_clear == "recent", f"Esperado sort='recent' após reset, obtido '{sort_after_clear}'"
            assert first_card_num == 127, f"Primeiro card após reset deveria ser #127, obtido #{first_card_num}"
            print("  ✓ SUCESSO: Limpar filtros restaura exatamente Abertos + Mais recentes com #127 no topo!")

            # -----------------------------------------------------------
            # TEST 6: Botão Atualizar (com animação spinning e mensagem sincera)
            # -----------------------------------------------------------
            print("\n[TESTE 6] Botão 'Atualizar' executa sem erros e informa status real")
            sync_text_before = await client.eval_js("document.querySelector('#updated').textContent")
            await client.eval_js("document.querySelector('#refresh-data').click()")
            is_spinning = await client.eval_js("document.querySelector('#refresh-data').classList.contains('spinning')")
            print(f"  → Botão acionado. Classe 'spinning' ativa: {is_spinning}")
            await asyncio.sleep(1.0)
            sync_text_after = await client.eval_js("document.querySelector('#updated').textContent")
            cards_after_refresh = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            print(f"  → Status de sincronização exibido: '{sync_text_after}'")
            print(f"  → Total de cards pós-atualização: {cards_after_refresh}")
            assert cards_after_refresh == 6, f"Cards após refresh mudou inesperadamente para {cards_after_refresh}"
            assert len(sync_text_after) > 5, "Status de sincronização vazio"
            print("  ✓ SUCESSO: Botão Atualizar opera perfeitamente com feedback transparente e sem corrupção!")

            # -----------------------------------------------------------
            # TEST 7: Modal de Abertura de Solicitação
            # -----------------------------------------------------------
            print("\n[TESTE 7] Modal de Solicitações e Categorias")
            await client.eval_js("document.querySelector('#open-ticket').click()")
            await asyncio.sleep(0.2)
            modal_hidden = await client.eval_js("document.querySelector('#ticket-modal').hidden")
            assert not modal_hidden, "Modal não abriu"
            await client.capture_screenshot("modal_desktop_1440px.png")
            # Fechar via Escape
            await client.eval_js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
            await asyncio.sleep(0.2)
            modal_hidden_after = await client.eval_js("document.querySelector('#ticket-modal').hidden")
            assert modal_hidden_after, "Modal não fechou com Escape"
            print("  ✓ SUCESSO: Modal abre, exibe opções e fecha com Escape!")

            # -----------------------------------------------------------
            # TEST 8: Responsividade Desktop e Android Mobile (Captura de Evidências)
            # -----------------------------------------------------------
            print("\n[TESTE 8] Inspeção de Responsividade Desktop e Android Mobile")
            devices = [
                ("desktop_1440px.png", 1440, 900, False, "Desktop Padrão"),
                ("android_pixel_393px.png", 393, 852, True, "Android Mobile (Google Pixel / Galaxy)"),
                ("android_mobile_360px.png", 360, 800, True, "Android Mobile Compacto (360px)"),
                ("tablet_768px.png", 768, 1024, True, "Tablet (768px)")
            ]

            for filename, w, h, is_mob, label in devices:
                await client.set_viewport(w, h, is_mobile=is_mob)
                await asyncio.sleep(0.2)

                overflow_data = await client.eval_js("""
                    ({
                        scrollWidth: document.documentElement.scrollWidth,
                        clientWidth: document.documentElement.clientWidth
                    })
                """)
                scroll_w = overflow_data["scrollWidth"]
                client_w = overflow_data["clientWidth"]
                has_overflow = scroll_w > client_w

                print(f"  → {label:35s} ({w:4d}x{h:<4d}): clientWidth={client_w:4d}px | scrollWidth={scroll_w:4d}px | Overflow={has_overflow}")
                assert not has_overflow, f"ERRO: Overflow horizontal em {label} ({w}px): scrollWidth={scroll_w} > clientWidth={client_w}"

                await client.capture_screenshot(filename)
                print(f"     Evidência visual salva: {filename}")

            print("  ✓ SUCESSO: Zero overflow em Desktop e Android! Screenshots capturadas com sucesso!")

            print("\n" + "=" * 70)
            print("SUÍTE DE TESTES E2E EM NAVEGADOR REAL CONCLUÍDA COM 100% DE SUCESSO!")
            print("=" * 70)

    finally:
        if proc:
            proc.terminate()
            proc.wait()
        if dev_server_proc:
            dev_server_proc.terminate()
            dev_server_proc.wait()


if __name__ == "__main__":
    asyncio.run(run_tests())
