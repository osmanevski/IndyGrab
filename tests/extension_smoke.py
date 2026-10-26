#!/usr/bin/env python3
"""Headless smoke test for the real unpacked IndyGrab extension.

This test uses an isolated Chromium profile and blocks every HTTP(S) request. It
validates the extension UI with local fixture data; it does not test live sites.
"""

from __future__ import annotations

import base64
from urllib.parse import unquote
import argparse
import json
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from playwright.sync_api import Page, Playwright, sync_playwright


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


DEFAULT_EXTENSION_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT_DIR = Path("/private/tmp/indygrab-qa artifacts")
FIXTURE_IMAGE = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480' "
    "viewBox='0 0 640 480'%3E%3Crect width='640' height='480' fill='%23e9edf2'/%3E"
    "%3Cpath d='M160 330h320l-48-176H208z' fill='%2328a36a'/%3E"
    "%3Ccircle cx='252' cy='356' r='28' fill='%23242a32'/%3E"
    "%3Ccircle cx='400' cy='356' r='28' fill='%23242a32'/%3E%3C/svg%3E"
)

FIXTURE_IMAGE = "data:image/svg+xml;base64," + base64.b64encode(unquote(FIXTURE_IMAGE.split(",", 1)[1]).encode()).decode()

def fixture_storage() -> dict[str, Any]:
    return {
        "theme": "dark",
        "language": "tr",
        "potentialProducts": [
            {
                "itemId": "fixture-001",
                "title": "Katlanabilir Kamp Arabası",
                "imageUrl": FIXTURE_IMAGE,
                "sellerName": "north-star-outlet",
                "amazonSearchUrl": "https://www.amazon.com/s?k=folding+camp+wagon",
                "ebayPrice": "$89.90",
                "customerCount": 18,
                "riskScore": 2,
                "riskReason": "Genel ürün; belirgin marka riski yok.",
            },
            {
                "itemId": "fixture-002",
                "title": "Paslanmaz Çelik Mutfak Rafı",
                "imageUrl": FIXTURE_IMAGE,
                "sellerName": "home-lab-supply",
                "amazonSearchUrl": "https://www.amazon.com/s?k=stainless+kitchen+rack",
                "ebayPrice": "$42.50",
                "customerCount": 9,
            },
            {
                "itemId": "fixture-003",
                "title": "Ayarlanabilir Dizüstü Bilgisayar Standı",
                "imageUrl": FIXTURE_IMAGE,
                "sellerName": "desk-works",
                "amazonSearchUrl": "https://www.amazon.com/s?k=adjustable+laptop+stand",
                "ebayPrice": "$31.25",
                "customerCount": 5,
                "fetched": True,
            },
        ],
        "savedSellerLinks": [
            {"url": "https://www.ebay.com/sch/i.html?_ssn=north-star-outlet&_ipg=240", "visited": True},
            {"url": "https://www.ebay.com/sch/i.html?_ssn=home-lab-supply&_ipg=240", "visited": False},
            {"url": "https://www.ebay.com/sch/i.html?_ssn=desk-works&_ipg=240", "visited": False},
        ],
        "memoryAsins": ["B0FIXTURE01", "B0FIXTURE02", "B0FIXTURE03"],
        "analysisQueue": [],
        "sellerBlacklist": {},
        "forbiddenMainCategories": ["Restricted fixture"],
        "forbiddenSubCategories": ["Fixture subcategory"],
        "autoCollectActive": False,
        "asinList": [],
    }


class SmokeRun:
    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.passed: list[str] = []
        self.failures: list[dict[str, str]] = []
        self.page_errors: list[str] = []
        self.console_errors: list[str] = []
        self.screenshots: list[str] = []

    def check(self, name: str, action: Callable[[], None]) -> None:
        try:
            action()
            self.passed.append(name)
        except Exception as exc:  # Keep running so one visual failure does not hide the rest.
            self.failures.append(
                {
                    "name": name,
                    "error": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(limit=5),
                }
            )

    def screenshot(self, page: Page, name: str) -> None:
        path = self.artifact_dir / name
        page.screenshot(path=str(path), full_page=True)
        self.screenshots.append(str(path))

    def summary(self) -> dict[str, Any]:
        return {
            "kind": "headless-unpacked-extension-smoke",
            "live_sites_tested": False,
            "passed": self.passed,
            "failures": self.failures,
            "page_errors": self.page_errors,
            "console_errors": self.console_errors,
            "screenshots": self.screenshots,
            "ok": not self.failures and not self.page_errors,
        }


def visible_top_sections(page: Page) -> list[str]:
    return page.locator(".container > section").evaluate_all(
        "sections => sections.filter(section => getComputedStyle(section).display !== 'none')"
        ".map(section => section.id)"
    )


def assert_workspace(page: Page, button_selector: str, expected_section: str) -> None:
    button = page.locator(button_selector)
    assert button.count() == 1, f"expected one nav button for {button_selector}, found {button.count()}"
    button.click()
    page.wait_for_function(
        "sectionId => getComputedStyle(document.getElementById(sectionId)).display !== 'none'",
        arg=expected_section,
    )
    assert visible_top_sections(page) == [expected_section]

    # Clicking the active destination again must leave one workspace visible.
    button.click()
    assert visible_top_sections(page) == [expected_section]


def assert_inner_panel(page: Page, expected: str) -> None:
    states = page.locator("#section-amazon > .amazon-panel .tab-content").evaluate_all(
        "panels => Object.fromEntries(panels.map(panel => [panel.id, getComputedStyle(panel).display !== 'none']))"
    )
    assert states.get(expected) is True, states
    assert sum(1 for visible in states.values() if visible) == 1, states


def wait_for_extension_worker(context: Any) -> Any:
    workers = context.service_workers
    if workers:
        return workers[0]
    return context.wait_for_event("serviceworker", timeout=15_000)


def run(playwright: Playwright, extension_dir: Path, artifact_dir: Path, result: SmokeRun) -> None:
    manifest = extension_dir / "manifest.json"
    baseline_path = extension_dir / "docs" / "ui-contract-baseline.json"
    if not manifest.is_file():
        raise FileNotFoundError(f"manifest not found: {manifest}")
    if not baseline_path.is_file():
        raise FileNotFoundError(f"UI baseline not found: {baseline_path}")

    with tempfile.TemporaryDirectory(prefix="indygrab-playwright-profile-") as profile_dir:
        context = playwright.chromium.launch_persistent_context(
            profile_dir,
            channel="chromium",
            headless=True,
            reduced_motion="reduce",
            viewport={"width": 1440, "height": 1000},
            args=[
                f"--disable-extensions-except={extension_dir}",
                f"--load-extension={extension_dir}",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
            ],
        )
        try:
            context.route("http://**/*", lambda route: route.abort("blockedbyclient"))
            context.route("https://**/*", lambda route: route.abort("blockedbyclient"))

            worker = wait_for_extension_worker(context)
            extension_id = worker.url.split("/")[2]
            worker.evaluate("data => chrome.storage.local.set(data)", fixture_storage())

            page = context.pages[0] if context.pages else context.new_page()
            page.on("pageerror", lambda error: result.page_errors.append(str(error)))
            page.on(
                "console",
                lambda message: result.console_errors.append(message.text)
                if message.type == "error"
                else None,
            )
            page.goto(f"chrome-extension://{extension_id}/research.html", wait_until="networkidle")
            page.wait_for_function("document.readyState === 'complete'")
            page.wait_for_timeout(750)

            def baseline_ids() -> None:
                baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
                ids = baseline["pages"]["research.html"]["ids"]
                counts = page.evaluate(
                    "ids => Object.fromEntries(ids.map(id => [id, document.querySelectorAll('#' + CSS.escape(id)).length]))",
                    ids,
                )
                invalid = {key: value for key, value in counts.items() if value != 1}
                assert not invalid, f"baseline IDs missing or duplicated: {invalid}"

            result.check("baseline research.html IDs occur exactly once", baseline_ids)

            def seeded_content() -> None:
                page.locator('.nav-btn[data-target="section-products"]').click()
                page.wait_for_selector("#product-list .product-card")
                assert page.locator("#product-list .product-card").count() == 3
                page.locator('.nav-btn[data-target="section-stores"]').click()
                page.wait_for_selector("#store-links-list .store-link-item")
                assert page.locator("#store-links-list .store-link-item").count() == 3

            result.check("representative products, stores, and memory load from extension storage", seeded_content)

            def stores_layout() -> None:
                assert_workspace(page, '.nav-btn[data-target="section-stores"]', "section-stores")
                listing = page.locator("#store-links-list")
                assert listing.evaluate("e => e.scrollHeight <= e.clientHeight + 1"), "store list must not scroll inside a fixed height"
                for name in ("scan_mode", "catch_sensitivity", "auto_concurrency"):
                    assert page.locator(f'#automation-controls input[name="{name}"]:checked').count() == 1, name
                page.locator('label:has(> input[name="catch_sensitivity"][value="strict"])').click()
                wait_js(page, "async () => (await chrome.storage.local.get('catchSensitivity')).catchSensitivity === 'strict'")
                page.locator('label:has(> input[name="catch_sensitivity"][value="normal"])').click()
                wait_js(page, "async () => (await chrome.storage.local.get('catchSensitivity')).catchSensitivity === 'normal'")
                page.locator('label:has(> input[name="scan_mode"][value="sold"])').click()
                wait_js(page, "async () => (await chrome.storage.local.get('scanMode')).scanMode === 'sold'")
                page.locator('label:has(> input[name="scan_mode"][value="live"])').click()
                page.locator('label:has(> input[name="auto_concurrency"][value="2"])').click()
                wait_js(page, "async () => (await chrome.storage.local.get('autoConcurrency')).autoConcurrency === '2'")
                page.locator('label:has(> input[name="auto_concurrency"][value="1"])').click()
                page.locator("#schSellerSaleDays").fill("9")
                wait_js(page, "async () => String((await chrome.storage.local.get('schSellerSaleDays')).schSellerSaleDays) === '9'")
                page.locator("#schSellerSaleDays").fill("")
                page.locator("#auto-queue-checkbox").check()
                wait_js(page, "async () => (await chrome.storage.local.get('autoAddToQueue')).autoAddToQueue === true")
                page.locator("#auto-queue-checkbox").uncheck()

            result.check("stores page: segmented settings still save and the list is not clipped", stores_layout)

            def products_layout() -> None:
                assert_workspace(page, '.nav-btn[data-target="section-products"]', "section-products")
                controls = page.locator("#header-middle-controls")
                for control in ("#show-risky-btn", "#live-search", "#sort-products"):
                    assert controls.locator(control).count() == 1, control
                assert page.locator("#product-list .product-card").count() == 3
                rows = page.evaluate(
                    "() => { const rows = {}; document.querySelectorAll('#product-list .product-card').forEach(card => {"
                    " const top = Math.round(card.getBoundingClientRect().top);"
                    " (rows[top] ||= []).push(Math.round(card.querySelector('.fetch-btn').getBoundingClientRect().bottom)); });"
                    " return Object.values(rows); }"
                )
                assert all(max(row) - min(row) <= 1 for row in rows), f"fetch buttons misaligned within a row: {rows}"
                customers = page.locator("#product-list .product-card .product-customers").first
                assert customers.evaluate("e => e.getBoundingClientRect().height < 24"), "customer label and value should share one line"
                page.locator("#live-search").fill("Mutfak")
                wait_js(page, "() => document.querySelectorAll('#product-list .product-card').length === 1")
                page.locator("#live-search").fill("")
                wait_js(page, "() => document.querySelectorAll('#product-list .product-card').length === 3")

            result.check("products page: toolbar controls stay wired, cards align and search still filters", products_layout)

            def queue_layout() -> None:
                queue = ([{"url": f"https://www.ebay.com/sch/i.html?_ssn=done-{i}&_ipg=240", "status": "completed"} for i in range(2)]
                         + [{"url": f"https://www.ebay.com/sch/i.html?_ssn=wait-{i}&_ipg=240", "status": "waiting"} for i in range(5)])
                page.evaluate("q => chrome.storage.local.set({analysisQueue: q})", queue)
                assert_workspace(page, '.nav-btn[data-target="section-queue"]', "section-queue")
                wait_js(page, "() => document.querySelectorAll('#analysis-queue-list > li.queue-item').length === 7")
                listing = page.locator("#analysis-queue-list")
                assert listing.evaluate("e => e.scrollHeight <= e.clientHeight + 1"), "queue list must not scroll inside a fixed height"
                assert page.locator("#analysis-queue-list .force-start-item-btn").count() == 5
                concurrency = page.locator("#analysis-concurrency-input")
                assert concurrency.input_value() == "2"
                wait_js(page, "() => document.getElementById('queue-status').textContent.includes('/2')")
                assert worker.evaluate("getAnalysisConcurrency()") == 2, "background default must be 2"
                concurrency.fill("4")
                concurrency.dispatch_event("change")
                wait_js(page, "async () => (await chrome.storage.local.get('analysisConcurrency')).analysisConcurrency === 4")
                wait_js(page, "() => document.getElementById('queue-status').textContent.includes('/4')")
                assert worker.evaluate("getAnalysisConcurrency()") == 4
                concurrency.fill("12")
                concurrency.dispatch_event("change")
                wait_js(page, "async () => (await chrome.storage.local.get('analysisConcurrency')).analysisConcurrency === 7")
                assert concurrency.input_value() == "7"
                page.locator("#analysis-queue-list .remove-queue-item").first.click()
                wait_js(page, "async () => (await chrome.storage.local.get('analysisQueue')).analysisQueue.length === 6")
                result.screenshot(page, "queue-dark-1440x1000.png")
                page.evaluate("chrome.storage.local.set({analysisQueue: [], analysisConcurrency: 2})")

            result.check("analysis queue: tab limit defaults to 2, is adjustable 1-7 and the list is not clipped", queue_layout)

            nav_cases = [
                ('.nav-btn[data-target="section-stores"]', "section-stores"),
                ('.nav-btn[data-target="section-products"]', "section-products"),
                ('.nav-btn[data-target="section-queue"]', "section-queue"),
                ('.nav-btn[data-target="section-blacklist"]', "section-blacklist"),
                ('.nav-btn[data-target="section-forbidden-cats"]', "section-forbidden-cats"),
                ('.nav-btn[data-target="section-settings"]', "section-settings"),
                ('.nav-btn[data-target="section-ai"]', "section-ai"),
            ]
            for selector, section_id in nav_cases:
                result.check(
                    f"navigation keeps only {section_id} visible, including repeat click",
                    lambda selector=selector, section_id=section_id: assert_workspace(page, selector, section_id),
                )

            def amazon_collect_navigation() -> None:
                selector = '.nav-btn[data-target="section-amazon"][data-amazon-tab="collect"]'
                assert_workspace(page, selector, "section-amazon")
                assert_inner_panel(page, "collect")

            def amazon_memory_navigation() -> None:
                selector = '.nav-btn[data-target="section-amazon"][data-amazon-tab="memory"]'
                assert_workspace(page, selector, "section-amazon")
                assert_inner_panel(page, "memory")
                assert page.locator("#memoryOutput .asin-row").count() == 3

            result.check("Amazon collect nav shows only the collect panel", amazon_collect_navigation)
            result.check("Amazon memory nav shows only the populated memory panel", amazon_memory_navigation)

            def filtering_and_no_target() -> None:
                page.locator('.nav-btn[data-target="section-amazon"][data-amazon-tab="collect"]').click()
                page.locator('.tab[data-tab="filtering"]').click()
                assert_inner_panel(page, "filtering")
                assert page.locator("#filtering details").count() == 0
                assert page.locator("#minPriceFilter").is_visible()
                page.locator("#minPriceFilter").fill("12.5")
                page.locator("#maxPriceFilter").fill("0")
                wait_js(page, 
                    "async () => { const d = await chrome.storage.local.get(['minPrice', 'maxPrice']);"
                    " return d.minPrice === 12.5 && d.maxPrice === 0; }"
                )
                values = page.evaluate("chrome.storage.local.get(['minPrice', 'maxPrice'])")
                assert values == {"minPrice": 12.5, "maxPrice": 0}
                assert page.locator("#maxBsrFilter").evaluate("e => e.tagName") == "SELECT"
                # Auto-collect limits live with the collect actions; per-search selection stays with filters.
                assert page.locator("#collect #autoPageLimit").count() == 1
                assert page.locator("#collect #autoAsinLimit").count() == 1
                assert page.locator("#filtering #asinCount").count() == 1
                assert page.locator("#filtering #sortFilter").count() == 1
                page.locator("#maxBsrFilter").select_option("3000")
                wait_js(page, "async () => (await chrome.storage.local.get('maxBsr')).maxBsr === 3000")
                page.locator("#maxBsrFilter").select_option("")
                wait_js(page, "async () => (await chrome.storage.local.get('maxBsr')).maxBsr === 0")
                assert page.locator("#bg-collect-input").count() == 1

            result.check("filters save numeric minimum and zero upper limit without an Amazon tab", filtering_and_no_target)

            settings_ids = [
                "toggleStock",
                "togglePrime",
                "toggleRating",
                "toggleBannedWarning",
                "toggleCopyIcon",
                "toggleSaveIcon",
                "toggleEbayIcon",
                "bsrDisplayMode",
                "ebayChartDefaultDays",
                "ebayChartDisplay",
                "schDisplayMode",
                "schSellerSaleDays",
                "schDisplay7Days",
                "schDisplay14Days",
                "schDisplay30Days",
                "schDataDisplay",
                "schDisplaySold",
                "schDisplayWatchers",
                "schDisplayAvailable",
            ]

            def settings_controls() -> None:
                page.locator('.nav-btn[data-target="section-settings"]').click()
                counts = page.evaluate(
                    "ids => Object.fromEntries(ids.map(id => [id, document.querySelectorAll('#' + CSS.escape(id)).length]))",
                    settings_ids,
                )
                assert all(value == 1 for value in counts.values()), counts

            result.check("moved Amazon and eBay display settings remain present", settings_controls)

            def ai_settings_page() -> None:
                assert page.locator("#section-products #manage-keys-btn, #section-products #analyze-risk-btn").count() == 0
                assert_workspace(page, '.nav-btn[data-target="section-ai"]', "section-ai")
                page.locator("#gemini-key-input").fill("  AIzaFixtureGeminiKey01 ")
                page.locator("#deepseek-key-input").fill("sk-fixture-deepseek-01")
                page.locator("#claude-key-input").fill("sk-ant-fixture-claude-01")
                assert page.locator("#gemini-key-input").get_attribute("type") == "password"
                page.locator("#manage-keys-btn").click()
                wait_js(page, 
                    "async () => { const d = await chrome.storage.local.get(['geminiApiKey', 'deepseekApiKey', 'claudeApiKey']);"
                    " return d.geminiApiKey === 'AIzaFixtureGeminiKey01' && d.deepseekApiKey === 'sk-fixture-deepseek-01' && d.claudeApiKey === 'sk-ant-fixture-claude-01'; }"
                )
                assert "Gemini, DeepSeek, Claude" in page.locator("#key-count-label").inner_text()
                assert "gemini-3.8-flash" in page.locator("#ai-model-gemini").inner_text()
                assert "deepseek-flash" in page.locator("#ai-model-deepseek").inner_text()
                assert "claude-haiku-5-5" in page.locator("#ai-model-claude").inner_text()
                page.locator("#ai-model-input-claude").fill("claude-sonnet-5-5")
                page.locator("#ai-model-input-claude").dispatch_event("change")
                wait_js(page,
                    "async () => ((await chrome.storage.local.get('aiSettings')).aiSettings || {}).models?.claude === 'claude-sonnet-5-5'"
                )
                assert "claude-sonnet-5-5 (seçili)" in page.locator("#ai-model-claude").inner_text()
                assert page.locator("#ai-model-list-claude option").count() >= 3
                page.locator("#ai-provider-match").select_option("gemini")
                page.locator("#ai-risk-threshold").select_option("5")
                page.locator("#ai-match-verification").uncheck()
                wait_js(page, 
                    "async () => { const s = (await chrome.storage.local.get('aiSettings')).aiSettings || {};"
                    " return s.taskProviders?.match === 'gemini' && s.riskBlockThreshold === 5 && s.matchVerification === false; }"
                )
                page.evaluate("chrome.storage.local.set({aiStats: {'task.triage': 4, 'rule.hit': 2, 'hash.same': 7}})")
                page.wait_for_function("document.querySelector('#ai-stats').textContent.includes('7')")
                page.locator("#ai-stats-reset").click()
                wait_js(page, "async () => Object.keys((await chrome.storage.local.get('aiStats')).aiStats || {}).length === 0")
                result.screenshot(page, "ai-settings-dark-1440x1000.png")

            result.check("AI settings page stores both providers' keys, task providers and rules", ai_settings_page)

            def embedded_tools() -> None:
                count_before = len(context.pages)
                assert page.locator('a[href="titles.html"]').count() == 0
                assert_workspace(page, '.nav-btn[data-target="section-mixer"]', 'section-mixer')
                page.locator('#inputAsins').fill('B0TEST0001\nB0TEST0002\nB0TEST0001')
                page.locator('#mixButton').click()
                assert set(page.locator('#outputAsins').input_value().splitlines()) == {'B0TEST0001','B0TEST0002'}
                page.locator('#duplicatesButton').click()
                assert page.locator('#duplicatesContent').inner_text() == 'B0TEST0001'
                with page.expect_download() as info:
                    page.locator('#downloadButton').click()
                assert set(Path(info.value.path()).read_text().splitlines()) == {'B0TEST0001','B0TEST0002'}
                assert_workspace(page, '.nav-btn[data-target="section-asin-blacklist"]', 'section-asin-blacklist')
                page.locator('#blacklistAsinInput').fill('B0TEST0001')
                page.locator('#addBlacklistBtn').click()
                wait_js(page, "async () => (await chrome.storage.local.get('blacklistAsins')).blacklistAsins.includes('B0TEST0001')")
                assert 'B0TEST0001' in page.locator('#blacklistOutput').inner_text()
                page.locator('#blacklistFileInput').set_input_files({'name':'asins.txt','mimeType':'text/plain','buffer':b'B0TEST0002\nB0TEST0003'})
                page.locator('#uploadBlacklistBtn').click()
                wait_js(page, "async () => (await chrome.storage.local.get('blacklistAsins')).blacklistAsins.length === 3")
                assert len(context.pages) == count_before
                page.locator('.nav-btn[data-target="section-amazon"][data-amazon-tab="collect"]').click()
                page.locator('[data-workspace="section-asin-blacklist"]').click()
                assert visible_top_sections(page) == ['section-asin-blacklist']
                result.screenshot(page, 'blacklist-embedded.png')
                page.locator('.nav-btn[data-target="section-mixer"]').click()
                result.screenshot(page, 'mixer-embedded.png')

            result.check('Mixer and ASIN blacklist work within panel without new tabs', embedded_tools)

            def asin_exports() -> None:
                page.locator('.nav-btn[data-target="section-amazon"][data-amazon-tab="memory"]').click()
                with page.expect_download() as info:
                    page.locator('#exportCsvBtn').click()
                lines = Path(info.value.path()).read_text().splitlines()
                assert lines[0] == 'ASIN' and set(lines[1:]) == {'B0FIXTURE01','B0FIXTURE02','B0FIXTURE03'}
                with page.expect_download() as info:
                    page.locator('#exportJsonBtn').click()
                items = json.loads(Path(info.value.path()).read_text())['items']
                assert all(set(item) == {'asin'} for item in items) and len(items) == 3

            result.check('CSV and JSON export ASIN data without title preparation', asin_exports)

            def background_collect_controls() -> None:
                # The full background-window flow runs offline in tests/bg_collect_e2e.py.
                page.locator('.nav-btn[data-target="section-amazon"][data-amazon-tab="collect"]').click()
                assert page.locator("#amazon-target-select").count() == 0
                windows_before = worker.evaluate("async () => (await chrome.windows.getAll()).length")
                page.locator("#bg-collect-input").fill("")
                page.locator("#updateBtn").click()
                page.wait_for_timeout(300)
                assert worker.evaluate("async () => (await chrome.windows.getAll()).length") == windows_before, "empty input must not open a window"
                invalid = page.evaluate("chrome.runtime.sendMessage({action: 'bgCollectStart', input: 'https://example.com/s?k=x', mode: 'single'})")
                assert invalid["status"] == "invalid", invalid
                assert worker.evaluate("amazonCollectUrl('bamboo tray')") == "https://www.amazon.com/s?k=bamboo+tray"
                assert worker.evaluate("amazonCollectUrl('www.amazon.de/s?k=x')") == "https://www.amazon.de/s?k=x"
                assert page.locator("#stopAutoBtn").is_disabled() and not page.locator("#updateBtn").is_disabled()

            result.check("background collect: empty or non-Amazon input opens no window", background_collect_controls)

            def restore_memory_deep_link() -> None:
                page.goto(f"chrome-extension://{extension_id}/research.html#section-amazon/memory", wait_until="networkidle")
                page.reload(wait_until="networkidle")
                page.wait_for_function("document.getElementById('memory').classList.contains('active')")
                assert_inner_panel(page, "memory")
                assert visible_top_sections(page) == ["section-amazon"]

            result.check("reload restores the ASIN pool deep link", restore_memory_deep_link)

            def visual_artifacts() -> None:
                page.set_viewport_size({"width": 1440, "height": 1000})
                page.evaluate("chrome.storage.local.set({theme: 'dark'})")
                page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
                page.locator('.nav-btn[data-target="section-products"]').click()
                result.screenshot(page, "products-dark-1440x1000.png")

                page.locator("#theme-toggle").click()
                page.wait_for_function("document.documentElement.dataset.theme === 'light'")
                stored_theme = page.evaluate("chrome.storage.local.get('theme')")
                assert stored_theme.get("theme") == "light"
                result.screenshot(page, "products-light-1440x1000.png")

                page.locator("#theme-toggle").click()
                page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
                page.locator('.nav-btn[data-target="section-stores"]').click()
                result.screenshot(page, "stores-dark-1440x1000.png")

                page.locator('.nav-btn[data-target="section-amazon"][data-amazon-tab="collect"]').click()
                page.locator('.tab[data-tab="filtering"]').click()
                result.screenshot(page, "amazon-filter-dark-1440x1000.png")

            result.check("dark/light theme toggle and wide visual artifacts", visual_artifacts)

            def narrow_layout(width: int) -> None:
                page.set_viewport_size({"width": width, "height": 1000})
                page.locator('.nav-btn[data-target="section-products"]').click()
                page.wait_for_timeout(100)
                dimensions = page.evaluate(
                    "() => ({docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,"
                    " bodyScroll: document.body.scrollWidth, bodyClient: document.body.clientWidth})"
                )
                assert dimensions["docScroll"] <= dimensions["docClient"], dimensions
                assert dimensions["bodyScroll"] <= dimensions["bodyClient"], dimensions
                result.screenshot(page, f"products-dark-{width}x1000.png")

            result.check("760px viewport has no body overflow", lambda: narrow_layout(760))
            result.check("390px viewport has no body overflow", lambda: narrow_layout(390))

            def no_page_errors() -> None:
                page.wait_for_timeout(250)
                assert not result.page_errors, result.page_errors

            result.check("research page emits no uncaught page errors", no_page_errors)
        finally:
            context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extension-dir", type=Path, default=DEFAULT_EXTENSION_DIR)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    args = parser.parse_args()
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    result = SmokeRun(args.artifact_dir)

    try:
        with sync_playwright() as playwright:
            run(playwright, args.extension_dir.resolve(), args.artifact_dir.resolve(), result)
    except Exception as exc:
        result.failures.append(
            {
                "name": "smoke test setup",
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(limit=8),
            }
        )

    summary = result.summary()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
