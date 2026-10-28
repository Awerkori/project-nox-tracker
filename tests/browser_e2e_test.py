#!/usr/bin/env python3
"""Project Nox Tracker 2.0.1 - End-to-End Real Browser Automation Test Suite
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
BASE_URL = "http://localhost:8088/"
ISSUES_JSON_PATH = "/home/awerkori/.Projects/Project-Nox-Tracker/data/issues.json"
SCREENSHOTS_DIR = "/home/awerkori/.Projects/Project-Nox-Tracker/screenshots/e2e"
BRAIN_SCREENSHOTS_DIR = "/home/awerkori/.gemini/antigravity-cli/brain/f09dc443-be98-401e-8aba-5270296e5f60/screenshots/e2e"

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
        except Exception as e:
            # print("Listener closed:", e)
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
    print("PROJECT NOX TRACKER 2.0.1 - SUÍTE DE TESTES E2E EM NAVEGADOR REAL")
    print("=" * 70)

    # 1. Start Chromium headless with CDP
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
            # TEST 1: Navegação limpa e verificação inicial do seletor
            # -----------------------------------------------------------
            print("\n[TESTE 1] Sessão Limpa: Acessar http://localhost:8088/")
            await client.set_viewport(1440, 900, is_mobile=False)
            await client.call("Page.navigate", {"url": BASE_URL})

            # Wait for data load
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            sort_val = await client.eval_js("document.querySelector('#sort').value")
            sort_text = await client.eval_js("document.querySelector('#sort').selectedOptions[0].text")
            print(f"  → Valor do select #sort: '{sort_val}'")
            print(f"  → Texto visível no select: '{sort_text}'")

            assert sort_val == "recent", f"ERRO: Valor esperado 'recent', mas obteve '{sort_val}'"
            assert "Mais recentes" in sort_text, f"ERRO: Texto visual não contém 'Mais recentes': '{sort_text}'"
            print("  ✓ SUCESSO: Seletor exibe 'Mais recentes' como padrão no carregamento limpo!")

            # -----------------------------------------------------------
            # TEST 2: Ordenação real dos cards renderizados no DOM
            # -----------------------------------------------------------
            print("\n[TESTE 2] Validar ordem real dos tickets exibidos por updated_at DESC")
            card_numbers = await client.eval_js("""
                Array.from(document.querySelectorAll('#tickets .ticket-card'))
                     .map(c => Number(c.getAttribute('data-number')))
            """)
            print(f"  → Total de cards renderizados: {len(card_numbers)}")
            print(f"  → Primeiros 6 tickets no DOM: {card_numbers[:6]}")

            # Verify descending order of updated_at
            for idx in range(len(card_numbers) - 1):
                num_a = card_numbers[idx]
                num_b = card_numbers[idx + 1]
                iss_a = issues_map[num_a]
                iss_b = issues_map[num_b]
                time_a = iss_a.get("updated_at") or ""
                time_b = iss_b.get("updated_at") or ""
                if time_a != time_b:
                    assert time_a >= time_b, f"Inconsistência de ordenação entre #{num_a} ({time_a}) e #{num_b} ({time_b})"
                else:
                    assert num_a >= num_b, f"Falha no desempate por number entre #{num_a} e #{num_b}"

            print("  ✓ SUCESSO: Todos os tickets no DOM seguem rigorosamente updated_at DESC com desempate por number DESC!")
            print(f"  → Top 5 confirmados: #{card_numbers[0]} ({issues_map[card_numbers[0]]['title']}) [{issues_map[card_numbers[0]]['updated_at']}]")
            for n in card_numbers[1:5]:
                print(f"                       #{n} ({issues_map[n]['title']}) [{issues_map[n]['updated_at']}]")

            # -----------------------------------------------------------
            # TEST 3: Recarregar a página (Simulação de Reload / F5)
            # -----------------------------------------------------------
            print("\n[TESTE 3] Recarregar a página e confirmar permanência de 'Mais recentes'")
            await client.call("Page.reload", {})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            sort_val_after_reload = await client.eval_js("document.querySelector('#sort').value")
            first_card_after_reload = await client.eval_js("Number(document.querySelector('#tickets .ticket-card').getAttribute('data-number'))")
            assert sort_val_after_reload == "recent", f"ERRO após reload: {sort_val_after_reload}"
            assert first_card_after_reload == card_numbers[0], f"ERRO: Primeiro card mudou após reload: #{first_card_after_reload}"
            print(f"  ✓ SUCESSO: Após reload, #sort continua 'recent' e primeiro card permanece #{first_card_after_reload}!")

            # -----------------------------------------------------------
            # TEST 4: Migração segura contra preferências antigas (localStorage)
            # -----------------------------------------------------------
            print("\n[TESTE 4] Simular preferência antiga 'demand' persistida no localStorage")
            await client.eval_js("""
                localStorage.setItem('nox_tracker_sort', 'demand');
                localStorage.setItem('tracker_sort', 'demand');
                localStorage.setItem('sort_preference', 'demand');
                sessionStorage.setItem('tracker_sort', 'demand');
            """)
            # Reload page with simulated legacy storage
            await client.call("Page.reload", {})
            for _ in range(50):
                ready = await client.eval_js("document.querySelectorAll('#tickets .ticket-card').length > 0")
                if ready:
                    break
                await asyncio.sleep(0.1)

            sort_val_legacy = await client.eval_js("document.querySelector('#sort').value")
            cleaned_check = await client.eval_js("localStorage.getItem('nox_tracker_sort') || localStorage.getItem('tracker_sort')")
            print(f"  → Valor do select após migração: '{sort_val_legacy}'")
            print(f"  → Chaves legadas no localStorage: '{cleaned_check}'")
            assert sort_val_legacy == "recent", f"ERRO: Preferência antiga sobrescreveu o padrão! Obtido: '{sort_val_legacy}'"
            assert cleaned_check is None, "ERRO: Chaves antigas não foram limpas do localStorage!"
            print("  ✓ SUCESSO: Migração limpa preferências antigas e mantém 'recent' inabalável!")

            # -----------------------------------------------------------
            # TEST 5: Alternância manual para 'demand' e posterior reset
            # -----------------------------------------------------------
            print("\n[TESTE 5] Alternância manual para 'Mais votados' e posterior limpeza")
            await client.eval_js("""
                const sel = document.querySelector('#sort');
                sel.value = 'demand';
                sel.dispatchEvent(new Event('change'));
            """)
            await asyncio.sleep(0.2)
            first_card_demand = await client.eval_js("Number(document.querySelector('#tickets .ticket-card').getAttribute('data-number'))")
            chips_count = await client.eval_js("document.querySelectorAll('#filter-chips .chip').length")
            print(f"  → Primeiro card sob 'demand' (Mais votados): #{first_card_demand} (Votos: {issues_map[first_card_demand]['reactions']['+1']})")
            print(f"  → Chip de filtro de ordem gerado: {chips_count} chip(s)")
            assert issues_map[first_card_demand]['reactions']['+1'] >= 1, "ERRO: Card mais votado deveria ter pelo menos 1 voto!"

            # Reset filters
            await client.eval_js("document.querySelector('#clear-filters').click()")
            await asyncio.sleep(0.2)
            sort_val_reset = await client.eval_js("document.querySelector('#sort').value")
            first_card_reset = await client.eval_js("Number(document.querySelector('#tickets .ticket-card').getAttribute('data-number'))")
            assert sort_val_reset == "recent", f"ERRO no reset: {sort_val_reset}"
            assert first_card_reset == card_numbers[0], f"ERRO: Primeiro card não restaurou #{card_numbers[0]}"
            print(f"  ✓ SUCESSO: Alternância manual funciona perfeitamente e reset restaura 'recent' (# {first_card_reset})!")

            # -----------------------------------------------------------
            # TEST 6: Inspeção de Responsividade e Verificação de Overflow
            # -----------------------------------------------------------
            print("\n[TESTE 6] Inspeção de Breakpoints Responsivos e Ausência de Overflow")
            breakpoints = [
                (320, 800, True, "mobile_320px.png"),
                (360, 800, True, "mobile_360px.png"),
                (375, 667, True, "mobile_375px.png"),
                (390, 844, True, "mobile_390px.png"),
                (430, 932, True, "mobile_430px.png"),
                (768, 1024, True, "tablet_768px.png"),
                (1024, 768, False, "desktop_1024px.png"),
                (1280, 800, False, "desktop_1280px.png"),
                (1440, 900, False, "desktop_1440px.png"),
                (1920, 1080, False, "desktop_1920px.png"),
            ]

            for width, height, is_mobile, filename in breakpoints:
                await client.set_viewport(width, height, is_mobile=is_mobile)
                await asyncio.sleep(0.15)

                overflow_data = await client.eval_js("""
                    ({
                        scrollWidth: document.documentElement.scrollWidth,
                        clientWidth: document.documentElement.clientWidth,
                        bodyScrollWidth: document.body.scrollWidth,
                        sortValue: document.querySelector('#sort').value,
                        headerWidth: document.querySelector('.site-header').offsetWidth
                    })
                """)

                scroll_w = overflow_data["scrollWidth"]
                client_w = overflow_data["clientWidth"]
                has_overflow = scroll_w > client_w

                print(f"  → Viewport {width:4d}x{height:<4d} | clientWidth: {client_w:4d}px | scrollWidth: {scroll_w:4d}px | Overflow: {has_overflow} | Sort: '{overflow_data['sortValue']}'")
                assert not has_overflow, f"ERRO: Overflow horizontal detectado em {width}px: scrollWidth={scroll_w} > clientWidth={client_w}"

                # Capture real screenshot
                await client.capture_screenshot(filename)

            print("  ✓ SUCESSO: Zero overflow horizontal em todos os 10 breakpoints testados (320px a 1920px)!")

            # -----------------------------------------------------------
            # TEST 7: Modal de Abertura de Solicitações e Teclado
            # -----------------------------------------------------------
            print("\n[TESTE 7] Teste do Modal de 'Abrir Solicitação' e Atalhos")
            await client.set_viewport(1440, 900, is_mobile=False)
            # Click open ticket button
            await client.eval_js("document.querySelector('#open-ticket').click()")
            await asyncio.sleep(0.2)

            modal_hidden = await client.eval_js("document.querySelector('#ticket-modal').hidden")
            body_class = await client.eval_js("document.body.classList.contains('modal-open')")
            assert not modal_hidden, "ERRO: Modal continua com atributo hidden=true"
            assert body_class, "ERRO: Body não recebeu classe modal-open"

            template_options = await client.eval_js("""
                Array.from(document.querySelectorAll('.template-option')).map(opt => ({
                    title: opt.querySelector('.template-name').textContent.trim(),
                    badge: opt.querySelector('.template-badge').textContent.trim(),
                    href: opt.getAttribute('href')
                }))
            """)
            print(f"  → Categorias encontradas no modal: {len(template_options)}")
            for opt in template_options:
                print(f"     • [{opt['badge']}] {opt['title']} → {opt['href'].split('template=')[-1]}")
                assert "project-nox-requests/issues/new?template=" in opt["href"], f"Link inválido: {opt['href']}"

            assert len(template_options) == 5, f"Esperava 5 templates, encontrou {len(template_options)}"

            # Capture desktop modal screenshot
            await client.capture_screenshot("modal_desktop_1440px.png")

            # Mobile modal screenshot (390px)
            await client.set_viewport(390, 844, is_mobile=True)
            await asyncio.sleep(0.15)
            await client.capture_screenshot("modal_mobile_390px.png")

            # Close modal via Escape
            await client.set_viewport(1440, 900, is_mobile=False)
            await client.eval_js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
            await asyncio.sleep(0.2)
            modal_hidden_after_esc = await client.eval_js("document.querySelector('#ticket-modal').hidden")
            assert modal_hidden_after_esc, "ERRO: Modal não fechou ao pressionar Escape!"
            print("  ✓ SUCESSO: Modal abre, lista as 5 categorias com links e badges oficiais, e fecha com Escape!")

            # -----------------------------------------------------------
            # TEST 8: Métricas de Desempenho e Fluidez
            # -----------------------------------------------------------
            print("\n[TESTE 8] Métricas de Desempenho, Animação e Memória")
            # Sample FPS over 1 second with requestAnimationFrame
            fps_result = await client.eval_js("""
                new Promise(resolve => {
                    let frames = 0;
                    const start = performance.now();
                    function count() {
                        frames++;
                        if (performance.now() - start < 1000) {
                            requestAnimationFrame(count);
                        } else {
                            const elapsed = (performance.now() - start) / 1000;
                            resolve({ fps: Math.round(frames / elapsed), frames, elapsed });
                        }
                    }
                    requestAnimationFrame(count);
                })
            """)

            perf_metrics = await client.call("Performance.getMetrics")
            metrics_dict = {m["name"]: m["value"] for m in perf_metrics["metrics"]}

            js_heap_mb = metrics_dict.get("JSHeapUsedSize", 0) / (1024 * 1024)
            layouts = metrics_dict.get("LayoutCount", 0)
            nodes = metrics_dict.get("Nodes", 0)

            print(f"  → FPS real da animação em execução: {fps_result['fps']} FPS ({fps_result['frames']} quadros em {fps_result['elapsed']:.2f}s)")
            print(f"  → Uso de Memória JS Heap: {js_heap_mb:.2f} MB")
            print(f"  → Total de Nós DOM: {int(nodes)}")
            print(f"  → Total de Layouts computados: {int(layouts)}")

            assert fps_result["fps"] >= 25, f"Alerta de fluidez baixa: {fps_result['fps']} FPS"
            assert js_heap_mb < 50, f"Uso excessivo de heap: {js_heap_mb:.2f} MB"
            print("  ✓ SUCESSO: Desempenho excelente, renderização fluida e baixo consumo de memória!")

            print("\n" + "=" * 70)
            print("TODOS OS TESTES E2E EM NAVEGADOR REAL FORAM CONCLUÍDOS COM 100% DE APROVAÇÃO!")
            print("=" * 70)

    finally:
        if proc:
            proc.terminate()
            proc.wait()


if __name__ == "__main__":
    asyncio.run(run_tests())
