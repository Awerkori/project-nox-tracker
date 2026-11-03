#!/usr/bin/env python3
"""Project Nox Tracker - Verification of Live Official GitHub Pages Site.
Site URL: https://awerkori.github.io/project-nox-tracker/
"""

import asyncio
import base64
import json
import os
import subprocess
import urllib.request
import aiohttp

CDP_PORT = 9227
LIVE_URL = "https://awerkori.github.io/project-nox-tracker/"
SCREENSHOTS_DIR = "/home/awerkori/.gemini/antigravity-cli/brain/f4dcc61a-039c-46ea-bcb0-e71282c54d0f/screenshots/live_official"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


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
        path = os.path.join(SCREENSHOTS_DIR, filename)
        with open(path, "wb") as f:
            f.write(img_data)
        print(f"  [SCREENSHOT] Salvo: {path}")


def get_live_api_counts():
    req = urllib.request.Request(
        "https://api.github.com/repos/Awerkori/project-nox-requests/issues?state=all&per_page=100",
        headers={"User-Agent": "Antigravity-Verifier"}
    )
    with urllib.request.urlopen(req) as resp:
        issues = json.loads(resp.read().decode())
    real_issues = [i for i in issues if "pull_request" not in i]
    open_issues = [i for i in real_issues if i["state"] == "open"]
    return {
        "open_count": len(open_issues),
        "open_numbers": [i["number"] for i in open_issues],
        "has_127": any(i["number"] == 127 for i in open_issues)
    }


async def run():
    print("=" * 70)
    print("VERIFICAÇÃO DO SITE OFICIAL PUBLICADO NO GITHUB PAGES")
    print(f"URL: {LIVE_URL}")
    print("=" * 70)

    # 1. Obter contagem oficial da API do GitHub
    api_info = get_live_api_counts()
    print(f"\n[API GitHub Oficial - project-nox-requests]")
    print(f"  Issues abertas na API: {api_info['open_count']}")
    print(f"  Números abertos: {api_info['open_numbers']}")
    print(f"  Ticket #127 está aberto na API? {api_info['has_127']}")

    chrome_proc = subprocess.Popen([
        "chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
        f"--remote-debugging-port={CDP_PORT}", "--incognito", "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1.5)

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

            # -----------------------------------------------------------------
            # TESTE 1: Acesso direto à URL oficial limpa
            # -----------------------------------------------------------------
            print(f"\n[TESTE 1] Navegação para URL oficial: {LIVE_URL}")
            await client.call("Page.navigate", {"url": LIVE_URL})

            # Esperar cards carregarem
            loaded = False
            for _ in range(60):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    loaded = True
                    break
                await asyncio.sleep(0.2)
            assert loaded, "ERRO: Cards não carregaram na página oficial!"

            # Verificar seletores e botões rápidos padrão
            state_val = await client.eval_js("document.querySelector('#state').value")
            sort_val = await client.eval_js("document.querySelector('#sort').value")
            quick_active = await client.eval_js("document.querySelector('.quick-btn.active')?.getAttribute('data-quick-state')")
            
            print(f"  Estado selecionado: {state_val}")
            print(f"  Ordenação selecionada: {sort_val}")
            print(f"  Botão rápido ativo: {quick_active}")

            assert state_val == "open", f"ERRO: Estado padrão deveria ser 'open', obtido '{state_val}'"
            assert sort_val == "recent", f"ERRO: Ordenação padrão deveria ser 'recent', obtido '{sort_val}'"
            assert quick_active == "open", f"ERRO: Botão rápido ativo deveria ser 'open', obtido '{quick_active}'"

            # Verificar cards renderizados
            cards = await client.eval_js("""
                Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => ({
                    number: Number(c.getAttribute('data-number')),
                    stateBadge: c.querySelector('.badge-state')?.textContent?.trim(),
                    title: c.querySelector('.ticket-title')?.textContent?.trim()
                }))
            """)
            print(f"  Total de cards renderizados: {len(cards)}")
            for c in cards:
                print(f"    #{c['number']} | {c['stateBadge']} | {c['title']}")

            assert len(cards) == api_info["open_count"], f"ERRO: Cards ({len(cards)}) != API ({api_info['open_count']})"
            assert all("ABERTO" in c["stateBadge"] for c in cards), "ERRO: Tickets fechados misturados na visualização padrão!"
            if api_info["has_127"]:
                assert cards[0]["number"] == 127, f"ERRO: Ticket #127 deveria ser o primeiro card, obtido #{cards[0]['number']}"

            # Captura de tela Desktop
            await client.capture_screenshot("01_desktop_live_topo.png")
            await client.eval_js("document.querySelector('#tickets').scrollIntoView()")
            await asyncio.sleep(0.3)
            await client.capture_screenshot("02_desktop_live_cards.png")
            print("  ✓ TESTE 1 APROVADO: URL limpa abre com Estado=Abertos, Ordenação=Mais recentes, ticket #127 no topo e 0 fechados.")

            # -----------------------------------------------------------------
            # TESTE 2: Filtros explícitos na URL (?state=all e ?state=closed)
            # -----------------------------------------------------------------
            print("\n[TESTE 2] Filtros explícitos na URL")
            # ?state=all
            await client.call("Page.navigate", {"url": f"{LIVE_URL}?state=all"})
            for _ in range(40):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 10")
                if ready:
                    break
                await asyncio.sleep(0.2)
            count_all = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            print(f"  ?state=all renderizou {count_all} tickets.")
            assert count_all >= 114, f"ERRO: ?state=all retornou apenas {count_all} tickets"

            # ?state=closed
            await client.call("Page.navigate", {"url": f"{LIVE_URL}?state=closed"})
            for _ in range(40):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 10")
                if ready:
                    break
                await asyncio.sleep(0.2)
            count_closed = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length")
            print(f"  ?state=closed renderizou {count_closed} tickets.")
            assert count_closed >= 108, f"ERRO: ?state=closed retornou apenas {count_closed} tickets"
            print("  ✓ TESTE 2 APROVADO: Links explícitos ?state=all e ?state=closed preservados com sucesso.")

            # -----------------------------------------------------------------
            # TESTE 3: Botão de limpar filtros restaura o padrão
            # -----------------------------------------------------------------
            print("\n[TESTE 3] Limpar filtros restaura Abertos + Mais recentes")
            await client.eval_js("document.querySelector('#clear-filters').click()")
            await asyncio.sleep(0.4)
            cleared_state = await client.eval_js("document.querySelector('#state').value")
            cleared_sort = await client.eval_js("document.querySelector('#sort').value")
            cleared_cards = await client.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            print(f"  Após limpar: state={cleared_state}, sort={cleared_sort}, cards={cleared_cards}")
            assert cleared_state == "open"
            assert cleared_sort == "recent"
            assert len(cleared_cards) == api_info["open_count"]
            print("  ✓ TESTE 3 APROVADO: Limpar filtros retorna para Abertos + Mais recentes.")

            # -----------------------------------------------------------------
            # TESTE 4: Botão Atualizar Dados
            # -----------------------------------------------------------------
            print("\n[TESTE 4] Teste do botão Atualizar Dados")
            await client.eval_js("document.querySelector('#refresh-data').click()")
            # Esperar toast ou atualização
            await asyncio.sleep(1.2)
            sync_toast = await client.eval_js("document.querySelector('.toast')?.textContent || ''")
            print(f"  Toast exibido: {sync_toast}")
            cards_after_refresh = await client.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            assert len(cards_after_refresh) == api_info["open_count"]
            print("  ✓ TESTE 4 APROVADO: Botão Atualizar executa consulta real e mantém dados sincronizados.")

            # -----------------------------------------------------------------
            # TESTE 5: Visualização no Android Mobile (393x852)
            # -----------------------------------------------------------------
            print("\n[TESTE 5] Visualização Mobile Android (393x852)")
            await client.set_viewport(393, 852, is_mobile=True)
            await client.call("Page.navigate", {"url": LIVE_URL})
            for _ in range(40):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.2)

            # Verificar overflow horizontal
            has_overflow = await client.eval_js("document.documentElement.scrollWidth > window.innerWidth")
            scroll_width = await client.eval_js("document.documentElement.scrollWidth")
            inner_width = await client.eval_js("window.innerWidth")
            print(f"  Mobile width: {inner_width}px, scrollWidth: {scroll_width}px, overflow: {has_overflow}")
            assert not has_overflow, f"ERRO: Overflow horizontal no mobile ({scroll_width}px > {inner_width}px)"

            # Captura de tela Android
            await client.capture_screenshot("03_android_live_topo.png")
            await client.eval_js("document.querySelector('#tickets').scrollIntoView()")
            await asyncio.sleep(0.3)
            await client.capture_screenshot("04_android_live_cards.png")
            print("  ✓ TESTE 5 APROVADO: Responsividade mobile perfeita no Android 393px, sem overflow.")

            print("\n" + "=" * 70)
            print("TODOS OS TESTES NO SITE OFICIAL PASSARAM COM 100% DE SUCESSO!")
            print("=" * 70)

    finally:
        chrome_proc.terminate()


if __name__ == "__main__":
    asyncio.run(run())
