#!/usr/bin/env python3
"""Project Nox Tracker - Header Inspection & Comparison Tool"""

import asyncio
import base64
import json
import os
import subprocess
import sys
import aiohttp

CDP_PORT = 9227
BASE_URL = "http://localhost:8088/"
HEADER_SCREENSHOTS_DIR = "/home/awerkori/.Projects/Project-Nox-Tracker/screenshots/header"
BRAIN_HEADER_DIR = "/home/awerkori/.gemini/antigravity-cli/brain/f09dc443-be98-401e-8aba-5270296e5f60/screenshots/header"

os.makedirs(HEADER_SCREENSHOTS_DIR, exist_ok=True)
os.makedirs(BRAIN_HEADER_DIR, exist_ok=True)


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
            raise Exception(f"CDP call error: {resp['error']}")
        return resp.get("result", {})

    async def evaluate(self, expr):
        res = await self.call("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True
        })
        return res.get("result", {}).get("value")

    async def capture_element(self, selector, filepath):
        rect = await self.evaluate(f"""(() => {{
            const el = document.querySelector('{selector}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 }};
        }})()""")
        if not rect:
            raise Exception(f"Element {selector} not found")
        res = await self.call("Page.captureScreenshot", {"format": "png", "clip": rect, "captureBeyondViewport": True})
        data = base64.b64decode(res["data"])
        with open(filepath, "wb") as f:
            f.write(data)
        # Also copy to brain
        brain_path = os.path.join(BRAIN_HEADER_DIR, os.path.basename(filepath))
        with open(brain_path, "wb") as f:
            f.write(data)
        return rect


async def inspect(prefix="before"):
    proc = subprocess.Popen([
        "chromium",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--remote-debugging-port={CDP_PORT}",
        "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        await asyncio.sleep(1.2)
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://localhost:{CDP_PORT}/json/list") as r:
                tabs = await r.json()
                page_tab = next(t for t in tabs if t.get("type") == "page")
                ws_url = page_tab["webSocketDebuggerUrl"]

            cdp = CDPClient(ws_url)
            await cdp.connect(session)

            await cdp.call("Page.navigate", {"url": BASE_URL})
            await asyncio.sleep(2.0)

            # Measure buttons metrics at 1440px
            await cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": 1440, "height": 900, "deviceScaleFactor": 1.0, "mobile": False
            })
            await asyncio.sleep(0.5)

            metrics = await cdp.evaluate("""(() => {
                const fluxer = document.querySelector('.community-link.fluxer-link');
                const discord = document.querySelector('.community-link.discord-link');
                const ticket = document.querySelector('#open-ticket');
                const header = document.querySelector('.site-header');

                const getM = el => {
                    const r = el.getBoundingClientRect();
                    const s = window.getComputedStyle(el);
                    return {
                        width: r.width,
                        height: r.height,
                        y: r.y,
                        fontSize: s.fontSize,
                        fontWeight: s.fontWeight,
                        padding: s.padding,
                        borderRadius: s.borderRadius,
                        boxShadow: s.boxShadow
                    };
                };

                return {
                    fluxer: getM(fluxer),
                    discord: getM(discord),
                    ticket: getM(ticket)
                };
            })()""")

            print(f"[{prefix.upper()}] Metrics at 1440px:")
            print(json.dumps(metrics, indent=2))

            # Snap header at 1440px
            await cdp.capture_element(".site-header", f"{HEADER_SCREENSHOTS_DIR}/header_{prefix}_1440px.png")
            # Snap specifically nav-links
            await cdp.capture_element(".nav-links", f"{HEADER_SCREENSHOTS_DIR}/nav_buttons_{prefix}_1440px.png")

            # Snap across all breakpoints if after
            if prefix == "after":
                viewports = [
                    (320, 568, True),
                    (360, 640, True),
                    (390, 844, True),
                    (430, 932, True),
                    (768, 1024, False),
                    (1024, 768, False),
                    (1440, 900, False),
                    (1920, 1080, False)
                ]
                for w, h, is_mobile in viewports:
                    await cdp.call("Emulation.setDeviceMetricsOverride", {
                        "width": w, "height": h, "deviceScaleFactor": 1.0, "mobile": is_mobile
                    })
                    await asyncio.sleep(0.3)
                    await cdp.capture_element(".site-header", f"{HEADER_SCREENSHOTS_DIR}/header_after_{w}px.png")
                    print(f"✓ Saved header_after_{w}px.png")

    finally:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    prefix = sys.argv[1] if len(sys.argv) > 1 else "before"
    asyncio.run(inspect(prefix))
