#!/usr/bin/env python3
"""Project Nox Tracker - Verification of User Requested Scenarios.

Scenarios:
1. URL limpa: obrigatoriamente Estado = Abertos (6 tickets) e Ordenação = Mais recentes (#127 no topo).
   Tickets fechados NÃO estão misturados.
2. Atualizar a página (F5 / Reload) e botão Atualizar: mantém Abertos + Mais recentes.
3. Botão de limpar filtros: se estava em Fechados ou Todos, volta obrigatoriamente para Abertos + Mais recentes.
4. Celular (Mobile 393x852): abre em Abertos + Mais recentes, zero overflow horizontal.
5. Filtros explícitos na URL: ?state=all e ?state=closed continuam funcionando soberanamente.
"""

import asyncio
import base64
import json
import os
import subprocess
import sys
import aiohttp

CDP_PORT = 9226
DEV_PORT = 8088
BASE_URL = f"http://localhost:{DEV_PORT}/"
BASE_DIR = "/home/awerkori/.Projects/Project-Nox-Tracker"
BRAIN_DIR = "/home/awerkori/.gemini/antigravity-cli/brain/f4dcc61a-039c-46ea-bcb0-e71282c54d0f/screenshots/e2e"

os.makedirs(BRAIN_DIR, exist_ok=True)


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
        with open(f"{BRAIN_DIR}/{filename}", "wb") as f:
            f.write(img_data)
        print(f"  [SCREENSHOT] Salvo: {filename}")


async def run():
    print("Iniciando dev_server.py na porta", DEV_PORT)
    dev_proc = subprocess.Popen([
        sys.executable, f"{BASE_DIR}/scripts/dev_server.py"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1.0)

    chrome_proc = subprocess.Popen([
        "chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
        f"--remote-debugging-port={CDP_PORT}", "--incognito", "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1.2)

    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"http://localhost:{CDP_PORT}/json/list") as r:
                tabs = await r.json()
                page_tab = next(t for t in tabs if t.get("type") == "page")
                ws_url = page_tab["webSocketDebuggerUrl"]

            client = CDPClient(ws_url)
            await client.connect(s)

            await client.call("Page.enable")
            await client.call("Runtime.enable")
            await client.set_viewport(1440, 900, is_mobile=False)

            # -------------------------------------------------------------
            # CENÁRIO 1: Acessar URL limpa
            # -------------------------------------------------------------
            print("\n[CENÁRIO 1] Acessar URL limpa (sem query params)")
            await client.call("Page.navigate", {"url": BASE_URL})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            cards = await client.eval_js("""
                Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => ({
                    number: Number(c.getAttribute('data-number')),
                    stateClass: c.className,
                    stateBadge: c.querySelector('.badge-state')?.textContent?.trim(),
                    title: c.querySelector('.ticket-title')?.textContent?.trim()
                }))
            """)
            print(f"  → Total de cards: {len(cards)}")
            for c in cards:
                print(f"     #{c['number']} | {c['stateBadge']} | {c['title']}")

            assert len(cards) == 6, f"Esperado exatamente 6 cards, obtido {len(cards)}"
            assert all("ABERTO" in c["stateBadge"] for c in cards), "ERRO: Tickets fechados misturados na página inicial!"
            assert cards[0]["number"] == 127, f"ERRO: Ticket #127 deveria ser o primeiro, obtido #{cards[0]['number']}"
            assert [c["number"] for c in cards] == [127, 126, 125, 123, 122, 121], "Ordem incorreta de criação recente!"

            # Scroll até os cards e capturar
            await client.eval_js("document.querySelector('#tickets').scrollIntoView()")
            await asyncio.sleep(0.3)
            await client.capture_screenshot("cenario1_url_limpa_abertos.png")
            print("✓ CENÁRIO 1 CONFIRMADO: Página inicial abre com 6 tickets ABERTOS, ordenados por MAIS RECENTES (#127 no topo). ZERO tickets fechados misturados!")

            # -------------------------------------------------------------
            # CENÁRIO 2: Atualizar a página (Reload e botão Atualizar)
            # -------------------------------------------------------------
            print("\n[CENÁRIO 2] Atualizar a página (Page.reload e botão Atualizar)")
            await client.call("Page.reload", {})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            cards_after_reload = await client.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            assert cards_after_reload == [127, 126, 125, 123, 122, 121], f"Cards após reload alterados: {cards_after_reload}"

            # Clicar no botão Atualizar (#refresh-data)
            await client.eval_js("document.querySelector('#refresh-data').click()")
            await asyncio.sleep(1.0)
            cards_after_refresh_btn = await client.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            assert cards_after_refresh_btn == [127, 126, 125, 123, 122, 121], f"Cards após botão atualizar alterados: {cards_after_refresh_btn}"
            print("✓ CENÁRIO 2 CONFIRMADO: Recarregamento e botão Atualizar mantêm estritamente Abertos + Mais recentes!")

            # -------------------------------------------------------------
            # CENÁRIO 3: Botão de limpar filtros
            # -------------------------------------------------------------
            print("\n[CENÁRIO 3] Botão de limpar filtros restaura Abertos + Mais recentes")
            # Mudar para 'Todos'
            await client.eval_js("document.querySelector('[data-quick-state=\"all\"]').click()")
            await asyncio.sleep(0.2)
            count_all = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            assert count_all == 114, f"Esperado 114 em Todos, obtido {count_all}"

            # Clicar em Limpar filtros
            await client.eval_js("document.querySelector('#clear-filters').click()")
            await asyncio.sleep(0.2)
            cards_after_clear = await client.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            state_val_clear = await client.eval_js("document.querySelector('#state').value")
            sort_val_clear = await client.eval_js("document.querySelector('#sort').value")
            assert cards_after_clear == [127, 126, 125, 123, 122, 121]
            assert state_val_clear == "open"
            assert sort_val_clear == "recent"
            print("✓ CENÁRIO 3 CONFIRMADO: Limpar filtros restaura obrigatoriamente Abertos + Mais recentes (6 cards, #127 no topo)!")

            # -------------------------------------------------------------
            # CENÁRIO 4: Abrir no celular (Mobile Android 393x852)
            # -------------------------------------------------------------
            print("\n[CENÁRIO 4] Abrir no celular (Android 393x852)")
            await client.set_viewport(393, 852, is_mobile=True)
            await client.call("Page.navigate", {"url": BASE_URL})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            mobile_cards = await client.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            assert mobile_cards == [127, 126, 125, 123, 122, 121], f"Cards no mobile incorretos: {mobile_cards}"

            # Verificar overflow horizontal
            overflow = await client.eval_js("document.documentElement.scrollWidth > document.documentElement.clientWidth")
            assert not overflow, "ERRO: Overflow horizontal detectado no celular!"

            await client.capture_screenshot("cenario4_celular_topo.png")
            await client.eval_js("document.querySelector('#tickets').scrollIntoView()")
            await asyncio.sleep(0.3)
            await client.capture_screenshot("cenario4_celular_cards.png")
            print("✓ CENÁRIO 4 CONFIRMADO: No celular abre com Abertos + Mais recentes, zero overflow horizontal!")

            # -------------------------------------------------------------
            # CENÁRIO 5: Filtros explícitos na URL preservados
            # -------------------------------------------------------------
            print("\n[CENÁRIO 5] Filtros explícitos na URL preservados")
            await client.call("Page.navigate", {"url": f"{BASE_URL}?state=all"})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length === 114")
                if ready:
                    break
                await asyncio.sleep(0.1)
            count_url_all = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            assert count_url_all == 114, f"Falha ?state=all: {count_url_all}"

            await client.call("Page.navigate", {"url": f"{BASE_URL}?state=closed"})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length === 108")
                if ready:
                    break
                await asyncio.sleep(0.1)
            count_url_closed = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            assert count_url_closed == 108, f"Falha ?state=closed: {count_url_closed}"
            print("✓ CENÁRIO 5 CONFIRMADO: URLs explícitas (?state=all e ?state=closed) continuam funcionando soberanamente!")

            print("\n" + "=" * 70)
            print("TODOS OS CENÁRIOS FORAM CONFIRMADOS COM SUCESSO ABSOLUTO!")
            print("=" * 70)

    finally:
        chrome_proc.terminate()
        dev_proc.terminate()


if __name__ == "__main__":
    asyncio.run(run())
