function escapeHTML(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag));
}

const MAX_CACHE_SIZE = 500;

let ebaySettings = {
    ebayChartDefaultDays: "7",
    ebayChartDisplay: "both",
    schDisplay7Days: true,
    schDisplay14Days: true,
    schDisplay30Days: true,
    schDataDisplay: "both",
    schDisplaySold: true,
    schDisplayWatchers: true,
    schDisplayAvailable: true,
    schDisplayMode: "standard",
    schSellerSaleDays: "",
    advancedCatcher: false,
    // Yakalama hassasiyeti: bir ürünün Potansiyel Ürünler'e kaydedilmesi için gereken
    // minimum satış hızı. 'strict' = eski katı davranış (son 7 günde >=3 alıcı),
    // 'normal' (varsayılan) = son 7 günde >=1 VEYA son 30 günde >=3, 'wide' = son 30 günde >=1.
    catchSensitivity: "normal"
};

// c7/c14/c30 = son 7/14/30 gündeki farklı alıcı (müşteri) sayısı.
function passesCatchThreshold(c7, c14, c30) {
    switch (ebaySettings.catchSensitivity) {
        case 'wide':   return c30 >= 1;
        case 'strict': return c7 >= 3;
        case 'normal':
        default:       return c7 >= 1 || c30 >= 3;
    }
}

const requestManager = {
    isBlocked: false,
    blockUntil: 0,
    baseDelay: 50,
    maxDelay: 1500,
    isSolvingCaptcha: false,
    block(duration = 5000) {
        this.isBlocked = true;
        this.blockUntil = Date.now() + duration;
        this.baseDelay = Math.min(this.baseDelay + 200, this.maxDelay);
    },
    getDelay(mode) {
        return this.baseDelay + Math.floor(Math.random() * 150);
    },
    checkStatus() {
        if (this.isBlocked && Date.now() > this.blockUntil) {
            this.isBlocked = false;
        }
        return this.isBlocked;
    },
    initiateCaptchaSolve(url) {
        if (this.isSolvingCaptcha) return;
        this.isSolvingCaptcha = true;
        chrome.runtime.sendMessage({ action: "solveCaptcha", url: url });
    }
};

let _forbiddenMainCategoryList = [];
let _forbiddenSubCategoryList = [];

function loadForbiddenCategories(callback) {
    chrome.storage.local.get(['forbiddenMainCategories', 'forbiddenSubCategories'], (data) => {
        _forbiddenMainCategoryList = data.forbiddenMainCategories || [];
        _forbiddenSubCategoryList = data.forbiddenSubCategories || [];
        if (callback) callback();
    });
}

// Sayfa 'load' olayında iki ayrı yerden (otomasyon akışı ve loadEbaySettings)
// bağımsız şekilde tetiklenen kontroller arasında yarış durumu oluşmaması için:
// liste storage'dan gelene kadar checkForbiddenCategories() çalıştırılmamalı.
const forbiddenCategoriesReady = new Promise(resolve => loadForbiddenCategories(resolve));

function checkForbiddenCategories() {
    try {
        const mainKeywords = _forbiddenMainCategoryList;
        const subKeywords = _forbiddenSubCategoryList;
        if ((!mainKeywords || mainKeywords.length === 0) && (!subKeywords || subKeywords.length === 0)) return null;

        const breadcrumb = document.querySelector('.seo-breadcrumb-text, nav.seo-breadcrumb, .x-bread-crumb');
        if (breadcrumb) {
            const text = breadcrumb.textContent.trim();
            const found = [...mainKeywords, ...subKeywords].find(k => text.includes(k));
            if (found) return found;
        }

        const selectedItem = document.querySelector('.srp-refine__category__item[data-state="selected"]');
        if (selectedItem) {
            const firstTopLink = selectedItem.querySelector(':scope > ul.srp-refine__category__list > li > a');
            if (firstTopLink) {
                const mainText = firstTopLink.textContent.trim();
                const foundMain = mainKeywords.find(k => mainText.includes(k));
                if (foundMain) return foundMain;

                const firstSubLink = firstTopLink.closest('li')?.querySelector(':scope > ul.srp-refine__category__list > li > a');
                if (firstSubLink) {
                    const subText = firstSubLink.textContent.trim();
                    const foundSub = subKeywords.find(k => subText.includes(k));
                    if (foundSub) return foundSub;
                }
            }
        }

        const pageH1 = document.querySelector('h1.x-item-title__mainTitle, h1.b-pageheader');
        if (pageH1) {
            const text = pageH1.textContent.trim();
            const found = [...mainKeywords, ...subKeywords].find(k => text.startsWith(k));
            if (found) return found;
        }
    } catch(e) {
        return null;
    }
    return null;
}

async function waitForForbiddenCategoryCheck(maxWaitMs = 4000, intervalMs = 100) {
    await forbiddenCategoriesReady;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const riskyCat = checkForbiddenCategories();
        if (riskyCat) return riskyCat;
        if (document.querySelector('.srp-refine__category__item[data-state="selected"]')) {
            return null;
        }
        await AslRequestDelay(intervalMs);
    }
    return null;
}

function createC4ResultsWindow() {
    if (document.getElementById('indygrab-c4-results-window')) return;
    const resultsWindow = document.createElement('div');
    resultsWindow.id = 'indygrab-c4-results-window';
    resultsWindow.innerHTML = `
        <div class="c4-window-header">
            <span>Potansiyel Ürünler (C4+)</span>
            <button class="c4-window-close">&times;</button>
        </div>
        <div id="c4-results-list" class="c4-results-list"></div>
    `;
    document.body.appendChild(resultsWindow);
    resultsWindow.querySelector('.c4-window-close').addEventListener('click', () => {
        resultsWindow.style.display = 'none';
    });
    makeDraggable(resultsWindow);
}

function askGoOnWithoutAi(reason) {
    return confirm(`AI yanıt vermiyor (${reason}).\n\nAI olmadan devam edilsin mi? Onayın, AI yeniden yanıt verene kadar geçerli olur.`);
}

function addProductToResultsWindow(productInfo) {
    const resultsList = document.getElementById('c4-results-list');
    if (!resultsList) return;
    if (resultsList.querySelector(`.c4-result-item[data-item-id="${productInfo.itemId}"]`)) return;
    
    const safeTitle = escapeHTML(productInfo.title);
    const safeImageUrl = encodeURI(productInfo.imageUrl);

    const itemElement = document.createElement('div');
    itemElement.className = 'c4-result-item';
    itemElement.setAttribute('data-item-id', productInfo.itemId);
    itemElement.innerHTML = `
        <img src="${safeImageUrl}" class="c4-item-image">
        <div class="c4-item-details">
            <p class="c4-item-title" title="${safeTitle}">${safeTitle}</p>
            <div class="c4-button-group">
                <a href="${productInfo.amazonSearchUrl}" target="_blank" class="c4-amazon-button">Amazon'da Ara</a>
                <button class="c4-amazon-fetch-button">Amazon'dan Çek</button>
            </div>
        </div>
        <button class="c4-bookmark-star" title="Yer işaretlerine kaydet">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        </button>
    `;
    const fetchButton = itemElement.querySelector('.c4-amazon-fetch-button');
    fetchButton.addEventListener('click', () => {
        const autoCollectUrl = productInfo.amazonSearchUrl + '&indygrab_auto_collect=true';
        fetchButton.textContent = 'Çekiliyor...';
        fetchButton.disabled = true;
        chrome.runtime.sendMessage({ action: "openTabInBackground", url: autoCollectUrl, itemId: productInfo.itemId }, response => {
            if (response && response.status === 'aiHalted') {
                fetchButton.textContent = "Amazon'dan Çek";
                fetchButton.disabled = false;
                if (askGoOnWithoutAi(response.reason)) {
                    chrome.runtime.sendMessage({ action: "allowNoAi" }, () => fetchButton.click());
                }
            } else if (response && response.status === 'skipped') {
                fetchButton.textContent = 'Çekilmedi';
            }
        });
    });
    const bookmarkStar = itemElement.querySelector('.c4-bookmark-star');
    bookmarkStar.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "createBookmark", title: productInfo.title, url: productInfo.amazonSearchUrl }, (response) => {
            if (response && response.status === "success") {
                bookmarkStar.classList.add('saved');
                bookmarkStar.disabled = true;
            }
        });
    });
    resultsList.prepend(itemElement);
    document.getElementById('indygrab-c4-results-window').style.display = 'flex';
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = element.querySelector(".c4-window-header");
    if (header) header.onmousedown = dragMouseDown;
    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }
    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }
    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function loadEbaySettings() {
    chrome.storage.local.get(Object.keys(ebaySettings), (data) => {
        ebaySettings = { ...ebaySettings, ...data };
        loadForbiddenCategories(() => {
            if (window.location.href.includes('/itm/')) {
                waitForElementAndRun('.vim.x-price-section', addElements);
            } else if (window.location.href.includes('/sch/')) {
                initializeSearchPageObservers();
            }
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.updateEbayFeatures) {
        ebaySettings = { ...ebaySettings, ...message.updateEbayFeatures };
        const existingContainer = document.querySelector('.indygrab-main-container');
        if (existingContainer) existingContainer.remove();
        const existingButtons = document.querySelector('.indygrab-buttons-container');
        if (existingButtons) existingButtons.remove();
        elementsAdded = false;
        if (window.location.href.includes('/itm/')) addElements();
    } else if (message.action === 'captchaSolved') {
        requestManager.isSolvingCaptcha = false;
    }
});

let elementsAdded = false;

function parseEbayDate(dateString) {
    const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const parts = dateString.replace(' at', '').split(' ');
    if (parts.length < 4) return null;
    const day = parseInt(parts[0], 10);
    const month = monthMap[parts[1]];
    const year = parseInt(parts[2], 10);
    let timePart = parts[3];
    const isPM = timePart.toLowerCase().includes('pm');
    timePart = timePart.replace(/am|pm/i, '');
    let [hours, minutes, seconds] = timePart.split(':').map(num => parseInt(num, 10));
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    if (isNaN(day) || month === undefined || isNaN(year)) return null;
    return new Date(year, month, day, hours, minutes, seconds);
}

function AslRequestDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForElementAndRun(selector, callback) {
    const interval = setInterval(() => {
        const element = document.querySelector(selector);
        if (element) {
            clearInterval(interval);
            callback();
        }
    }, 200);
}

function renderSalesChart(svg, salesByDay, customersByDay, totalDays, totalQuantity) {
    svg.innerHTML = '';
    const showQuantity = ebaySettings.ebayChartDisplay === 'both' || ebaySettings.ebayChartDisplay === 'quantity';
    const showCustomers = ebaySettings.ebayChartDisplay === 'both' || ebaySettings.ebayChartDisplay === 'customers';
    if (totalQuantity === 0) {
        svg.innerHTML = `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="chart-no-data">No sales data for the selected period.</text>`;
        return;
    }
    const margin = { top: 40, right: 20, bottom: 40, left: 40 };
    const width = 600 - margin.left - margin.right;
    const height = 250 - margin.top - margin.bottom;
    svg.setAttribute('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    svg.appendChild(g);
    const dates = [];
    const today = new Date();
    for (let i = 0; i < totalDays; i++) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        dates.unshift(date);
    }
    const yMaxValue = showQuantity ? Math.max(...Object.values(salesByDay), 0) : Math.max(...Object.values(customersByDay), 0);
    const yMax = Math.max(4, Math.ceil(yMaxValue / 1) * 1);
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    yAxis.setAttribute('class', 'axis y-axis');
    for (let i = 0; i <= 4; i++) {
        const y = height - (i / 4) * height;
        const value = Math.round((i / 4) * yMax);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'grid-line');
        line.setAttribute('x1', 0);
        line.setAttribute('x2', width);
        line.setAttribute('y1', y);
        line.setAttribute('y2', y);
        yAxis.appendChild(line);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', -8);
        text.setAttribute('y', y);
        text.textContent = value;
        yAxis.appendChild(text);
    }
    g.appendChild(yAxis);
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    xAxis.setAttribute('class', 'axis x-axis');
    xAxis.setAttribute('transform', `translate(0, ${height})`);
    const labelCount = Math.min(totalDays, 7);
    for (let i = 0; i < labelCount; i++) {
        const index = Math.floor(i * (totalDays - 1) / (labelCount - 1));
        const date = dates[index];
        const x = (index / (totalDays - 1)) * width;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', 25);
        text.textContent = `${date.getDate()}/${date.getMonth() + 1}`;
        xAxis.appendChild(text);
    }
    g.appendChild(xAxis);
    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('class', 'chart-legend');
    legend.setAttribute('transform', `translate(${width - 200}, -20)`);
    const legendItems = [];
    if (showQuantity) legendItems.push({ label: 'Quantity', color: '#b91c1c' });
    if (showCustomers) legendItems.push({ label: 'Customers', color: '#4a90e2' });
    legendItems.forEach((item, i) => {
        const legendGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        legendGroup.setAttribute('transform', `translate(${i * 100}, 0)`);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', 12);
        rect.setAttribute('height', 12);
        rect.setAttribute('fill', item.color);
        legendGroup.appendChild(rect);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 18);
        text.setAttribute('y', 10);
        text.textContent = item.label;
        legendGroup.appendChild(text);
        legend.appendChild(legendGroup);
    });
    g.appendChild(legend);
    const barGroupWidth = width / totalDays;
    const barWidth = barGroupWidth * 0.8;
    const groupPadding = barGroupWidth * 0.1;
    dates.forEach((date, i) => {
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const quantity = salesByDay[dateKey] || 0;
        const customers = customersByDay[dateKey] || 0;
        const additionalQuantity = quantity - customers;
        const customerBarHeight = (customers / yMax) * height;
        const additionalQtyHeight = (additionalQuantity / yMax) * height;
        const x = i * barGroupWidth + groupPadding;
        const barGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        barGroup.setAttribute('class', 'bar-group');
        if (showCustomers) {
            const custRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            custRect.setAttribute('class', 'chart-bar customer-bar');
            custRect.setAttribute('x', x);
            custRect.setAttribute('y', height - customerBarHeight);
            custRect.setAttribute('width', barWidth);
            custRect.setAttribute('height', customerBarHeight);
            custRect.setAttribute('fill', '#4a90e2');
            barGroup.appendChild(custRect);
        }
        if (showQuantity && quantity > 0) {
            const yPosition = showCustomers ? height - customerBarHeight - additionalQtyHeight : height - (quantity / yMax) * height;
            const barHeight = showCustomers ? (quantity > customers ? additionalQtyHeight : 0) : (quantity / yMax) * height;
            if (additionalQuantity > 0 || !showCustomers) {
                const qtyRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                qtyRect.setAttribute('class', 'chart-bar quantity-bar');
                qtyRect.setAttribute('x', x);
                qtyRect.setAttribute('y', yPosition);
                qtyRect.setAttribute('width', barWidth);
                qtyRect.setAttribute('height', barHeight);
                qtyRect.setAttribute('fill', '#b91c1c');
                barGroup.appendChild(qtyRect);
            }
        }
        g.appendChild(barGroup);
        barGroup.addEventListener('mouseover', (e) => {
            const tooltip = document.querySelector('.chart-tooltip');
            const groupBounds = barGroup.getBoundingClientRect();
            tooltip.style.display = 'block';
            tooltip.innerHTML = `<strong>${date.toLocaleDateString('en-US')}</strong><br>Sales: <strong>${quantity}</strong><br>Customers: <strong>${customers}</strong>`;
            tooltip.style.left = `${groupBounds.left + groupBounds.width / 2 - tooltip.offsetWidth / 2}px`;
            tooltip.style.top = `${groupBounds.top - 60 - 5}px`;
        });
        barGroup.addEventListener('mouseout', () => {
            const tooltip = document.querySelector('.chart-tooltip');
            tooltip.style.display = 'none';
        });
    });
    let tooltip = document.querySelector('.chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        document.body.appendChild(tooltip);
    }
}

async function fetchAndProcessSales(itemId, days) {
    const chartContainer = document.getElementById(`sales-chart-${itemId}`);
    if (!chartContainer) return;
    chartContainer.innerHTML = `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="chart-loading">Loading chart...</text>`;
    try {
        const purchaseHistoryUrl = `https://www.ebay.com/bin/purchaseHistory?item=${itemId}`;
        const response = await fetch(purchaseHistoryUrl);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const salesTable = doc.querySelector('table.app-table__table');
        if (!salesTable) {
            chartContainer.innerHTML = `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="chart-no-data">No sales data found.</text>`;
            return;
        }
        const rows = salesTable.querySelectorAll('tbody tr.app-table__row');
        const salesByDay = {};
        const customersByDay = {};
        let totalQuantity = 0;
        let totalCustomers = 0;
        const now = new Date();
        const timeLimit = new Date();
        timeLimit.setDate(now.getDate() - days);
        rows.forEach(row => {
            const quantityCell = row.children[row.children.length - 2];
            const dateCell = row.children[row.children.length - 1];
            if (quantityCell && dateCell) {
                const quantity = parseInt(quantityCell.textContent.trim(), 10);
                const purchaseDate = parseEbayDate(dateCell.textContent.trim());
                if (!isNaN(quantity) && purchaseDate && purchaseDate >= timeLimit) {
                    const dateKey = `${purchaseDate.getFullYear()}-${String(purchaseDate.getMonth() + 1).padStart(2, '0')}-${String(purchaseDate.getDate()).padStart(2, '0')}`;
                    salesByDay[dateKey] = (salesByDay[dateKey] || 0) + quantity;
                    customersByDay[dateKey] = (customersByDay[dateKey] || 0) + 1;
                    totalQuantity += quantity;
                    totalCustomers += 1;
                }
            }
        });
        renderSalesChart(chartContainer, salesByDay, customersByDay, days, totalQuantity);
        const totalSalesElement = document.getElementById(`total-sales-${itemId}`);
        if (totalSalesElement) {
            totalSalesElement.innerHTML = `<span style="color:#b91c1c; font-weight:700;">Q${totalQuantity}</span> <span style="color:#1e40af; font-weight:700; margin-left:8px;">C${totalCustomers}</span>`;
        }
    } catch (error) {
        chartContainer.innerHTML = `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="chart-error">Failed to load chart.</text>`;
    }
}

function createSalesAnalysisSection(itemId) {
    const analysisContainer = document.createElement('div');
    analysisContainer.className = 'sales-analysis-container';
    const header = document.createElement('div');
    header.className = 'sales-analysis-header';
    const title = document.createElement('h3');
    title.className = 'sales-analysis-title';
    title.textContent = 'Sales Chart';
    header.appendChild(title);
    const poweredByLink = document.createElement('span');
    poweredByLink.className = 'powered-by';
    poweredByLink.textContent = 'Powered by IndyGrab.VO';
    header.appendChild(poweredByLink);
    analysisContainer.appendChild(header);
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'date-range-buttons';
    const timeFrames = [{ label: 'Last 7 Days', days: 7 }, { label: 'Last 14 Days', days: 30 }, { label: 'Last 30 Days', days: 30 }];
    const defaultDays = parseInt(ebaySettings.ebayChartDefaultDays, 10);
    timeFrames.forEach(frame => {
        const button = document.createElement('button');
        button.className = 'indygrab-btn date-range-btn';
        button.textContent = frame.label;
        if (frame.days === defaultDays) button.classList.add('active');
        button.addEventListener('click', (e) => {
            buttonContainer.querySelectorAll('.date-range-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            fetchAndProcessSales(itemId, frame.days);
        });
        buttonContainer.appendChild(button);
    });
    analysisContainer.appendChild(buttonContainer);
    const totalSales = document.createElement('div');
    totalSales.id = `total-sales-${itemId}`;
    totalSales.className = 'total-sales';
    totalSales.textContent = 'Total Sales: -';
    analysisContainer.appendChild(totalSales);
    const chartContainer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chartContainer.id = `sales-chart-${itemId}`;
    chartContainer.setAttribute('class', 'sales-chart');
    chartContainer.innerHTML = `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="chart-no-data">Select a time range to analyze.</text>`;
    analysisContainer.appendChild(chartContainer);
    return analysisContainer;
}

function addElements() {
    if (elementsAdded) return;
    const priceContainer = document.querySelector('.vim.x-price-section');
    if (!priceContainer) return;
    let itemIdMatch = window.location.href.match(/\/itm\/(\d+)/);
    if (!itemIdMatch || !itemIdMatch[1]) return;
    const itemId = itemIdMatch[1];
    let titleElement = document.querySelector("h1.x-item-title__mainTitle span.ux-textspans.ux-textspans--BOLD");
    const title = titleElement ? titleElement.textContent.trim() : "";
    let amazonSearchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(title).replace(/%20/g, "+")}`;
    let purchaseHistoryUrl = `https://www.ebay.com/bin/purchaseHistory?item=${itemId}`;
    let buttonsContainer = document.createElement("div");
    buttonsContainer.className = "indygrab-buttons-container";
    buttonsContainer.style.margin = "8px 0";
    buttonsContainer.style.display = "flex";
    buttonsContainer.style.gap = "10px";
    buttonsContainer.style.alignItems = "center";
    buttonsContainer.style.flexWrap = "wrap";
    let amazonIconLink = document.createElement("a");
    amazonIconLink.href = amazonSearchUrl;
    amazonIconLink.target = "_blank";
    amazonIconLink.style.display = "inline-block";
    let amazonIcon = document.createElement("img");
    amazonIcon.src = chrome.runtime.getURL("images/amazon-search-icon.png");
    amazonIcon.alt = "Search on Amazon";
    amazonIcon.style.width = "88px";
    amazonIcon.style.height = "35px";
    amazonIcon.style.cursor = "pointer";
    amazonIcon.style.marginBottom = "3px";
    amazonIconLink.appendChild(amazonIcon);
    let historyButtonLink = document.createElement("a");
    historyButtonLink.href = purchaseHistoryUrl;
    historyButtonLink.target = "_blank";
    historyButtonLink.style.textDecoration = "none";
    let historyButton = document.createElement("button");
    historyButton.className = "indygrab-btn indygrab-btn-history";
    historyButton.textContent = "Sold History";
    historyButtonLink.appendChild(historyButton);
    buttonsContainer.appendChild(amazonIconLink);
    buttonsContainer.appendChild(historyButtonLink);
    const currentUrlParams = new URLSearchParams(window.location.search);
    if (!currentUrlParams.has('_ssn') || !currentUrlParams.has('LH_Sold')) {
        const contactSellerLink = document.querySelector('a[href*="ShowSellerFAQ"]');
        if (contactSellerLink) {
            try {
                const sellerUrl = new URL(contactSellerLink.href, window.location.origin);
                const urlParams = new URLSearchParams(sellerUrl.search);
                const sellerName = urlParams.get('requested');
                if (sellerName) {
                    const sellerSoldButtonLink = document.createElement("a");
                    sellerSoldButtonLink.href = `https://www.ebay.com/sch/i.html?_ssn=${sellerName}&LH_Sold=1&LH_Complete=1`;
                    sellerSoldButtonLink.target = "_blank";
                    sellerSoldButtonLink.style.textDecoration = "none";
                    const sellerSoldButton = document.createElement("button");
                    sellerSoldButton.className = "indygrab-btn";
                    sellerSoldButton.textContent = "Seller Sales";
                    sellerSoldButtonLink.appendChild(sellerSoldButton);
                    buttonsContainer.appendChild(sellerSoldButtonLink);
                }
            } catch (e) {}
        }
    }
    let titleContainer = document.querySelector("div.vim.x-item-title") || document.querySelector("h1.x-item-title__mainTitle")?.parentElement;
    if (titleContainer) {
        titleContainer.insertAdjacentElement("afterend", buttonsContainer);
    } else if (titleElement) {
        titleElement.insertAdjacentElement("afterend", buttonsContainer);
    } else {
        document.body.appendChild(buttonsContainer);
    }
    const mainContainer = document.createElement('div');
    mainContainer.className = 'indygrab-main-container';
    const salesAnalysisSection = createSalesAnalysisSection(itemId);
    mainContainer.appendChild(salesAnalysisSection);
    priceContainer.insertAdjacentElement("afterend", mainContainer);
    elementsAdded = true;
    const defaultDays = parseInt(ebaySettings.ebayChartDefaultDays, 10) || 7;
    fetchAndProcessSales(itemId, defaultDays);
}

async function autoScrollToLoadItems() {
    let lastHeight = document.body.scrollHeight;
    let scrollCount = 0;
    while (scrollCount < 2) {
        window.scrollTo(0, document.body.scrollHeight);
        await AslRequestDelay(50);
        let newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) break;
        lastHeight = newHeight;
        scrollCount++;
    }
    window.scrollTo(0, 0);
}

(function() {
    const infoCache = {};
    let consecutiveTimeLimitExceeded = 0;
    let isAutoScanning = false;

    const urlParams = new URLSearchParams(window.location.search);
    const isOnSellerSoldPage = urlParams.has('_ssn') && urlParams.has('LH_Sold');
    const isAutomationMode = urlParams.has('idg_auto');
    const isAnalysisMode = urlParams.has('idg_analysis');

    if (isOnSellerSoldPage) {
        const currentUrl = window.location.href;
        chrome.storage.local.get('sellerBlacklist', (data) => {
            const blacklist = data.sellerBlacklist || {};
        });
    }

    // 'load' olayı sayfadaki TÜM görsellerin de bitmesini bekliyor; arka planda (active:false)
    // açılan sekmelerde Chrome bunu ciddi şekilde geciktirebiliyor (dakikalarca). Taramanın
    // ihtiyaç duyduğu her şey (kart listesi, kategori paneli) DOM hazır olur olmaz mevcut
    // olduğundan, görsellerin bitmesini beklemeden DOMContentLoaded ile başlıyoruz.
    function runWhenDomReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    }

    if (isAutomationMode) {
        runWhenDomReady(async () => {
            const riskyCat = await waitForForbiddenCategoryCheck();
            if (riskyCat) {
                const msg = document.createElement('div');
                msg.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(185, 28, 28, 0.95); color:white; font-family:sans-serif; display:flex; justify-content:center; align-items:center; z-index:9999999; flex-direction:column; text-align:center;";
                msg.innerHTML = `
                    <div style="font-size:60px;">⛔</div>
                    <div style="font-size:32px; font-weight:bold; margin-top:20px;">YASAKLI KATEGORİ</div>
                    <div style="font-size:24px; margin-top:10px; opacity:0.9;">"${riskyCat}" tespit edildi.</div>
                    <div style="font-size:18px; margin-top:30px; border:1px solid white; padding:10px 20px; border-radius:5px;">Süresiz Yasaklanıyor...</div>
                `;
                document.body.appendChild(msg);
                chrome.runtime.sendMessage({ action: "blockStoreForever", url: window.location.href, reason: riskyCat }, () => {
                    setTimeout(() => { chrome.runtime.sendMessage({ action: "closeSelf" }); }, 100);
                });
                return;
            }

            const countHeading = document.querySelector('.srp-controls__count-heading');
            if (countHeading && countHeading.textContent.trim().startsWith('0')) {
                chrome.runtime.sendMessage({ action: "closeSelf" });
                return;
            }
            await autoScrollToLoadItems();
            await processAllStoreItemsSequentially();
        });
    }
    
    if (isAnalysisMode) {
        runWhenDomReady(async () => {
            const riskyCat = await waitForForbiddenCategoryCheck();
            if (riskyCat) {
                chrome.runtime.sendMessage({ action: "blockStoreForever", url: window.location.href, reason: riskyCat });
                await AslRequestDelay(50);
                chrome.runtime.sendMessage({ action: "closeSelf" });
                return;
            }
            await autoScrollToLoadItems();
            await processAllItemsSequentially();
            chrome.runtime.sendMessage({ action: "closeSelf" });
        });
    }

    function getItemId(url) {
        const m = url.match(/\/itm\/(\d+)/);
        return m ? m[1] : null;
    }

    function parseLastSoldDate(text) {
        if (!text) return null;
        try {
            const cleanText = text.replace('Sold', '').trim();
            const date = new Date(cleanText);
            return isNaN(date.getTime()) ? null : date;
        } catch (e) {
            return null;
        }
    }

    function displayTimeLimitMessage(card) {
        const sellerInfo = card.querySelector('.s-item__details-section--secondary, .su-card-container__attributes__secondary');
        if (sellerInfo) {
            const messageEl = document.createElement('div');
            messageEl.textContent = 'Zaman dilimi aşıldı.';
            messageEl.style.cssText = 'margin-top: 6px; font-size: 13px; color: #f59e0b; font-weight: 700;';
            sellerInfo.appendChild(messageEl);
        }
    }

    function createSellerCarousel(data, blacklist = {}, savedLinks = [], mainImageUrl = "", autoAnalyze = false) {
        let currentIndex = 0;
        const itemsToShow = 3;
        const imageWidth = 120;
        const imageHeight = 95;
        const imageGap = 8;
        const carouselContainer = document.createElement('div');
        carouselContainer.className = 'asl-seller-carousel';

        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = "display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 5px; padding: 0 5px;";

        const aiButton = document.createElement('button');
        aiButton.className = 'indygrab-btn';
        aiButton.style.cssText = "background-color: #8e44ad; font-size: 11px; padding: 4px 8px; height: auto;";
        aiButton.innerHTML = '🤖 AI ile Eşle & Kaydet';

        const runAiAnalysis = async () => {
            if (!mainImageUrl) {
                if (!autoAnalyze) alert("Ana ürün görseli bulunamadı!");
                return;
            }
            if (!autoAnalyze && !confirm(`${data.length} satıcı görseli ana ürünle karşılaştırılacak. Bu işlem biraz zaman alabilir. Devam edilsin mi?`)) return;

            aiButton.disabled = true;
            aiButton.textContent = "AI İnceliyor...";
            let matchCount = 0;
            let aiStopped = false;

            for (let i = 0; i < data.length; i++) {
                if (i > 0) {
                    let scrollIndex = i;
                    const maxIndex = data.length - itemsToShow;
                    if (scrollIndex > maxIndex) scrollIndex = maxIndex;
                    if (scrollIndex < 0) scrollIndex = 0;
                    currentIndex = scrollIndex;
                    const offset = currentIndex * (imageWidth + imageGap);
                    filmstrip.style.transform = `translateX(-${offset}px)`;
                    updateArrows();
                }
                const item = data[i];
                const isBlacklisted = blacklist[item.sellerSalesUrl];
                const isAlreadySaved = savedLinks.some(link => link.url === item.sellerSalesUrl);

                let feedbackStr = (item.sellerFeedback || "").toLowerCase();
                let multiplier = feedbackStr.includes("k") ? 1000 : 1;
                let feedbackCount = parseFloat(feedbackStr.replace(/[^0-9.]/g, "")) * multiplier || 0;

                if (isBlacklisted || isAlreadySaved || feedbackCount <= 100) continue;

                const wrappers = carouselContainer.querySelectorAll('.asl-carousel-item-wrapper');
                if (wrappers[i]) wrappers[i].style.border = "2px solid #f1c40f";

                try {
                    const response = await new Promise(resolve => {
                        chrome.runtime.sendMessage({
                            action: "compareImages",
                            mainImageUrl: mainImageUrl,
                            targetImageUrl: item.imageUrl
                        }, resolve);
                    });

                    if (!response || (response.error && !response.imageFailed)) {
                        if (wrappers[i]) wrappers[i].style.border = "1px solid #e5e7eb";
                        // An unattended run cannot ask: it stops and the panel shows the question.
                        if (autoAnalyze || !askGoOnWithoutAi(response ? response.reason : 'yanıt yok')) {
                            aiStopped = true;
                            break;
                        }
                        await new Promise(resolve => chrome.runtime.sendMessage({ action: "allowNoAi" }, resolve));
                        continue;
                    }

                    if (response && response.isMatch) {
                        matchCount++;
                        if (wrappers[i]) {
                            wrappers[i].style.border = "3px solid #2ecc71";
                            const savedMsg = document.createElement('div');
                            savedMsg.textContent = "KAYDEDİLDİ";
                            savedMsg.style.cssText = "position:absolute; bottom:0; left:0; width:100%; background:#2ecc71; color:white; font-size:10px; text-align:center;";
                            wrappers[i].appendChild(savedMsg);
                        }
                        
                        await new Promise(r => {
                            chrome.storage.local.get({ savedSellerLinks: [] }, (d) => {
                                const links = d.savedSellerLinks;
                                if (!links.some(l => l.url === item.sellerSalesUrl)) {
                                    links.unshift({ url: item.sellerSalesUrl, visited: false });
                                    chrome.storage.local.set({ savedSellerLinks: links }, r);
                                } else {
                                    r();
                                }
                            });
                        });
                        const starBtn = wrappers[i].querySelector('.seller-bookmark-star');
                        if (starBtn) {
                            starBtn.classList.add('saved');
                            starBtn.disabled = true;
                        }
                    } else {
                        if (wrappers[i]) wrappers[i].style.border = "1px solid #e5e7eb";
                    }
                } catch (e) {}
                if (autoAnalyze) await AslRequestDelay(100);
            }
            aiButton.disabled = false;
            aiButton.textContent = aiStopped ? `AI yanıt vermedi, durduruldu (${matchCount} Eşleşme)` : `Tamamlandı (${matchCount} Eşleşme)`;
            if (!autoAnalyze) setTimeout(() => {
                aiButton.textContent = '🤖 AI ile Eşle & Kaydet';
            }, 3000);
            return matchCount;
        };

        aiButton.onclick = runAiAnalysis;
        headerDiv.appendChild(document.createElement('span'));
        headerDiv.appendChild(aiButton);
        carouselContainer.appendChild(headerDiv);

        const wrapperDiv = document.createElement('div');
        wrapperDiv.style.cssText = "display: flex; align-items: center; justify-content: center; width: 100%;";

        const leftArrow = document.createElement('button');
        leftArrow.className = 'asl-carousel-arrow left';
        leftArrow.innerHTML = '‹';

        const viewport = document.createElement('div');
        viewport.className = 'asl-carousel-viewport';
        viewport.style.width = `calc(3 * (${imageWidth}px + ${imageGap}px) - ${imageGap}px)`;

        const filmstrip = document.createElement('div');
        filmstrip.className = 'asl-carousel-filmstrip';
        viewport.appendChild(filmstrip);

        data.forEach(item => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'asl-carousel-item-wrapper';
            itemWrapper.style.width = `${imageWidth}px`;
            
            const safeSellerName = escapeHTML(item.sellerName);
            const safeFeedback = escapeHTML(item.sellerFeedback);

            const link = document.createElement('a');
            link.href = item.sellerSalesUrl;
            link.target = '_blank';
            link.title = `View sales for ${safeSellerName}`;
            const imageContainer = document.createElement('div');
            imageContainer.className = 'image-container';
            imageContainer.style.height = `${imageHeight}px`;
            const img = document.createElement('img');
            img.src = item.imageUrl;
            imageContainer.appendChild(img);
            link.appendChild(imageContainer);
            const infoDiv = document.createElement('div');
            infoDiv.className = 'asl-carousel-seller-info';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'seller-name';
            nameSpan.textContent = safeSellerName;
            const feedbackSpan = document.createElement('span');
            feedbackSpan.className = 'seller-feedback';
            feedbackSpan.textContent = `(${safeFeedback})`;
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(feedbackSpan);
            link.appendChild(infoDiv);

            const bookmarkStar = document.createElement('button');
            bookmarkStar.className = 'seller-bookmark-star';
            bookmarkStar.title = 'Satıcıyı kaydet';
            bookmarkStar.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

            const isBlacklisted = blacklist[item.sellerSalesUrl];
            const isAlreadySaved = savedLinks.some(link => link.url === item.sellerSalesUrl);
            const isBlacklistedActive = isBlacklisted && isBlacklisted > Date.now();

            if (isBlacklistedActive) {
                itemWrapper.classList.add('blacklisted');
                const warningDiv = document.createElement('div');
                warningDiv.className = 'asl-blacklist-warning';
                warningDiv.textContent = 'Kara Listede!';
                infoDiv.appendChild(warningDiv);
                bookmarkStar.disabled = true;
                bookmarkStar.title = 'Bu satıcı kara listede olduğu için eklenemez.';
            } else if (isAlreadySaved) {
                itemWrapper.classList.add('already-saved');
                const savedDiv = document.createElement('div');
                savedDiv.className = 'asl-already-saved-warning';
                savedDiv.textContent = 'Zaten Kayıtlı!';
                infoDiv.appendChild(savedDiv);
                bookmarkStar.classList.add('saved');
                bookmarkStar.disabled = true;
                bookmarkStar.title = 'Bu satıcı zaten listenizde kayıtlı.';
            } else {
                bookmarkStar.onclick = () => {
                    bookmarkStar.disabled = true;
                    const newLink = { url: item.sellerSalesUrl, visited: false };
                    chrome.storage.local.get({ savedSellerLinks: [] }, (data) => {
                        const links = data.savedSellerLinks;
                        const isNowSaved = links.some(link => link.url === newLink.url);
                        if (!isNowSaved) {
                            links.unshift(newLink);
                            chrome.storage.local.set({ savedSellerLinks: links }, () => {
                                bookmarkStar.classList.add('saved');
                            });
                        } else {
                            bookmarkStar.classList.add('saved');
                        }
                    });
                };
            }

            itemWrapper.appendChild(link);
            itemWrapper.appendChild(bookmarkStar);
            filmstrip.appendChild(itemWrapper);
        });
        
        const rightArrow = document.createElement('button');
        rightArrow.className = 'asl-carousel-arrow right';
        rightArrow.innerHTML = '›';

        function updateArrows() {
            leftArrow.disabled = currentIndex === 0;
            rightArrow.disabled = (currentIndex + itemsToShow) >= data.length;
        }
        
        leftArrow.onclick = () => {
            currentIndex = Math.max(0, currentIndex - itemsToShow);
            const offset = currentIndex * (imageWidth + imageGap);
            filmstrip.style.transform = `translateX(-${offset}px)`;
            updateArrows();
        };
        
        rightArrow.onclick = () => {
            const maxIndex = data.length - itemsToShow;
            currentIndex = Math.min(currentIndex + itemsToShow, maxIndex > currentIndex ? maxIndex : currentIndex);
            const offset = currentIndex * (imageWidth + imageGap);
            filmstrip.style.transform = `translateX(-${offset}px)`;
            updateArrows();
        };

        wrapperDiv.appendChild(leftArrow);
        wrapperDiv.appendChild(viewport);
        wrapperDiv.appendChild(rightArrow);
        carouselContainer.appendChild(wrapperDiv);
        carouselContainer.style.flexDirection = "column";
        updateArrows();
        
        carouselContainer.startAutoAnalysis = async () => {
             if(autoAnalyze) {
                 await runAiAnalysis();
             }
        };
        return carouselContainer;
    }

    async function findOtherSellers(event, card, autoAnalyze = false) {
        let button;
        if (!autoAnalyze && event) {
            button = event.target;
            button.disabled = true;
            button.textContent = 'Aranıyor...';
        } else {
            button = card.querySelector('.indygrab-btn-find-sellers');
            if (button) {
                button.disabled = true;
                button.textContent = 'Otomatik Taranıyor...';
            }
        }
        const existingCarousel = card.querySelector('.asl-seller-carousel');
        if (existingCarousel) existingCarousel.remove();
        const existingError = card.querySelector('.asl-no-sellers-msg');
        if(existingError) existingError.remove();

        const titleEl = card.querySelector('.s-item__title, .s-card__title, .su-item-card__title');
        if (!titleEl) {
            if (button) button.textContent = 'Hata: Başlık bulunamadı';
            return;
        }
        const mainImgEl = card.querySelector('.s-item__image-img, .s-card__image, .su-image img');
        const mainImageUrl = mainImgEl ? (mainImgEl.getAttribute('data-src') || mainImgEl.src) : '';
        const title = titleEl.textContent.trim();
        const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}`;
        try {
            const { sellerBlacklist = {}, savedSellerLinks = [] } = await chrome.storage.local.get(['sellerBlacklist', 'savedSellerLinks']);
            const response = await fetch(searchUrl);
            if (!response.ok) throw new Error('Network response was not ok.');
            const htmlText = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            const items = doc.querySelectorAll('li.s-item, div.s-item, .su-card-container');
            const sellerData = [];
            const processedSellers = new Set();
            items.forEach(item => {
                const sellerNameEl = item.querySelector('.s-item__seller-info-text, .su-card-container__attributes__secondary .su-program-badge .su-styled-text, .su-card-container__attributes__secondary .su-styled-text.primary:first-child');
                const sellerName = sellerNameEl ? sellerNameEl.textContent.trim().split(' ')[0] : null;

                if (sellerName && !processedSellers.has(sellerName)) {
                    let sellerFeedback = '';
                    const feedbackEl = item.querySelector('.s-item__seller-info-text, .su-card-container__attributes__secondary .su-program-badge, .su-card-container__attributes__secondary');
                    if (feedbackEl) {
                        const feedbackMatch = feedbackEl.textContent.match(/\(([^)]+)\)/);
                        if (feedbackMatch && feedbackMatch[1]) {
                            sellerFeedback = feedbackMatch[1];
                        }
                    }
                    const imgEl = item.querySelector('.s-item__image-img, .s-card__image, .su-image img');
                    const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.src) : '';
                    if (imageUrl) {
                        const sellerSalesUrl = `https://www.ebay.com/sch/i.html?_ssn=${sellerName}&LH_Sold=1&LH_Complete=1`;
                        sellerData.push({ imageUrl, sellerSalesUrl, sellerName, sellerFeedback });
                        processedSellers.add(sellerName);
                    }
                }
            });
            if (sellerData.length > 0) {
                const carousel = createSellerCarousel(sellerData, sellerBlacklist, savedSellerLinks, mainImageUrl, autoAnalyze);
                card.appendChild(carousel);
                if (autoAnalyze && carousel.startAutoAnalysis) {
                     await carousel.startAutoAnalysis();
                }
            } else {
                if (button) button.textContent = 'Satıcı bulunamadı';
                if(autoAnalyze) {
                    const msg = document.createElement('div');
                    msg.className = 'asl-no-sellers-msg';
                    msg.textContent = '❌ Başka Satıcı Bulunamadı';
                    msg.style.cssText = 'color: #e74c3c; font-weight: bold; font-size: 13px; margin-top: 5px; padding: 5px; background: #fee; border-radius: 4px;';
                    const container = card.querySelector('.indygrab-btn-container') || card;
                    container.appendChild(msg);
                }
            }
            if (button) button.style.display = 'none';
        } catch (error) {
            if (button) {
                button.textContent = 'Başarısız';
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = 'Find Sellers';
                }, 2000);
            }
        }
    }

    function addStaticElements(card) {
        if (card.dataset.aslStaticDone) return;
        card.dataset.aslStaticDone = 'true';
        const insertAfterEl = card.querySelector('.s-item__subtitle, .s-card__subtitle-row, .su-item-card__subtitle, .su-item-card__header');
        if (!insertAfterEl) return;
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'indygrab-btn-container';
        buttonContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 6px;';
        const titleEl = card.querySelector('.s-item__title, .s-card__title, .su-item-card__title');
        if (titleEl) {
            const title = titleEl.textContent.trim();
            const amazonBtn = createAmazonBtn(title);
            buttonContainer.appendChild(amazonBtn);
        }
        const findSellersBtn = document.createElement('button');
        findSellersBtn.className = 'indygrab-btn indygrab-btn-find-sellers';
        findSellersBtn.textContent = 'Find Sellers';
        findSellersBtn.onclick = (e) => findOtherSellers(e, card, false);
        buttonContainer.appendChild(findSellersBtn);

        if (!isOnSellerSoldPage) {
            const sellerInfoElement = card.querySelector('.s-item__seller-info-text, .s-item__etrs-text .PRIMARY:first-child, .su-card-container__attributes__secondary .su-program-badge .su-styled-text, .su-card-container__attributes__secondary .su-styled-text.primary:first-child');
            if (sellerInfoElement) {
                const sellerName = sellerInfoElement.textContent.trim().split(' ')[0];
                if (sellerName) {
                    const sellerSoldButtonLink = document.createElement("a");
                    sellerSoldButtonLink.href = `https://www.ebay.com/sch/i.html?_ssn=${sellerName}&LH_Sold=1&LH_Complete=1`;
                    sellerSoldButtonLink.target = "_blank";
                    sellerSoldButtonLink.style.textDecoration = "none";
                    const sellerSoldButton = document.createElement("button");
                    sellerSoldButton.className = "indygrab-btn";
                    sellerSoldButton.textContent = "Seller Sales";
                    sellerSoldButtonLink.appendChild(sellerSoldButton);
                    buttonContainer.appendChild(sellerSoldButtonLink);
                }
            }
        }
        if (buttonContainer.hasChildNodes()) {
            insertAfterEl.insertAdjacentElement('afterend', buttonContainer);
        }
    }

    async function handleCard(card) {
        if (card.dataset.aslDynamicDone) return;
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('idg_analysis')) return;
        card.dataset.aslDynamicDone = '1';
        let sellerInfo = card.querySelector('.s-item__details-section--secondary, .su-card-container__attributes__secondary');
        if (!sellerInfo) sellerInfo = card.querySelector('.s-item__info, .s-item__details, .su-card-container__content');
        const linkEl = card.querySelector('a.s-item__link, a.s-card__link, a.su-link');
        const itemUrl = linkEl ? linkEl.href : null;
        const itemId = itemUrl ? getItemId(itemUrl) : null;
        const titleEl = card.querySelector('.s-item__title, .s-card__title, .su-item-card__title');
        let title = 'No Title';
        if (titleEl) {
            const tempEl = titleEl.cloneNode(true);
            const accessibilitySpan = tempEl.querySelector('.clipped');
            if (accessibilitySpan) accessibilitySpan.remove();
            title = tempEl.textContent.trim();
        }
        const imageEl = card.querySelector('.s-item__image-img, .s-card__image, .su-image img');
        const imageUrl = imageEl ? (imageEl.getAttribute('data-src') || imageEl.src) : '';
        const amazonSearchUrl = 'https://www.amazon.com/s?k=' + encodeURIComponent(title).replace(/%20/g, '+');
        const priceEl = card.querySelector('.s-card__price, .s-item__price, .su-item-card__price');
        const ebayPrice = priceEl ? priceEl.textContent.trim() : 'N/A';
        const sellerEl = card.querySelector('.s-item__seller-info-text, .su-card-container__attributes__secondary .su-program-badge .su-styled-text, .su-card-container__attributes__secondary .su-styled-text.primary:first-child');
        const sellerName = sellerEl ? sellerEl.textContent.trim().split(' ')[0] : 'N/A';
        const productInfo = { itemId, title, imageUrl, amazonSearchUrl, ebayPrice, sellerName };

        if (isOnSellerSoldPage && ebaySettings.schSellerSaleDays) {
            const dateElement = card.querySelector('.s-item__caption--signal.POSITIVE span, .s-card__caption span, .s-item__title--tag, .signal');
            if (dateElement) {
                const parsedDate = parseLastSoldDate(dateElement.textContent);
                if (parsedDate) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const limit = parseInt(ebaySettings.schSellerSaleDays, 10);
                    const diffTime = today - parsedDate;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays > limit) {
                        displayTimeLimitMessage(card);
                        consecutiveTimeLimitExceeded++;
                        if (consecutiveTimeLimitExceeded >= 10 && isAutomationMode) {
                            chrome.runtime.sendMessage({ action: "closeSelf" });
                        }
                        return;
                    }
                }
            }
        }
        consecutiveTimeLimitExceeded = 0;

        if (sellerInfo && itemUrl && itemId) {
            if (ebaySettings.schDisplayMode === 'direct' || isAutomationMode) {
                const salesContainerPlaceholder = document.createElement('div');
                salesContainerPlaceholder.style.cssText = 'margin-top: 6px; display: block; width: 100%; min-height: 20px;';
                sellerInfo.appendChild(salesContainerPlaceholder);
                await fetchAndDisplayDetailedSales(itemId, salesContainerPlaceholder, true, productInfo);
            } else {
                const loader = document.createElement('div');
                loader.style.cssText = 'margin-top: 6px; font-size: 13px; color: #6b7280;';
                loader.textContent = 'Loading info...';
                sellerInfo.appendChild(loader);
                const result = await getAvailabilityInfo(itemUrl);
                loader.remove();
                const availabilityEl = createAvailabilityEl(result);
                sellerInfo.appendChild(availabilityEl);
                if (typeof result === 'object' && result !== null) {
                    const breakdownButton = document.createElement('button');
                    breakdownButton.className = 'asl-sales-breakdown-btn';
                    breakdownButton.textContent = 'Show Sales Breakdown';
                    breakdownButton.onclick = async () => {
                        try {
                            await fetchAndDisplayDetailedSales(itemId, breakdownButton, false, productInfo);
                            breakdownButton.disabled = true;
                        } catch (error) {
                            if (error.message === 'CAPTCHA_REQUIRED') {
                                requestManager.initiateCaptchaSolve(`https://www.ebay.com/bin/purchaseHistory?item=${itemId}`);
                                breakdownButton.textContent = 'Retrying...';
                                setTimeout(() => {
                                    breakdownButton.disabled = false;
                                    breakdownButton.textContent = 'Retry Breakdown';
                                }, 4000);
                            } else {
                                breakdownButton.textContent = 'Error';
                            }
                        }
                    };
                    availabilityEl.insertAdjacentElement('afterend', breakdownButton);
                }
            }
        }
    }

    async function getAvailabilityInfo(itemUrl) {
        if (requestManager.checkStatus()) return null;
        if (Object.keys(infoCache).length > MAX_CACHE_SIZE) {
            const keys = Object.keys(infoCache);
            for(let i=0; i<100; i++) delete infoCache[keys[i]];
        }
        const id = getItemId(itemUrl);
        if (!id) return null;
        if (infoCache[id] !== undefined) return infoCache[id];
        try {
            const res = await fetch(itemUrl, { credentials: 'include' });
            if (!res.ok) {
                if (res.status === 429 || res.status === 403) requestManager.block();
                return null;
            }
            const html = await res.text();
            if (html.includes("This listing was ended by the seller")) {
                infoCache[id] = 'ENDED';
                return 'ENDED';
            }
            if (html.includes("to continue, please solve this CAPTCHA") || html.includes("human verification")) {
                throw new Error('CAPTCHA_REQUIRED');
            }
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const info = { sold: null, available: null, watchers: null };
            const qtyDiv = doc.querySelector('#qtyAvailability, .d-quantity__availability');
            if (qtyDiv) {
                for (const span of qtyDiv.querySelectorAll('span.ux-textspans, a.ux-textspans')) {
                    const text = span.textContent.trim();
                    if (/sold/i.test(text)) info.sold = text;
                    else if (/available/i.test(text)) info.available = text;
                    else if (text.toLowerCase() === 'last one') info.available = '1 available';
                }
            }
            const watcherSpan = doc.querySelector('span.x-watch-heart-btn-text, .ux-action-text');
            if (watcherSpan && watcherSpan.textContent.includes('watching')) {
                const watcherText = watcherSpan.textContent.trim().match(/(\d+)/);
                info.watchers = watcherText ? watcherText[0] : '0';
            } else {
                info.watchers = '0';
            }
            infoCache[id] = info;
            return info;
        } catch (e) {
            if (e.message === 'CAPTCHA_REQUIRED') throw e;
            infoCache[id] = null;
            return null;
        }
    }

    async function fetchAndDisplayDetailedSales(itemId, triggerElement, isDirectMode = false, productInfo, hasRetried = false) {
        const container = document.createElement('div');
        container.className = 'asl-sales-data-container';
        if (isDirectMode) {
            triggerElement.appendChild(container);
        } else {
            triggerElement.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Loading...`;
            triggerElement.classList.add('loading');
            triggerElement.insertAdjacentElement('afterend', container);
        }
        if (!hasRetried) {
            container.innerHTML = `<div style="text-align: center; padding: 10px; color: #6b7280;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin" style="margin: 0 auto;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><div style="margin-top: 8px;">Fetching sales data...</div></div>`;
        }
        try {
            const purchaseHistoryUrl = `https://www.ebay.com/bin/purchaseHistory?item=${itemId}`;
            const response = await fetch(purchaseHistoryUrl);
            if (!response.ok) throw new Error('HTTP_ERROR');
            const htmlText = await response.text();
            const doc = new DOMParser().parseFromString(htmlText, 'text/html');
            const salesTable = doc.querySelector('table.app-table__table');
            if (!salesTable) throw new Error('FETCH_FAILED');
            const rows = salesTable.querySelectorAll('tbody tr.app-table__row');
            let s7 = 0, s14 = 0, s30 = 0, c7 = 0, c14 = 0, c30 = 0;
            const now = new Date();
            rows.forEach(row => {
                const qCell = row.children[row.children.length - 2], dCell = row.children[row.children.length - 1];
                if (qCell && dCell) {
                    const quantity = parseInt(qCell.textContent.trim(), 10);
                    const pDate = parseEbayDate(dCell.textContent.trim());
                    if (!isNaN(quantity) && pDate) {
                        const diffDays = (now - pDate) / (1000 * 3600 * 24);
                        if (diffDays <= 30) { s30 += quantity; c30++; }
                        if (diffDays <= 14) { s14 += quantity; c14++; }
                        if (diffDays <= 7) { s7 += quantity; c7++; }
                    }
                }
            });
            if (passesCatchThreshold(c7, c14, c30)) {
                if (productInfo) {
                    productInfo.customerCount = c7;
                    productInfo.customerCount30 = c30;
                    addProductToResultsWindow(productInfo);
                    chrome.runtime.sendMessage({ action: "addPotentialProduct", product: productInfo });
                }
            }
            const showQty = ebaySettings.schDataDisplay === 'both' || ebaySettings.schDataDisplay === 'quantity';
            const showCust = ebaySettings.schDataDisplay === 'both' || ebaySettings.schDataDisplay === 'customers';
            let htmlContent = '';
            if (ebaySettings.schDisplay7Days) {
                let p = [];
                if (showQty) p.push(`<span style="color:#b91c1c; width: 45px; text-align: left;">Q${s7}</span>`);
                if (showCust) p.push(`<span style="color:#1e40af; width: 45px; text-align: left;">C${c7}</span>`);
                if (p.length > 0) htmlContent += `<div class="asl-sales-data-item"><span class="asl-sales-data-label">Last 7 Days:</span><span class="asl-sales-data-value" style="display: flex;">${p.join('')}</span></div>`;
            }
            if (ebaySettings.schDisplay14Days) {
                let p = [];
                if (showQty) p.push(`<span style="color:#b91c1c; width: 45px; text-align: left;">Q${s14}</span>`);
                if (showCust) p.push(`<span style="color:#1e40af; width: 45px; text-align: left;">C${c14}</span>`);
                if (p.length > 0) htmlContent += `<div class="asl-sales-data-item"><span class="asl-sales-data-label">Last 14 Days:</span><span class="asl-sales-data-value" style="display: flex;">${p.join('')}</span></div>`;
            }
            if (ebaySettings.schDisplay30Days) {
                let p = [];
                if (showQty) p.push(`<span style="color:#b91c1c; width: 45px; text-align: left;">Q${s30}</span>`);
                if (showCust) p.push(`<span style="color:#1e40af; width: 45px; text-align: left;">C${c30}</span>`);
                if (p.length > 0) htmlContent += `<div class="asl-sales-data-item"><span class="asl-sales-data-label">Last 30 Days:</span><span class="asl-sales-data-value" style="display: flex;">${p.join('')}</span></div>`;
            }
            container.innerHTML = htmlContent || '<div style="color: #6b7280; text-align: center;">No data to display.</div>';
        } catch (error) {
            if (error.message === 'FETCH_FAILED' && !hasRetried) {
                // Bu fonksiyon eskiden requestManager.block()'u hiç tetiklemiyordu, yani
                // otomasyon döngüsü art arda başarısız olsa bile hızını hiç düşürmüyordu.
                requestManager.block(4000);
                container.innerHTML = `<div style="text-align: center; color: #f59e0b;">Doğrulama algılandı, tekrar deneniyor...</div>`;
                chrome.runtime.sendMessage({ action: "solveCaptcha", url: `https://www.ebay.com/bin/purchaseHistory?item=${itemId}` });
                await new Promise(resolve => setTimeout(resolve, 3000));
                await fetchAndDisplayDetailedSales(itemId, triggerElement, isDirectMode, productInfo, true);
            } else {
                container.innerHTML = '<div style="color: #ef4444; text-align: center;">Doğrulama aşılamadı veya satış verisi yok.</div>';
            }
        } finally {
            if (!isDirectMode) triggerElement.remove();
        }
    }

    function createAmazonBtn(title) {
        const link = document.createElement('a');
        link.href = 'https://www.amazon.com/s?k=' + encodeURIComponent(title).replace(/%20/g, '+');
        link.target = '_blank';
        link.className = 'asl-search-amzn-link';
        const img = document.createElement('img');
        img.src = chrome.runtime.getURL('images/amazon-search-icon.png');
        img.alt = 'Search on Amazon';
        img.style.cssText = 'width: 88px; height: 35px; cursor: pointer; display:block;';
        link.appendChild(img);
        return link;
    }

    function createAvailabilityEl(result) {
        const div = document.createElement('div');
        div.style.cssText = 'margin-top: 6px; font-size: 14px; font-weight: 700; white-space: nowrap;';
        if (typeof result === 'object' && result !== null) {
            const info = result;
            const parts = [];
            div.style.color = '#b91c1c';
            if (ebaySettings.schDisplaySold) {
                if (info.sold) {
                    const soldMatch = info.sold.match(/([\d,]+)\s+sold/i);
                    const soldText = soldMatch ? `${soldMatch[1].replace(/,/g, '')} SOLD` : info.sold.toUpperCase();
                    parts.push(`🛒 ${soldText}`);
                } else {
                    parts.push('🛒 - SOLD');
                }
            }
            if (info.watchers && ebaySettings.schDisplayWatchers) parts.push(`${info.watchers} WATCHERS`);
            if (info.available && ebaySettings.schDisplayAvailable) {
                let availText = /more than 10 available/i.test(info.available) ? '10+ AVAILABLE' :
                    info.available.match(/(\d+)\s+available/i) ? `${info.available.match(/(\d+)\s+available/i)[1]} AVAILABLE` : info.available.toUpperCase();
                parts.push(availText);
            }
            if (parts.length > 0) {
                div.textContent = parts.join(' | ');
            } else {
                div.textContent = '-';
                div.style.color = '#6b7280';
            }
        } else {
            switch (result) {
                case 'ENDED': div.textContent = 'Durum: Liste Sonlanmış'; div.style.color = '#6b7280'; break;
                case null:
                default: div.textContent = 'HATA: Veri Alınamadı'; div.style.color = '#ef4444'; break;
            }
        }
        return div;
    }

    // Botluk tespiti çoğunlukla isteklerin çok düzenli/mekanik aralıklarla gelmesine bakıyor.
    // Gerçek bir kullanıcı bazen hızlı göz gezdirir, bazen bir ürünü okumak için durur, ara sıra
    // da uzunca bir mola verir (mesaj yazmak, başka sekmeye bakmak vb.) - sabit bir bant yerine
    // bu değişkenliği taklit ediyoruz.
    function humanPause() {
        const r = Math.random();
        if (r < 0.05) return 6000 + Math.random() * 6000;
        if (r < 0.35) return 1500 + Math.random() * 1500;
        return 400 + Math.random() * 600;
    }

    function simulateHumanGlance(card) {
        try {
            const rect = card.getBoundingClientRect();
            const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
            const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
            card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
            card.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
        } catch (e) {}
    }

    function getFirstItemId() {
        const cards = document.querySelectorAll('li.s-item, div.s-item, .su-card-container');
        for (const c of cards) {
            const a = c.querySelector('a[href*="/itm/"]');
            const m = a && a.href.match(/\/itm\/(\d+)/);
            if (m) return m[1];
        }
        return null;
    }

    // Sağlam sayfalama: eBay'in "sonraki" buton DOM'una (a.pagination__next) güvenmek yerine
    // URL'deki _pgn sayfa numarasını doğrudan artırıyoruz. eBay tasarımı değişse bile çalışır.
    // Herhangi bir satıcı sayfasında (canlı veya LH_Sold) geçerlidir.
    const AUTO_MAX_PAGES = 50;
    function tryAutoPagination() {
        if (!isAutomationMode) return;

        const cards = document.querySelectorAll('li.s-item, div.s-item, .su-card-container');
        const itemCount = Array.from(cards).filter(c => c.querySelector('.s-item__title, .s-card__title, .su-item-card__title')).length;

        const params = new URLSearchParams(window.location.search);
        const curPage = parseInt(params.get('_pgn') || '1', 10);
        const firstId = getFirstItemId();
        const prevFirstId = sessionStorage.getItem('idg_prevFirstId');

        // Durma koşulları:
        //  - Sayfada ürün yok (son sayfayı geçtik)
        //  - eBay son sayfaya "sabitlemiş" (ilk ürün önceki sayfayla aynı = tekrar)
        //  - Sert güvenlik limiti
        if (itemCount === 0 || (prevFirstId && firstId && prevFirstId === firstId) || curPage >= AUTO_MAX_PAGES) {
            sessionStorage.removeItem('idg_prevFirstId');
            chrome.runtime.sendMessage({ action: "closeSelf" });
            return;
        }

        if (firstId) sessionStorage.setItem('idg_prevFirstId', firstId);
        params.set('_pgn', String(curPage + 1));
        params.set('idg_auto', 'true');
        window.location.href = window.location.pathname + '?' + params.toString();
    }

    async function processAllStoreItemsSequentially() {
        const cards = document.querySelectorAll('li.s-item, div.s-item, .su-card-container');
        const items = Array.from(cards).filter(card => card.querySelector('.s-item__title, .s-card__title, .su-item-card__title') !== null);
        for (let i = 0; i < items.length; i++) {
            if (requestManager.isSolvingCaptcha) {
                while (requestManager.isSolvingCaptcha) await AslRequestDelay(200);
            }
            if (requestManager.checkStatus()) {
                while (requestManager.checkStatus()) await AslRequestDelay(200);
            }
            const card = items[i];
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await AslRequestDelay(250 + Math.floor(Math.random() * 400));
            simulateHumanGlance(card);
            try { addStaticElements(card); } catch(e) {}
            const timeLimitCountBefore = consecutiveTimeLimitExceeded;
            try {
                await handleCard(card);
            } catch (error) {
                if (error.message === 'CAPTCHA_REQUIRED') {
                    const linkEl = card.querySelector('a.s-item__link, a.su-link');
                    const itemUrl = linkEl ? linkEl.href : null;
                    const itemId = itemUrl ? getItemId(itemUrl) : null;
                    delete card.dataset.aslDynamicDone;
                    const urlToSolve = ebaySettings.schDisplayMode === 'direct' || !itemUrl ? `https://www.ebay.com/bin/purchaseHistory?item=${itemId}` : itemUrl;
                    requestManager.initiateCaptchaSolve(urlToSolve);
                    i--;
                    continue;
                }
            }
            if (consecutiveTimeLimitExceeded >= 10) {
                // Ardarda zaman dilimini aşan ürünler için hiç ağ isteği atılmadı, bekleyip
                // durmadan direkt kapatıyoruz.
                chrome.runtime.sendMessage({ action: "closeSelf" });
                return;
            }
            if (consecutiveTimeLimitExceeded > timeLimitCountBefore) {
                // Bu üründe zaman dilimi aşıldığı için handleCard hiç ağ isteği yapmadı;
                // CAPTCHA'dan korunmak için var olan bekleme burada gereksiz.
                continue;
            }
            // requestManager.getDelay() sadece 50-200ms civarı veriyor (CAPTCHA olmadan asla
            // artmıyor, çünkü bu döngünün kullandığı fetchAndDisplayDetailedSales hiçbir zaman
            // requestManager.block()'u tetiklemiyordu (aşağıda düzeltildi); gerçek bir
            // başarısızlık olduğunda o artık devreye girip yavaşlatıyor. Burada da sabit bir
            // bant yerine insansı, değişken bir bekleme kullanıyoruz.
            await AslRequestDelay(requestManager.getDelay(ebaySettings.schDisplayMode) + humanPause());
        }
        tryAutoPagination();
    }
    
    async function processAllItemsSequentially() {
        const cards = document.querySelectorAll('li.s-item, div.s-item, .su-card-container');
        const items = Array.from(cards).filter(card => card.querySelector('.s-item__title, .s-card__title, .su-item-card__title') !== null);
        for (let i = 0; i < items.length; i++) {
            const card = items[i];
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await AslRequestDelay(250 + Math.floor(Math.random() * 400));
            simulateHumanGlance(card);
            card.style.border = "3px solid #8e44ad";
            try { addStaticElements(card); } catch(e) {}
            try { await findOtherSellers(null, card, true); } catch (e) {}
            card.style.border = "3px solid #2ecc71";
            // findOtherSellers her kartta bir eBay araması yapıyor ve hiç hız korumasına
            // sahip değildi; sabit bir bant yerine insansı, değişken bir bekleme kullanıyoruz.
            await AslRequestDelay(humanPause());
        }
    }

    function createAutoScanButton() {
        const buttonId = 'asl-auto-scan-trigger';
        if (document.getElementById(buttonId)) return;
        const btn = document.createElement('button');
        btn.id = buttonId;
        btn.className = 'indygrab-btn';
        btn.innerHTML = '🔍 Sayfayı Tara & AI Eşle';
        btn.style.cssText = `position: fixed; bottom: 20px; right: 20px; z-index: 9999; background-color: #8e44ad; box-shadow: 0 4px 12px rgba(0,0,0,0.2); padding: 12px 20px; font-size: 14px; border: 2px solid #fff;`;
        btn.onclick = async () => {
            if (isAutoScanning) {
                alert("Tarama zaten devam ediyor!");
                return;
            }
            await forbiddenCategoriesReady;
            const riskyCat = checkForbiddenCategories();
            if (riskyCat) {
                alert(`⚠️ BU SAYFADA İŞLEM YAPILAMAZ!\n\nTespit Edilen Yasaklı Kategori: "${riskyCat}"\n\nDropshipping için riskli olduğu (Auto Parts/Books) için işlem engellendi.`);
                return;
            }
            if(!confirm("Bu sayfadaki tüm ürünler sırayla taranacak, satıcılar bulunacak ve AI ile eşleştirme yapılıp kaydedilecek. Bu işlem uzun sürebilir. Başlatılsın mı?")) return;
            btn.innerHTML = '⏳ Tarama Yapılıyor...';
            btn.style.backgroundColor = '#7f8c8d';
            isAutoScanning = true;
            await processAllItemsSequentially();
            isAutoScanning = false;
            btn.innerHTML = '✅ Tarama Tamamlandı';
            btn.style.backgroundColor = '#27ae60';
            setTimeout(() => {
                btn.innerHTML = '🔍 Sayfayı Tara & AI Eşle';
                btn.style.backgroundColor = '#8e44ad';
            }, 5000);
        };
        document.body.appendChild(btn);
    }

    window.initializeSearchPageObservers = function() {
        createAutoScanButton();
        createC4ResultsWindow();
        if (isAutomationMode || isAnalysisMode) return; 
        const intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const card = entry.target;
                    intersectionObserver.unobserve(card);
                    handleCard(card);
                }
            });
        }, { rootMargin: '300px 0px 300px 0px', threshold: 0.01 });
        const mutationObserver = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.matches('li.s-item, div.s-item, .su-card-container')) {
                            addStaticElements(node);
                            intersectionObserver.observe(node);
                        }
                    });
                }
            }
        });
        const targetNode = document.querySelector('.srp-results .s-list__container, #srp-results');
        if (targetNode) {
            mutationObserver.observe(targetNode, { childList: true, subtree: true });
            const initialCards = targetNode.querySelectorAll('li.s-item, div.s-item, .su-card-container');
            initialCards.forEach(card => { addStaticElements(card); intersectionObserver.observe(card); });
        } else {
            mutationObserver.observe(document.body, { childList: true, subtree: true });
            const initialCards = document.querySelectorAll('li.s-item, div.s-item, .su-card-container');
            initialCards.forEach(card => { addStaticElements(card); intersectionObserver.observe(card); });
        }
    };
})();

if (document.readyState === 'complete') {
    loadEbaySettings();
} else {
    window.addEventListener('load', loadEbaySettings, { once: true });
}

let styleSheet = document.createElement("style");
styleSheet.textContent = `
    .asl-sales-breakdown-btn { background-color: #f3f4f6; color: #374151; font-size: 12px; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 5px; cursor: pointer; margin-top: 7px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s ease; }
    .asl-sales-breakdown-btn:hover { background-color: #e5e7eb; border-color: #9ca3af; transform: translateY(-1px); }
    .asl-sales-breakdown-btn:active { transform: translateY(0); }
    .asl-sales-breakdown-btn.loading { opacity: 0.7; cursor: progress; }
    .asl-sales-data-container { font-size: 13px; color: #111827; margin-top: 8px; padding: 10px; background-color: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; animation: fadeIn 0.3s ease-out; max-width: 240px; box-sizing: border-box; }
    .asl-sales-data-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e5e7eb; }
    .asl-sales-data-item:last-child { border-bottom: none; }
    .asl-sales-data-label { font-weight: 500; color: #4b5563; }
    .asl-sales-data-value { font-weight: 600; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 1s linear infinite; }
    .indygrab-main-container { margin-top: 20px; }
    .indygrab-buttons-container { margin: 8px 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .indygrab-btn { background-color: #4a90e2; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; font-weight: 600; color: #fff; font-family: 'Inter', sans-serif; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center; height: 35px; box-sizing: border-box; }
    .indygrab-btn:hover { background-color: #357abd; box-shadow: 0 4px 8px rgba(0,0,0,0.15); transform: translateY(-1px); }
    .indygrab-btn:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
    .indygrab-btn-find-sellers { background-color: #16a34a; }
    .indygrab-btn-find-sellers:hover { background-color: #15803d; }
    .indygrab-buttons-container img:hover { opacity: 0.8; }
    .asl-seller-carousel { display: flex; align-items: center; justify-content: center; margin-top: 12px; padding: 8px; background-color: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; }
    .asl-carousel-viewport { overflow: hidden; margin: 0 5px; }
    .asl-carousel-filmstrip { display: flex; gap: 8px; transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
    .asl-carousel-item-wrapper { position: relative; flex-shrink: 0; }
    .asl-carousel-filmstrip a { display: flex; flex-direction: column; flex-shrink: 0; text-decoration: none; background-color: #fff; border: 1px solid #e5e7eb; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; }
    .asl-carousel-filmstrip .image-container { width: 100%; overflow: hidden; }
    .asl-carousel-filmstrip img { width: 100%; height: 100%; object-fit: contain; transition: transform 0.25s ease; display: block; }
    .asl-carousel-filmstrip a:hover img { transform: scale(1.05); }
    .asl-carousel-seller-info { text-align: center; padding: 4px; border-top: 1px solid #f3f4f6; }
    .seller-name, .seller-feedback { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .seller-name { font-size: 12px; font-weight: 600; color: #374151; }
    .seller-feedback { font-size: 11px; color: #6b7280; }
    .asl-carousel-arrow { background-color: #fff; border: 1px solid #d1d5db; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 24px; line-height: 24px; font-weight: bold; color: #4b5563; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding-bottom: 2px; transition: background-color 0.2s ease, border-color 0.2s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .asl-carousel-arrow:hover { background-color: #f3f4f6; border-color: #9ca3af; }
    .asl-carousel-arrow:disabled { opacity: 0.4; cursor: not-allowed; background-color: #f9fafb; }
    .seller-bookmark-star { position: absolute; top: 4px; right: 4px; background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(0,0,0,0.1); border-radius: 50%; cursor: pointer; padding: 4px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; opacity: 0.8; transition: all 0.2s ease; }
    .seller-bookmark-star:hover { opacity: 1; transform: scale(1.1); background: rgba(255, 255, 255, 0.95); }
    .seller-bookmark-star svg { width: 16px; height: 16px; stroke: #4b5563; transition: all 0.2s ease; }
    .seller-bookmark-star:hover svg { stroke: #000; }
    .seller-bookmark-star.saved svg { stroke: #f7b000; fill: #f7b000; }
    .seller-bookmark-star:disabled { cursor: not-allowed; }
    .asl-carousel-item-wrapper.blacklisted > a { border-color: #e74c3c; border-width: 2px; }
    .asl-carousel-item-wrapper.blacklisted { opacity: 0.7; }
    .asl-blacklist-warning, .asl-already-saved-warning { font-size: 11px; font-weight: bold; color: #fff; padding: 2px 4px; border-radius: 3px; margin-top: 3px; display: inline-block; }
    .asl-blacklist-warning { background-color: #e74c3c; }
    .asl-carousel-item-wrapper.blacklisted .seller-bookmark-star { cursor: not-allowed; opacity: 0.5; }
    .asl-carousel-item-wrapper.already-saved > a { border-color: #3498db; border-width: 2px; }
    .asl-carousel-item-wrapper.already-saved { opacity: 0.8; }
    .asl-already-saved-warning { background-color: #3498db; }
    .sales-analysis-container { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; background-color: #fff; font-family: 'Inter', sans-serif; max-width: 600px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); }
    .sales-analysis-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .sales-analysis-title { font-size: 16px; font-weight: 600; margin: 0; color: #111827; }
    .powered-by { font-size: 11px; color: #6b7280; }
    .date-range-buttons { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .date-range-btn { background-color: #f3f4f6; color: #374151; font-size: 12px; padding: 6px 12px; font-weight: 500; height: auto;}
    .date-range-btn:hover { background-color: #e5e7eb; color: #111827; }
    .date-range-btn.active { background-color: #4a90e2; color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
    .total-sales { font-size: 14px; font-weight: 500; color: #111827; margin-bottom: 12px; }
    .sales-chart { width: 100%; height: auto; display: block; }
    .sales-chart .axis text { font-size: 11px; fill: #6b7280; text-anchor: middle; }
    .sales-chart .y-axis text { text-anchor: end; }
    .sales-chart .grid-line { stroke: #e5e7eb; stroke-width: 1.5; }
    .sales-chart .chart-bar { opacity: 0; animation: fadeIn 0.5s ease-out forwards; transition: opacity 0.2s ease; }
    .bar-group:hover .chart-bar { opacity: 0.85; }
    .sales-chart .chart-no-data, .sales-chart .chart-loading, .sales-chart .chart-error { font-size: 14px; fill: #6b7280; font-weight: 500; }
    .sales-chart .chart-legend text { font-size: 12px; fill: #374151; font-weight: 500; dominant-baseline: middle; }
    .chart-tooltip { position: fixed; display: none; background: #111827; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; pointer-events: none; z-index: 9999; text-align: center; line-height: 1.5; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); transition: top 0.1s ease, left 0.1s ease; }
    #indygrab-c4-results-window { position: fixed; top: 20px; right: 20px; width: 350px; max-height: 80vh; background-color: #fff; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 99999; display: none; flex-direction: column; }
    .c4-window-header { padding: 8px 12px; background-color: #f5f5f5; font-weight: bold; cursor: move; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; border-top-left-radius: 8px; border-top-right-radius: 8px; }
    .c4-window-close { border: none; background: transparent; font-size: 20px; cursor: pointer; padding: 0 5px; }
    .c4-results-list { overflow-y: auto; padding: 8px; flex-grow: 1; }
    .c4-result-item { display: flex; align-items: center; gap: 10px; padding: 8px; border-bottom: 1px solid #eee; }
    .c4-result-item:last-child { border-bottom: none; }
    .c4-item-image { width: 60px; height: 60px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .c4-item-details { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
    .c4-item-title { font-size: 13px; margin: 0; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; }
    .c4-button-group { display: flex; gap: 8px; align-items: center; }
    .c4-amazon-button { background-color: #f0c14b; color: #111; text-align: center; padding: 5px 10px; font-size: 12px; font-weight: 500; border-radius: 4px; text-decoration: none; border: 1px solid #a88734; width: fit-content; }
    .c4-amazon-button:hover { background-color: #e4b335; }
    .c4-amazon-fetch-button { background-color: #2a752d; color: #fff; text-align: center; padding: 5px 10px; font-size: 12px; font-weight: 500; border-radius: 4px; text-decoration: none; border: 1px solid #1c501f; cursor: pointer; width: fit-content; }
    .c4-amazon-fetch-button:hover { background-color: #215c24; }
    .c4-amazon-fetch-button:disabled { background-color: #6b7280; cursor: not-allowed; border-color: #4b5563; }
    .c4-bookmark-star { background: transparent; border: none; cursor: pointer; padding: 4px; align-self: flex-start; }
    .c4-bookmark-star svg { width: 20px; height: 20px; stroke: #666; transition: all 0.2s ease; }
    .c4-bookmark-star:hover svg { stroke: #111; fill: #ffeb8a; }
    .c4-bookmark-star.saved svg { stroke: #f7b000; fill: #f7b000; }
    .c4-bookmark-star:disabled { cursor: not-allowed; }
`;
document.head.appendChild(styleSheet);
