importScripts('ai-core.js');

let settings = { extensionCookies: {} };
const domainId = 1;
let trackingInterval = null;
let stockTrackingInterval = null;
let trackedAsins = [];
let stockTrackedAsins = [];
let trackingResults = {};
let stockResults = {};
let priceHistory = {};
let timerState = { startTime: Date.now(), remainingTime: 60 * 60, isRunning: false };
let activeScrolls = {};
const CONCURRENT_REQUEST_LIMIT = 5;
const REQUEST_DELAY = 500;
const CACHE_DURATION = 800;
const CAPTCHA_RETRY_DELAY = 120000;
// LOCAL MODE: Uzak sunucu (Google Apps Script) adresi kaldırıldı.
let automationState = 'stopped';
let storeQueue = [];
let activeAutomationTabs = [];
let automationConcurrency = 1;
let automationWindowId = null;
let fetchingTabs = {};
let analysisState = 'stopped';
let activeAnalysisTabs = [];
let analysisWindowId = null;
// Amazon arka arkaya açılan çok sayıda isteği bot koruması olarak değerlendirip
// CAPTCHA/blok sayfası döndürüyordu. eBay akışlarındaki gibi sekmeler arasına
// bekleme koyuyor ve eşzamanlılığı düşürüyoruz.
const FETCH_ALL_CONCURRENCY = 3;
const FETCH_ALL_TAB_SPACING_MS = 2000;
// Blok tespit edilirse bu süre boyunca yeni sekme açılmaz (watchdog alarmı yeniden dener).
const FETCH_ALL_COOLDOWN_MS = 120000;
let fetchAllBlockedUntil = 0;
// Bir Amazon sekmesi bu süreden uzun açık kalırsa takılmış sayılır ve zorla kapatılır.
// (CAPTCHA yönlendirmesi, sayfanın hiç yüklenmemesi, içerik betiğinin hata alması vb.
//  durumlarda sekme kendini kapatamıyordu ve 5 sekme dolunca kuyruk kalıcı olarak tıkanıyordu.)
const FETCH_ALL_TAB_TIMEOUT_MS = 90000;
const FETCH_ALL_WATCHDOG_ALARM = 'fetchAllWatchdog';
let fetchAllState = 'stopped';
let fetchAllQueue = [];
let activeFetchAllTabs = [];

chrome.storage.local.get(['analysisState', 'activeAnalysisTabs', 'analysisWindowId'], (d) => {
    if(d.analysisState) analysisState = d.analysisState;
    if(d.activeAnalysisTabs) activeAnalysisTabs = d.activeAnalysisTabs || [];
    if(d.analysisWindowId) analysisWindowId = d.analysisWindowId;
});

chrome.storage.local.get(['fetchAllState', 'fetchAllQueue', 'activeFetchAllTabs'], (d) => {
    if (d.fetchAllState) fetchAllState = d.fetchAllState;
    if (d.fetchAllQueue) fetchAllQueue = d.fetchAllQueue || [];
    if (d.activeFetchAllTabs) activeFetchAllTabs = d.activeFetchAllTabs || [];
    if (fetchAllState === 'running') {
        chrome.alarms.create(FETCH_ALL_WATCHDOG_ALARM, { periodInMinutes: 1 });
        processFetchAllQueue();
    }
});

async function validateActiveTabs() {
    try {
        const currentTabs = await chrome.tabs.query({});
        const currentTabIds = new Set(currentTabs.map(t => t.id));
        const originalLength = activeAnalysisTabs.length;
        activeAnalysisTabs = activeAnalysisTabs.filter(t => currentTabIds.has(t.tabId));
        if (activeAnalysisTabs.length !== originalLength) {
            await chrome.storage.local.set({ activeAnalysisTabs });
        }
    } catch (e) {}
}

async function validateAutomationTabs() {
    try {
        const currentTabs = await chrome.tabs.query({});
        const currentTabIds = new Set(currentTabs.map(t => t.id));
        const originalLength = activeAutomationTabs.length;
        activeAutomationTabs = activeAutomationTabs.filter(t => currentTabIds.has(t.tabId));
        if (activeAutomationTabs.length !== originalLength) {
            await chrome.storage.local.set({ activeAutomationTabs });
        }
    } catch (e) {}
}

async function validateFetchAllTabs() {
    try {
        const currentTabs = await chrome.tabs.query({});
        const currentTabIds = new Set(currentTabs.map(t => t.id));
        const originalLength = activeFetchAllTabs.length;
        activeFetchAllTabs = activeFetchAllTabs.filter(t => currentTabIds.has(t.tabId));
        if (activeFetchAllTabs.length !== originalLength) {
            await chrome.storage.local.set({ activeFetchAllTabs });
        }
    } catch (e) {}
}

// "Tümünü Çek" için Amazon'da yığılma olmaması adına AI kuyruğuyla aynı desen:
// aynı anda en fazla FETCH_ALL_CONCURRENCY sekme açık kalır, biri kapanınca sıradaki açılır.
// Zaman aşımına uğramış (takılmış) sekmeleri zorla kapatır. Kapanma olayı
// onRemoved'ı tetikler; o da kuyruk öğesini 'completed' yapıp sıradakini açar.
// Ürün 'fetched' olarak İŞARETLENMEZ (bunu yalnızca closeSelf yapar), böylece
// takılan ürünler bir sonraki "Tümünü Çek" çalışmasında tekrar denenir.
async function sweepStuckFetchAllTabs() {
    const now = Date.now();
    const stuck = activeFetchAllTabs.filter(t => t.startedAt && (now - t.startedAt) > FETCH_ALL_TAB_TIMEOUT_MS);
    for (const t of stuck) {
        try {
            await chrome.tabs.remove(t.tabId);
        } catch (e) {
            activeFetchAllTabs = activeFetchAllTabs.filter(x => x.tabId !== t.tabId);
            const qi = fetchAllQueue.findIndex(item => item.itemId === t.itemId && item.status === 'active');
            if (qi !== -1) fetchAllQueue[qi].status = 'completed';
            await chrome.storage.local.set({ activeFetchAllTabs, fetchAllQueue });
        }
    }
    return stuck.length;
}

let fetchAllPumping = false;
async function processFetchAllQueue() {
    // Preparing a product awaits an AI call; a second pumper would overshoot concurrency.
    if (fetchAllPumping) return;
    fetchAllPumping = true;
    try { await pumpFetchAllQueue(); } finally { fetchAllPumping = false; }
}

async function pumpFetchAllQueue() {
    if (fetchAllState !== 'running') return;
    await validateFetchAllTabs();
    await sweepStuckFetchAllTabs();
    // Amazon blok verdiyse soğuma süresi dolana kadar yeni sekme açma; watchdog
    // alarmı (1 dk) süre dolunca kuyruğu kendiliğinden devam ettirir.
    if (fetchAllBlockedUntil && Date.now() < fetchAllBlockedUntil) return;
    while (activeFetchAllTabs.length < FETCH_ALL_CONCURRENCY) {
        const nextIndex = fetchAllQueue.findIndex(item => item.status === 'waiting');
        if (nextIndex === -1) break;
        const queueItem = fetchAllQueue[nextIndex];
        queueItem.status = 'active';
        try {
            await chrome.storage.local.set({ fetchAllQueue });
            const prep = await prepareAmazonFetch(queueItem.itemId, queueItem.url);
            if (prep.halt) {
                // The product stays unfetched, so the next "Tümünü Çek" run retries it.
                // Tabs already open finish on their own; onRemoved no longer pumps.
                queueItem.status = 'waiting';
                fetchAllState = 'stopped';
                await chrome.storage.local.set({ fetchAllState, fetchAllQueue });
                chrome.alarms.clear(FETCH_ALL_WATCHDOG_ALARM);
                chrome.runtime.sendMessage({ action: 'fetchAllQueueFinished', halted: true, reason: prep.reason }).catch(() => {});
                return;
            }
            if (prep.skip) {
                queueItem.status = 'completed';
                await chrome.storage.local.set({ fetchAllQueue });
                continue;
            }
            const tab = await chrome.tabs.create({ url: prep.url, active: false });
            fetchingTabs[tab.id] = queueItem.itemId;
            activeFetchAllTabs.push({ tabId: tab.id, itemId: queueItem.itemId, startedAt: Date.now() });
            await chrome.storage.local.set({ fetchAllQueue, activeFetchAllTabs });
            if (activeFetchAllTabs.length < FETCH_ALL_CONCURRENCY) {
                await new Promise(r => setTimeout(r, FETCH_ALL_TAB_SPACING_MS));
            }
        } catch (e) {
            break;
        }
    }
    const hasWaiting = fetchAllQueue.some(i => i.status === 'waiting');
    if (!hasWaiting && activeFetchAllTabs.length === 0) {
        fetchAllState = 'stopped';
        fetchAllQueue = [];
        await chrome.storage.local.set({ fetchAllState, fetchAllQueue });
        chrome.alarms.clear(FETCH_ALL_WATCHDOG_ALARM);
        chrome.runtime.sendMessage({ action: 'fetchAllQueueFinished' }).catch(() => {});
    }
}

// Service worker uykuya dalsa bile kuyruğun tıkalı kalmaması için periyodik denetim.
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== FETCH_ALL_WATCHDOG_ALARM) return;
    if (fetchAllState !== 'running') {
        chrome.alarms.clear(FETCH_ALL_WATCHDOG_ALARM);
        return;
    }
    await processFetchAllQueue();
});

// Concurrent analysis tabs, set on the analysis queue page (default 2, max 7).
async function getAnalysisConcurrency() {
    const { analysisConcurrency } = await chrome.storage.local.get('analysisConcurrency');
    const n = parseInt(analysisConcurrency, 10);
    return Number.isFinite(n) ? Math.min(7, Math.max(1, n)) : 2;
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.analysisConcurrency && analysisState === 'running') processQueueLoop();
});

async function processQueueLoop() {
    if (analysisState !== 'running') return;
    await validateActiveTabs();
    let { analysisQueue = [] } = await chrome.storage.local.get('analysisQueue');
    analysisQueue = analysisQueue.map(item => typeof item === 'string' ? { url: item, status: 'waiting' } : item);
    const limit = await getAnalysisConcurrency();
    while (activeAnalysisTabs.length < limit) {
        const nextItemIndex = analysisQueue.findIndex(item => item.status === 'waiting');
        if (nextItemIndex === -1) break;
        const item = analysisQueue[nextItemIndex];
        const analysisUrl = await applyScanMode(item.url, 'idg_analysis');
        analysisQueue[nextItemIndex].status = 'active';
        const tab = await chrome.tabs.create({ url: analysisUrl, active: false, windowId: analysisWindowId || undefined });
        activeAnalysisTabs.push({ tabId: tab.id, url: item.url });
        await chrome.storage.local.set({ analysisQueue, activeAnalysisTabs });
        // Sekmeler aynı anda açılınca hepsi eBay taramasına neredeyse aynı anda
        // başlıyordu; açılışları biraz yayarak ani istek yığılmasını azaltıyoruz.
        if (activeAnalysisTabs.length < limit) await new Promise(r => setTimeout(r, 2000));
    }
    const hasWaiting = analysisQueue.some(i => i.status === 'waiting');
    if (!hasWaiting && activeAnalysisTabs.length === 0) {
        analysisState = 'stopped';
        await chrome.storage.local.set({ analysisState });
        sendSheetLog('Analiz_Kuyrugu_Bitti');
    }
}

function broadcastAutomationState() {
    chrome.runtime.sendMessage({ action: 'automationStateUpdate', state: automationState }).catch(error => { });
}

// potentialProducts is rewritten whole; several fetch tabs finish at once, so writes are serialized.
let productWriteChain = Promise.resolve();
function saveProductFields(itemId, fields) {
    if (!itemId) return Promise.resolve();
    productWriteChain = productWriteChain.then(async () => {
        const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
        const productIndex = potentialProducts.findIndex(p => p.itemId === itemId);
        if (productIndex > -1) {
            Object.assign(potentialProducts[productIndex], fields);
            await chrome.storage.local.set({ potentialProducts });
        }
    }).catch(() => {});
    return productWriteChain;
}

async function markProductAsFetched(itemId) {
    await saveProductFields(itemId, { fetched: true });
}

async function cleanUpBlacklist() {
    const { sellerBlacklist = {} } = await chrome.storage.local.get('sellerBlacklist');
    const now = Date.now();
    let updatedBlacklist = {};
    let needsUpdate = false;
    for (const url in sellerBlacklist) {
        const expirationTime = sellerBlacklist[url];
        if (expirationTime > now) {
            updatedBlacklist[url] = expirationTime;
        } else {
            needsUpdate = true;
        }
    }
    if (needsUpdate) {
        await chrome.storage.local.set({ sellerBlacklist: updatedBlacklist });
    }
}

async function syncGlobalBlacklist() {
    // LOCAL MODE: Uzak sunucu senkronizasyonu tamamen kaldırıldı. Blacklist yereldir.
    return;
}

async function sendSheetLog(event, data = {}) {
    // LOCAL MODE: Telemetri tamamen kaldırıldı. Hiçbir veri dışarı gönderilmez.
    return;
}

async function checkAndSendDailyReport() {
    const { lastReportDate } = await chrome.storage.local.get('lastReportDate');
    const today = new Date().toLocaleDateString('tr-TR');
    if (lastReportDate !== today) {
        await sendSheetLog('Günlük_Sistem_Raporu', { status: 'Otomatik Rapor' });
        await syncGlobalBlacklist();
        await chrome.storage.local.set({ lastReportDate: today });
    }
}

// Kayıtlı mağaza linkleri LH_Sold içermeden (temiz) saklanır; Canlı/Satılmış tarama
// modu sekme açılırken burada uygulanır. Böylece mod değişince linkleri yeniden
// eklemek gerekmez ve eski (sold gömülü) kayıtlar da her iki modda çalışır.
async function applyScanMode(rawUrl, flagParam) {
    const { scanMode = 'live' } = await chrome.storage.local.get('scanMode');
    try {
        const url = new URL(rawUrl);
        if (scanMode === 'sold') {
            url.searchParams.set('LH_Sold', '1');
            url.searchParams.set('LH_Complete', '1');
        } else {
            url.searchParams.delete('LH_Sold');
            url.searchParams.delete('LH_Complete');
        }
        if (flagParam) url.searchParams.set(flagParam, 'true');
        return url.toString();
    } catch (e) {
        return rawUrl + (rawUrl.includes('?') ? '&' : '?') + (flagParam ? flagParam + '=true' : '');
    }
}

async function processNextInQueue() {
    if (automationState !== 'running') return;
    await validateAutomationTabs();
    let { storeQueue = [] } = await chrome.storage.local.get('storeQueue');
    storeQueue = storeQueue.map(item => item.status ? item : { ...item, status: 'waiting' });
    while (activeAutomationTabs.length < automationConcurrency) {
        const nextItemIndex = storeQueue.findIndex(item => item.status === 'waiting');
        if (nextItemIndex === -1) break;
        const linkInfo = storeQueue[nextItemIndex];
        const urlToVisit = await applyScanMode(linkInfo.url, 'idg_auto');
        const { savedSellerLinks = [] } = await chrome.storage.local.get('savedSellerLinks');
        const linkIndex = savedSellerLinks.findIndex(l => l.url === linkInfo.url);
        if (linkIndex !== -1) {
            savedSellerLinks[linkIndex].visited = true;
            await chrome.storage.local.set({ savedSellerLinks });
        }
        storeQueue[nextItemIndex].status = 'active';
        try {
            const tab = await chrome.tabs.create({ 
                url: urlToVisit, 
                active: false,
                windowId: automationWindowId || undefined
            });
            activeAutomationTabs.push({ tabId: tab.id, url: linkInfo.url });
            await chrome.storage.local.set({ storeQueue, activeAutomationTabs });
            if (activeAutomationTabs.length < automationConcurrency) await new Promise(r => setTimeout(r, 2000));
        } catch(e) {
            automationState = 'stopped';
            await chrome.storage.local.set({ automationState });
            broadcastAutomationState();
            break;
        }
    }
    const hasWaiting = storeQueue.some(i => i.status === 'waiting');
    if (!hasWaiting && activeAutomationTabs.length === 0) {
        automationState = 'stopped';
        storeQueue = [];
        activeAutomationTabs = [];
        automationWindowId = null;
        await chrome.storage.local.set({ automationState, storeQueue, activeAutomationTabs, automationWindowId });
        broadcastAutomationState();
        sendSheetLog('Otomasyon_Tamamlandı');
    }
}

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const autoTabIndex = activeAutomationTabs.findIndex(t => t.tabId === tabId);
    if (autoTabIndex !== -1) {
        const closedTabInfo = activeAutomationTabs[autoTabIndex];
        activeAutomationTabs.splice(autoTabIndex, 1);
        await chrome.storage.local.set({ activeAutomationTabs });
        const urlToBlacklist = closedTabInfo.url;
        const { sellerBlacklist = {} } = await chrome.storage.local.get('sellerBlacklist');
        const existingBanDate = sellerBlacklist[urlToBlacklist];
        const now = Date.now();
        const isPermanentlyBanned = existingBanDate && existingBanDate > (now + (10000 * 24 * 60 * 60 * 1000));
        if (!isPermanentlyBanned) {
            const expirationDate = Date.now() + (15 * 24 * 60 * 60 * 1000);
            sellerBlacklist[urlToBlacklist] = expirationDate;
            await chrome.storage.local.set({ sellerBlacklist });
        }
        let { storeQueue = [] } = await chrome.storage.local.get('storeQueue');
        const queueIndex = storeQueue.findIndex(item => item.url === closedTabInfo.url && item.status === 'active');
        if (queueIndex !== -1) {
            storeQueue[queueIndex].status = 'completed';
            await chrome.storage.local.set({ storeQueue });
        }
        if (automationState === 'running') {
            processNextInQueue();
        }
    }
    const tabIndex = activeAnalysisTabs.findIndex(t => t.tabId === tabId);
    if (tabIndex !== -1) {
        const closedTabInfo = activeAnalysisTabs[tabIndex];
        activeAnalysisTabs.splice(tabIndex, 1);
        await chrome.storage.local.set({ activeAnalysisTabs });
        let { analysisQueue = [] } = await chrome.storage.local.get('analysisQueue');
        const queueIndex = analysisQueue.findIndex(item => item.url === closedTabInfo.url && item.status === 'active');
        if (queueIndex !== -1) {
            analysisQueue[queueIndex].status = 'completed';
            await chrome.storage.local.set({ analysisQueue });
        }
        processQueueLoop();
    }
    const fetchAllIndex = activeFetchAllTabs.findIndex(t => t.tabId === tabId);
    if (fetchAllIndex !== -1) {
        const closedInfo = activeFetchAllTabs[fetchAllIndex];
        activeFetchAllTabs.splice(fetchAllIndex, 1);
        delete fetchingTabs[tabId];
        const qIndex = fetchAllQueue.findIndex(item => item.itemId === closedInfo.itemId && item.status === 'active');
        if (qIndex !== -1) fetchAllQueue[qIndex].status = 'completed';
        await chrome.storage.local.set({ activeFetchAllTabs, fetchAllQueue });
        if (fetchAllState === 'running') processFetchAllQueue();
    }
});

function cookieToString(cookies) {
    if (!Array.isArray(cookies)) return "";
    let result = "";
    cookies.forEach(cookie => {
        if (cookie.value && cookie.value !== "-" && cookie.value !== "delete") {
            result += `${cookie.name}=${cookie.value}; `;
        }
    });
    return result.trim();
}

async function checkPriceAndStock(asin) {
    const existingResult = stockResults[asin] || {};
    if (existingResult.lastUpdated && (Date.now() - existingResult.lastUpdated) / 1000 < CACHE_DURATION) {
        return existingResult;
    }
    const productLink = `https://www.amazon.com/dp/${asin}`;
    try {
        const userCookies = await chrome.cookies.getAll({ url: "https://www.amazon.com" }).catch(() => []);
        if (!userCookies || userCookies.length === 0) {
            return { price: "Error: No Cookies", stock: "Unknown", prime: "Unknown", title: "Login Required", lastUpdated: Date.now(), status: "fail", image: "" };
        }
        const cookieHeader = cookieToString(userCookies);
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
        const response = await fetch(productLink, {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Referer": "https://www.amazon.com",
                "Cookie": cookieHeader,
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1"
            },
            credentials: "include"
        });
        if (response.status !== 200) {
            return { price: `Error: HTTP ${response.status}`, stock: "Unknown", prime: "Unknown", title: "Network Error", lastUpdated: Date.now(), status: "fail", image: "" };
        }
        const text = await response.text();
        if (!text || text.length < 100) {
            return { price: "Error: Empty Response", stock: "Unknown", prime: "Unknown", title: "Invalid Data", lastUpdated: Date.now(), status: "fail", image: "" };
        }
        const captchaIndicators = [
            /captcha/i,
            /verify your identity/i,
            /enter the characters/i,
            /recaptcha/i,
            /not a robot/i
        ];
        if (captchaIndicators.some(indicator => indicator.test(text))) {
            if (trackingInterval) {
                clearInterval(trackingInterval);
                trackingInterval = null;
            }
            if (stockTrackingInterval) {
                clearInterval(stockTrackingInterval);
                stockTrackingInterval = null;
            }
            chrome.runtime.sendMessage({ type: "captchaDetected", asin }, (response) => {});
            setTimeout(() => {
                if (trackedAsins.length > 0) {
                    trackingInterval = setInterval(trackAsins, 60 * 60 * 1000);
                    trackAsins();
                }
                if (stockTrackedAsins.length > 0) {
                    stockTrackingInterval = setInterval(trackStockAsins, 60 * 60 * 1000);
                    trackStockAsins();
                }
            }, CAPTCHA_RETRY_DELAY);
            return { price: "Error: CAPTCHA Detected", stock: "Unknown", prime: "Unknown", title: "CAPTCHA Required", lastUpdated: Date.now(), status: "fail", image: "" };
        }
        let price = "Unknown";
        const priceSelectors = [
            /<span[^>]*class="[^\"]*a-price[^\"]*"[^>]*>[\s\S]*?<span[^>]*class="a-offscreen"[^>]*>[\$\{\}]*([\d,.]+)/i,
            /<span[^>]*id="priceblock_ourprice"[^>]*>[\$\{\}]*([\d,.]+)/i,
            /<span[^>]*class="a-price-whole"[^>]*>([\d,.]+)/i,
            /<div[^>]*class="a-price"[^>]*>[\s\S]*?<span[^>]*>[\$\{\}]*([\d,.]+)/i,
            /<span[^>]*id="price"[^>]*>[\$\{\}]*([\d,.]+)/i
        ];
        for (const regex of priceSelectors) {
            const match = regex.exec(text);
            if (match) {
                price = `$${match[1]}`;
                break;
            }
        }
        let oldPrice = priceHistory[asin] || "N/A";
        if (price !== "Unknown") {
            priceHistory[asin] = price;
            chrome.storage.local.set({ priceHistory });
        }
        let stock = "Out of Stock";
        const stockButtonSelectors = [
            /<input[^>]*id="add-to-cart-button"[^>]*>/i,
            /<input[^>]*id="buy-now-button"[^>]*>/i,
            /<button[^>]*id="add-to-cart-button"[^>]*>/i,
            /<button[^>]*id="buy-now-button"[^>]*>/i
        ];
        for (const regex of stockButtonSelectors) {
            if (text.match(regex)) {
                stock = "In Stock";
                break;
            }
        }
        let prime = "Not Prime";
        const primeSelector = /<i[^>]*class="[^\"]*a-icon-prime[^\"]*"[^>]*role="img"[^>]*aria-label="prime"[^>]*>/i;
        if (text.match(primeSelector)) {
            prime = "Prime";
        }
        let title = "N/A";
        const titleSelectors = [
            /<span[^>]*id="productTitle"[^>]*class="[^\"]*a-size-large[^\"]*"[^>]*>([\s\S]*?)<\/span>/i,
            /<h1[^>]*id="title"[^>]*class="a-size-large[^>]*>([\s\S]*?)<\/h1>/i,
            /<span[^>]*class="a-size-extra-large"[^>]*>([\s\S]*?)<\/span>/i,
            /<title[^>]*>([\s\S]*?)(?: - Amazon\.com[\s\S]*?)<\/title>/i,
            /<div[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/div>/,
            /<span[^>]*id="[^\"]*title[^\"]*"[^>]*>([\s\S]*?)<\/span>/i
        ];
        for (const regex of titleSelectors) {
            const match = regex.exec(text);
            if (match && match[1]) {
                let rawTitle = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if (rawTitle) {
                    title = rawTitle.length > 100 ? rawTitle.substring(0, 100) + "..." : rawTitle;
                    break;
                }
            }
        }
        let image = "";
        const landingImageBlockSelector = /<span[^>]*class="a-declarative"[^>]*data-action="main-image-click"[^>]*>[\s\S]*?<img[^>]*src=["'](.*?\.jpg)["'][^>]*?(?:data-old-hires=["'](.*?\.jpg)["'])?[^>]*?(?:data-a-dynamic-image=["'](.*?)["'])?[^>]*>/i;
        let imageMatch = text.match(landingImageBlockSelector);
        if (imageMatch) {
            const hiresImage = imageMatch[2];
            if (hiresImage) {
                image = hiresImage;
            } else if (imageMatch[3]) {
                try {
                    const dynamicImages = JSON.parse(imageMatch[3].replace(/"/g, '"'));
                    let maxSize = 0;
                    let largestImage = "";
                    for (const [url, dimensions] of Object.entries(dynamicImages)) {
                        const size = dimensions[0];
                        if (size > maxSize) {
                            maxSize = size;
                            largestImage = url;
                        }
                    }
                    image = largestImage || imageMatch[1];
                } catch (e) {
                    image = imageMatch[1];
                }
            } else {
                image = imageMatch[1];
            }
        } else {
            const ivLargeImageSelector = /<div[^>]*id="ivLargeImage"[^>]*>[\s\S]*?<img[^>]*src=["'](.*?\.jpg)["'][^>]*>/i;
            imageMatch = text.match(ivLargeImageSelector);
            if (imageMatch) {
                image = imageMatch[1];
            }
        }
        if (image) {
            image = image.replace(/\._+AC_([A-Z09_]+?)(\.jpg|\.webp)/g, "._AC_SL1500$2");
        }
        const status = (response.status === 200 && price !== "Unknown" && stock !== "Unknown" && title !== "N/A" && image && prime !== "Unknown") ? "success" : "fail";
        return { price, oldPrice, prime, stock, title, lastUpdated: Date.now(), status, image };
    } catch (err) {
        return { price: "Error: " + err.message, oldPrice: "N/A", prime: "Unknown", stock: "Unknown", title: "Error", lastUpdated: Date.now(), status: "fail", image: "" };
    }
}

async function trackAsins() {
    const chunks = [];
    for (let i = 0; i < trackedAsins.length; i += CONCURRENT_REQUEST_LIMIT) {
        chunks.push(trackedAsins.slice(i, i + CONCURRENT_REQUEST_LIMIT));
    }
    for (const chunk of chunks) {
        const promises = chunk.map(asin => checkPriceAndStock(asin).then(result => {
            trackingResults[asin] = result;
        }));
        await Promise.all(promises);
    }
    chrome.runtime.sendMessage({ type: "trackingUpdate", results: trackingResults }, (response) => {});
    chrome.storage.local.set({ trackingResults });
}

async function trackStockAsins() {
    const chunks = [];
    for (let i = 0; i < stockTrackedAsins.length; i += CONCURRENT_REQUEST_LIMIT) {
        chunks.push(stockTrackedAsins.slice(i, i + CONCURRENT_REQUEST_LIMIT));
    }
    for (const chunk of chunks) {
        const promises = chunk.map(asin => checkPriceAndStock(asin).then(result => {
            stockResults[asin] = result;
        }));
        await Promise.all(promises);
    }
    chrome.runtime.sendMessage({ type: "stockTrackingUpdate", results: stockResults }, (response) => {});
    chrome.storage.local.set({ stockResults });
}

function updateTimer() {
    chrome.storage.local.get("timerState", (data) => {
        let currentTimerState = data.timerState || { startTime: Date.now(), remainingTime: 60 * 60, isRunning: false };
        if (!currentTimerState.isRunning) {
            return;
        }
        let elapsed = Math.floor((Date.now() - currentTimerState.startTime) / 1000);
        let timeLeft = 60 * 60 - elapsed;
        if (timeLeft <= 0) {
            currentTimerState.isRunning = false;
            currentTimerState.remainingTime = 0;
        } else {
            currentTimerState.remainingTime = timeLeft;
        }
        chrome.storage.local.set({ timerState: currentTimerState }, () => {
            try {
                chrome.runtime.sendMessage({ type: "timerUpdate" }, (response) => {
                    if (chrome.runtime.lastError) {
                        setTimeout(() => {
                            chrome.runtime.sendMessage({ type: "timerUpdate" });
                        }, 1000);
                    }
                });
            } catch (e) {}
        });
    });
    checkAndSendDailyReport();
}

async function getOrCreateFolder(folderName, parentId = '1') {
    const searchResults = await chrome.bookmarks.search({ title: folderName });
    const existingFolder = searchResults.find(bookmark => bookmark.parentId === parentId && !bookmark.url);
    if (existingFolder) {
        return existingFolder.id;
    } else {
        const newFolder = await chrome.bookmarks.create({
            parentId: parentId,
            title: folderName
        });
        return newFolder.id;
    }
}

// ---- AI tasks (ai-core.js does provider calls, rules, hashing and prompts) ----------------
async function loadAiContext() {
    const d = await chrome.storage.local.get([...Object.values(IndyAI.KEY_STORAGE), ...Object.values(IndyAI.LEGACY_KEY_STORAGE), 'aiSettings']);
    const migration = IndyAI.migrateKeyStorage(d);
    if (migration) {
        await chrome.storage.local.set(migration.set);
        await chrome.storage.local.remove(migration.remove);
    }
    return { keys: IndyAI.keysFromStorage(d), settings: IndyAI.mergeSettings(d.aiSettings) };
}

// Counters for the AI page. Batched in memory: parallel tabs would otherwise lose increments.
let pendingAiStats = {};
let aiStatsTimer = null;
function countAi(key, n = 1) {
    pendingAiStats[key] = (pendingAiStats[key] || 0) + n;
    if (!aiStatsTimer) aiStatsTimer = setTimeout(flushAiStats, 1000);
}
async function flushAiStats() {
    const batch = pendingAiStats;
    pendingAiStats = {};
    aiStatsTimer = null;
    const { aiStats = {} } = await chrome.storage.local.get('aiStats');
    for (const [key, n] of Object.entries(batch)) aiStats[key] = (aiStats[key] || 0) + n;
    aiStats.updatedAt = Date.now();
    await chrome.storage.local.set({ aiStats });
}

// The AI page shows the model that actually answered, not only the configured name.
async function rememberAiModel(provider, model, task) {
    if (!model) return;
    const { aiLastModels = {} } = await chrome.storage.local.get('aiLastModels');
    aiLastModels[provider] = { model, task, at: Date.now() };
    await chrome.storage.local.set({ aiLastModels });
}

// Consecutive AI tasks that failed on every provider. A few in a row usually means spent
// credit or quota, so the panel gets a warning (aiAlert) instead of silent fallbacks.
const AI_ALERT_STREAK = 3;
let aiFailStreak = 0;
async function raiseAiAlert(reason, halted) {
    await chrome.storage.local.set({ aiAlert: { reason, halted: !!halted, at: Date.now() } });
}

async function runAi(task, prompt, images, maxTokens) {
    const { keys, settings } = await loadAiContext();
    const result = await IndyAI.runAiTask({
        task, prompt, images, maxTokens, keys, settings,
        fetchImpl: (url, init) => fetch(url, init),
        onAttempt: a => countAi(`${a.provider}.${a.ok ? 'ok' : 'fail'}`)
    });
    if (result.ok) {
        countAi(`task.${task}`);
        rememberAiModel(result.provider, result.model, task);
        aiFailStreak = 0;
    }
    else countAi(result.noKeys ? `task.${task}.noKeys` : `task.${task}.error`);
    if (!result.ok && !result.noKeys && ++aiFailStreak >= AI_ALERT_STREAK) await raiseAiAlert(result.reason, false);
    return result;
}

async function imageToInline(imageUrl, maxDim) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('Görsel indirilemedi');
    const bitmap = await createImageBitmap(await res.blob());
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
    }
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mimeType: 'image/jpeg', data: btoa(binary) };
}

const imageHashCache = new Map();
async function imageDHash(imageUrl) {
    if (imageHashCache.has(imageUrl)) return imageHashCache.get(imageUrl);
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('Görsel indirilemedi');
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(9, 8);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 9, 8);
    const px = ctx.getImageData(0, 0, 9, 8).data;
    const gray = [];
    for (let i = 0; i < px.length; i += 4) gray.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    const hash = IndyAI.dHashFromGray(gray);
    if (imageHashCache.size > 500) imageHashCache.clear();
    imageHashCache.set(imageUrl, hash);
    return hash;
}

// Ö3 rules first; otherwise one AI call returns risk and the cleaned Amazon query (Ö5).
async function triageProduct(product) {
    const rule = IndyAI.ruleRisk(product.title);
    if (rule) {
        countAi('rule.hit');
        return { ...rule, amazonQuery: null };
    }
    const images = [];
    try { if (product.imageUrl) images.push(await imageToInline(product.imageUrl, 768)); } catch (e) {}
    const r = await runAi('triage', IndyAI.triagePrompt({ title: product.title, price: product.ebayPrice, seller: product.sellerName }), images, 200);
    if (!r.ok) return { error: true, reason: r.reason, noKeys: r.noKeys };
    const t = IndyAI.normalizeTriage(r.json);
    return t ? { ...t, source: r.provider } : { error: true, reason: 'AI yanıtı eksik' };
}

function withAutoCollectFlag(url) {
    try {
        const u = new URL(url);
        u.searchParams.set('indygrab_auto_collect', 'true');
        return u.toString();
    } catch (e) {
        return url.includes('indygrab_auto_collect=true') ? url : url + '&indygrab_auto_collect=true';
    }
}

// Ö2: decide risk right before Amazon opens, and skip high-risk products.
// When the AI gives no answer fetching halts (stopOnAiFailure); with that setting off,
// no key or risk blocking off, the product is fetched with its original query.
async function prepareAmazonFetch(itemId, fallbackUrl) {
    const { potentialProducts = [] } = await chrome.storage.local.get('potentialProducts');
    const product = potentialProducts.find(p => p.itemId === itemId);
    if (!product) return { url: withAutoCollectFlag(fallbackUrl) };
    const { settings } = await loadAiContext();
    let triage;
    if (product.riskScore !== undefined && product.amazonQuery !== undefined) {
        triage = { riskScore: product.riskScore, reason: product.riskReason, amazonQuery: product.amazonQuery };
    } else {
        triage = await triageProduct(product);
        if (!triage.error) {
            await saveProductFields(itemId, {
                riskScore: triage.riskScore, riskReason: triage.reason,
                riskSource: triage.source, amazonQuery: triage.amazonQuery ?? null
            });
        }
    }
    if (IndyAI.triageHalts(triage, settings)) {
        countAi('fetch.haltedNoAi');
        await raiseAiAlert(triage.reason, true);
        return { halt: true, reason: triage.reason };
    }
    if (!triage.error && settings.riskBlockThreshold > 0 && triage.riskScore >= settings.riskBlockThreshold) {
        await saveProductFields(itemId, { fetched: true, fetchSkipReason: `Risk ${triage.riskScore}/10 — ${triage.reason}` });
        countAi('fetch.skippedRisk');
        return { skip: true };
    }
    const base = product.amazonSearchUrl || fallbackUrl;
    return { url: withAutoCollectFlag(IndyAI.amazonSearchUrlFor(base, triage.error ? null : triage.amazonQuery)) };
}

// Ö1: perceptual hash decides clear cases; the AI only sees borderline pairs.
async function compareSellerImages(mainImageUrl, targetImageUrl) {
    const { settings } = await loadAiContext();
    try {
        const distance = IndyAI.hammingHex(await imageDHash(mainImageUrl), await imageDHash(targetImageUrl));
        const verdict = IndyAI.hashVerdict(distance, settings);
        countAi(`hash.${verdict}`);
        if (verdict !== 'unsure') return { isMatch: verdict === 'same', method: 'hash', distance };
    } catch (e) {
        countAi('hash.error');
    }
    let images;
    try {
        images = await Promise.all([mainImageUrl, targetImageUrl].map(u => imageToInline(u, 512)));
    } catch (e) {
        return { error: true, reason: 'Görsel indirilemedi' };
    }
    const r = await runAi('imageCompare', IndyAI.imageComparePrompt(), images, 200);
    if (!r.ok) return { error: true, reason: r.reason };
    return { isMatch: r.json.isMatch === true, method: r.provider, analysis: r.json.analysis };
}

// Ö4: only Amazon results the AI calls the same product are kept for an eBay fetch.
async function verifyAmazonMatch(itemId, candidates) {
    const { settings } = await loadAiContext();
    if (!settings.matchVerification) return { skipped: true };
    const { potentialProducts = [] } = await chrome.storage.local.get('potentialProducts');
    const product = potentialProducts.find(p => p.itemId === itemId);
    if (!product || !product.imageUrl || !candidates.length) return { skipped: true };
    const unverified = async reason => {
        await saveProductFields(itemId, { aiMatch: 'unverified', aiMatchReason: reason });
        countAi('match.unverified');
        return { error: true, reason };
    };
    let reference;
    try { reference = await imageToInline(product.imageUrl, 512); } catch (e) { return unverified('eBay görseli indirilemedi'); }
    const limited = candidates.slice(0, settings.matchCandidateLimit);
    const loaded = await Promise.all(limited.map(c => c.imageUrl ? imageToInline(c.imageUrl, 384).catch(() => null) : null));
    const usable = limited.filter((c, i) => loaded[i]);
    if (!usable.length) return unverified('Amazon görselleri indirilemedi');
    const r = await runAi('match', IndyAI.matchPrompt(product, usable), [reference, ...loaded.filter(Boolean)], 300);
    if (!r.ok) return unverified(r.reason);
    const matches = IndyAI.normalizeMatch(r.json, usable);
    if (!matches) return unverified('AI yanıtı eksik');
    await saveProductFields(itemId, { aiMatch: matches.length ? 'verified' : 'no_match', aiMatchCount: matches.length, aiMatchProvider: r.provider });
    countAi(matches.length ? 'match.verified' : 'match.noMatch');
    return { matches, provider: r.provider };
}

// ---- Background Amazon collection from the panel ---------------------------------------
// The panel never drives the user's own Amazon tabs: it opens a separate unfocused window,
// collects there and closes it when the single scan or the auto-collect run ends.
const BG_COLLECT_SINGLE_TIMEOUT_MS = 90000;
const BG_COLLECT_IDLE_TIMEOUT_MS = 180000;
const BG_COLLECT_WATCHDOG_ALARM = 'bgCollectWatchdog';
const BG_AMAZON_HOSTS = ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au'];

// Accepts a supported Amazon URL (kept as is) or a keyword (amazon.com search).
function amazonCollectUrl(input) {
    let text = String(input || '').trim();
    if (!text) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/i.test(text)) text = 'https://' + text;
    try {
        const url = new URL(text);
        const host = url.hostname.toLowerCase();
        const supported = /^https?:$/.test(url.protocol) && BG_AMAZON_HOSTS.some(d => host === d || host.endsWith('.' + d));
        return supported ? url.toString() : null;
    } catch (e) {
        return 'https://www.amazon.com/s?k=' + encodeURIComponent(text).replace(/%20/g, '+');
    }
}

async function getBgCollect() {
    const { bgCollectSession = null } = await chrome.storage.local.get('bgCollectSession');
    return bgCollectSession;
}

async function endBgCollect(reason) {
    const session = await getBgCollect();
    if (!session) return;
    const reset = { bgCollectSession: null, bgCollectLast: { reason, mode: session.mode, endedAt: Date.now() } };
    if (session.mode === 'auto') Object.assign(reset, { autoCollectActive: false, autoCollectTabId: null, visitedPages: [] });
    await chrome.storage.local.set(reset);
    chrome.alarms.clear(BG_COLLECT_WATCHDOG_ALARM);
    try { await chrome.windows.remove(session.windowId); } catch (e) {}
}

async function startBgCollect(input, mode) {
    if (await getBgCollect()) return { status: 'busy' };
    const url = amazonCollectUrl(input);
    if (!url) return { status: 'invalid' };
    mode = mode === 'auto' ? 'auto' : 'single';
    // Open blank first so the tab id is recorded before any Amazon page can read the flags.
    const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal', width: 1280, height: 900 });
    const tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
    if (tabId === null) {
        try { await chrome.windows.remove(win.id); } catch (e) {}
        return { status: 'error' };
    }
    const session = { windowId: win.id, tabId, mode, url, startedAt: Date.now(), lastActivity: Date.now() };
    const state = { bgCollectSession: session, collectedPages: {} };
    if (mode === 'auto') Object.assign(state, { autoCollectActive: true, autoCollectTabId: tabId, visitedPages: [] });
    await chrome.storage.local.set(state);
    chrome.alarms.create(BG_COLLECT_WATCHDOG_ALARM, { periodInMinutes: 0.5 });
    await chrome.tabs.update(tabId, { url });
    return { status: 'started', mode, url };
}

async function onBgCollectTabMessage(tabId, message) {
    const session = await getBgCollect();
    if (!session || session.tabId !== tabId) return;
    if (message.autoCollectStopped) return endBgCollect(message.reason || 'stopped');
    if (session.mode === 'single') return endBgCollect('single_done');
    session.lastActivity = Date.now();
    await chrome.storage.local.set({ bgCollectSession: session });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== BG_COLLECT_WATCHDOG_ALARM) return;
    const session = await getBgCollect();
    if (!session) {
        chrome.alarms.clear(BG_COLLECT_WATCHDOG_ALARM);
        return;
    }
    const limit = session.mode === 'single' ? BG_COLLECT_SINGLE_TIMEOUT_MS : BG_COLLECT_IDLE_TIMEOUT_MS;
    if (Date.now() - (session.lastActivity || session.startedAt) > limit) await endBgCollect('timeout');
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    const session = await getBgCollect();
    if (session && session.windowId === windowId) await endBgCollect('window_closed');
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    const session = await getBgCollect();
    if (!session || session.tabId !== tabId) return;
    session.lastActivity = Date.now();
    await chrome.storage.local.set({ bgCollectSession: session });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender && sender.tab && (message.asinList || message.autoCollectStopped)) void onBgCollectTabMessage(sender.tab.id, message);
    if (message.action === "whoAmI") {
        sendResponse({ tabId: sender && sender.tab ? sender.tab.id : null });
        return true;
    }
    if (message.action === "bgCollectStart") {
        startBgCollect(message.input, message.mode).then(sendResponse, () => sendResponse({ status: "error" }));
        return true;
    }
    if (message.action === "bgCollectStop") {
        endBgCollect("stopped_by_user").then(() => sendResponse({ status: "stopped" }));
        return true;
    }
    if (message.action === "analyzeProductRisk") {
        (async () => {
            const result = await triageProduct({
                itemId: message.itemId, imageUrl: message.imageUrl, title: message.title,
                ebayPrice: message.price, sellerName: message.seller
            });
            if (!result.error && message.itemId) {
                await saveProductFields(message.itemId, {
                    riskScore: result.riskScore, riskReason: result.reason,
                    riskSource: result.source, amazonQuery: result.amazonQuery ?? null
                });
            }
            sendResponse(result);
        })();
        return true;
    }
    if (message.action === "compareImages") {
        compareSellerImages(message.mainImageUrl, message.targetImageUrl).then(sendResponse);
        return true;
    }
    if (message.action === "verifyAmazonMatch") {
        const tabId = sender.tab && sender.tab.id;
        const itemId = tabId ? fetchingTabs[tabId] : null;
        if (!itemId) {
            sendResponse({ skipped: true });
            return true;
        }
        verifyAmazonMatch(itemId, message.candidates || []).then(sendResponse);
        return true;
    }
    if (message.action === "initiateSmoothScroll") {
        const tabId = sender.tab.id;
        if (!tabId || activeScrolls[tabId]) {
            sendResponse({ status: "already_running_or_invalid" });
            return true;
        }
        const scrollStep = 10;
        const scrollInterval = 30;
        activeScrolls[tabId] = setInterval(async () => {
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: (step) => {
                        window.scrollBy(0, step);
                        return (window.innerHeight + window.scrollY) >= document.body.scrollHeight;
                    },
                    args: [scrollStep]
                });
                if (results && results[0] && results[0].result === true) {
                    clearInterval(activeScrolls[tabId]);
                    delete activeScrolls[tabId];
                }
            } catch (error) {
                clearInterval(activeScrolls[tabId]);
                delete activeScrolls[tabId];
            }
        }, scrollInterval);
        sendResponse({ status: "started" });
        return true;
    }
    if (message.action === "createBookmark") {
        (async () => {
            try {
                const folderId = await getOrCreateFolder("IndyGrab.VO");
                await chrome.bookmarks.create({ parentId: folderId, title: message.title, url: message.url });
                sendResponse({ status: "success" });
            } catch (error) {
                sendResponse({ status: "error", message: error.toString() });
            }
        })();
        return true;
    }
    if (message.action === "openTabInBackground") {
        (async () => {
            let url = message.url;
            if (message.itemId && String(url).includes('indygrab_auto_collect=true')) {
                const prep = await prepareAmazonFetch(message.itemId, url);
                if (prep.halt) {
                    sendResponse({ status: "aiHalted", reason: prep.reason });
                    return;
                }
                if (prep.skip) {
                    sendResponse({ status: "skipped" });
                    return;
                }
                url = prep.url;
            }
            const tab = await chrome.tabs.create({ 
                url, 
                active: false,
                windowId: sender.tab.windowId 
            });
            if (message.itemId) {
                fetchingTabs[tab.id] = message.itemId;
            }
            sendResponse({ status: "success" });
        })();
        return true;
    }
    if (message.action === "startFetchAllQueue") {
        (async () => {
            if (fetchAllState === 'running') {
                sendResponse({ status: "already_running", total: fetchAllQueue.length });
                return;
            }
            const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
            const toFetch = potentialProducts.filter(p => !p.fetched);
            if (toFetch.length === 0) {
                sendResponse({ status: "empty" });
                return;
            }
            fetchAllQueue = toFetch.map(p => ({ itemId: p.itemId, url: p.amazonSearchUrl + '&indygrab_auto_collect=true', status: 'waiting' }));
            fetchAllState = 'running';
            activeFetchAllTabs = [];
            await chrome.storage.local.set({ fetchAllState, fetchAllQueue, activeFetchAllTabs });
            chrome.alarms.create(FETCH_ALL_WATCHDOG_ALARM, { periodInMinutes: 1 });
            processFetchAllQueue();
            sendResponse({ status: "started", total: fetchAllQueue.length });
        })();
        return true;
    }
    if (message.action === "getFetchAllQueueStatus") {
        sendResponse({
            state: fetchAllState,
            total: fetchAllQueue.length,
            remaining: fetchAllQueue.filter(i => i.status !== 'completed').length,
            active: activeFetchAllTabs.length
        });
        return true;
    }
    // Amazon bot koruması (CAPTCHA / "robot değilim" / hata sayfası) tespit edildi.
    // Ürünü 'fetched' İŞARETLEME — kuyruğa geri koy ve bir süre yeni sekme açma.
    if (message.action === 'autoFetchBlocked') {
        (async () => {
            const tabId = sender.tab && sender.tab.id;
            fetchAllBlockedUntil = Date.now() + FETCH_ALL_COOLDOWN_MS;
            if (tabId) {
                const info = activeFetchAllTabs.find(t => t.tabId === tabId);
                if (info) {
                    // 'active' -> 'waiting': sekme kapanınca onRemoved bunu 'completed'
                    // yapmasın diye SIRALAMA ÖNEMLİ (önce durum, sonra kapatma).
                    const qi = fetchAllQueue.findIndex(i => i.itemId === info.itemId && i.status === 'active');
                    if (qi !== -1) fetchAllQueue[qi].status = 'waiting';
                    await chrome.storage.local.set({ fetchAllQueue });
                }
                delete fetchingTabs[tabId];
                try { await chrome.tabs.remove(tabId); } catch (e) {}
            }
            sendResponse({ status: "cooldown", until: fetchAllBlockedUntil });
        })();
        return true;
    }
    if (message.action === 'closeSelf') {
        if (sender.tab && sender.tab.id) {
            const tabId = sender.tab.id;
            const itemId = fetchingTabs[tabId];
            if (itemId) {
                markProductAsFetched(itemId);
                delete fetchingTabs[tabId];
            }
            chrome.tabs.remove(tabId);
            sendResponse({ status: "success" });
        } else {
            sendResponse({ status: "error", message: "Tab ID not found." });
        }
        return true;
    }
    if (message.action === "solveCaptcha") {
        (async () => {
            try {
                const tab = await chrome.tabs.create({ 
                    url: message.url, 
                    active: false,
                    windowId: sender.tab.windowId
                });
                setTimeout(async () => {
                    try {
                        const currentTabInfo = await chrome.tabs.get(tab.id);
                        if (currentTabInfo) await chrome.tabs.remove(tab.id);
                    } catch (e) {} finally {
                        if (sender.tab && sender.tab.id) {
                            chrome.tabs.sendMessage(sender.tab.id, { action: "captchaSolved" }).catch(e => {});
                        }
                    }
                }, 2000);
                sendResponse({ status: "solving" });
            } catch (error) {
                sendResponse({ status: "error", message: error.toString() });
            }
        })();
        return true;
    }
    if (message.action === "removePotentialProduct") {
        (async () => {
            const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
            const updatedProducts = potentialProducts.filter(p => p.itemId !== message.itemId);
            await chrome.storage.local.set({ potentialProducts: updatedProducts });
            sendResponse({ status: "success" });
        })();
        return true;
    }
    if (message.action === "clearPotentialProducts") {
        (async () => {
            await chrome.storage.local.set({ potentialProducts: [] });
            sendResponse({ status: "success" });
            sendSheetLog('Potansiyel_Ürünler_Temizlendi');
        })();
        return true;
    }
    if (message.action === "addPotentialProduct") {
        (async () => {
            const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
            const isAlreadyAdded = potentialProducts.some(p => p.itemId === message.product.itemId);
            if (!isAlreadyAdded) {
                potentialProducts.unshift(message.product);
                await chrome.storage.local.set({ potentialProducts });
                sendResponse({ status: "success", added: true });
            } else {
                sendResponse({ status: "success", added: false, message: "Already exists." });
            }
        })();
        return true;
    }
    if (message.action === "getPotentialProducts") {
        (async () => {
            const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
            sendResponse({ status: "success", products: potentialProducts });
        })();
        return true;
    }
    if (message.action === 'automationControl') {
        (async () => {
            switch (message.command) {
                case 'start':
                    automationConcurrency = message.concurrency || 1; 
                    if (sender.tab && sender.tab.windowId) {
                        automationWindowId = sender.tab.windowId;
                        await chrome.storage.local.set({ automationWindowId });
                    }
                    if (automationState === 'paused') {
                        automationState = 'running';
                        await chrome.storage.local.set({ automationState });
                        broadcastAutomationState();
                        processNextInQueue();
                    } else {
                        const { savedSellerLinks = [], sellerBlacklist = {} } = await chrome.storage.local.get(['savedSellerLinks', 'sellerBlacklist']);
                        const now = Date.now();
                        const linksToProcess = savedSellerLinks.filter(link => {
                            const expirationDate = sellerBlacklist[link.url];
                            if (expirationDate && expirationDate > now) {
                                return false; 
                            }
                            return true;
                        });
                        if (linksToProcess.length === 0) {
                            sendResponse({ status: 'no_links' });
                            return;
                        }
                        storeQueue = linksToProcess.map(link => ({ url: link.url, status: 'waiting' }));
                        automationState = 'running';
                        activeAutomationTabs = []; 
                        await chrome.storage.local.set({ automationState, storeQueue, activeAutomationTabs });
                        broadcastAutomationState();
                        processNextInQueue();
                    }
                    sendResponse({ status: 'started' });
                    sendSheetLog('Otomasyon_Başlatıldı');
                    break;
                case 'pause':
                    if (automationState === 'running') {
                        automationState = 'paused';
                        await chrome.storage.local.set({ automationState });
                        broadcastAutomationState();
                        sendResponse({ status: 'paused' });
                        sendSheetLog('Otomasyon_Durduruldu');
                    } else {
                        sendResponse({ status: 'not_running' });
                    }
                    break;
                case 'stop':
                    automationState = 'stopped';
                    storeQueue = [];
                    automationWindowId = null;
                    activeAutomationTabs = [];
                    await chrome.storage.local.set({ automationState, storeQueue, automationWindowId, activeAutomationTabs });
                    broadcastAutomationState();
                    sendResponse({ status: 'stopped' });
                    sendSheetLog('Otomasyon_Sonlandırıldı');
                    break;
            }
        })();
        return true;
    }
    if (message.action === "controlAnalysisQueue") {
        (async () => {
            if (message.command === "start") {
                if (sender.tab && sender.tab.windowId) {
                    analysisWindowId = sender.tab.windowId;
                    await chrome.storage.local.set({ analysisWindowId });
                }
                analysisState = 'running';
                await chrome.storage.local.set({ analysisState });
                processQueueLoop();
                sendSheetLog('Analiz_Kuyrugu_Baslatildi');
            } else if (message.command === "stop") {
                analysisState = 'stopped';
                analysisWindowId = null;
                await chrome.storage.local.set({ analysisState, analysisWindowId });
            }
            sendResponse({ status: "ok" });
        })();
        return true;
    }
    if (message.action === "forceProcessItem") {
        (async () => {
            const limit = await getAnalysisConcurrency();
            if (activeAnalysisTabs.length >= limit) {
                sendResponse({ status: "full", message: "Limit full", limit });
                return;
            }
            let { analysisQueue = [] } = await chrome.storage.local.get('analysisQueue');
            const index = message.index;
            if (analysisQueue[index] && analysisQueue[index].status === 'waiting') {
                const item = analysisQueue[index];
                const analysisUrl = await applyScanMode(item.url, 'idg_analysis');
                analysisQueue[index].status = 'active';
                const tab = await chrome.tabs.create({ url: analysisUrl, active: false, windowId: analysisWindowId || undefined });
                activeAnalysisTabs.push({ tabId: tab.id, url: item.url });
                await chrome.storage.local.set({ analysisQueue, activeAnalysisTabs });
                if (analysisState === 'stopped') {
                    analysisState = 'running';
                    await chrome.storage.local.set({ analysisState });
                }
                sendResponse({ status: "success" });
            } else {
                sendResponse({ status: "error", message: "Not found." });
            }
        })();
        return true;
    }
    if (message.action === 'getAutomationState') {
        sendResponse({ state: automationState });
        return true;
    }
    if (message.action === 'addSellerLinks') {
        (async () => {
            const { savedSellerLinks = [] } = await chrome.storage.local.get('savedSellerLinks');
            sendSheetLog('Mağaza_Linkleri_Eklendi', { count: message.count });
            sendResponse({ status: 'success' });
        })();
        return true;
    }
    if (message.action === 'clearSellerLinks') {
        (async () => {
            await chrome.storage.local.set({ savedSellerLinks: [] });
            sendSheetLog('Mağaza_Linkleri_Temizlendi');
            sendResponse({ status: 'success' });
        })();
        return true;
    }
    if (message.asinList) {
        sendResponse({ status: "received" });
        return true;
    }
    if (message.action === "blockStoreForever") {
        (async () => {
            let urlToBlock = message.url;
            const autoTabIndex = activeAutomationTabs.findIndex(t => t.tabId === sender.tab.id);
            if (autoTabIndex !== -1) {
                urlToBlock = activeAutomationTabs[autoTabIndex].url;
            }
            const { sellerBlacklist = {} } = await chrome.storage.local.get('sellerBlacklist');
            const foreverDate = Date.now() + (36135 * 24 * 60 * 60 * 1000); 
            sellerBlacklist[urlToBlock] = foreverDate;
            await chrome.storage.local.set({ sellerBlacklist });
            sendResponse({ status: "success" });
            // LOCAL MODE: Blacklist girişi yalnızca yerelde saklanır, sunucuya gönderilmez.
        })();
        return true;
    }
    // LOCAL MODE: "forceSyncBlacklist" handler'ı kaldırıldı (global sunucu senkronu yok).
});

// Eklenti simgesindeki kırmızı ASIN sayacı rozeti kaldırıldı.
// Önceki oturumdan kalmış bir rozet varsa temizlenir (rozet metni oturum boyunca kalıcıdır).
chrome.action.setBadgeText({ text: '' });

chrome.runtime.onInstalled.addListener(() => {
    cleanUpBlacklist();
    checkAndSendDailyReport();
    chrome.storage.local.set({ activeAnalysisTabs: [], activeAutomationTabs: [], activeFetchAllTabs: [] });
    syncGlobalBlacklist();
});

chrome.runtime.onStartup.addListener(() => {
    checkAndSendDailyReport();
    chrome.storage.local.set({ activeAnalysisTabs: [], activeAutomationTabs: [], activeFetchAllTabs: [] });
    syncGlobalBlacklist();
});

chrome.storage.local.get([
    "extensionCookies", "trackedAsins", "stockAsins", "trackingResults", "stockResults", "priceHistory", "timerState",
    "automationState", "storeQueue", "activeAutomationTabs", "automationWindowId"
], data => {
    if (data.extensionCookies) settings.extensionCookies = JSON.parse(data.extensionCookies);
    if (data.trackedAsins) trackedAsins = data.trackedAsins;
    if (data.stockAsins) stockTrackedAsins = data.stockAsins;
    if (data.trackingResults) trackingResults = data.trackingResults;
    if (data.stockResults) stockResults = data.stockResults;
    if (data.priceHistory) priceHistory = data.priceHistory;
    if (data.timerState) timerState = data.timerState;
    if (data.automationState) automationState = data.automationState;
    if (data.storeQueue) storeQueue = data.storeQueue;
    if (data.activeAutomationTabs) activeAutomationTabs = data.activeAutomationTabs || [];
    if (data.automationWindowId) automationWindowId = data.automationWindowId;
    cleanUpBlacklist();
    if (automationState === 'running' && activeAutomationTabs.length === 0) {
        automationState = 'paused';
        chrome.storage.local.set({ automationState });
    }
    if (trackedAsins.length > 0) trackAsins();
    if (timerState.isRunning) updateTimer();
});

setInterval(updateTimer, 1000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkLicenseOnPopupOpen') {
        // LOCAL MODE: Lisans doğrulaması devre dışı. Her zaman aktif kabul edilir.
        chrome.storage.local.set({ licenseStatus: 'active', licenseMessage: 'Yerel Mod' });
    }
});
