function escapeHTML(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag));
}

document.addEventListener('DOMContentLoaded', async () => {
    // LOCAL MODE: Lisans kontrolü kaldırıldı. AI ürün araştırma sayfası doğrudan açılır.

    const navButtons = [...document.querySelectorAll('.nav-btn')];
    const allSections = [...document.querySelectorAll('.container > section')];
    const workspaceLabels = {
        'section-mixer': ['Liste karıştırıcı', 'ASIN listesini tekilleştir, karıştır ve dışa aktar.'],
        'section-asin-blacklist': ['ASIN kara listesi', 'Amazon toplamasında hariç tutulacak ASIN’leri yönet.'],
        'section-stores': ['Mağaza araştırması', 'Kaynaklarını ekle, tarama kapsamını belirle ve ürün keşfini başlat.'],
        'section-products': ['Keşfedilen ürünler', 'Satış verilerini incele, riskleri değerlendir ve Amazon aramasına geç.'],
        'section-queue': ['Mağaza analiz kuyruğu', 'Bekleyen mağazaları ve analiz ilerlemesini takip et.'],
        'section-blacklist': ['Satıcı kuralları', 'Taramadan çıkarılan mağazaları ve engel sürelerini yönet.'],
        'section-forbidden-cats': ['Kategori kuralları', 'eBay araştırmasında hariç tutulacak ana ve alt kategorileri belirle.'],
        'section-amazon': ['Amazon toplama', 'Kaynağını seç, ürün filtrelerini belirle ve ASIN havuzunu oluştur.'],
        'section-settings': ['Görünüm ayarları', 'Amazon ve eBay sayfalarındaki bilgi ve araçları düzenle.'],
        'section-ai': ['AI ayarları', 'Gemini, DeepSeek ve Claude anahtarlarını, iş başına sağlayıcıyı ve risk kurallarını yönet.']
    };
    function selectWorkspace(button, writeHash = true) {
        if (!button) return;
        const targetId = button.dataset.target;
        navButtons.forEach(b => {
            const selected = b === button;
            b.classList.toggle('active', selected);
            if (selected) b.setAttribute('aria-current', 'page');
            else b.removeAttribute('aria-current');
        });
        allSections.forEach(sec => { sec.style.display = sec.id === targetId ? 'block' : 'none'; });
        const tabName = button.dataset.amazonTab;
        if (tabName) document.querySelector('.tab[data-tab="' + tabName + '"]')?.click();
        const [title, description] = tabName === 'memory'
            ? ['ASIN havuzu', 'Toplanan ASIN’leri düzenle ve dışa aktar.']
            : workspaceLabels[targetId];
        document.getElementById('workspace-title').textContent = title;
        document.getElementById('workspace-description').textContent = description;
        if (writeHash) history.replaceState(null, '', '#' + targetId + (tabName ? '/' + tabName : ''));
    }
    function restoreWorkspace() {
        const [section, tab] = location.hash.slice(1).split('/');
        selectWorkspace(navButtons.find(b => b.dataset.target === section && (!tab || b.dataset.amazonTab === tab)) || navButtons[0], false);
    }
    navButtons.forEach(btn => btn.addEventListener('click', () => selectWorkspace(btn)));
    document.querySelectorAll('[data-workspace]').forEach(button => button.addEventListener('click', () => selectWorkspace(navButtons.find(b => b.dataset.target === button.dataset.workspace))));
    window.addEventListener('hashchange', restoreWorkspace);
    // popup.js installs its inner-tab listeners during DOMContentLoaded as well.
    setTimeout(restoreWorkspace, 0);

    const ITEMS_PER_PAGE = 20;
    let currentPageProducts = 1;
    let currentPageLinks = 1;
    let currentPageBlacklist = 1;
    let currentSearchTerm = "";
    let allProducts = [];
    let isBulkAnalyzing = false;

    const productList = document.getElementById('product-list');
    const clearAllProductsButton = document.getElementById('clear-all-btn');
    const clearFetchedButton = document.getElementById('clear-fetched-btn');
    const resetFetchedButton = document.getElementById('reset-fetched-btn');
    const fetchAllButton = document.getElementById('fetch-all-btn');
    const noProductsMessage = document.getElementById('no-products');
    const sortSelect = document.getElementById('sort-products');
    const addLinkBtn = document.getElementById('add-link-btn');
    const storeLinkInput = document.getElementById('store-link-input');
    const storeLinksList = document.getElementById('store-links-list');
    const clearAllLinksButton = document.getElementById('clear-links-btn');
    const clearVisitedButton = document.getElementById('clear-visited-btn');
    const clearBannedLinksBtn = document.getElementById('clear-banned-links-btn');
    const noLinksMessage = document.getElementById('no-links');
    const startBtn = document.getElementById('start-automation-btn');
    const pauseBtn = document.getElementById('pause-automation-btn');
    const stopBtn = document.getElementById('stop-automation-btn');
    const concurrencyRadios = document.querySelectorAll('input[name="auto_concurrency"]');
    const blacklistList = document.getElementById('blacklist-list');
    const noBlacklistMessage = document.getElementById('no-blacklist-items');
    const permanentBanCounter = document.getElementById('permanent-ban-counter');
    const clearBlacklistBtn = document.getElementById('clear-blacklist-btn');
    const addBlacklistBtn = document.getElementById('add-blacklist-btn');
    const blacklistInput = document.getElementById('blacklist-input');
    const analyzeRiskBtn = document.getElementById('analyze-risk-btn');
    const manageKeysBtn = document.getElementById('manage-keys-btn');
    const keyCountLabel = document.getElementById('key-count-label');
    const progressWrapper = document.getElementById('progress-wrapper');
    const progressBar = document.getElementById('progress-bar');
    const analysisQueueList = document.getElementById('analysis-queue-list');
    const startQueueBtn = document.getElementById('start-queue-btn');
    const stopQueueBtn = document.getElementById('stop-queue-btn');
    const clearQueueBtn = document.getElementById('clear-queue-btn');
    const clearCompletedQueueBtn = document.getElementById('clear-completed-queue-btn');
    const queueStatusLabel = document.getElementById('queue-status');
    const autoQueueCheckbox = document.getElementById('auto-queue-checkbox');

    chrome.storage.local.get(['autoAddToQueue'], (data) => {
        if (autoQueueCheckbox) {
            autoQueueCheckbox.checked = !!data.autoAddToQueue;
        }
    });
    if (autoQueueCheckbox) {
        autoQueueCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ autoAddToQueue: e.target.checked });
        });
    }

    const style = document.createElement('style');
    style.innerHTML = `
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 10000; display: flex; justify-content: center; align-items: center; }
        .modal-content { background: #1e1e1e; color: #e0e0e0; width: 90%; max-width: 800px; max-height: 85vh; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.7); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #333; }
        .modal-header { padding: 15px; background: #c0392b; color: white; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #a93226; }
        .modal-body { padding: 15px; overflow-y: auto; background: #181818; }
        .modal-footer { padding: 15px; border-top: 1px solid #333; background: #1e1e1e; display: flex; justify-content: flex-end; gap: 10px; }
        .key-manager-content { max-width: 500px; }
        .key-manager-header { background: #34495e; }
        .key-textarea { width: 100%; height: 200px; padding: 10px; border: 1px solid #444; border-radius: 5px; font-family: monospace; font-size: 12px; resize: vertical; box-sizing: border-box; background-color: #2c2c2c; color: #e0e0e0; }
        .risk-item-row { display: flex; align-items: center; background: #2c2c2c; border: 1px solid #444; margin-bottom: 8px; padding: 8px; border-radius: 5px; gap: 10px; }
        .risk-item-img { width: 50px; height: 50px; object-fit: contain; border:1px solid #444; background: #fff; }
        .risk-item-info { flex: 1; }
        .risk-score-badge { background: #4a1b1b; color: #ffcccc; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-right: 5px; }
        .risk-checkbox { transform: scale(1.5); cursor: pointer; accent-color: #c0392b; }
        .analyze-single-btn { position: absolute; top: 40px; right: 5px; width: 45px; height: 24px; background-color: #8e44ad; color: white; border: none; border-radius: 12px; cursor: pointer; font-size: 10px; line-height: 24px; text-align: center; opacity: 0.9; transition: opacity 0.2s, background-color 0.2s; z-index: 10; font-weight: bold; }
        .analyze-single-btn:hover { opacity: 1; background-color: #9b59b6; }
        .analyze-single-btn:disabled { background-color: #4a4a4a; cursor: not-allowed; }
        .remove-from-report-btn { background: transparent; border: 1px solid #666; color: #bbb; cursor: pointer; font-size: 11px; padding: 3px 6px; border-radius: 3px; margin-left: 10px; }
        .remove-from-report-btn:hover { background-color: #333; color: #fff; }
        .lens-btn { position: absolute; top: 70px; right: 5px; width: 24px; height: 24px; background: #2c2c2c; border: 1px solid #555; border-radius: 50%; cursor: pointer; z-index: 10; font-size: 12px; display: flex; align-items: center; justify-content: center; opacity: 0.8; color: #fff; }
        .lens-btn:hover { opacity: 1; background: #444; }
        #live-search { padding: 8px; border: 1px solid #444; border-radius: 5px; margin-right: 10px; background-color: #2c2c2c; color: #e0e0e0; outline: none; width: 140px; }
    `;
    document.head.appendChild(style);

    const headerMiddleControls = document.getElementById('header-middle-controls');
    if (headerMiddleControls) {
        const showRiskyBtn = document.createElement('button');
        showRiskyBtn.id = 'show-risky-btn';
        showRiskyBtn.className = 'action-btn';
        showRiskyBtn.style.backgroundColor = '#c0392b';
        showRiskyBtn.style.color = 'white';
        showRiskyBtn.innerHTML = '⚠️ Riskli Gözat';
        headerMiddleControls.insertBefore(showRiskyBtn, sortSelect);

        const searchInput = document.createElement('input');
        searchInput.id = 'live-search';
        searchInput.type = 'text';
        searchInput.placeholder = 'Arama...';
        headerMiddleControls.insertBefore(searchInput, sortSelect);

        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.toLowerCase();
            currentPageProducts = 1;
            renderProducts();
        });

        showRiskyBtn.addEventListener('click', () => {
            const riskyProducts = allProducts.filter(p => p.riskScore !== undefined && p.riskScore >= 5);
            if (riskyProducts.length === 0) {
                alert("Şu an listede analiz edilmiş riskli (Puan >= 5) ürün yok.");
                return;
            }
            const modalData = riskyProducts.map(p => ({
                id: p.itemId,
                title: p.title,
                img: p.imageUrl,
                score: p.riskScore,
                reason: p.riskReason || "Belirtilmemiş"
            }));
            showRiskReviewModal(modalData);
        });
    }

    function setupPaginationControls(totalItems, currentPage, containerId, onPageChange) {
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (totalPages <= 1) {
            container.classList.add('hidden');
            return;
        }
        container.classList.remove('hidden');
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Önceki';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => onPageChange(currentPage - 1);
        const info = document.createElement('span');
        info.className = 'pagination-info';
        info.textContent = ` Sayfa ${currentPage} / ${totalPages} `;
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Sonraki ▶';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => onPageChange(currentPage + 1);
        container.appendChild(prevBtn);
        container.appendChild(info);
        container.appendChild(nextBtn);
    }

    chrome.storage.local.get(['autoConcurrency'], (data) => {
        if (data.autoConcurrency) {
            const radio = document.querySelector(`input[name="auto_concurrency"][value="${data.autoConcurrency}"]`);
            if (radio) radio.checked = true;
        }
    });

    concurrencyRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            chrome.storage.local.set({ autoConcurrency: e.target.value });
        });
    });

    // Tarama modu: 'live' (canlı listelemeler, geniş kapsam - varsayılan) veya
    // 'sold' (yalnızca satılmış ürünler, talep doğrulama). background.js sekme açarken uygular.
    chrome.storage.local.get(['scanMode'], (data) => {
        const mode = data.scanMode || 'live';
        const radio = document.querySelector(`input[name="scan_mode"][value="${mode}"]`);
        if (radio) radio.checked = true;
    });

    document.querySelectorAll('input[name="scan_mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            chrome.storage.local.set({ scanMode: e.target.value });
        });
    });

    // Yakalama hassasiyeti: 'wide' (en çok ürün) / 'normal' (varsayılan) / 'strict' (sadece hot).
    // content_ebay.js ürün kaydetme eşiği için okur (catchSensitivity).
    chrome.storage.local.get(['catchSensitivity'], (data) => {
        const s = data.catchSensitivity || 'normal';
        const radio = document.querySelector(`input[name="catch_sensitivity"][value="${s}"]`);
        if (radio) radio.checked = true;
    });

    document.querySelectorAll('input[name="catch_sensitivity"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            chrome.storage.local.set({ catchSensitivity: e.target.value });
        });
    });

    function updateButtonStates(state) {
        if (state === 'running') {
            startBtn.textContent = 'Taramayı başlat';
            startBtn.disabled = true;
            pauseBtn.textContent = 'Duraklat';
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
        } else if (state === 'paused') {
            startBtn.textContent = 'Devam et';
            startBtn.disabled = false;
            pauseBtn.textContent = 'Duraklat';
            pauseBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            startBtn.textContent = 'Taramayı başlat';
            startBtn.disabled = false;
            pauseBtn.textContent = 'Duraklat';
            pauseBtn.disabled = true;
            stopBtn.disabled = true;
        }
    }

    startBtn.addEventListener('click', () => {
        const concurrencyInput = document.querySelector('input[name="auto_concurrency"]:checked');
        const concurrencyValue = concurrencyInput ? parseInt(concurrencyInput.value) : 1;
        chrome.runtime.sendMessage({ action: 'automationControl', command: 'start', concurrency: concurrencyValue });
    });
    pauseBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'automationControl', command: 'pause' });
    });
    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'automationControl', command: 'stop' });
    });

    function parsePrice(priceStr) {
        if (!priceStr || priceStr === 'N/A') return 0;
        return parseFloat(priceStr.replace(/[^0-9.]/g, ''));
    }

    function sortProducts(products, criteria) {
        const sorted = [...products];
        switch (criteria) {
            case 'newest': return sorted.reverse();
            case 'oldest': return sorted;
            case 'customers_high': return sorted.sort((a, b) => (b.customerCount || 0) - (a.customerCount || 0));
            case 'customers_low': return sorted.sort((a, b) => (a.customerCount || 0) - (b.customerCount || 0));
            case 'price_high': return sorted.sort((a, b) => parsePrice(b.ebayPrice) - parsePrice(a.ebayPrice));
            case 'price_low': return sorted.sort((a, b) => parsePrice(a.ebayPrice) - parsePrice(b.ebayPrice));
            case 'unanalyzed': return sorted.reverse();
            default: return sorted.reverse();
        }
    }

    function renderProducts(products) {
        if (products) {
            allProducts = products;
        }

        const badgeProducts = document.getElementById('badge-products');
        if (badgeProducts) badgeProducts.textContent = allProducts.length;

        productList.innerHTML = '';
        let filteredProducts = allProducts;
        const currentSort = sortSelect.value;
        if (currentSort === 'unanalyzed') {
            filteredProducts = filteredProducts.filter(p => p.riskScore === undefined);
        }
        if (currentSearchTerm) {
            filteredProducts = filteredProducts.filter(p => p.title.toLowerCase().includes(currentSearchTerm));
        }

        if (filteredProducts && filteredProducts.length > 0) {
            noProductsMessage.classList.add('hidden');
            const sortedProducts = sortProducts(filteredProducts, currentSort);
            updateFetchAllButton();
            const startIndex = (currentPageProducts - 1) * ITEMS_PER_PAGE;
            const paginatedProducts = sortedProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);
            const fragment = document.createDocumentFragment();
            paginatedProducts.forEach(product => {
                const card = document.createElement('div');
                card.className = 'product-card';
                card.dataset.itemId = product.itemId;
                const safeTitle = escapeHTML(product.title);
                const safeSellerName = escapeHTML(product.sellerName || 'N/A');
                const safeImageUrl = encodeURI(product.imageUrl);
                let riskAnalysisHtml = '';
                let aiBtnText = 'AI';
                let aiBtnStyle = '';
                if (product.riskScore !== undefined) {
                    let bgColor = product.riskScore >= 5 ? "#450a0a" : "#064e3b";
                    let textColor = product.riskScore >= 5 ? "#fca5a5" : "#86efac";
                    let riskText = product.riskScore >= 5 ? "⛔ RİSKLİ" : "DÜŞÜK RİSK TAHMİNİ";
                    const riskSource = { rule: 'Kural', deepseek: 'DeepSeek', gemini: 'Gemini', claude: 'Claude' }[product.riskSource] || '';
                    const riskDetail = [product.riskReason ? escapeHTML(product.riskReason) : '', riskSource].filter(Boolean).join(' · ');
                    riskAnalysisHtml = `<div class="risk-analysis-result" style="display:block; padding: 8px 15px; border-top: 1px solid #333; font-size: 12px; background-color:${bgColor}; color:${textColor}; font-weight: bold;">Puan: ${product.riskScore}/10 - ${riskText}${riskDetail ? `<br><span style="font-weight:normal;">${riskDetail}</span>` : ''}</div>`;
                    aiBtnText = 'Tekrar';
                    aiBtnStyle = 'background-color: #34495e;';
                } else {
                    riskAnalysisHtml = `<div class="risk-analysis-result" style="display:none; padding: 8px 15px; border-top: 1px solid #333; font-size: 12px;"></div>`;
                }
                if (product.fetchSkipReason) {
                    riskAnalysisHtml += `<div class="ai-card-status bad">Amazon'dan çekilmedi: ${escapeHTML(product.fetchSkipReason)}</div>`;
                } else if (product.aiMatch === 'verified') {
                    riskAnalysisHtml += `<div class="ai-card-status good">AI eşleşmeyi doğruladı (${Number(product.aiMatchCount) || 0} ASIN)</div>`;
                } else if (product.aiMatch === 'no_match') {
                    riskAnalysisHtml += `<div class="ai-card-status bad">AI aynı ürünü bulamadı — ASIN kaydedilmedi</div>`;
                } else if (product.aiMatch === 'unverified') {
                    riskAnalysisHtml += `<div class="ai-card-status">AI doğrulanamadı, filtre sonucu kaydedildi${product.aiMatchReason ? ': ' + escapeHTML(product.aiMatchReason) : ''}</div>`;
                }
                card.innerHTML = `
                    <button class="remove-product-btn" title="Bu ürünü sil">&times;</button>
                    <button class="analyze-single-btn" title="AI Analiz" style="${aiBtnStyle}">${aiBtnText}</button>
                    <button class="lens-btn" title="Google Lens ile Kaynak Ara">📷</button>
                    <div class="product-image-container">
                        <img src="${safeImageUrl}" alt="${safeTitle}" class="product-image">
                    </div>
                    <div class="product-info">
                        <p class="product-title" title="${safeTitle}">${safeTitle}</p>
                    </div>
                    <div class="product-details">
                        <div class="product-meta">
                            <span class="product-customers"><span class="label">Müşteri:</span> C${product.customerCount || '?'}</span>
                            <span class="product-seller"><span class="label">Satıcı:</span> ${safeSellerName}</span>
                        </div>
                        <span class="product-price">${product.ebayPrice || 'N/A'}</span>
                    </div>
                    ${riskAnalysisHtml}
                    <div class="product-info" style="padding-top: 0;">
                         <button class="fetch-btn" data-url="${product.amazonSearchUrl}">Amazon'dan Çek</button>
                    </div>
                `;
                const fetchBtn = card.querySelector('.fetch-btn');
                if (product.fetched) {
                    fetchBtn.textContent = 'İşlendi';
                    fetchBtn.title = 'Amazon araması işlendi; bu işaret ASIN bulunduğunu garanti etmez.';
                    fetchBtn.disabled = true;
                }
                fragment.appendChild(card);
            });
            productList.appendChild(fragment);
            setupPaginationControls(sortedProducts.length, currentPageProducts, 'products-pagination', (newPage) => {
                currentPageProducts = newPage;
                renderProducts();
            });
        } else {
            noProductsMessage.classList.remove('hidden');
            fetchAllButton.disabled = true;
            document.getElementById('products-pagination').classList.add('hidden');
        }
    }

    sortSelect.addEventListener('change', () => {
        currentPageProducts = 1;
        renderProducts();
    });

    productList.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.classList.contains('fetch-btn') && !target.disabled) {
            const card = target.closest('.product-card');
            const url = target.dataset.url + '&indygrab_auto_collect=true';
            const itemId = card.dataset.itemId;
            target.textContent = 'Çekiliyor...';
            target.disabled = true;
            chrome.runtime.sendMessage({ action: "openTabInBackground", url: url, itemId: itemId }, response => {
                // The reason is shown in the AI alert banner; the product can be retried.
                if (response && response.status === 'aiHalted') {
                    target.textContent = "Amazon'dan Çek";
                    target.disabled = false;
                }
            });
        }
        if (target.closest('.lens-btn')) {
            const card = target.closest('.product-card');
            const product = allProducts.find(p => p.itemId === card.dataset.itemId);
            if (product && product.imageUrl) {
                const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(product.imageUrl)}`;
                chrome.tabs.create({ url: lensUrl, active: false });
            }
        }
        if (target.classList.contains('remove-product-btn')) {
            const card = target.closest('.product-card');
            const itemId = card.dataset.itemId;
            const productTitle = card.querySelector('.product-title').textContent;
            if (confirm(`"${productTitle}" ürününü listeden kalıcı olarak silmek istediğinize emin misiniz?`)) {
                 chrome.runtime.sendMessage({ action: "removePotentialProduct", itemId: itemId });
            }
        }
        if (target.closest('.analyze-single-btn')) {
            const btn = target.closest('.analyze-single-btn');
            const card = target.closest('.product-card');
            const product = allProducts.find(p => p.itemId === card.dataset.itemId);
            if (!product) return;
            if (product.riskScore !== undefined) {
                if (!confirm(`Bu ürün zaten analiz edildi (Puan: ${product.riskScore}). Tekrar analiz etmek istiyor musunuz?`)) {
                    return;
                }
            }
            if (!(await hasAnyAiKey())) {
                return alert("API anahtarı yok. AI ayarları sayfasından Gemini, DeepSeek veya Claude anahtarı ekleyin.");
            }
            btn.disabled = true;
            btn.textContent = '...';

            const skeleton = document.createElement('div');
            skeleton.className = 'skeleton-overlay';
            skeleton.innerHTML = '🤖 AI İnceliyor...<br><span style="font-size:11px; color:#ddd; margin-top:5px; font-weight:normal;" class="skeleton-text">Lütfen bekleyin</span>';
            card.appendChild(skeleton);

            let retryCount = 0;
            const maxRetries = 2;
            let result = { error: true };
            let success = false;
            while (!success && retryCount <= maxRetries) {
                if (retryCount > 0) {
                    const skelText = skeleton.querySelector('.skeleton-text');
                    if(skelText) skelText.innerHTML = `⚠️ Takıldı, Tekrar... (${retryCount})`;
                    await new Promise(r => setTimeout(r, 1500));
                }
                result = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                        action: "analyzeProductRisk",
                        itemId: product.itemId,
                        imageUrl: product.imageUrl,
                        title: product.title,
                        price: product.ebayPrice || "0",
                        seller: product.sellerName || "Unknown"
                    }, resolve);
                });
                if (!result.error) success = true;
                else retryCount++;
            }

            skeleton.remove();

            const resDiv = card.querySelector('.risk-analysis-result');
            resDiv.style.display = 'block';

            if (result.error) {
                resDiv.style.backgroundColor = "#450a0a";
                resDiv.style.color = "#fca5a5";
                resDiv.innerHTML = "Hata: " + (result.reason || "Bilinmiyor");
                btn.disabled = false;
                btn.textContent = "AI";
            } else {
                const score = result.riskScore;
                isBulkAnalyzing = true;
                const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
                const pIndex = potentialProducts.findIndex(p => p.itemId === product.itemId);
                if (pIndex !== -1) {
                    potentialProducts[pIndex].riskScore = score;
                    potentialProducts[pIndex].riskReason = result.reason;
                    await chrome.storage.local.set({ potentialProducts });
                }
                isBulkAnalyzing = false;
                product.riskScore = score;
                product.riskReason = result.reason;
                let riskText = score >= 5 ? "⛔ RİSKLİ" : "DÜŞÜK RİSK TAHMİNİ";
                resDiv.innerHTML = `Puan: ${score}/10 - ${riskText}`;
                resDiv.style.fontWeight = "bold";
                btn.disabled = false;
                btn.textContent = "Tekrar";
                btn.style.backgroundColor = "#34495e";
                if (score >= 5) {
                    resDiv.style.backgroundColor = "#450a0a";
                    resDiv.style.color = "#fca5a5";
                } else {
                    resDiv.style.backgroundColor = "#064e3b";
                    resDiv.style.color = "#86efac";
                }
            }
        }
    });

    function updateFetchAllButton() {
        chrome.runtime.sendMessage({ action: "getFetchAllQueueStatus" }, (status) => {
            if (!status) return;
            if (status.state === 'running') {
                fetchAllButton.disabled = true;
                fetchAllButton.textContent = `Çekiliyor... (${status.remaining} kaldı, ${status.active} aktif)`;
            } else {
                fetchAllButton.textContent = 'Çekilmemişleri Amazon’da ara';
                fetchAllButton.disabled = allProducts.every(p => p.fetched);
            }
        });
    }

    fetchAllButton.addEventListener('click', () => {
        if (!confirm("Listede bulunan ve henüz çekilmemiş tüm ürünler için Amazon'dan çekim işlemi başlatılacaktır.\n\nAmazon bot korumasına takılmamak için aynı anda en fazla 3 sekme açılır ve aralarında bekleme uygulanır; bu yüzden işlem yavaş ilerler. Koruma tespit edilirse çekim 2 dakika duraklar ve o ürünler yakılmadan tekrar denenir.\n\nOnaylıyor musunuz?")) return;
        fetchAllButton.disabled = true;
        fetchAllButton.textContent = 'Çekiliyor...';
        chrome.runtime.sendMessage({ action: "startFetchAllQueue" }, (response) => {
            if (!response || response.status === 'empty') {
                fetchAllButton.textContent = 'Çekilmemişleri Amazon’da ara';
                fetchAllButton.disabled = allProducts.every(p => p.fetched);
                return;
            }
            updateFetchAllButton();
        });
    });

    clearFetchedButton.addEventListener('click', async () => {
        const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
        const fetchedCount = potentialProducts.filter(p => p.fetched).length;
        if (fetchedCount === 0) {
            return alert("Silinecek 'Çekildi' durumunda ürün bulunmuyor.");
        }
        if (confirm(`Listeden ${fetchedCount} adet 'Çekildi' durumundaki ürün silinecek. Emin misiniz?`)) {
            const remaining = potentialProducts.filter(p => !p.fetched);
            await chrome.storage.local.set({ potentialProducts: remaining });
        }
    });

    // Ürünleri SİLMEDEN 'Çekildi' işaretini kaldırır; hepsi yeniden çekilebilir hale gelir.
    // (Bozuk maxPrice filtresiyle boşa harcanan çekimleri tekrar denemek için gerekli.)
    if (resetFetchedButton) {
        resetFetchedButton.addEventListener('click', async () => {
            const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
            const fetchedCount = potentialProducts.filter(p => p.fetched).length;
            if (fetchedCount === 0) {
                return alert("'Çekildi' işaretli ürün bulunmuyor.");
            }
            if (!confirm(`${fetchedCount} üründeki 'Çekildi' işareti kaldırılacak.\n\nÜrünler listede KALIR, sadece yeniden çekilebilir hale gelir. Onaylıyor musunuz?`)) return;
            potentialProducts.forEach(p => { delete p.fetched; });
            await chrome.storage.local.set({ potentialProducts });
            updateFetchAllButton();
        });
    }

    clearAllProductsButton.addEventListener('click', () => {
        if (confirm('Emin misiniz? Tüm potansiyel ürünler kalıcı olarak silinecektir.')) {
            chrome.runtime.sendMessage({ action: "clearPotentialProducts" });
        }
    });

    function getStoreNameFromUrl(urlString) {
        try {
            const url = new URL(urlString);
            const params = new URLSearchParams(url.search);
            const storeName = params.get('_ssn');
            if (storeName) return storeName;
            return url.hostname;
        } catch (e) {
            return "Geçersiz Link";
        }
    }

    function loadSellerLinks() {
        chrome.storage.local.get(['savedSellerLinks', 'sellerBlacklist'], (data) => {
            renderSellerLinks(data.savedSellerLinks || [], data.sellerBlacklist || {});
        });
    }

    function renderSellerLinks(links, blacklist) {
        const badgeStores = document.getElementById('badge-stores');
        if (badgeStores) badgeStores.textContent = links ? links.length : 0;

        storeLinksList.innerHTML = '';
        const linkCount = links ? links.length : 0;
        const visitedCount = links ? links.filter(l => l.visited).length : 0;
        if (clearVisitedButton) {
            clearVisitedButton.textContent = `Tarananları Sil (${visitedCount})`;
            clearVisitedButton.disabled = visitedCount === 0;
        }
        const now = Date.now();
        const permanentBannedStores = new Set();
        Object.entries(blacklist).forEach(([bUrl, exp]) => {
            const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
            if (days > 10000) {
                permanentBannedStores.add(getStoreNameFromUrl(bUrl));
            }
        });
        if (linkCount > 0) {
            noLinksMessage.classList.add('hidden');
            const startIndex = (currentPageLinks - 1) * ITEMS_PER_PAGE;
            const paginatedLinks = links.slice(startIndex, startIndex + ITEMS_PER_PAGE);
            const fragment = document.createDocumentFragment();
            paginatedLinks.forEach(link => {
                const li = document.createElement('li');
                li.className = 'store-link-item';
                if (link.visited) li.classList.add('visited');
                const storeName = getStoreNameFromUrl(link.url);
                const isBanned = permanentBannedStores.has(storeName);
                li.innerHTML = `
                    <div style="display:flex; align-items:center; gap:5px; flex-grow:1;">
                        <button class="add-to-queue-btn" data-url="${link.url}" title="Analiz Kuyruğuna Ekle" style="background:none; border:none; cursor:pointer; font-size:16px; color:#2ecc71;">➕</button>
                        <a href="${link.url}" title="${link.url}" target="_blank"><span class="store-name">${storeName}</span></a>
                        ${isBanned ? '<span style="background-color:#c0392b; color:white; padding:2px 5px; border-radius:3px; font-size:10px; margin-left:5px; font-weight:bold;">⛔ YASAKLI</span>' : ''}
                    </div>
                    <div class="controls">
                        <span class="visited-icon">✔</span>
                        <button class="delete-link-btn" data-url="${link.url}">Sil</button>
                    </div>`;
                fragment.appendChild(li);
            });
            storeLinksList.appendChild(fragment);
            setupPaginationControls(links.length, currentPageLinks, 'links-pagination', (newPage) => {
                currentPageLinks = newPage;
                renderSellerLinks(links, blacklist);
            });
        } else {
            noLinksMessage.classList.remove('hidden');
            document.getElementById('links-pagination').classList.add('hidden');
        }
    }

    // Yapıştırılan herhangi bir girdiyi (düz mağaza adı, /str/ linki, /usr/ linki,
    // veya /sch/?_ssn= linki) taranabilir bir eBay satıcı arama URL'sine çevirir.
    // eBay mağaza vitrini slug'ı (ör. "endlesstreasuresus") çoğu zaman gerçek satıcı
    // kullanıcı adından (ör. "open4rush") farklı olduğu için, gerekirse mağaza sayfasını
    // çekip gerçek _ssn'i HTML'den çıkarır.
    async function resolveToSearchUrl(rawInput) {
        const input = rawInput.trim();
        if (!input) return null;

        // Zaten geçerli bir /sch/ + _ssn linkiyse temizleyip normalize et.
        // NOT: LH_Sold/LH_Complete burada zorlanmaz; Canlı/Satılmış tarama modu
        // otomasyon sekmeyi açarken (background.js) uygulanır. Böylece kayıtlı
        // linkler her iki modda da yeniden eklenmeden kullanılabilir.
        if (/ebay\.[^\/]+\/sch\//i.test(input) && /[?&]_ssn=/i.test(input)) {
            try {
                const url = new URL(input.startsWith('http') ? input : 'https://' + input);
                url.searchParams.set('_ipg', '240');
                url.searchParams.delete('LH_Sold');
                url.searchParams.delete('LH_Complete');
                url.searchParams.delete('_pgn');
                url.searchParams.delete('idg_auto');
                return url.toString();
            } catch (e) {
                return null;
            }
        }

        let username = null;

        // Doğrudan _ssn= veya /usr/ADI içeriyorsa fetch'e gerek yok
        let m = input.match(/[?&]_ssn=([^&\s]+)/i);
        if (m) username = decodeURIComponent(m[1]);
        if (!username) { m = input.match(/\/usr\/([^\/?&#\s]+)/i); if (m) username = decodeURIComponent(m[1]); }

        // Değilse: /str/ slug veya düz ad → mağaza sayfasını çekip gerçek _ssn'i bul
        if (!username) {
            let storeUrl = null;
            m = input.match(/\/str\/([^\/?&#\s]+)/i);
            if (m) storeUrl = 'https://www.ebay.com/str/' + m[1];
            else if (/^[a-zA-Z0-9_.\-]+$/.test(input)) storeUrl = 'https://www.ebay.com/str/' + input;
            else if (/ebay\./i.test(input)) storeUrl = input.startsWith('http') ? input : 'https://' + input;

            if (storeUrl) {
                try {
                    const res = await fetch(storeUrl, { credentials: 'include' });
                    if (res.ok) {
                        const html = await res.text();
                        const all = [...html.matchAll(/_ssn=([a-zA-Z0-9_.\-]+)/g)].map(x => x[1]);
                        if (all.length) {
                            const counts = {};
                            all.forEach(u => counts[u] = (counts[u] || 0) + 1);
                            username = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
                        }
                    }
                } catch (e) {}
            }
        }

        if (!username) return null;
        // _ipg=240: sayfa başına max ürün → daha az sayfa geçişi (daha hızlı tam tarama).
        // Canlı/Satılmış filtresi ziyaret anında (background.js) tarama moduna göre eklenir.
        return 'https://www.ebay.com/sch/i.html?_ssn=' + encodeURIComponent(username) + '&_ipg=240';
    }

    addLinkBtn.addEventListener('click', async () => {
        const inputText = storeLinkInput.value.trim();
        if (!inputText) return;
        const rawInputs = inputText.split('\n').map(s => s.trim()).filter(s => s);
        if (rawInputs.length === 0) return;

        const origLabel = addLinkBtn.textContent;
        addLinkBtn.disabled = true;
        addLinkBtn.textContent = 'Çözümleniyor...';

        let resolved;
        try {
            resolved = await Promise.all(rawInputs.map(resolveToSearchUrl));
        } catch (e) {
            resolved = [];
        }

        chrome.storage.local.get('savedSellerLinks', (data) => {
            const existingLinks = data.savedSellerLinks || [];
            const existingUrls = new Set(existingLinks.map(link => link.url));
            let newLinksAddedCount = 0;
            const failed = [];
            resolved.forEach((url, i) => {
                if (!url) { failed.push(rawInputs[i]); return; }
                if (!existingUrls.has(url)) {
                    existingLinks.unshift({ url: url, visited: false });
                    existingUrls.add(url);
                    newLinksAddedCount++;
                }
            });

            const finish = () => {
                addLinkBtn.disabled = false;
                addLinkBtn.textContent = origLabel;
            };

            if (newLinksAddedCount > 0) {
                chrome.storage.local.set({ savedSellerLinks: existingLinks }, () => {
                    storeLinkInput.value = '';
                    currentPageLinks = 1;
                    if (typeof loadSellerLinks === 'function') loadSellerLinks();
                    finish();
                    if (failed.length) alert('Bazı girdiler çözümlenemedi (mağaza bulunamadı veya kaldırılmış):\n' + failed.join('\n'));
                });
            } else {
                finish();
                if (failed.length) alert('Çözümlenemedi (mağaza bulunamadı veya kaldırılmış):\n' + failed.join('\n'));
                else alert('Girdiğiniz linklerin tamamı zaten listede mevcut.');
            }
        });
    });

    storeLinksList.addEventListener('click', (event) => {
        const target = event.target;
        const linkElement = target.closest('a');
        const deleteButton = target.closest('.delete-link-btn');
        if (linkElement) {
            event.preventDefault();
            const originalUrl = linkElement.href;
            const urlToVisit = originalUrl + (originalUrl.includes('?') ? '&' : '?') + 'idg_auto=true';
            chrome.tabs.create({ url: urlToVisit, active: true });
            chrome.storage.local.get('savedSellerLinks', (data) => {
                const links = data.savedSellerLinks || [];
                const linkIndex = links.findIndex(l => l.url === originalUrl);
                if (linkIndex !== -1) {
                    links[linkIndex].visited = true;
                    chrome.storage.local.set({ savedSellerLinks: links });
                }
            });
        }
        if (deleteButton) {
            const urlToDelete = deleteButton.dataset.url;
            chrome.storage.local.get('savedSellerLinks', (data) => {
                let links = data.savedSellerLinks || [];
                links = links.filter(l => l.url !== urlToDelete);
                if (links.length <= (currentPageLinks - 1) * ITEMS_PER_PAGE && currentPageLinks > 1) {
                    currentPageLinks--;
                }
                chrome.storage.local.set({ savedSellerLinks: links });
            });
        }
    });

    clearVisitedButton.addEventListener('click', () => {
        chrome.storage.local.get('savedSellerLinks', (data) => {
            const links = data.savedSellerLinks || [];
            const unvisitedLinks = links.filter(l => !l.visited);
            const countToRemove = links.length - unvisitedLinks.length;
            if (countToRemove > 0) {
                if (confirm(`${countToRemove} adet taranmış mağaza linki silinecek. Emin misiniz?`)) {
                    currentPageLinks = 1;
                    chrome.storage.local.set({ savedSellerLinks: unvisitedLinks });
                }
            }
        });
    });

    clearBannedLinksBtn.addEventListener('click', () => {
        chrome.storage.local.get(['savedSellerLinks', 'sellerBlacklist'], (data) => {
            const links = data.savedSellerLinks || [];
            const blacklist = data.sellerBlacklist || {};
            const now = Date.now();
            const permanentBannedStores = new Set();
            Object.entries(blacklist).forEach(([bUrl, exp]) => {
                const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                if (days > 10000) {
                    permanentBannedStores.add(getStoreNameFromUrl(bUrl));
                }
            });
            const filteredLinks = links.filter(link => !permanentBannedStores.has(getStoreNameFromUrl(link.url)));
            const removedCount = links.length - filteredLinks.length;
            if (removedCount > 0) {
                if (confirm(`Listeden ${removedCount} adet süresiz yasaklı mağaza linki silinecek. Emin misiniz?`)) {
                    currentPageLinks = 1;
                    chrome.storage.local.set({ savedSellerLinks: filteredLinks });
                }
            } else {
                alert("Listede süresiz yasaklı mağaza bulunamadı.");
            }
        });
    });

    clearAllLinksButton.addEventListener('click', () => {
        if (confirm('Emin misiniz? Tüm kayıtlı mağaza linkleri kalıcı olarak silinecektir.')) {
            currentPageLinks = 1;
            chrome.storage.local.set({ savedSellerLinks: [] });
        }
    });

    function loadBlacklist() {
        chrome.storage.local.get('sellerBlacklist', (data) => {
            const blacklist = data.sellerBlacklist || {};
            const now = Date.now();
            let updatedBlacklist = {};
            let hasChanges = false;
            Object.entries(blacklist).forEach(([url, timestamp]) => {
                if (timestamp > now) {
                    updatedBlacklist[url] = timestamp;
                } else {
                    hasChanges = true;
                }
            });
            if (hasChanges || Object.keys(blacklist).length !== Object.keys(updatedBlacklist).length) {
                chrome.storage.local.set({ sellerBlacklist: updatedBlacklist });
            }
            renderBlacklist(updatedBlacklist);
        });
    }

    function renderBlacklist(blacklist) {
        blacklistList.innerHTML = '';
        const now = Date.now();
        const validEntries = [];
        const renderedStores = new Set();
        let permanentCount = 0;
        Object.entries(blacklist).forEach(([url, expirationTime]) => {
            if (expirationTime <= now) return;
            const storeName = getStoreNameFromUrl(url);
            if (renderedStores.has(storeName)) return;
            renderedStores.add(storeName);
            const timeRemaining = expirationTime - now;
            const daysRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60 * 24));
            const isPermanent = daysRemaining > 10000;
            if (isPermanent) permanentCount++;
            validEntries.push({ url, expirationTime, storeName, isPermanent, daysRemaining });
        });

        const badgeBlacklist = document.getElementById('badge-blacklist');
        if (badgeBlacklist) badgeBlacklist.textContent = validEntries.length;

        if(permanentBanCounter) permanentBanCounter.textContent = `Kalıcı: ${permanentCount}`;

        if (validEntries.length > 0) {
            noBlacklistMessage.classList.add('hidden');
            const startIndex = (currentPageBlacklist - 1) * ITEMS_PER_PAGE;
            const paginatedBlacklist = validEntries.slice(startIndex, startIndex + ITEMS_PER_PAGE);
            const fragment = document.createDocumentFragment();
            paginatedBlacklist.forEach(item => {
                const li = document.createElement('li');
                li.className = 'blacklist-item';
                let daysDisplayHtml = item.isPermanent ?
                    `<div style="background-color:#c0392b; color:white; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;">⛔ YASAKLI KATEGORİ</div>` :
                    `<input type="number" class="blacklist-days-input" data-url="${item.url}" value="${item.daysRemaining}" min="1" style="width:50px; padding:3px; border:1px solid #444; background:#2c2c2c; color:#fff; border-radius:4px; text-align:center;"><span style="font-size:12px; color:#999;">gün</span>`;
                li.innerHTML = `
                    <div class="store-info" style="display:flex; align-items:center; gap:5px;">
                        <button class="add-to-queue-btn" data-url="${item.url}" title="Analiz Kuyruğuna Ekle" style="background:none; border:none; cursor:pointer; font-size:16px; color:#2ecc71;">➕</button>
                        <span class="store-name-blacklisted" title="${item.storeName}">${item.storeName}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:5px; margin-right:10px;">
                        ${daysDisplayHtml}
                    </div>
                    <button class="remove-from-blacklist-btn" data-url="${item.url}">Sil</button>
                `;
                fragment.appendChild(li);
            });
            blacklistList.appendChild(fragment);
            setupPaginationControls(validEntries.length, currentPageBlacklist, 'blacklist-pagination', (newPage) => {
                currentPageBlacklist = newPage;
                renderBlacklist(blacklist);
            });
        } else {
            noBlacklistMessage.classList.remove('hidden');
            document.getElementById('blacklist-pagination').classList.add('hidden');
        }
    }

    addBlacklistBtn.addEventListener('click', () => {
        const storeName = blacklistInput.value.trim();
        if (!storeName) return;
        const dummyUrl = `https://www.ebay.com/sch/i.html?_ssn=${storeName}&LH_Sold=1&LH_Complete=1`;
        const fifteenDaysInMillis = 15 * 24 * 60 * 60 * 1000;
        const expirationDate = Date.now() + fifteenDaysInMillis;
        chrome.storage.local.get('sellerBlacklist', (data) => {
            const blacklist = data.sellerBlacklist || {};
            blacklist[dummyUrl] = expirationDate;
            chrome.storage.local.set({ sellerBlacklist: blacklist }, () => {
                blacklistInput.value = '';
                currentPageBlacklist = 1;
            });
        });
    });

    clearBlacklistBtn.addEventListener('click', () => {
        if(confirm("Yasaklı kategoriler (kalıcı yasaklar) hariç tüm kara liste temizlenecek. Emin misiniz?")) {
            chrome.storage.local.get('sellerBlacklist', (data) => {
                const blacklist = data.sellerBlacklist || {};
                const now = Date.now();
                const newBlacklist = {};
                Object.entries(blacklist).forEach(([url, expirationTime]) => {
                    const timeRemaining = expirationTime - now;
                    const daysRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60 * 24));
                    if (daysRemaining > 10000) {
                        newBlacklist[url] = expirationTime;
                    }
                });
                currentPageBlacklist = 1;
                chrome.storage.local.set({ sellerBlacklist: newBlacklist }, () => {
                     loadBlacklist();
                     alert("Liste temizlendi. Sadece yasaklı kategoriler kaldı.");
                });
            });
        }
    });

    // LOCAL MODE: Global kara liste sunucu senkronu kaldırıldı ("🔄 Eşitle" butonu ve
    // forceSyncBlacklist çağrıları silindi). Kara liste tamamen yereldir.

    blacklistList.addEventListener('change', (event) => {
        if (event.target.classList.contains('blacklist-days-input')) {
            const newDays = parseInt(event.target.value);
            const urlToUpdate = event.target.dataset.url;
            if (isNaN(newDays) || newDays <= 0) {
                alert("Lütfen geçerli bir gün sayısı girin.");
                loadBlacklist();
                return;
            }
            const newExpirationTime = Date.now() + (newDays * 24 * 60 * 60 * 1000);
            chrome.storage.local.get('sellerBlacklist', (data) => {
                const blacklist = data.sellerBlacklist || {};
                if (blacklist[urlToUpdate] !== undefined) {
                    blacklist[urlToUpdate] = newExpirationTime;
                    chrome.storage.local.set({ sellerBlacklist: blacklist });
                } else {
                     const storeName = getStoreNameFromUrl(urlToUpdate);
                     Object.keys(blacklist).forEach(key => {
                        if (getStoreNameFromUrl(key) === storeName) {
                            blacklist[key] = newExpirationTime;
                        }
                    });
                    chrome.storage.local.set({ sellerBlacklist: blacklist });
                }
            });
        }
    });

    blacklistList.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-from-blacklist-btn')) {
            const urlToRemove = event.target.dataset.url;
            const storeName = getStoreNameFromUrl(urlToRemove);
            if (confirm(`'${storeName}' mağazasını kara listeden kaldırmak istediğinize emin misiniz?`)) {
                chrome.storage.local.get('sellerBlacklist', (data) => {
                    const blacklist = data.sellerBlacklist || {};
                    Object.keys(blacklist).forEach(key => {
                        if (getStoreNameFromUrl(key) === storeName) {
                            delete blacklist[key];
                        }
                    });
                    const remainingLength = Object.keys(blacklist).length;
                    if (remainingLength <= (currentPageBlacklist - 1) * ITEMS_PER_PAGE && currentPageBlacklist > 1) {
                        currentPageBlacklist--;
                    }
                    chrome.storage.local.set({ sellerBlacklist: blacklist });
                });
            }
        }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
            if (changes.potentialProducts) {
                if (!isBulkAnalyzing) {
                    renderProducts(changes.potentialProducts.newValue || []);
                } else {
                    allProducts = changes.potentialProducts.newValue || [];
                }
            }
            if (changes.savedSellerLinks) {
                chrome.storage.local.get(['sellerBlacklist', 'autoAddToQueue', 'analysisQueue'], (data) => {
                    const newLinks = changes.savedSellerLinks.newValue || [];
                    const oldLinks = changes.savedSellerLinks.oldValue || [];
                    const blacklist = data.sellerBlacklist || {};
                    let queue = data.analysisQueue || [];
                    queue = queue.map(item => typeof item === 'string' ? { url: item, status: 'waiting' } : item);
                    let queueUpdated = false;

                    if (data.autoAddToQueue) {
                        const now = Date.now();
                        const permanentBannedStores = new Set();
                        Object.entries(blacklist).forEach(([bUrl, exp]) => {
                            const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                            if (days > 10000) {
                                permanentBannedStores.add(getStoreNameFromUrl(bUrl));
                            }
                        });

                        newLinks.forEach(newLink => {
                            if (newLink.visited) {
                                const oldLink = oldLinks.find(l => l.url === newLink.url);
                                if (!oldLink || !oldLink.visited) {
                                    const storeName = getStoreNameFromUrl(newLink.url);
                                    if (!permanentBannedStores.has(storeName)) {
                                        const existingIndex = queue.findIndex(item => item.url === newLink.url);
                                        if (existingIndex === -1) {
                                            queue.push({ url: newLink.url, status: 'waiting' });
                                            queueUpdated = true;
                                        }
                                    }
                                }
                            }
                        });
                    }

                    if (queueUpdated) {
                        chrome.storage.local.set({ analysisQueue: queue });
                    }
                    renderSellerLinks(newLinks, blacklist);
                });
            }
            if (changes.sellerBlacklist) {
                renderBlacklist(changes.sellerBlacklist.newValue || {});
                loadSellerLinks();
            }
            if (changes.analysisQueue || changes.analysisState || changes.activeAnalysisTabs || changes.analysisConcurrency) {
                loadAnalysisQueue();
            }
            if (changes.fetchAllQueue || changes.activeFetchAllTabs || changes.fetchAllState) {
                updateFetchAllButton();
            }
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'automationStateUpdate') {
            updateButtonStates(message.state);
        }
        if (message.action === 'fetchAllQueueFinished') {
            updateFetchAllButton();
        }
    });

    updateFetchAllButton();

    chrome.runtime.sendMessage({ action: 'getAutomationState' }, (response) => {
        if (!chrome.runtime.lastError && response && response.state) {
            updateButtonStates(response.state);
        }
    });

    function showRiskReviewModal(riskyItems) {
        let currentItems = [...riskyItems];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = `
            <div class="modal-header">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span>⚠️ Riskli Ürün İncelemesi (<span id="risk-count-label">${currentItems.length}</span>)</span>
                    <select id="risk-sort-select" style="background:#2c2c2c; color:#fff; font-size:12px; padding:4px; border-radius:4px; border:1px solid #555; outline:none; cursor:pointer;">
                        <option value="score_desc">Puan (Yüksek > Düşük)</option>
                        <option value="reason_asc">Sebep (A'dan Z'ye Grupla)</option>
                        <option value="title_asc">Ürün Adı (A-Z)</option>
                    </select>
                </div>
                <span style="cursor:pointer; font-size:20px;" id="close-modal">&times;</span>
            </div>
            <div class="modal-body" id="risk-list-body"></div>
            <div class="modal-footer">
                <div style="flex-grow:1;"></div>
                <button class="action-btn" id="cancel-risk-btn" style="background:#7f8c8d;">Kapat</button>
                <button class="danger-btn" id="confirm-delete-btn">Seçili Olanları Sil</button>
            </div>
        `;
        overlay.appendChild(content);
        document.body.appendChild(overlay);
        const body = content.querySelector('#risk-list-body');
        const countLabel = content.querySelector('#risk-count-label');
        const sortSelect = content.querySelector('#risk-sort-select');

        const renderRows = (itemsToRender) => {
            body.innerHTML = '';
            itemsToRender.forEach(item => {
                const row = document.createElement('div');
                row.className = 'risk-item-row';
                row.id = `risk-row-${item.id}`;
                row.innerHTML = `
                    <input type="checkbox" class="risk-checkbox" data-id="${item.id}" checked>
                    <img src="${item.img}" class="risk-item-img">
                    <div class="risk-item-info">
                        <div style="font-weight:bold; font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:350px; color:#fff;">${item.title}</div>
                        <div style="margin-top:4px;">
                            <span class="risk-score-badge">Puan: ${item.score}/10</span>
                            <span style="font-size:11px; color:#bbb; font-weight:600;">${item.reason}</span>
                        </div>
                    </div>
                    <button class="remove-from-report-btn" data-id="${item.id}">Listeden Çıkar</button>
                `;
                body.appendChild(row);
            });
            countLabel.textContent = itemsToRender.length;
        };

        currentItems.sort((a, b) => b.score - a.score);
        renderRows(currentItems);

        sortSelect.addEventListener('change', (e) => {
            const criteria = e.target.value;
            if (criteria === 'score_desc') {
                currentItems.sort((a, b) => b.score - a.score);
            } else if (criteria === 'reason_asc') {
                currentItems.sort((a, b) => {
                    const rA = (a.reason || "").toLowerCase();
                    const rB = (b.reason || "").toLowerCase();
                    return rA.localeCompare(rB, 'tr');
                });
            } else if (criteria === 'title_asc') {
                currentItems.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
            }
            renderRows(currentItems);
        });

        const closeModal = () => document.body.removeChild(overlay);
        content.querySelector('#close-modal').onclick = closeModal;
        content.querySelector('#cancel-risk-btn').onclick = closeModal;

        body.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-from-report-btn')) {
                const itemId = e.target.dataset.id;
                currentItems = currentItems.filter(item => item.id !== itemId);
                renderRows(currentItems);
            }
        });

        content.querySelector('#confirm-delete-btn').onclick = async () => {
            const checkboxes = body.querySelectorAll('.risk-checkbox:checked');
            const idsToDelete = Array.from(checkboxes).map(cb => cb.dataset.id);
            if (idsToDelete.length === 0) {
                alert("Silinecek ürün seçmediniz.");
                return;
            }
            if (confirm(`${idsToDelete.length} adet riskli ürün silinecek. Emin misiniz?`)) {
                for (const id of idsToDelete) {
                    await new Promise(resolve => {
                        chrome.runtime.sendMessage({ action: "removePotentialProduct", itemId: id }, resolve);
                    });
                }
                closeModal();
                function loadProductsCallback() {
                    chrome.runtime.sendMessage({ action: "getPotentialProducts" }, (response) => {
                        if (response && response.status === "success") {
                            renderProducts(response.products);
                        }
                    });
                }
                loadProductsCallback();
                alert("Temizlik tamamlandı.");
            }
        };
    }

    async function hasAnyAiKey() {
        const names = [...Object.values(IndyAI.KEY_STORAGE), ...Object.values(IndyAI.LEGACY_KEY_STORAGE)];
        return Object.values(IndyAI.keysFromStorage(await chrome.storage.local.get(names))).some(Boolean);
    }

    analyzeRiskBtn.addEventListener('click', async () => {
        if (!(await hasAnyAiKey())) {
            return alert("API anahtarı yok. AI ayarları sayfasından Gemini, DeepSeek veya Claude anahtarı ekleyin.");
        }
        if (!confirm("Risk analizi başlatılsın mı? Puanı olmayan ürünler sırayla analiz edilecek.")) return;

        const progressText = document.getElementById('progress-text');
        analyzeRiskBtn.disabled = true;
        analyzeRiskBtn.textContent = "Analiz Ediliyor...";
        progressWrapper.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = '#8e44ad';

        let collectedRiskyItems = [];
        const productsToAnalyze = allProducts.filter(p => p.riskScore === undefined);
        const totalItems = productsToAnalyze.length;
        let processedCount = 0;

        if (totalItems === 0) {
             alert("Listede analiz edilecek yeni ürün yok.");
             analyzeRiskBtn.disabled = false;
             analyzeRiskBtn.textContent = "Risk Analizi (AI)";
             progressWrapper.style.display = 'none';
             return;
        }

        progressText.textContent = `Hazırlanıyor... (0 / ${totalItems} Ürün)`;
        isBulkAnalyzing = true;

        for (const product of productsToAnalyze) {
            const card = document.querySelector(`.product-card[data-item-id="${product.itemId}"]`);
            let skeleton = null;
            if (card) {
                skeleton = document.createElement('div');
                skeleton.className = 'skeleton-overlay';
                skeleton.innerHTML = '🤖 AI İnceliyor...<br><span style="font-size:11px; color:#ddd; margin-top:5px; font-weight:normal;" class="skeleton-text">Sırada...</span>';
                card.appendChild(skeleton);
            }

            let retryCount = 0;
            const maxRetries = 2;
            let result = { error: true };
            let success = false;

            while (!success && retryCount <= maxRetries) {
                if (retryCount > 0 && skeleton) {
                    const skelText = skeleton.querySelector('.skeleton-text');
                    if(skelText) skelText.innerHTML = `⚠️ Takıldı, Tekrar... (${retryCount})`;
                }
                if (retryCount > 0) await new Promise(r => setTimeout(r, 2000));

                result = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                        action: "analyzeProductRisk",
                        itemId: product.itemId,
                        imageUrl: product.imageUrl,
                        title: product.title,
                        price: product.ebayPrice || "0",
                        seller: product.sellerName || "Unknown"
                    }, resolve);
                });

                if (!result.error) {
                    success = true;
                } else {
                    retryCount++;
                }
            }

            if (skeleton) skeleton.remove();

            if (!result.error) {
                const score = result.riskScore;
                product.riskScore = score;
                product.riskReason = result.reason;

                if (card) {
                    const resDiv = card.querySelector('.risk-analysis-result');
                    resDiv.style.display = 'block';
                    let riskText = score >= 5 ? "⛔ RİSKLİ" : "DÜŞÜK RİSK TAHMİNİ";
                    resDiv.innerHTML = `Puan: ${score}/10 - ${riskText}`;
                    resDiv.style.fontWeight = "bold";
                    const singleAiBtn = card.querySelector('.analyze-single-btn');
                    if(singleAiBtn) {
                        singleAiBtn.textContent = 'Tekrar';
                        singleAiBtn.style.backgroundColor = "#34495e";
                    }
                    if (score >= 5) {
                        resDiv.style.backgroundColor = "#450a0a";
                        resDiv.style.color = "#fca5a5";
                    } else {
                        resDiv.style.backgroundColor = "#064e3b";
                        resDiv.style.color = "#86efac";
                    }
                }
                if (score >= 5) {
                    collectedRiskyItems.push({
                        id: product.itemId,
                        title: product.title,
                        img: product.imageUrl,
                        score: score,
                        reason: result.reason
                    });
                }
            } else {
                if (card) {
                    const resDiv = card.querySelector('.risk-analysis-result');
                    resDiv.style.display = 'block';
                    resDiv.style.backgroundColor = "#450a0a";
                    resDiv.style.color = "#fca5a5";
                    resDiv.innerHTML = "Hata: " + (result.reason || "Bilinmiyor");
                }
            }

            processedCount++;
            const percent = Math.round((processedCount / totalItems) * 100);
            progressBar.style.width = `${percent}%`;
            progressText.textContent = `%${percent} (${processedCount} / ${totalItems} Analiz Edildi)`;

            await new Promise(r => setTimeout(r, 2000));
        }

        const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
        for (const p of productsToAnalyze) {
            if(p.riskScore !== undefined) {
                 const pIndex = potentialProducts.findIndex(item => item.itemId === p.itemId);
                 if (pIndex !== -1) {
                     potentialProducts[pIndex].riskScore = p.riskScore;
                     potentialProducts[pIndex].riskReason = p.riskReason;
                 }
            }
        }
        await chrome.storage.local.set({ potentialProducts });

        isBulkAnalyzing = false;
        renderProducts(allProducts);

        progressBar.style.backgroundColor = '#27ae60';
        progressText.textContent = `Tamamlandı! (${totalItems} Ürün İncelendi)`;
        analyzeRiskBtn.disabled = false;
        analyzeRiskBtn.textContent = "Risk Analizi (AI)";

        setTimeout(() => {
            progressWrapper.style.display = 'none';
        }, 3000);

        if (collectedRiskyItems.length > 0) {
            showRiskReviewModal(collectedRiskyItems);
        } else {
            alert("İşlem tamamlandı. Yeni riskli ürün bulunamadı.");
        }
    });

    const clearRiskScoresBtn = document.createElement('button');
    clearRiskScoresBtn.id = 'clear-risk-scores-btn';
    clearRiskScoresBtn.className = 'secondary-btn';
    clearRiskScoresBtn.style.backgroundColor = '#7f8c8d';
    clearRiskScoresBtn.style.color = 'white';
    clearRiskScoresBtn.style.marginRight = '5px';
    clearRiskScoresBtn.innerHTML = '🧹 Risk Puanlarını Temizle';

    if (analyzeRiskBtn && analyzeRiskBtn.parentNode) {
        analyzeRiskBtn.parentNode.insertBefore(clearRiskScoresBtn, analyzeRiskBtn);
    }

    clearRiskScoresBtn.addEventListener('click', async () => {
        const { potentialProducts = [] } = await chrome.storage.local.get("potentialProducts");
        let hasScores = potentialProducts.some(p => p.riskScore !== undefined);

        if (!hasScores) {
            return alert("Listede puanı silinecek ürün bulunmuyor.");
        }

        if (!confirm(`Tüm ürünlerin analiz puanları silinecek. Onaylıyor musunuz?`)) return;

        for (let i = 0; i < potentialProducts.length; i++) {
            if (potentialProducts[i].riskScore !== undefined) {
                delete potentialProducts[i].riskScore;
                delete potentialProducts[i].riskReason;
            }
        }

        await chrome.storage.local.set({ potentialProducts });
        alert("Risk puanları başarıyla temizlendi!");
    });

    // Concurrent analysis tabs: background.js reads the same key (default 2, max 7).
    const analysisConcurrencyInput = document.getElementById('analysis-concurrency-input');
    function clampAnalysisConcurrency(value) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? Math.min(7, Math.max(1, n)) : 2;
    }
    chrome.storage.local.get('analysisConcurrency', d => {
        analysisConcurrencyInput.value = clampAnalysisConcurrency(d.analysisConcurrency);
    });
    analysisConcurrencyInput.addEventListener('change', () => {
        const n = clampAnalysisConcurrency(analysisConcurrencyInput.value);
        analysisConcurrencyInput.value = n;
        chrome.storage.local.set({ analysisConcurrency: n }, loadAnalysisQueue);
    });

    function loadAnalysisQueue() {
        chrome.storage.local.get(['analysisQueue', 'analysisState', 'activeAnalysisTabs', 'analysisConcurrency'], (data) => {
            let queue = data.analysisQueue || [];
            queue = queue.map(item => typeof item === 'string' ? { url: item, status: 'waiting' } : item);
            const state = data.analysisState || 'stopped';
            const activeCount = (data.activeAnalysisTabs || []).length;

            const badgeQueue = document.getElementById('badge-queue');
            if (badgeQueue) badgeQueue.textContent = queue.length;

            renderAnalysisQueue(queue);
            updateQueueStatus(state, queue.filter(i => i.status === 'waiting').length, activeCount, clampAnalysisConcurrency(data.analysisConcurrency));
        });
    }

    function renderAnalysisQueue(queue) {
        analysisQueueList.innerHTML = '';
        if (queue.length === 0) {
            analysisQueueList.innerHTML = '<li class="queue-empty">Kuyruk boş. Mağazalar listesindeki ➕ butonuyla ekleyin.</li>';
            return;
        }
        const statusLabels = { active: 'Çalışıyor', completed: 'Bitti', waiting: 'Bekliyor' };
        const fragment = document.createDocumentFragment();
        queue.forEach((item, index) => {
            const status = item.status === 'active' || item.status === 'completed' ? item.status : 'waiting';
            const li = document.createElement('li');
            li.className = `queue-item is-${status}`;
            li.innerHTML = `
                <span class="queue-index">${index + 1}</span>
                <span class="queue-store" title="${escapeHTML(item.url)}">${escapeHTML(getStoreNameFromUrl(item.url))}</span>
                <span class="queue-badge">${statusLabels[status]}</span>
                <span class="queue-actions">
                    ${status === 'waiting' ? `<button class="force-start-item-btn" data-index="${index}" title="Sıra beklemeden hemen aç (yer varsa)" aria-label="Hemen başlat">▶</button>` : ''}
                    <button class="remove-queue-item" data-index="${index}" title="Kuyruktan çıkar" aria-label="Kuyruktan çıkar">×</button>
                </span>`;
            fragment.appendChild(li);
        });
        analysisQueueList.appendChild(fragment);
    }
    function updateQueueStatus(state, waitingCount, activeCount, limit) {
        const running = state === 'running';
        queueStatusLabel.textContent = `${running ? 'Çalışıyor' : 'Durdu'} · Bekleyen ${waitingCount} · Aktif sekme ${activeCount}/${limit}`;
        queueStatusLabel.dataset.state = running ? 'running' : 'stopped';
        startQueueBtn.disabled = running;
        stopQueueBtn.disabled = !running;
    }

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-to-queue-btn')) {
            const url = e.target.dataset.url;
            chrome.storage.local.get({ analysisQueue: [] }, (data) => {
                let queue = data.analysisQueue;
                queue = queue.map(item => typeof item === 'string' ? { url: item, status: 'waiting' } : item);
                const existingIndex = queue.findIndex(item => item.url === url);

                if (existingIndex === -1) {
                    queue.push({ url: url, status: 'waiting' });
                    chrome.storage.local.set({ analysisQueue: queue }, loadAnalysisQueue);
                    const originalText = e.target.textContent;
                    e.target.textContent = '✔';
                    setTimeout(() => e.target.textContent = originalText, 1000);
                } else {
                    alert("Bu mağaza zaten kuyrukta!");
                }
            });
        }
        if (e.target.classList.contains('remove-queue-item')) {
            const index = parseInt(e.target.dataset.index);
            chrome.storage.local.get({ analysisQueue: [] }, (data) => {
                const queue = data.analysisQueue;
                queue.splice(index, 1);
                chrome.storage.local.set({ analysisQueue: queue }, loadAnalysisQueue);
            });
        }
        if (e.target.closest('.force-start-item-btn')) {
            const btn = e.target.closest('.force-start-item-btn');
            const index = parseInt(btn.dataset.index);
            btn.disabled = true;
            chrome.runtime.sendMessage({ action: "forceProcessItem", index: index }, (response) => {
                if (response.status === "success") {
                } else if (response.status === "full") {
                    alert(`Eşzamanlı sekme sınırı (${response.limit || 'ayar'}) dolu. Bir sekmenin kapanmasını bekleyin ya da sınırı artırın.`);
                    btn.disabled = false;
                } else {
                    alert("Hata: " + response.message);
                    btn.disabled = false;
                }
            });
        }
    });

    startQueueBtn.addEventListener('click', () => {
        chrome.storage.local.get({ analysisQueue: [] }, (data) => {
            let queue = data.analysisQueue;
            let hasCompleted = queue.some(item => item.status === 'completed');

            if (hasCompleted) {
                if (confirm("Kuyruktaki daha önce tamamlanan (✅ Bitti) mağazalar tekrar taransın mı?")) {
                    queue.forEach(item => {
                        if (item.status === 'completed') {
                            item.status = 'waiting';
                        }
                    });
                    chrome.storage.local.set({ analysisQueue: queue }, () => {
                        loadAnalysisQueue();
                        chrome.runtime.sendMessage({ action: "controlAnalysisQueue", command: "start" });
                    });
                    return;
                }
            }

            chrome.runtime.sendMessage({ action: "controlAnalysisQueue", command: "start" });
        });
    });

    stopQueueBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "controlAnalysisQueue", command: "stop" });
    });

    if (clearCompletedQueueBtn) {
        clearCompletedQueueBtn.addEventListener('click', () => {
            if(confirm("Kuyruktaki daha önce tamamlanan (✅ Bitti) mağazalar silinecek. Emin misiniz?")) {
                chrome.storage.local.get({ analysisQueue: [] }, (data) => {
                    const queue = data.analysisQueue || [];
                    const newQueue = queue.filter(item => item.status !== 'completed');
                    chrome.storage.local.set({ analysisQueue: newQueue }, loadAnalysisQueue);
                });
            }
        });
    }

    clearQueueBtn.addEventListener('click', () => {
        if(confirm("Tüm kuyruk temizlenecek. Emin misiniz?")) {
            chrome.storage.local.set({ analysisQueue: [] }, loadAnalysisQueue);
        }
    });

    document.getElementById('clear-blacklisted-queue-btn').addEventListener('click', () => {
        chrome.storage.local.get(['analysisQueue', 'sellerBlacklist'], (data) => {
            const queue = data.analysisQueue || [];
            const blacklist = data.sellerBlacklist || {};
            const now = Date.now();
            const permanentThreshold = now + (10000 * 24 * 60 * 60 * 1000);
            const permanentlyBanned = new Set(
                Object.entries(blacklist)
                    .filter(([, exp]) => exp > permanentThreshold)
                    .map(([url]) => url)
            );
            const filtered = queue.filter(item => !permanentlyBanned.has(item.url));
            const removedCount = queue.length - filtered.length;
            if (removedCount === 0) {
                alert('Kuyrukta süresiz yasaklı mağaza bulunamadı.');
                return;
            }
            if (confirm(`Kuyrukta ${removedCount} adet süresiz yasaklı mağaza bulundu. Silinsin mi?`)) {
                chrome.storage.local.set({ analysisQueue: filtered }, loadAnalysisQueue);
            }
        });
    });

    function loadProducts() {
        chrome.runtime.sendMessage({ action: "getPotentialProducts" }, (response) => {
            if (response && response.status === "success") {
                renderProducts(response.products);
            }
        });
    }

    loadProducts();
    loadSellerLinks();
    loadBlacklist();
    loadAnalysisQueue();

    const mainCatInput = document.getElementById('main-cat-input');
    const addMainCatBtn = document.getElementById('add-main-cat-btn');
    const mainCatsList = document.getElementById('main-cats-list');
    const noMainCats = document.getElementById('no-main-cats');
    const clearMainCatsBtn = document.getElementById('clear-main-cats-btn');
    const mainCatsCounter = document.getElementById('main-cats-counter');

    const subCatInput = document.getElementById('sub-cat-input');
    const addSubCatBtn = document.getElementById('add-sub-cat-btn');
    const subCatsList = document.getElementById('sub-cats-list');
    const noSubCats = document.getElementById('no-sub-cats');
    const clearSubCatsBtn = document.getElementById('clear-sub-cats-btn');
    const subCatsCounter = document.getElementById('sub-cats-counter');

    const forbiddenCatsCounter = document.getElementById('forbidden-cats-counter');

    function updateForbiddenTotalCounter(mainCount, subCount) {
        if (forbiddenCatsCounter) forbiddenCatsCounter.textContent = (mainCount + subCount) + ' Kategori';
    }

    function renderCatList(cats, listEl, noEl, counterEl) {
        listEl.innerHTML = '';
        if (!cats || cats.length === 0) {
            noEl.style.display = 'block';
            counterEl.textContent = '0';
            return;
        }
        noEl.style.display = 'none';
        counterEl.textContent = cats.length;
        cats.forEach((cat, index) => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid #333; font-size:13px;';
            li.innerHTML = `<span style="color:#e0e0e0; word-break:break-word; flex:1; margin-right:8px;">🚫 ${cat}</span><button data-index="${index}" class="remove-cat-btn" style="background-color:#7f1d1d; color:#fca5a5; border:none; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold; flex-shrink:0;">Sil</button>`;
            listEl.appendChild(li);
        });
    }

    function loadForbiddenCategoriesUI() {
        chrome.storage.local.get(['forbiddenMainCategories', 'forbiddenSubCategories'], (data) => {
            const mainCats = data.forbiddenMainCategories || [];
            const subCats = data.forbiddenSubCategories || [];
            renderCatList(mainCats, mainCatsList, noMainCats, mainCatsCounter);
            renderCatList(subCats, subCatsList, noSubCats, subCatsCounter);
            updateForbiddenTotalCounter(mainCats.length, subCats.length);
        });
    }

    function addCategory(inputEl, storageKey, listEl, noEl, counterEl) {
        const val = inputEl.value.trim();
        if (!val) return;
        chrome.storage.local.get(storageKey, (data) => {
            const cats = data[storageKey] || [];
            if (cats.includes(val)) { alert('Bu kategori zaten listede mevcut.'); return; }
            cats.push(val);
            chrome.storage.local.set({ [storageKey]: cats }, () => {
                inputEl.value = '';
                renderCatList(cats, listEl, noEl, counterEl);
                chrome.storage.local.get(['forbiddenMainCategories', 'forbiddenSubCategories'], (d) => {
                    updateForbiddenTotalCounter((d.forbiddenMainCategories || []).length, (d.forbiddenSubCategories || []).length);
                });
            });
        });
    }

    addMainCatBtn.addEventListener('click', () => addCategory(mainCatInput, 'forbiddenMainCategories', mainCatsList, noMainCats, mainCatsCounter));
    mainCatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMainCatBtn.click(); });

    addSubCatBtn.addEventListener('click', () => addCategory(subCatInput, 'forbiddenSubCategories', subCatsList, noSubCats, subCatsCounter));
    subCatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSubCatBtn.click(); });

    mainCatsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-cat-btn')) {
            const index = parseInt(e.target.dataset.index, 10);
            chrome.storage.local.get('forbiddenMainCategories', (data) => {
                const cats = data.forbiddenMainCategories || [];
                cats.splice(index, 1);
                chrome.storage.local.set({ forbiddenMainCategories: cats }, () => {
                    renderCatList(cats, mainCatsList, noMainCats, mainCatsCounter);
                    chrome.storage.local.get(['forbiddenMainCategories', 'forbiddenSubCategories'], (d) => {
                        updateForbiddenTotalCounter((d.forbiddenMainCategories || []).length, (d.forbiddenSubCategories || []).length);
                    });
                });
            });
        }
    });

    subCatsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-cat-btn')) {
            const index = parseInt(e.target.dataset.index, 10);
            chrome.storage.local.get('forbiddenSubCategories', (data) => {
                const cats = data.forbiddenSubCategories || [];
                cats.splice(index, 1);
                chrome.storage.local.set({ forbiddenSubCategories: cats }, () => {
                    renderCatList(cats, subCatsList, noSubCats, subCatsCounter);
                    chrome.storage.local.get(['forbiddenMainCategories', 'forbiddenSubCategories'], (d) => {
                        updateForbiddenTotalCounter((d.forbiddenMainCategories || []).length, (d.forbiddenSubCategories || []).length);
                    });
                });
            });
        }
    });

    clearMainCatsBtn.addEventListener('click', () => {
        if (confirm('Tüm ana kategoriler silinecek. Emin misiniz?')) {
            chrome.storage.local.set({ forbiddenMainCategories: [] }, () => {
                renderCatList([], mainCatsList, noMainCats, mainCatsCounter);
                chrome.storage.local.get('forbiddenSubCategories', (d) => {
                    updateForbiddenTotalCounter(0, (d.forbiddenSubCategories || []).length);
                });
            });
        }
    });

    clearSubCatsBtn.addEventListener('click', () => {
        if (confirm('Tüm alt kategoriler silinecek. Emin misiniz?')) {
            chrome.storage.local.set({ forbiddenSubCategories: [] }, () => {
                renderCatList([], subCatsList, noSubCats, subCatsCounter);
                chrome.storage.local.get('forbiddenMainCategories', (d) => {
                    updateForbiddenTotalCounter((d.forbiddenMainCategories || []).length, 0);
                });
            });
        }
    });

    loadForbiddenCategoriesUI();
});
