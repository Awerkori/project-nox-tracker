#!/usr/bin/env python3
"""Project Nox Tracker - Tab Rollback & Cache Preservation Verification Test.

Specifically verifies:
1. When Tab 1 has synchronized newer live data (containing e.g. Issue #9999),
   Tab 2 opening and reading static data/issues.json does NOT cause Tab 1 to roll back.
2. Tab 2 prioritizes the fresher live cache from localStorage over older static issues.json.
3. The storage event listener does not blindly accept stale snapshot writes.
"""

import asyncio
import copy
import json
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
import aiohttp

CDP_PORT = 9228
DEV_PORT = 8087
MOCK_API_PORT = 8086
BASE_URL = f"http://localhost:{DEV_PORT}/"
BASE_DIR = Path(__file__).resolve().parent.parent

mock_state = {
    "issues": []
}


class MockGitHubAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        issues_batch = copy.deepcopy(mock_state["issues"])
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "ETag, Link, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After")
        self.send_header("X-RateLimit-Limit", "60")
        self.send_header("X-RateLimit-Remaining", "55")
        self.send_header("X-RateLimit-Reset", str(int(time.time()) + 3600))
        self.end_headers()
        self.wfile.write(json.dumps(issues_batch[:100]).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, If-None-Match")
        self.end_headers()


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
                    if data.get("method") == "Runtime.consoleAPICalled":
                        args = [a.get("value") or a.get("description") for a in data.get("params", {}).get("args", [])]
                        print("  [BROWSER CONSOLE]", *args)
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
        return res.get("result", {}).get("value")


async def main():
    print("=" * 80)
    print("VERIFICAÇÃO: PROTEÇÃO CONTRA ROLLBACK DE DADOS ENTRE ABAS E CACHE REVERSO")
    print("=" * 80)

    data_path = BASE_DIR / "data/issues.json"
    with open(data_path, "r", encoding="utf-8") as f:
        baseline = json.load(f)
    mock_state["issues"] = copy.deepcopy(baseline["issues"])

    # 1. Start mock server
    server = HTTPServer(("127.0.0.1", MOCK_API_PORT), MockGitHubAPIHandler)
    server_thread = Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # 2. Start dev server on port 8087
    env = {**dict(subprocess.os.environ), "PORT": str(DEV_PORT)}
    dev_proc = subprocess.Popen([
        sys.executable, "-c",
        f"from http.server import HTTPServer, SimpleHTTPRequestHandler; import os; os.chdir('{BASE_DIR}'); HTTPServer(('127.0.0.1', {DEV_PORT}), SimpleHTTPRequestHandler).serve_forever()"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(0.8)

    # 3. Start Chromium
    user_data_dir = f"/tmp/nox_test_prof_{int(time.time())}"
    chrome_proc = subprocess.Popen([
        "chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
        f"--user-data-dir={user_data_dir}",
        f"--remote-debugging-port={CDP_PORT}", "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1.2)

    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"http://localhost:{CDP_PORT}/json/list") as r:
                tabs = await r.json()
                page_tab = next(t for t in tabs if t.get("type") == "page")
                ws_url = page_tab["webSocketDebuggerUrl"]

            client1 = CDPClient(ws_url)
            await client1.connect(s)
            await client1.call("Page.enable")
            await client1.call("Runtime.enable")

            mock_api_url = f"http://127.0.0.1:{MOCK_API_PORT}/repos/Awerkori/project-nox-requests/issues"
            await client1.call("Page.addScriptToEvaluateOnNewDocument", {
                "source": f"""
                    window.__NOX_API_BASE__ = "{mock_api_url}";
                    window.__NOX_POLL_INTERVAL__ = 500;
                """
            })

            await client1.call("Page.navigate", {"url": BASE_URL})
            await asyncio.sleep(1.0)

            # Step 1: Add new live issue #8888 in mock API
            new_ticket = {
                "number": 8888,
                "title": "[Nova extensão]: Teste Anti-Rollback",
                "html_url": "https://github.com/Awerkori/project-nox-requests/issues/8888",
                "state": "open",
                "state_reason": None,
                "created_at": "2099-05-01T00:00:00Z",
                "updated_at": "2099-05-01T00:00:00Z",
                "closed_at": None,
                "comments": 0,
                "labels": [{"name": "Nova extensão", "color": "8b5cf6"}],
                "reactions": {"total_count": 0, "+1": 0},
                "user": {"login": "tester"}
            }
            mock_state["issues"].insert(0, new_ticket)

            # Wait for Tab 1 to synchronize Issue #8888
            synced_8888 = False
            for _ in range(30):
                await asyncio.sleep(0.2)
                tab1_cards = await client1.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
                if 8888 in tab1_cards:
                    synced_8888 = True
                    break

            assert synced_8888, "Aba 1 não sincronizou o ticket #8888!"
            print("✓ Aba 1 sincronizou ticket #8888 com sucesso!")

            # Step 2: Open Tab 2. Tab 2 loads static issues.json from server
            new_tab_res = await client1.call("Target.createTarget", {"url": "about:blank"})
            tab2_id = new_tab_res["targetId"]
            async with s.get(f"http://localhost:{CDP_PORT}/json/list") as r:
                tabs = await r.json()
                tab2_info = next(t for t in tabs if t.get("id") == tab2_id)
                ws2_url = tab2_info["webSocketDebuggerUrl"]

            client2 = CDPClient(ws2_url)
            await client2.connect(s)
            await client2.call("Page.enable")
            await client2.call("Runtime.enable")
            await client2.call("Page.addScriptToEvaluateOnNewDocument", {
                "source": f"""
                    window.__NOX_API_BASE__ = "{mock_api_url}";
                    window.__NOX_POLL_INTERVAL__ = 500;
                """
            })
            await client2.call("Page.navigate", {"url": BASE_URL})
            await asyncio.sleep(1.0)

            # Step 3: Verify that Tab 2 displays #8888 immediately (from localStorage cache)
            tab2_cards = await client2.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            assert 8888 in tab2_cards, "Aba 2 não carregou #8888 do cache vivo de localStorage!"
            print("✓ Aba 2 exibiu ticket #8888 preservando cache vivo em detrimento do snapshot estático mais antigo!")

            # Step 4: Verify that Tab 1 STILL displays #8888 and did not roll back
            tab1_cards_after = await client1.eval_js("Array.from(document.querySelectorAll('#tickets .ticket-card')).map(c => Number(c.getAttribute('data-number')))")
            assert 8888 in tab1_cards_after, "REGRESSÃO: Aba 1 sofreu rollback e perdeu #8888 após Aba 2 abrir!"
            print("✓ Aba 1 NÃO sofreu rollback! Ticket #8888 permaneceu intacto!")

            print("=" * 80)
            print("SUCESSO: PROTEÇÃO CONTRA ROLLBACK VALIDADA COM 100% DE ÊXITO!")
            print("=" * 80)
    finally:
        dev_proc.terminate()
        chrome_proc.terminate()
        server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
