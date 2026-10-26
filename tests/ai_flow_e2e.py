#!/usr/bin/env python3
"""End-to-end AI flow in the real unpacked extension, fully offline.

Covers the service-worker path unit tests cannot reach: importScripts(ai-core.js), the
fetch-all queue skipping a rule-flagged product without any AI call, one DeepSeek triage
call producing the cleaned Amazon query, AI match verification from the real Amazon
content script, hash-only image comparison, and the no-key fallback to the old behavior.

Tabs opened by the extension itself (chrome.tabs.create) are not intercepted by
Playwright routing, so the Amazon step runs in a Playwright-owned tab registered in the
worker's fetchingTabs map. DNS is disabled for anything not fulfilled by the router, so a
missed interception fails the test instead of reaching a real server.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

def wait_js(page: Any, expression: str, arg: Any = None, timeout: float = 10_000) -> None:
    """Poll a (possibly async) JS predicate until it returns truthy.

    Playwright's wait_for_function treats the Promise of an async predicate as truthy and
    returns at once, so storage-backed waits must be polled through page.evaluate instead.
    """
    deadline = time.monotonic() + timeout / 1000
    while True:
        if page.evaluate(expression, arg) if arg is not None else page.evaluate(expression):
            return
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {timeout:.0f} ms waiting for: {expression[:160]}")
        page.wait_for_timeout(100)


EXT = Path(__file__).resolve().parents[1]


def png(width: int = 32, height: int = 32, shift: int = 0) -> bytes:
    rows = b"".join(
        b"\x00" + bytes(v for x in range(width) for v in ((x * 8 + shift) % 256, (y * 8) % 256, 120))
        for y in range(height)
    )
    chunk = lambda tag, data: struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


IMAGE = png()
AMAZON_HTML = "<html><head><title>Fixture search</title></head><body>" + "".join(
    f'<div data-component-type="s-search-result" data-asin="{asin}">'
    f'<img class="s-image" src="https://m.media-amazon.com/images/I/{asin}.png">'
    f"<h2><span>{title}</span></h2>"
    '<span class="a-price"><span class="a-offscreen">$25.00</span></span>'
    '<i class="a-icon-star"><span>4.5 out of 5 stars</span></i>'
    '<span aria-label="120 ratings">120</span></div>'
    for asin, title in (("B0MATCH001", "Woven storage basket"), ("B0OTHER002", "Metal wire bin"))
) + "</body></html>"


def product(item_id: str, title: str) -> dict[str, Any]:
    return {
        "itemId": item_id,
        "title": title,
        "imageUrl": f"https://i.ebayimg.com/images/g/{item_id}.png",
        "amazonSearchUrl": "https://www.amazon.com/s?k=" + title.replace(" ", "+"),
        "ebayPrice": "$20.00",
        "sellerName": "fixture-seller",
    }


def main() -> int:
    deepseek_calls: list[dict[str, Any]] = []
    amazon_queries: list[str] = []
    unrouted: list[str] = []
    failures: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    def router(route: Any) -> None:
        url = route.request.url
        if url.startswith("https://api.deepseek.com/"):
            body = json.loads(route.request.post_data or "{}")
            deepseek_calls.append(body)
            content = body["messages"][1]["content"]
            prompt = content if isinstance(content, str) else content[0]["text"]
            answer = ({"matches": ["B0MATCH001"]} if "verify dropshipping product matches" in prompt
                      else {"riskScore": 2, "reason": "Generic storage item", "amazonQuery": "woven storage basket"})
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"model": "DeepSeek-V4.1-Flash", "choices": [{"message": {"content": json.dumps(answer)}}]}))
        if url.startswith("https://www.amazon.com/s?"):
            amazon_queries.append(parse_qs(urlparse(url).query).get("k", [""])[0])
            return route.fulfill(status=200, content_type="text/html", body=AMAZON_HTML)
        if url.startswith("https://www.amazon.com/e2e-blank"):
            return route.fulfill(status=200, content_type="text/html", body="<html><body>blank</body></html>")
        if url.startswith("https://i.ebayimg.com/") or url.startswith("https://m.media-amazon.com/"):
            return route.fulfill(status=200, content_type="image/png", body=IMAGE)
        if url.startswith("http"):
            unrouted.append(url)
            return route.abort("blockedbyclient")
        return route.continue_()

    with sync_playwright() as p, tempfile.TemporaryDirectory(prefix="indygrab-ai-e2e-") as profile:
        ctx = p.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True,
            args=[
                f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
            ],
        )
        try:
            ctx.route("**/*", router)
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15_000)
            ext_id = worker.url.split("/")[2]
            check(worker.evaluate("typeof IndyAI === 'object' && typeof prepareAmazonFetch === 'function'"), "ai-core.js / AI tasks not loaded in service worker")
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"chrome-extension://{ext_id}/research.html", wait_until="networkidle")

            def storage(keys: list[str]) -> dict[str, Any]:
                return page.evaluate("keys => chrome.storage.local.get(keys)", keys)

            def product_by_id(item_id: str) -> dict[str, Any]:
                return next(p for p in storage(["potentialProducts"])["potentialProducts"] if p["itemId"] == item_id)

            def fetch_in_owned_tab(item: dict[str, Any]) -> None:
                """Same steps as the fetch-all pump, with a tab Playwright can intercept."""
                prep = worker.evaluate("([id, url]) => prepareAmazonFetch(id, url)", [item["itemId"], item["amazonSearchUrl"]])
                check(not prep.get("skip"), f"{item['itemId']} unexpectedly skipped: {prep}")
                tab = ctx.new_page()
                tab.goto("https://www.amazon.com/e2e-blank")
                tab_id = worker.evaluate("async () => (await chrome.tabs.query({url: 'https://www.amazon.com/e2e-blank'}))[0].id")
                worker.evaluate("([tabId, itemId]) => { fetchingTabs[tabId] = itemId; }", [tab_id, item["itemId"]])
                try:
                    tab.goto(prep["url"])
                except Exception:
                    pass  # the content script may close the tab before navigation settles
                wait_js(page, 
                    "async id => (await chrome.storage.local.get('potentialProducts')).potentialProducts.find(p => p.itemId === id)?.fetched === true",
                    arg=item["itemId"], timeout=45_000,
                )

            # 1) Same photo: decided by hash, no AI call.
            same = page.evaluate("chrome.runtime.sendMessage({action: 'compareImages', mainImageUrl: 'https://i.ebayimg.com/images/g/a.png', targetImageUrl: 'https://m.media-amazon.com/images/I/b.png'})")
            check(same.get("method") == "hash" and same.get("isMatch") is True, f"hash compare: {same}")

            # 2) Fetch-all queue with a VeRO product: rule skip, no tab, no AI call.
            risky = product("e2e-risky", "Nike Air Max 90 Running Shoes")
            worker.evaluate("d => chrome.storage.local.set(d)", {"deepseekApiKey": "sk-fixture-deepseek-01", "memoryAsins": [], "potentialProducts": [risky]})
            tabs_before = len(ctx.pages)
            started = page.evaluate("chrome.runtime.sendMessage({action: 'startFetchAllQueue'})")
            check(started.get("status") == "started", f"fetch queue did not start: {started}")
            wait_js(page, "async () => (await chrome.storage.local.get('fetchAllState')).fetchAllState === 'stopped'", timeout=30_000)
            got = product_by_id("e2e-risky")
            check(got.get("riskSource") == "rule" and got.get("riskScore") == 9, f"risky triage: {got}")
            check(got.get("fetched") is True and "Risk 9/10" in (got.get("fetchSkipReason") or ""), f"risky not skipped: {got}")
            check(len(ctx.pages) == tabs_before, "a skipped product must not open an Amazon tab")
            check(not deepseek_calls, "rule decision must not call the AI")

            # 3) Safe product: one triage call → cleaned query; match check keeps only the confirmed ASIN.
            safe = product("e2e-safe", "NEW 2026 Woven Storage Basket FAST SHIP")
            worker.evaluate("d => chrome.storage.local.set(d)", {"potentialProducts": [got, safe]})
            fetch_in_owned_tab(safe)
            page.wait_for_timeout(1500)  # AI counters flush after one second
            got = product_by_id("e2e-safe")
            state = storage(["memoryAsins", "aiStats"])
            check(got.get("riskSource") == "deepseek" and got.get("amazonQuery") == "woven storage basket", f"safe triage: {got}")
            check(got.get("aiMatch") == "verified" and got.get("aiMatchCount") == 1, f"safe match: {got}")
            check(state["memoryAsins"] == ["B0MATCH001"], f"pool should hold only the verified ASIN: {state['memoryAsins']}")
            check(amazon_queries == ["woven storage basket"], f"Amazon searched with: {amazon_queries}")
            check(len(deepseek_calls) == 2, f"expected triage + match calls, got {len(deepseek_calls)}")
            if len(deepseek_calls) == 2:
                triage, match = deepseek_calls
                check(triage["model"] == "deepseek-flash" and triage["response_format"] == {"type": "json_object"}, "triage request shape")
                check(triage.get("thinking") == {"type": "disabled"} and match.get("thinking") == {"type": "disabled"}, "DeepSeek thinking must be disabled")
                check(sum(1 for part in triage["messages"][1]["content"] if part.get("type") == "image_url") == 1, "triage should carry the eBay image")
                check(sum(1 for part in match["messages"][1]["content"] if part.get("type") == "image_url") == 3, "match should carry reference + 2 candidates")
            stats = state.get("aiStats") or {}
            for key in ("rule.hit", "fetch.skippedRisk", "task.triage", "task.match", "match.verified", "hash.same", "deepseek.ok"):
                check(stats.get(key, 0) >= 1, f"aiStats missing {key}: {stats}")
            last = storage(["aiLastModels"]).get("aiLastModels") or {}
            check((last.get("deepseek") or {}).get("model") == "DeepSeek-V4.1-Flash", f"answering model not recorded: {last}")
            page.locator('.nav-btn[data-target="section-ai"]').click()
            wait_js(page, "() => document.getElementById('ai-model-deepseek').textContent.includes('Son yanıt: DeepSeek-V4.1-Flash')")
            check("gemini-3.8-flash" in page.locator("#ai-model-gemini").inner_text(), "Gemini model label")

            # 4) No keys: previous behavior — original query, filter result saved, marked unverified.
            deepseek_calls.clear()
            amazon_queries.clear()
            nokey = product("e2e-nokey", "Woven Storage Basket Large")
            worker.evaluate("d => chrome.storage.local.set(d)", {"deepseekApiKey": "", "geminiApiKey": "", "memoryAsins": [], "potentialProducts": [nokey]})
            fetch_in_owned_tab(nokey)
            got = product_by_id("e2e-nokey")
            check(not deepseek_calls, "no-key run must not call the AI")
            check(amazon_queries == ["Woven Storage Basket Large"], f"no-key query: {amazon_queries}")
            check(got.get("aiMatch") == "unverified", f"no-key product should be marked unverified: {got}")
            check(sorted(storage(["memoryAsins"])["memoryAsins"]) == ["B0MATCH001", "B0OTHER002"], "no-key pool should keep the filter result")
            check(not errors, f"page errors: {errors}")
        finally:
            ctx.close()

    print(json.dumps({"ok": not failures, "failures": failures, "unrouted_blocked": sorted(set(u[:100] for u in unrouted))}, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
