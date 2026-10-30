(function () {
    'use strict';

    let hasFetched = false;
    let autoCollectInterval = null;
    let totalAsinsCollected = 0;
    let isExtracting = false;
    // "Tümünü Çek" sekmesi yalnızca bir kez kapanma isteği göndermeli (çift istek
    // arka planda gereksiz hataya yol açar), ama HER koşulda göndermelidir.
    let autoCloseSent = false;
    function closeAutoTab(keepUnfetched = false) {
        if (autoCloseSent) return;
        autoCloseSent = true;
        chrome.runtime.sendMessage({ action: 'closeSelf', keepUnfetched });
    }

    // Auto collect belongs to exactly one tab (the panel's background window, or the tab the
    // popup started it in). Other Amazon tabs must never react to the shared storage flag.
    let currentTabId = null;
    const myTabIdPromise = new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ action: 'whoAmI' }, response => {
                resolve(chrome.runtime.lastError ? null : (response && Number.isInteger(response.tabId) ? response.tabId : null));
            });
        } catch (e) {
            resolve(null);
        }
    });
    myTabIdPromise.then(id => { currentTabId = id; });
    async function autoCollectOwnedHere(data) {
        if (!data.autoCollectActive) return false;
        const myTabId = await myTabIdPromise;
        return myTabId !== null && data.autoCollectTabId === myTabId;
    }

    const stockCache = {};
    const cacheExpiry = {};
    const CACHE_DURATION = 3600000;
    const processedAsins = new Set();
    const MAX_CONCURRENT_REQUESTS = 5;
    let activeRequests = 0;
    let lastUrl = window.location.href;

    let features = {
        toggleAsinBox: true,
        toggleStock: true,
        togglePrime: true,
        toggleRating: true,
        toggleBannedWarning: true,
        toggleCopyIcon: true,
        toggleSaveIcon: true,
        toggleEbayIcon: true,
        toggleFilterMatch: true,
        bsrDisplayMode: 'general',
        toggleLogs: false
    };

    function log(...args) {
        if (features.toggleLogs) {
            console.log(...args);
        }
    }

    async function fetchProductDetails(asin, waitedMs = 0) {
        if (stockCache[asin] && Date.now() - (cacheExpiry[asin] || 0) < CACHE_DURATION) {
            return stockCache[asin];
        }
        // activeRequests bir hata yolunda azaltılmadan kalırsa bu kapı sonsuza kadar
        // kapalı kalıyordu ve Promise.all hiç çözülmüyordu (sekme kapanmıyor, kuyruk
        // tıkanıyordu). Belirli bir bekleyişten sonra kapıyı yok sayıp devam ediyoruz.
        if (activeRequests >= MAX_CONCURRENT_REQUESTS && waitedMs < 15000) {
            await new Promise(resolve => setTimeout(resolve, 100));
            return fetchProductDetails(asin, waitedMs + 100);
        }
        activeRequests++;
        
        let details = {
            stock: 0,
            bsr: [],
            brand: null,
            buyBox: false,
            fbaCount: 0,
            fbmCount: 0,
            moreSellersPossible: false
        };

        const domain = window.location.hostname;
        const parser = new DOMParser();

        try {
            const response = await fetch(`https://${domain}/dp/${asin}`);
            const text = await response.text();
            const doc = parser.parseFromString(text, 'text/html');

            details.buyBox = doc.querySelectorAll("#add-to-cart-button").length > 0;

            const bsrSelectors = [
                "#prodDetails [href*='/gp/bestsellers/']",
                "#productDetails_detailBullets_sections1 [href*='/gp/bestsellers/']",
                "#detailBulletsWrapper_feature_div [href*='/gp/bestsellers/']",
                "#productDetails_detailBullets_sections [href*='/gp/bestsellers/']",
                "#productDetailsTable [href*='/gp/bestsellers/']",
                "#productDetails_db_sections [href*='/gp/bestsellers/']",
                "#detailBullets_feature_div [href*='/gp/bestsellers/']"
            ];

            let bsrElements = [];
            for (const selector of bsrSelectors) {
                const elements = doc.querySelectorAll(selector);
                if (elements.length > 0) {
                    bsrElements = Array.from(elements).map(el => el.parentElement);
                    break;
                }
            }

            const cleanBSRText = (rawText) => {
                if (!rawText) return null;
                const removalPatterns = ["(see top", "(visualizza", "(voir", "(siehe", "(ver"];
                let textToClean = rawText;
                let cutIndex = -1;

                for (const pattern of removalPatterns) {
                    const index = textToClean.toLowerCase().indexOf(pattern);
                    if (index !== -1) {
                        cutIndex = (cutIndex === -1) ? index : Math.min(cutIndex, index);
                    }
                }

                if (cutIndex !== -1) {
                    textToClean = textToClean.substring(0, cutIndex);
                }
                
                let cleanedText = textToClean.replace(/\{.*\}/g, "").trim().replace(/\s+/g, ' ');
                return cleanedText.replace(/^Best Sellers Rank:\s*/i, '').trim();
            };

            if (bsrElements.length > 0) {
                bsrElements.forEach(item => {
                    const cleanText = cleanBSRText(item.textContent);
                    if (cleanText) details.bsr.push(cleanText);
                });
            } else {
                const salesRankElement = doc.querySelector("#SalesRank");
                if (salesRankElement) {
                    const cleanText = cleanBSRText(salesRankElement.textContent);
                    if (cleanText) details.bsr.push(cleanText);
                } else {
                    const salesRankValueElement = doc.querySelector("#SalesRank .value");
                    if (salesRankValueElement) {
                        const cleanText = cleanBSRText(salesRankValueElement.textContent);
                        if (cleanText) details.bsr.push(cleanText);
                    }
                }
            }
            
            const brandKeywords = ["Brand", "Marke", "Marque", "Marka", "Marca", "Marchio", "Merk", "Varumärke", "Üretici", "الشركة المصنعة", "العلامة التجارية", "ブランド"];
            const detailEntries = doc.querySelectorAll(".prodDetSectionEntry");
            
            for (const entry of detailEntries) {
                const entryText = entry.textContent.trim().toLowerCase();
                if (brandKeywords.some(keyword => entryText === keyword.toLowerCase())) {
                    details.brand = entry.nextElementSibling?.textContent.trim();
                    break;
                }
            }

            if (!details.brand) {
                const poBrand = doc.querySelector(".po-brand");
                if (poBrand) {
                    for (const keyword of brandKeywords) {
                        if (poBrand.textContent.includes(keyword)) {
                            details.brand = poBrand.textContent.replace(keyword, '').trim();
                            break;
                        }
                    }
                }
            }

            if (!details.brand) {
                const bylineInfoText = doc.querySelector("#bylineInfo");
                if (bylineInfoText && bylineInfoText.textContent.includes("Brand:")) {
                    details.brand = bylineInfoText.textContent.replace("Brand:", "").trim();
                }
            }

            if (!details.brand) {
                const bylineLink = doc.querySelector("a#bylineInfo[href*='/stores/']");
                if (bylineLink) {
                    const href = bylineLink.getAttribute('href');
                    const match = href.match(/\/stores\/([^/]+)\//);
                    if (match && match[1]) {
                        details.brand = match[1];
                    }
                }
            }

        } catch (e) {
            log('Error fetching main page details', e);
        }

        try {
            const offersUrl = `https://${domain}/gp/product/ajax/ref=dp_aod_ALL_mbc?asin=${asin}&pc=dp&experienceId=aodAjaxMain`;
            const offersResponse = await fetch(offersUrl);
            const offersText = await offersResponse.text();
            const offersDoc = parser.parseFromString(offersText, 'text/html');
            
            let totalQuantity = 0;
            
            const processOffer = (offer) => {
                if(!offer) return;

                const qtyOptions = offer.querySelectorAll('[id^="aod-offer-qty-component-"] .aod-qty-option');
                totalQuantity += qtyOptions.length === 0 ? 1 : qtyOptions.length;

                const shipsFromEl = offer.querySelector("#aod-offer-shipsFrom .a-col-right");
                const soldByEl = offer.querySelector("#aod-offer-soldBy .a-col-right");
                let isFBA = false;

                if (shipsFromEl && shipsFromEl.textContent.toLowerCase().includes("amazon")) {
                    isFBA = true;
                } else if (soldByEl) {
                    const soldByText = soldByEl.textContent.toLowerCase();
                    if (!soldByText.includes("amazon") && offer.querySelector(".a-icon-prime")) {
                        isFBA = true;
                    }
                }

                if(isFBA) {
                    details.fbaCount++;
                } else {
                    details.fbmCount++;
                }
            };
            
            const pinnedOffer = offersDoc.querySelector("#aod-pinned-offer");
            processOffer(pinnedOffer);

            const allOffers = offersDoc.querySelectorAll("#aod-offer-list #aod-offer");
            allOffers.forEach(processOffer);
            
            if ((allOffers.length + (pinnedOffer ? 1 : 0)) >= 10) {
                details.moreSellersPossible = true;
            }

            details.stock = totalQuantity > 0 ? totalQuantity : 'N/A';

        } catch(e) {
            log('Error fetching offers page', e);
            if (details.stock === 0) details.stock = 'N/A';
        }
        
        stockCache[asin] = details;
        cacheExpiry[asin] = Date.now();
        activeRequests--;
        return details;
    }

    function detectAsin() {
        const patterns = [
            /(?:\/dp\/|\/gp\/product\/|\/product\/|\/gp\/aw\/d\/|\/gp\/slredirect\/.*?\/dp\/|asin=)([A-Z0-9]{10})/,
            /\/([A-Z0-9]{10})(?:\/|\?|$)/
        ];
        for (const pattern of patterns) {
            const match = window.location.href.match(pattern);
            if (match) {
                log('ASIN detected from URL:', match[1]);
                return match[1];
            }
        }

        const selectors = [
            '[data-asin]',
            'input[name="ASIN"]',
            '#ASIN',
            '[data-csa-c-asin]',
            '[data-component-type="s-product-image"] [data-asin]',
            '#productDetails_detailBullets_sections1 td'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                const asin = el.getAttribute('data-asin') || 
                            el.getAttribute('data-csa-c-asin') || 
                            el.value || 
                            el.textContent.trim();
                if (asin && /^[A-Z0-9]{10}$/.test(asin)) {
                    log('ASIN detected from DOM element:', asin, 'using selector:', selector);
                    return asin;
                }
            }
        }

        log('ASIN could not be detected');
        return null;
    }

    async function checkIfAsinSaved(asin) {
        return new Promise(resolve => {
            chrome.storage.local.get("memoryAsins", (data) => {
                const memoryAsins = data.memoryAsins || [];
                resolve(memoryAsins.includes(asin));
            });
        });
    }

    async function checkIfAsinBlacklisted(asin) {
        return new Promise(resolve => {
            chrome.storage.local.get("blacklistAsins", (data) => {
                const blacklistAsins = data.blacklistAsins || [];
                resolve(blacklistAsins.includes(asin));
            });
        });
    }

    function getProductInfo(container) {
        let isPrime = false;
        let rating = 0;
        let feedback = 0;
        let deliveryTime = 99;
        let price = null;
        let stock = Infinity;
        let hasStockWarning = false;
        let brand = "";
        let title = "";
        let bsr = Infinity;

        if (!container || typeof container.querySelector !== 'function') {
            return { isPrime, rating, feedback, deliveryTime, price, stock, hasStockWarning, brand, title, bsr };
        }

        function isElementVisible(element) {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
        }

        const primeSelectors = [
            ".a-icon-prime",
            ".a-icon-addon-prime",
            ".puis-npa-prime-upsell-blue-color"
        ];
        for (const selector of primeSelectors) {
            const primeElement = container.querySelector(selector);
            if (primeElement && isElementVisible(primeElement)) {
                isPrime = true;
                break;
            }
        }

        let ratingElement = container.querySelector('i.a-icon-star > span, i.a-icon-star-small > span, .a-icon-star-small .a-icon-alt, [aria-label*="out of 5 stars"], .a-icon-star');
        if (ratingElement) {
            let ratingText = ratingElement.textContent || ratingElement.getAttribute("aria-label") || "";
            rating = ratingText.match(/[\d.]+/) ? parseFloat(ratingText.match(/[\d.]+/)[0]) : 0;
        }

        const feedbackSelectors = [
            "[aria-label*='ratings']",
            "[aria-label*='değerlendirme']",
            "[data-hook='total-review-count']",
            "[href*='#customerReviews']",
            "span.a-size-small.puis-normal-weight-text.s-underline-text",
            ".a-size-small.a-link-normal",
            "[class*='rating']"
        ];
        for (const selector of feedbackSelectors) {
            const feedbackElement = container.querySelector(selector);
            if (feedbackElement) {
                let ariaLabel = feedbackElement.getAttribute("aria-label") || "";
                let textContent = feedbackElement.textContent || "";
                
                let textToParse = (ariaLabel.toLowerCase().includes('rating') || ariaLabel.toLowerCase().includes('değerlendirme')) ? ariaLabel : textContent;
                textToParse = textToParse.toLowerCase();

                if(textToParse.includes('star') || textToParse.includes('yıldız')) {
                    continue;
                }

                if (textToParse.includes('k')) {
                    let match = textToParse.match(/[\d.]+/);
                    if (match) feedback = parseFloat(match[0]) * 1000;
                } else if (textToParse.includes('m')) {
                    let match = textToParse.match(/[\d.]+/);
                    if (match) feedback = parseFloat(match[0]) * 1000000;
                } else {
                    let cleanText = textToParse.replace(/[^\d]/g, '');
                    if (cleanText) feedback = parseInt(cleanText) || 0;
                }

                if (feedback > 0) break;
            }
        }

        let deliveryTextElement = container.querySelector("span.a-color-base, [aria-label*='delivery'], .a-row.a-size-base.a-color-secondary");
        let deliveryText = deliveryTextElement ? (deliveryTextElement.textContent || deliveryTextElement.getAttribute("aria-label") || "").toLowerCase() : "";
        if (deliveryText.match(/one-day|same-day|tomorrow|overnight/i)) deliveryTime = 1;
        else if (deliveryText.match(/two-day|2-day/i)) deliveryTime = 2;
        else if (deliveryText.match(/(\d+)\s*(day|days|gün)/i)) {
            deliveryTime = parseInt(deliveryText.match(/(\d+)\s*(day|days|gün)/i)[1]);
        }

        let priceElement = container.querySelector(".sx-price, .s-price, span.a-price > span.a-offscreen, .a-price-whole, [data-a-price='whole']");
        if (priceElement) {
            let priceText = priceElement.textContent || "";
            let cleanPrice = priceText.replace(/[^\d.,]/g, ""); 
            
            if (cleanPrice) {
                let lastComma = cleanPrice.lastIndexOf(',');
                let lastDot = cleanPrice.lastIndexOf('.');
                
                if (lastComma > -1 && lastDot > -1) {
                    if (lastComma > lastDot) {
                        cleanPrice = cleanPrice.replace(/\./g, '').replace(',', '.');
                    } else {
                        cleanPrice = cleanPrice.replace(/,/g, '');
                    }
                } else if (lastComma > -1) {
                    let parts = cleanPrice.split(',');
                    if (parts[parts.length - 1].length === 2) {
                        cleanPrice = cleanPrice.replace(',', '.'); 
                    } else {
                        cleanPrice = cleanPrice.replace(/,/g, ''); 
                    }
                }
                price = parseFloat(cleanPrice) || null;
            }
        }

        let stockTextElements = container.querySelectorAll('span[aria-label*="left in stock"], span[aria-label*="available"], .a-size-base.a-color-price, #availability span.a-size-base.a-color-price, .a-size-medium, .a-color-price, .a-text-price, [data-a-color="price"]');
        for (let stockElement of stockTextElements) {
            let stockText = stockElement.textContent.trim() || "";
            if (stockText.match(/out of stock|stokta yok/i)) {
                stock = 0;
                break;
            }
            if (stockText.match(/in stock|available|stokta/i)) {
                const stockMatch = stockText.match(/Only (\d+) left in stock|Stokta sadece (\d+) adet kaldı|(\d+) in stock|Only (\d+) available/i);
                if (stockMatch) {
                    stock = parseInt(stockMatch[1] || stockMatch[2] || stockMatch[3] || stockMatch[4]);
                    hasStockWarning = stock <= 15;
                    break;
                }
            }
        }

        let brandElement = container.querySelector("#bylineInfo, span.a-size-base-plus.a-color-base:not([data-hook='amazons-choice-label'])");
        brand = brandElement ? brandElement.textContent.trim().toLowerCase() : "";
        brand = brand.replace(/amazon's choice|amazonun seçimi/gi, '').trim();

        let titleElement = container.querySelector("h2 a span, .a-size-medium.a-color-base.a-text-normal, #productTitle, h2 span:not([data-hook='amazons-choice-label'])");
        title = titleElement ? titleElement.textContent.trim().toLowerCase() : "";
        title = title.replace(/amazon's choice|amazonun seçimi/gi, '').trim();

        try {
            let bsrElements = [];
            const bsrSelectors = [
                "#prodDetails [href*='/gp/bestsellers/']",
                "#productDetails_detailBullets_sections1 [href*='/gp/bestsellers/']",
                "#detailBulletsWrapper_feature_div [href*='/gp/bestsellers/']",
                "#productDetails_detailBullets_sections [href*='/gp/bestsellers/']",
                "#productDetailsTable [href*='/gp/bestsellers/']",
                "#productDetails_db_sections [href*='/gp/bestsellers/']",
                "#detailBullets_feature_div [href*='/gp/bestsellers/']"
            ];
            
            for (const selector of bsrSelectors) {
                const elements = container.querySelectorAll(selector);
                if (elements.length > 0) {
                    bsrElements = Array.from(elements).map(el => el.parentElement);
                    break;
                }
            }
            
            const cleanBSRNumber = (rawText) => {
                if (!rawText) return null;
                let match = rawText.replace(/[,.]/g, '').match(/\d+/);
                return match ? parseInt(match[0]) : null;
            };

            let parsedBsrs = [];
            if (bsrElements.length > 0) {
                bsrElements.forEach(item => {
                    const val = cleanBSRNumber(item.textContent);
                    if (val) parsedBsrs.push(val);
                });
            } else {
                const salesRankElement = container.querySelector("#SalesRank");
                if (salesRankElement) {
                    const val = cleanBSRNumber(salesRankElement.textContent);
                    if (val) parsedBsrs.push(val);
                } else {
                    const salesRankValueElement = container.querySelector("#SalesRank .value");
                    if (salesRankValueElement) {
                        const val = cleanBSRNumber(salesRankValueElement.textContent);
                        if (val) parsedBsrs.push(val);
                    }
                }
            }
            
            if (parsedBsrs.length > 1) {
                bsr = parsedBsrs[1]; 
            } else if (parsedBsrs.length === 1) {
                bsr = parsedBsrs[0];
            }
        } catch(e) {}

        return { isPrime, rating, feedback, deliveryTime, price, stock, hasStockWarning, brand, title, bsr };
    }

    function applyFilters(productInfo, filters) {
        try {
            const { rating, feedback, maxFeedback, shipping, minPrice, maxPrice, stock: stockFilter, bannedWords } = filters;

            // KRİTİK: "Max Price" boşken eskiden storage'a Infinity yazılıyordu; chrome.storage
            // JSON serileştirmesi Infinity'yi null'a çeviriyor ve "price > null" her fiyatlı
            // ürünü eliyordu (yalnızca fiyatı okunamayan ürünler geçiyordu). Bu yüzden aramalar
            // neredeyse hiç ASIN döndürmüyordu. null/undefined/0/"" artık "üst sınır yok" demek.
            const noMaxPrice = maxPrice === null || maxPrice === undefined || maxPrice === '' || Number(maxPrice) === 0;
            const effectiveMaxPrice = noMaxPrice ? Infinity : Number(maxPrice);
            const effectiveMinPrice = Number(minPrice) || 0;

            if (rating && productInfo.rating !== null && productInfo.rating < rating) return false;
            if (productInfo.feedback < feedback) return false;
            if (maxFeedback && productInfo.feedback > maxFeedback) return false;
            if (shipping === "prime" && !productInfo.isPrime) return false;
            if (shipping === "1-day" && productInfo.deliveryTime !== 1) return false;
            if (shipping === "2-day" && productInfo.deliveryTime > 2) return false;
            if (productInfo.price !== null && (productInfo.price < effectiveMinPrice || productInfo.price > effectiveMaxPrice)) return false;
            if (stockFilter === "exclude_warning" && productInfo.hasStockWarning) return false;
            if (stockFilter !== "ignore" && stockFilter !== "exclude_warning" && productInfo.stock < stockFilter) return false;

            if (bannedWords) {
                let bannedWordsArray = [];
                if (typeof bannedWords === 'string') {
                    bannedWordsArray = bannedWords.split(',').map(word => word.trim().toLowerCase());
                } else if (Array.isArray(bannedWords)) {
                    bannedWordsArray = bannedWords.map(w => w.toLowerCase());
                }
                const combinedText = `${productInfo.brand || ''} ${productInfo.title || ''}`.toLowerCase();
                for (const word of bannedWordsArray) {
                    if (word && combinedText.includes(word)) {
                        return false;
                    }
                }
            }

            const symbols = ['©', '™', '®'];
            const wordsInTitle = (productInfo.title || '').split(/\s+/);
            for (const word of wordsInTitle) {
                for (const symbol of symbols) {
                    if (word.includes(symbol)) {
                        return false;
                    }
                }
            }

            return true;
        } catch (e) {
            console.error("Filter calculation error:", e);
            return true; 
        }
    }

    function sortAndSelectItems(items, count, sortOrder) {
        if (sortOrder === "priceLowToHigh") {
            items.sort((a, b) => {
                if (a.price === null) return 1;
                if (b.price === null) return -1;
                return a.price - b.price;
            });
        } else if (sortOrder === "priceHighToLow") {
            items.sort((a, b) => {
                if (a.price === null) return 1;
                if (b.price === null) return -1;
                return b.price - a.price;
            });
        } else if (sortOrder === "feedbackLowToHigh") {
            items.sort((a, b) => (a.feedback || 0) - (b.feedback || 0));
        } else if (sortOrder === "feedbackHighToLow") {
            items.sort((a, b) => (b.feedback || 0) - (a.feedback || 0));
        } else if (sortOrder === "bsrLowToHigh") {
            items.sort((a, b) => {
                let bsrA = a.bsr === Infinity || a.bsr === null ? Infinity : a.bsr;
                let bsrB = b.bsr === Infinity || b.bsr === null ? Infinity : b.bsr;
                return bsrA - bsrB;
            });
        } else if (sortOrder === "random") {
            items.sort(() => Math.random() - 0.5);
        }
        
        count = parseInt(count) || items.length;
        return items.slice(0, count).map(item => item.asin);
    }

    async function createAsinBox(asin, title, container) {
        log('createAsinBox called for ASIN:', asin, 'with title:', title);

        await new Promise(resolve => {
            chrome.storage.local.get([
                "toggleAsinBox", "toggleStock", "togglePrime", "toggleRating",
                "toggleBannedWarning", "toggleCopyIcon", "toggleSaveIcon", 
                "toggleEbayIcon", "toggleFilterMatch", "toggleLogs", "bsrDisplayMode"
            ], (data) => {
                for (let key in data) {
                    if (data[key] !== undefined) {
                        features[key] = data[key];
                    }
                }
                resolve();
            });
        });

        if (features.toggleAsinBox === false) {
            return null;
        }

        let isBlacklisted = false;
        try {
            isBlacklisted = await checkIfAsinBlacklisted(asin);
        } catch(e) {}

        let matchesFilters = false;
        let filters = {};
        await new Promise(resolve => {
            chrome.storage.local.get([
                "rating", "feedback", "maxFeedback", "shipping", 
                "minPrice", "maxPrice", "stock", "bannedWords"
            ], (data) => {
                filters = {
                    rating: parseFloat(data.rating) || 0,
                    feedback: parseInt(data.feedback) || 0,
                    maxFeedback: parseInt(data.maxFeedback) || Infinity,
                    shipping: data.shipping || "all",
                    minPrice: parseFloat(data.minPrice) || 0,
                    maxPrice: parseFloat(data.maxPrice) || Infinity,
                    stock: data.stock === "ignore" ? "ignore" : 
                           data.stock === "exclude_warning" ? "exclude_warning" : 
                           parseInt(data.stock) || Infinity,
                    bannedWords: data.bannedWords || ""
                };
                try {
                    const productInfo = getProductInfo(container);
                    matchesFilters = applyFilters(productInfo, filters);
                } catch(e) {}
                resolve();
            });
        });

        const asinBox = document.createElement('div');
        asinBox.className = 'custom-asin-box';

        if (features.toggleEbayIcon) {
            const searchIcon = document.createElement('img');
            searchIcon.src = chrome.runtime.getURL('images/ebay-search-icon.png');
            Object.assign(searchIcon.style, {
                width: '65px', height: '29px', cursor: 'pointer', marginBottom: '1px'
            });
            searchIcon.addEventListener('click', () => {
                const shortTitle = title.slice(0, 80);
                const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(shortTitle)}`;
                window.open(url, '_blank');
            });
            asinBox.appendChild(searchIcon);
        }

        const productInfo = getProductInfo(container);
        const isPrime = productInfo ? productInfo.isPrime : false;
        
        const asinRow = document.createElement('div');
        asinRow.style.display = 'flex';
        asinRow.style.alignItems = 'center';
        asinRow.style.marginBottom = '4px';

        const asinText = document.createElement('span');
        const asinSpan = document.createElement('span');
        asinSpan.textContent = asin;
        if (isBlacklisted) {
            asinSpan.className = 'blacklisted-asin';
        }
        asinText.appendChild(document.createTextNode('ASIN: '));
        asinText.appendChild(asinSpan);
        asinText.style.marginRight = '5px';
        asinRow.appendChild(asinText);

        if (features.toggleCopyIcon) {
            const copyIcon = document.createElement('img');
            const copySrc = chrome.runtime.getURL('images/copy-icon.png');
            const tickSrc = chrome.runtime.getURL('images/tick-icon.png');
            copyIcon.src = copySrc;
            Object.assign(copyIcon.style, {
                width: '16px', height: '16px', cursor: 'pointer', verticalAlign: 'middle', marginRight: '5px'
            });
            copyIcon.addEventListener('click', () => {
                navigator.clipboard.writeText(asin).then(() => {
                    copyIcon.src = tickSrc;
                    setTimeout(() => { copyIcon.src = copySrc; }, 1000);
                }).catch(err => {});
            });
            asinRow.appendChild(copyIcon);
        }

        if (features.toggleSaveIcon) {
            const saveIcon = document.createElement('img');
            const saveSrc = chrome.runtime.getURL('images/save-icon.png');
            const disabledSrc = saveSrc;
            const tickSrc = chrome.runtime.getURL('images/tick-icon.png');
            let isSaved = false;
            try { isSaved = await checkIfAsinSaved(asin); } catch(e) {}

            saveIcon.src = isSaved ? disabledSrc : saveSrc;
            Object.assign(saveIcon.style, {
                width: '16px',
                height: '16px',
                verticalAlign: 'middle',
                opacity: isSaved ? '0.4' : '1',
                pointerEvents: isSaved ? 'none' : 'auto',
                cursor: isSaved ? 'default' : 'pointer'
            });

            if (!isSaved) {
                saveIcon.addEventListener('click', () => {
                    const productData = { asin, title, stock: stockCache[asin]?.stock || 'N/A' };
                    chrome.runtime.sendMessage({ action: 'saveToMemory', product: productData }, (res) => {
                        if (res && res.success) {
                            saveIcon.src = tickSrc;
                            setTimeout(() => {
                                saveIcon.src = disabledSrc;
                                saveIcon.style.opacity = '0.4';
                                saveIcon.style.pointerEvents = 'none';
                                saveIcon.style.cursor = 'default';
                            }, 1000);
                        }
                    });
                });
            }
            asinRow.appendChild(saveIcon);
        }

        asinBox.appendChild(asinRow);

        const statusRow = document.createElement('div');
        statusRow.style.display = 'flex';
        statusRow.style.alignItems = 'center';
        statusRow.style.marginBottom = '4px';

        if (features.togglePrime) {
            const primeStatusText = document.createElement('span');
            primeStatusText.textContent = isPrime ? 'Prime' : 'No Prime';
            primeStatusText.style.color = isPrime ? '#00A8E1' : '#ff0000';
            primeStatusText.style.fontSize = '13px';
            primeStatusText.style.fontWeight = 'bold';
            statusRow.appendChild(primeStatusText);
        }

        const separator1 = document.createElement('span');
        separator1.className = 'separator';
        separator1.textContent = ' / ';
        separator1.style.margin = '0 5px';
        separator1.style.color = '#ccc';
        statusRow.appendChild(separator1);

        const buyBoxText = document.createElement('span');
        buyBoxText.className = 'buybox-text';
        buyBoxText.style.fontSize = '12px';
        buyBoxText.style.fontWeight = 'bold';
        statusRow.appendChild(buyBoxText);
        
        const separator2 = document.createElement('span');
        separator2.className = 'separator-2';
        separator2.textContent = ' / ';
        separator2.style.margin = '0 5px';
        separator2.style.color = '#ccc';
        separator2.style.display = 'none';
        statusRow.appendChild(separator2);
        
        const sellersLink = document.createElement('a');
        sellersLink.className = 'sellers-link';
        
        const fbaText = document.createElement('span');
        fbaText.className = 'fba-text';
        fbaText.style.fontSize = '12px';
        fbaText.style.color = '#0066c0';
        fbaText.style.fontWeight = 'bold';
        sellersLink.appendChild(fbaText);

        const fbmText = document.createElement('span');
        fbmText.className = 'fbm-text';
        fbmText.style.fontSize = '12px';
        fbmText.style.color = '#E47911';
        fbmText.style.fontWeight = 'bold';
        sellersLink.appendChild(fbmText);

        statusRow.appendChild(sellersLink);

        asinBox.appendChild(statusRow);

        const bsrText = document.createElement('span');
        bsrText.className = 'bsr-text';
        bsrText.textContent = 'Loading...';
        bsrText.style.fontSize = '12px';
        bsrText.style.color = '#333';
        bsrText.style.marginBottom = '4px';
        bsrText.style.display = 'block';
        asinBox.appendChild(bsrText);

        if (features.toggleStock) {
            const stockContainer = document.createElement('div');
            stockContainer.style.fontSize = '12px';
            stockContainer.style.marginBottom = '4px';

            const stockLabel = document.createElement('span');
            stockLabel.textContent = 'Quantity: ';
            stockLabel.style.fontWeight = 'bold';
            stockLabel.style.color = 'black';

            const stockValue = document.createElement('span');
            stockValue.className = 'stock-value';
            stockValue.textContent = 'Loading...';
            stockValue.style.fontWeight = '500';
            stockValue.style.color = '#333';

            stockContainer.appendChild(stockLabel);
            stockContainer.appendChild(stockValue);
            asinBox.appendChild(stockContainer);
        }

        const brandText = document.createElement('div');
        brandText.className = 'brand-text';
        brandText.style.fontSize = '12px';
        brandText.style.display = 'block';
        brandText.style.marginBottom = '4px';
        
        const brandLabel = document.createElement('span');
        brandLabel.textContent = 'Brand: ';
        brandLabel.style.fontWeight = 'bold';
        brandLabel.style.color = 'black';

        const brandValue = document.createElement('span');
        brandValue.className = 'brand-value';
        brandValue.textContent = 'Loading...';
        brandValue.style.fontWeight = '500';
        brandValue.style.color = '#333';

        brandText.appendChild(brandLabel);
        brandText.appendChild(brandValue);
        asinBox.appendChild(brandText);

        const powered = document.createElement('span');
        powered.textContent = 'Powered by IndyGrab';
        Object.assign(powered.style, {
            fontSize: '10px',
            color: '#888',
            marginTop: '5px',
            alignSelf: 'flex-end'
        });
        asinBox.appendChild(powered);

        let matchedBannedWords = [];
        if (features.toggleBannedWarning) {
            await new Promise(resolve => {
                chrome.storage.local.get("bannedWords", (data) => {
                    try {
                        let bannedWords = [];
                        if (Array.isArray(data.bannedWords)) {
                            bannedWords = data.bannedWords.map(w => w.toLowerCase());
                        } else if (typeof data.bannedWords === 'string') {
                            bannedWords = data.bannedWords.split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
                        }
                        
                        if (bannedWords.length > 0) {
                            const combinedText = `${productInfo?.title || ''} ${productInfo?.brand || ''}`.toLowerCase();
                            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            matchedBannedWords = bannedWords.filter(word => {
                                if (!word) return false;
                                const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`);
                                return regex.test(combinedText);
                            });
                        }
                    } catch(e) {}
                    resolve();
                });
            });

            if (matchedBannedWords.length > 0) {
                const warningIcon = document.createElement('span');
                warningIcon.className = 'banned-word-icon';
                warningIcon.textContent = '!';
                
                const tooltipText = `Banned Word (${matchedBannedWords.join(', ')})`;
                warningIcon.setAttribute('data-tooltip', tooltipText);

                Object.assign(warningIcon.style, {
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '16px',
                    height: '16px',
                    backgroundColor: '#ff4444',
                    color: '#fff',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'default',
                    zIndex: '10',
                    padding: '2px'
                });
                asinBox.appendChild(warningIcon);
            }
        }
        
        if (features.toggleFilterMatch) {
            const filterIcon = document.createElement('img');
            filterIcon.src = chrome.runtime.getURL(matchesFilters ? 'images/filter-check.png' : 'images/filter-cross.png');
            Object.assign(filterIcon.style, {
                width: '16px',
                height: '16px',
                verticalAlign: 'middle',
                position: 'absolute',
                top: '2px',
                right: matchedBannedWords.length > 0 ? '22px' : '2px',
                zIndex: '10',
                cursor: 'default'
            });
            filterIcon.title = matchesFilters ? 'Matches Filters' : 'Does Not Match Filters';
            asinBox.appendChild(filterIcon);
        }

        Object.assign(asinBox.style, {
            border: '1px solid #ddd',
            padding: '10px',
            marginTop: '15px',
            marginBottom: '15px',
            backgroundColor: '#f9f9f9',
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: '1',
            position: 'relative',
            overflow: 'visible',
            minHeight: '50px'
        });

        return asinBox;
    }

    async function addAsinBoxToProductPage() {
        if (document.body.getAttribute('data-asin-box-initialized') === 'true') {
            return;
        }
        document.body.setAttribute('data-asin-box-initialized', 'true');

        let currentAsin = null;

        const updateBox = async () => {
            const asin = detectAsin();
            if (!asin || asin === currentAsin) {
                return;
            }

            currentAsin = asin;
            document.querySelectorAll('.custom-asin-box').forEach(box => box.remove());

            const titleSelectors = ['#productTitle', '[data-csa-c-slot-id="title"]', '.a-size-large.product-title-word-break', '#title', 'h1'];
            let titleElement = null;
            for (const selector of titleSelectors) {
                titleElement = document.querySelector(selector);
                if (titleElement) break;
            }
            const title = titleElement?.textContent.trim() || 'no-title';

            let asinBox;
            try {
                asinBox = await createAsinBox(asin, title, document);
            } catch(e) {
                console.error("Error creating ASIN box:", e);
                return;
            }
            
            if (!asinBox) {
                return;
            }

            const targetContainerSelectors = ['#titleSection', '#centerCol', '#title_feature_div', '#productTitleGroupAnchor', '#titleBlock', '#dp-container', '#product-details-grid_feature_div', '#productOverview_feature_div', '#detailBullets_feature_div', '#feature-bullets'];
            let targetContainer = null;
            for (const selector of targetContainerSelectors) {
                targetContainer = document.querySelector(selector);
                if (targetContainer) break;
            }

            if (targetContainer) {
                const titleElementInContainer = targetContainer.querySelector(titleSelectors.join(', '));
                if (titleElementInContainer && titleElementInContainer.parentElement) {
                    titleElementInContainer.parentElement.insertAdjacentElement('afterend', asinBox);
                } else {
                    targetContainer.appendChild(asinBox);
                }
            } else {
                document.body.appendChild(asinBox);
            }

            const details = await fetchProductDetails(asin);
            
            const buyBoxText = asinBox.querySelector('.buybox-text');
            if (buyBoxText) {
                buyBoxText.textContent = details.buyBox ? 'BuyBox' : 'No BuyBox';
                buyBoxText.style.color = details.buyBox ? '#0066c0' : '#00a000';
            }

            const fbaText = asinBox.querySelector('.fba-text');
            const fbmText = asinBox.querySelector('.fbm-text');
            const separator2 = asinBox.querySelector('.separator-2');
            
            const plus = details.moreSellersPossible ? '+' : '';
            const fbaContent = details.fbaCount > 0 ? `FBA${details.fbaCount}${plus}` : '';
            const fbmContent = details.fbmCount > 0 ? `FBM${details.fbmCount}${plus}` : '';

            if (fbaText) fbaText.textContent = fbaContent;
            if (fbmText) fbmText.textContent = fbmContent;
            if (fbmText && fbaContent && fbmContent) fbmText.style.marginLeft = '5px';
            if (separator2 && (fbaContent || fbmContent)) separator2.style.display = 'inline';
            
            const sellersLink = asinBox.querySelector('.sellers-link');
            if (sellersLink) {
                sellersLink.href = `https://${window.location.hostname}/gp/offer-listing/${asin}`;
                sellersLink.target = '_blank';
                sellersLink.style.color = 'inherit';
            }

            const stockValue = asinBox.querySelector('.stock-value');
            if (stockValue) stockValue.textContent = details.stock;
            
            const brandValue = asinBox.querySelector('.brand-value');
            if (brandValue) brandValue.textContent = details.brand || 'N/A';

            const bsrText = asinBox.querySelector('.bsr-text');
            if (bsrText) {
                if (details.bsr.length > 0) {
                    let defaultBsrIndex = 0;
                    if (features.bsrDisplayMode === 'deep' && details.bsr.length > 1) {
                        defaultBsrIndex = 1;
                    }
                    let currentBsrIndex = defaultBsrIndex;
                    bsrText.textContent = details.bsr[currentBsrIndex];
                    if (details.bsr.length > 1) {
                        bsrText.style.cursor = 'pointer';
                        bsrText.title = 'Click to see other categories';
                        bsrText.addEventListener('click', () => {
                            currentBsrIndex = (currentBsrIndex + 1) % details.bsr.length;
                            bsrText.textContent = details.bsr[currentBsrIndex];
                        });
                    }
                } else {
                    bsrText.textContent = 'N/A';
                }
            }
        };

        updateBox();

        const variationObserver = new MutationObserver(() => {
            const newAsin = detectAsin();
            if (newAsin && newAsin !== currentAsin) {
                updateBox();
            }
        });
        const variationTarget = document.getElementById('variation_color_name') || document.getElementById('twister-plus-mobile-container') || document.body;
        variationObserver.observe(variationTarget, { childList: true, subtree: true, attributes: true });
    }

    async function addAsinInfo(containers) {
        const promises = [];
        for (const container of Array.from(containers)) {
            if (container.getAttribute('data-indygrab-injected') === 'true' || container.querySelector('.custom-asin-box')) {
                continue;
            }

            let asin = container.getAttribute('data-asin');
            if (!asin) {
                const asinElement = container.querySelector('a[href*="/dp/"]');
                asin = asinElement?.href.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
            }
            
            if (!asin) continue;
            
            container.setAttribute('data-indygrab-injected', 'true');

            const title = container.querySelector('h2')?.textContent.trim() || 'no-title';
            let asinBox;
            try {
                asinBox = await createAsinBox(asin, title, container);
            } catch(e) {
                continue;
            }
            if (!asinBox) continue;
            
            const titleRecipe = container.querySelector('[data-cy="title-recipe"]');
            if (titleRecipe) {
                titleRecipe.insertAdjacentElement('afterend', asinBox);
            } else {
                const titleElement = container.querySelector('h2');
                if (titleElement && titleElement.closest('.a-section')) {
                    titleElement.closest('.a-section').insertAdjacentElement('afterend', asinBox);
                } else if (titleElement && titleElement.parentElement) {
                    titleElement.parentElement.insertAdjacentElement('afterend', asinBox);
                } else {
                    const targetContainer = container.querySelector('.s-card-container') || container.querySelector('.a-section') || container;
                    targetContainer.appendChild(asinBox);
                }
            }

            promises.push(fetchProductDetails(asin).then(details => {
                const buyBoxText = asinBox.querySelector('.buybox-text');
                if (buyBoxText) {
                    buyBoxText.textContent = details.buyBox ? 'BuyBox' : 'No BuyBox';
                    buyBoxText.style.color = details.buyBox ? '#0066c0' : '#00a000';
                }
                
                const fbaText = asinBox.querySelector('.fba-text');
                const fbmText = asinBox.querySelector('.fbm-text');
                const separator2 = asinBox.querySelector('.separator-2');
                
                const plus = details.moreSellersPossible ? '+' : '';
                const fbaContent = details.fbaCount > 0 ? `FBA${details.fbaCount}${plus}` : '';
                const fbmContent = details.fbmCount > 0 ? `FBM${details.fbmCount}${plus}` : '';

                if(fbaText) fbaText.textContent = fbaContent;
                if(fbmText) fbmText.textContent = fbmContent;
                if(fbmText && fbaContent && fbmContent) fbmText.style.marginLeft = '5px';
                if(separator2 && (fbaContent || fbmContent)) separator2.style.display = 'inline';
                
                const sellersLink = asinBox.querySelector('.sellers-link');
                if (sellersLink) {
                    sellersLink.href = `https://${window.location.hostname}/gp/offer-listing/${asin}`;
                    sellersLink.target = '_blank';
                    sellersLink.style.color = 'inherit';
                }

                const stockValue = asinBox.querySelector('.stock-value');
                if (stockValue) stockValue.textContent = details.stock;
                
                const brandValue = asinBox.querySelector('.brand-value');
                if(brandValue) brandValue.textContent = details.brand || 'N/A';

                const bsrText = asinBox.querySelector('.bsr-text');
                if (bsrText) {
                    if (details.bsr.length > 0) {
                        let defaultBsrIndex = 0;
                        if (features.bsrDisplayMode === 'deep' && details.bsr.length > 1) {
                            defaultBsrIndex = 1;
                        }
                        let currentBsrIndex = defaultBsrIndex;
                        bsrText.textContent = details.bsr[currentBsrIndex];
                        if (details.bsr.length > 1) {
                            bsrText.style.cursor = 'pointer';
                            bsrText.title = 'Click to see other categories';
                            bsrText.addEventListener('click', () => {
                                currentBsrIndex = (currentBsrIndex + 1) % details.bsr.length;
                                bsrText.textContent = details.bsr[currentBsrIndex];
                            });
                        }
                    } else {
                        bsrText.textContent = 'N/A';
                    }
                }
            }));
        }
        await Promise.all(promises);
    }

    const style = document.createElement('style');
    style.textContent = `
        .custom-asin-box { 
            transition: all 0.3s ease; 
            position: relative;
            min-height: 50px;
        }
        .custom-asin-box:hover { background-color: #f0f0f0; }
        .banned-word-icon {
            position: absolute;
            top: 2px;
            right: 2px;
            width: 16px;
            height: 16px;
            background-color: #ff4444;
            color: #fff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            cursor: default;
            z-index: 10;
            padding: 2px;
        }
        .banned-word-icon:hover::after {
            content: attr(data-tooltip);
            position: absolute;
            top: 20px;
            right: 0;
            background-color: #333;
            color: #fff;
            padding: 2px 5px;
            border-radius: 3px;
            font-size: 10px;
            white-space: nowrap;
            z-index: 11;
        }
        .blacklisted-asin {
            text-decoration: line-through;
        }
        .bsr-text[style*="cursor: pointer"]:hover {
            text-decoration: underline;
        }
        .sellers-link:hover {
            text-decoration: underline;
            color: inherit;
        }
    `;
    document.head.appendChild(style);

    function initialize() {
        processedAsins.clear();
        document.body.removeAttribute('data-asin-box-initialized');
        document.querySelectorAll('.custom-asin-box').forEach(box => box.remove());
        document.querySelectorAll('[data-indygrab-injected]').forEach(el => el.removeAttribute('data-indygrab-injected'));

        const searchContainers = document.querySelectorAll('div[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]:not([data-asin=""])');
        
        if (searchContainers.length > 0) {
            addAsinInfo(searchContainers);
            observeForNewSearchResults();
        } else if (window.location.href.includes('/dp/')) {
            const productContainer = document.querySelector('#dp-container, #titleSection');
            if (productContainer) {
                addAsinBoxToProductPage();
            } else {
                const productPageObserver = new MutationObserver((mutations, observer) => {
                    const productContainer = document.querySelector('#dp-container, #titleSection');
                    if (productContainer) {
                        addAsinBoxToProductPage();
                        observer.disconnect();
                    }
                });
                productPageObserver.observe(document.body, { childList: true, subtree: true });
            }
        }
    }

    let searchObserver;
    function observeForNewSearchResults() {
        if (searchObserver) searchObserver.disconnect();
        
        searchObserver = new MutationObserver((mutations) => {
            const newContainers = new Set();
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.matches('div[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]:not([data-asin=""])')) {
                                newContainers.add(node);
                            }
                            node.querySelectorAll('div[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]:not([data-asin=""])').forEach(item => newContainers.add(item));
                        }
                    }
                }
            }
            if (newContainers.size > 0) {
                addAsinInfo(Array.from(newContainers));
            }
        });
        
        const targetNode = document.getElementById('search') || document.body;
        searchObserver.observe(targetNode, { childList: true, subtree: true });
    }

    function handleNavigation() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            setTimeout(initialize, 500);
        }
    }

    async function extractASINs(isAutoSaveMode = false) {
        if (hasFetched && !isAutoSaveMode) return;
        if (isExtracting) return;
        isExtracting = true;

        try {
            const pageUrl = window.location.href;

            const data = await new Promise(resolve => chrome.storage.local.get([
                'collectedPages', 'autoCollectActive', 'autoPageLimit', 
                'autoAsinLimit', 'memoryAsins', 'blacklistAsins', 'autoCollectTabId'
            ], resolve));

            let collectedPages = data.collectedPages || {};
            let autoCollectActive = await autoCollectOwnedHere(data);
            let autoPageLimit = data.autoPageLimit || Infinity;
            let autoAsinLimit = data.autoAsinLimit || Infinity;
            let memoryAsins = data.memoryAsins || [];
            let blacklistAsins = data.blacklistAsins || [];

            if (collectedPages[pageUrl] && !isAutoSaveMode) {
                hasFetched = true;
                if (autoCollectActive) navigateToNextPage();
                return;
            }

            const filters = await new Promise(resolve => chrome.storage.local.get([
                "rating", "feedback", "maxFeedback", "shipping", "asinCount", 
                "minPrice", "maxPrice", "maxBsr", "stock", "sort", "bannedWords"
            ], resolve));

            let collectedASINs = new Set();
            let availableItems = [];
            
            let requiresBsrFetch = (filters.maxBsr && filters.maxBsr > 0) || filters.sort === "bsrLowToHigh";

            if (requiresBsrFetch && isSearchPage()) {
                chrome.runtime.sendMessage({ notification: "fetching_bsr" });
            }

            if (isSearchPage()) {
                let items = document.querySelectorAll('div[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]:not([data-asin=""])');

                if (!items.length) {
                    if(isAutoSaveMode) {
                        // 0 sonuç mu, yoksa bot koruması mı? Blok ise ürün yakılmasın.
                        if (isAmazonBlockPage()) {
                            chrome.runtime.sendMessage({ action: 'autoFetchBlocked' });
                        } else {
                            closeAutoTab();
                        }
                    } else {
                        hasFetched = true;
                        await new Promise(resolve => chrome.storage.local.set({ asinList: [] }, resolve));
                        chrome.runtime.sendMessage({ asinList: [] });
                        if (autoCollectActive) navigateToNextPage();
                    }
                    return;
                }

                items.forEach((item) => {
                    let productId = item.getAttribute('data-asin');
                    if (!productId || productId.length !== 10 || collectedASINs.has(productId) || blacklistAsins.includes(productId)) return;
                    
                    let productInfo = getProductInfo(item);
                    if (!productInfo) return;

                    let tempFilters = { ...filters };
                    delete tempFilters.maxBsr;

                    if (applyFilters(productInfo, tempFilters)) {
                        collectedASINs.add(productId);
                        const resultImage = item.querySelector('img.s-image');
                        availableItems.push({ 
                            asin: productId, 
                            price: productInfo.price, 
                            feedback: productInfo.feedback,
                            title: productInfo.title,
                            bsr: productInfo.bsr,
                            imageUrl: resultImage ? resultImage.src : ''
                        });
                    }
                });
            }

            if (isProductPage()) {
                let productId = document.querySelector('#ASIN')?.value ||
                               document.querySelector('[name=ASIN]')?.value;
                if (productId && productId.length === 10 && !collectedASINs.has(productId) && !blacklistAsins.includes(productId)) {
                    
                    collectedASINs.add(productId);
                    let productInfo = getProductInfo(document.body);
                    
                    let tempFilters = { ...filters };
                    delete tempFilters.maxBsr;

                    if (productInfo && applyFilters(productInfo, tempFilters)) {
                        availableItems.push({ 
                            asin: productId, 
                            price: productInfo.price, 
                            feedback: productInfo.feedback,
                            title: productInfo.title,
                            bsr: productInfo.bsr
                        });
                    }
                }
            }

            // Ö4: on an eBay → Amazon fetch keep only results the AI confirms as the same product.
            // Runs before BSR lookups so rejected results cost no product-page requests.
            // Without a decision (quota, network, no key, unknown product) nothing is saved and the
            // product stays unfetched. Only verification turned off or the user's approval to go on
            // without the AI keeps the filter result.
            if (isAutoSaveMode && availableItems.length > 0) {
                const verdict = await new Promise(resolve => {
                    try {
                        chrome.runtime.sendMessage({
                            action: 'verifyAmazonMatch',
                            candidates: availableItems.map(({ asin, title, imageUrl }) => ({ asin, title, imageUrl }))
                        }, response => resolve(chrome.runtime.lastError ? null : response));
                    } catch (e) {
                        resolve(null);
                    }
                });
                if (!verdict || verdict.blocked) {
                    closeAutoTab(true);
                    return;
                }
                if (Array.isArray(verdict.matches)) {
                    const confirmed = new Set(verdict.matches);
                    availableItems = availableItems.filter(item => confirmed.has(item.asin));
                }
            }

            if (availableItems.length > 0 && requiresBsrFetch) {
                const bsrPromises = availableItems.map(async (item) => {
                    try {
                        const details = await fetchProductDetails(item.asin);
                        if (details.bsr && details.bsr.length > 0) {
                            let deepBsrString = details.bsr.length > 1 ? details.bsr[1] : details.bsr[0];
                            let match = deepBsrString.replace(/[,.]/g, '').match(/\d+/);
                            if (match) {
                                item.bsr = parseInt(match[0]);
                            }
                        }
                    } catch (e) {
                        console.error("BSR fetch error for", item.asin, e);
                    }
                });
                
                await Promise.all(bsrPromises);

                if (filters.maxBsr && filters.maxBsr > 0) {
                    availableItems = availableItems.filter(item => item.bsr !== null && item.bsr !== Infinity && item.bsr <= filters.maxBsr);
                }
            }
            
            let asinCount = filters.asinCount || 5;
            let asinList = sortAndSelectItems(availableItems, asinCount, filters.sort);

            if (isAutoSaveMode) {
                if (asinList.length > 0) {
                    const memData = await new Promise(resolve => chrome.storage.local.get("memoryAsins", resolve));
                    let currentMemory = memData.memoryAsins || [];
                    let combinedAsins = [...currentMemory, ...asinList];
                    let uniqueAsins = [...new Set(combinedAsins)];
                    let wasLimited = false;

                    if (uniqueAsins.length > 20000) {
                        uniqueAsins = uniqueAsins.slice(0, 20000);
                        wasLimited = true;
                    }

                    await new Promise(resolve => chrome.storage.local.set({ memoryAsins: uniqueAsins }, resolve));
                    if (wasLimited) {
                        chrome.runtime.sendMessage({ notification: "memory_limit_exceeded" });
                    } else {
                        chrome.runtime.sendMessage({ notification: "ebay_asins_saved", count: asinList.length });
                    }
                    closeAutoTab();
                } else {
                    closeAutoTab();
                }
            } 
            else {
                if (!availableItems.length) {
                    hasFetched = true;
                    await new Promise(resolve => chrome.storage.local.set({ asinList: [] }, resolve));
                    chrome.runtime.sendMessage({ asinList: [] });
                    if (autoCollectActive) navigateToNextPage();
                    return;
                }

                if (autoCollectActive && asinList.length > 0) {
                    let combinedAsins = [...memoryAsins, ...asinList];
                    let uniqueAsins = [...new Set(combinedAsins)];

                    if (uniqueAsins.length > 20000) {
                        uniqueAsins = uniqueAsins.slice(0, 20000);
                        chrome.runtime.sendMessage({ notification: "memory_limit_exceeded" });
                    } else {
                        chrome.runtime.sendMessage({ notification: "saved_to_memory" });
                    }

                    await new Promise(resolve => chrome.storage.local.set({ memoryAsins: uniqueAsins }, resolve));
                    totalAsinsCollected = uniqueAsins.length;
                    if (totalAsinsCollected >= autoAsinLimit) {
                        stopAutoCollect("auto_collect_asin_limit");
                        return;
                    }
                }

                await new Promise(resolve => chrome.storage.local.set({ asinList: asinList }, resolve));
                chrome.runtime.sendMessage({ asinList: asinList });
                
                collectedPages[pageUrl] = true;
                await new Promise(resolve => chrome.storage.local.set({ collectedPages: collectedPages }, resolve));
                
                if (autoCollectActive) {
                    if (totalAsinsCollected >= autoAsinLimit) {
                        stopAutoCollect("auto_collect_asin_limit");
                        return;
                    }
                    navigateToNextPage();
                }

                hasFetched = true;
            }

        } catch (e) {
            log('Error extracting ASINs', e);
        } finally {
            isExtracting = false;
            // Kritik: otomatik çekim sekmesi hata durumunda da kapanmalı. Aksi halde
            // sekme açık kalıyor, eşzamanlılık dolunca arka plan kuyruğu kalıcı tıkanıyordu.
            if (isAutoSaveMode) closeAutoTab();
        }
    }

    function navigateToNextPage() {
        chrome.storage.local.get(['autoPageLimit', 'autoCollectActive', 'autoCollectTabId', 'visitedPages'], async (data) => {
            let autoPageLimit = data.autoPageLimit || Infinity;
            let autoCollectActive = await autoCollectOwnedHere(data);
            if (!autoCollectActive) return;
            let visitedPages = data.visitedPages || [];

            const currentUrl = window.location.href;
            if (!visitedPages.includes(currentUrl)) {
                visitedPages.push(currentUrl);
            }

            if (autoCollectActive && visitedPages.length >= autoPageLimit) {
                chrome.storage.local.set({ visitedPages: [] }, () => {
                    stopAutoCollect("auto_collect_page_limit");
                });
                return;
            }

            const nextPageLink = document.querySelector("a.s-pagination-next, .s-pagination-item.s-pagination-next, a[aria-label*='Next page']");
            if (nextPageLink && !nextPageLink.classList.contains('s-pagination-disabled')) {
                chrome.storage.local.set({ visitedPages: visitedPages }, () => {
                    window.location.href = nextPageLink.href;
                });
            } else {
                chrome.storage.local.set({ visitedPages: [] }, () => {
                    stopAutoCollect("auto_collect_page_limit");
                });
            }
        });
    }

    function stopAutoCollect(reason) {
        chrome.storage.local.set({ autoCollectActive: false, autoCollectTabId: null, visitedPages: [] }, () => {
            clearInterval(autoCollectInterval);
            autoCollectInterval = null;
            totalAsinsCollected = 0;
            hasFetched = false;
            chrome.runtime.sendMessage({ autoCollectStopped: true, reason });
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const isAutoSaveMode = urlParams.get('indygrab_auto_collect') === 'true';

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.requestASINs) {
            hasFetched = false;
            extractASINs();
        }
        if (message.startAutoCollect) {
            chrome.storage.local.set({ autoCollectActive: true, autoCollectTabId: currentTabId, visitedPages: [] }, () => {
                hasFetched = false;
                totalAsinsCollected = 0;
                extractASINs();
                if (!autoCollectInterval) {
                    autoCollectInterval = setInterval(() => {
                        if (!isSearchPage()) {
                            stopAutoCollect("auto_collect_page_limit");
                            return;
                        }
                        if (!isExtracting) { 
                            hasFetched = false;
                            extractASINs();
                        }
                    }, 5000);
                }
            });
        }
        if (message.stopAutoCollect) {
            stopAutoCollect("auto_collect_stopped");
        }
        if (message.refreshASINs || message.updateFeatures) {
            if (message.refreshASINs) {
                hasFetched = false;
                chrome.storage.local.get(['collectedPages', 'visitedPages'], (data) => {
                    let collectedPages = data.collectedPages || {};
                    let visitedPages = data.visitedPages || [];
                    collectedPages[window.location.href] = false;
                    visitedPages = visitedPages.filter(url => url !== window.location.href);
                    chrome.storage.local.set({ collectedPages, visitedPages }, () => {
                        extractASINs();
                    });
                });
            }
            initialize();
        }
        if (message.action === 'saveToMemory') {
            const asin = message.product.asin;
            chrome.storage.local.get("memoryAsins", (data) => {
                let memoryAsins = data.memoryAsins || [];
                if (!memoryAsins.includes(asin)) {
                    memoryAsins.push(asin);
                    if (memoryAsins.length > 20000) {
                        memoryAsins = memoryAsins.slice(-20000);
                        chrome.runtime.sendMessage({ notification: "memory_limit_exceeded" });
                    }
                    chrome.storage.local.set({ memoryAsins: memoryAsins }, () => {
                        chrome.runtime.sendMessage({ notification: "saved_to_memory" });
                        sendResponse({ success: true });
                    });
                } else {
                    sendResponse({ success: false, error: 'This ASIN is already in memory.' });
                }
            });
            return true;
        }
    });

    // "Tümünü Çek" sekmeleri kendilerini kapatmak zorunda; aksi halde arka plandaki
    // kuyruk tıkanır. Sayfa arama/ürün sayfası olarak tanınmazsa (CAPTCHA veya hata
    // sayfasına yönlendirme) extractASINs hiç çalışmaz, dolayısıyla burada kapatıyoruz.
    // Amazon bot koruması: CAPTCHA sayfası, "robot değilim" doğrulaması veya
    // "Dogs of Amazon" hata sayfası. Bunlar 0 sonuçlu arama gibi görünür; ayırt
    // edilmezse ürün boşuna "çekildi" işaretlenip yakılır.
    function isAmazonBlockPage() {
        try {
            if (location.href.includes('/errors/validateCaptcha')) return true;
            if (document.querySelector('form[action*="validateCaptcha"], input[name="amzn-captcha-token"], img[src*="captcha"]')) return true;
            const text = (document.body ? document.body.innerText : '').slice(0, 3000);
            return /not a robot|Enter the characters you see|Type the characters you see|Sorry, we just need|Dogs of Amazon|automated access/i.test(text);
        } catch (e) {
            return false;
        }
    }

    function startExtraction() {
        if (isAutoSaveMode && isAmazonBlockPage()) {
            chrome.runtime.sendMessage({ action: 'autoFetchBlocked' });
            return;
        }
        initialize();
        if (isSearchPage() || isProductPage()) {
            extractASINs(isAutoSaveMode);
        } else if (isAutoSaveMode) {
            closeAutoTab();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startExtraction);
    } else {
        startExtraction();
    }

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(history, arguments);
        handleNavigation();
    };

    setInterval(() => {
        if (window.location.href !== lastUrl) {
            handleNavigation();
        }
    }, 1000);

    function isSearchPage() {
        return window.location.href.includes('/s?') || document.querySelector('div[data-component-type="s-search-result"]');
    }

    function isProductPage() {
        return window.location.href.includes('/dp/') || window.location.href.includes('/gp/product/');
    }
})();
