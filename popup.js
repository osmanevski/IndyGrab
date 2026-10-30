document.addEventListener("DOMContentLoaded", async function () {
    // LOCAL MODE: Lisans kontrolü kaldırıldı. Tüm özellikler yerel olarak aktiftir.

    const translations = {
        en: {
            add_words: "Add words…", search_words: "Search words…", add_word: "Add", copy_words: "Copy words", select_value: "Select…",
            title: "IndyGrab", tab_collect: "Collect", tab_filter: "Filter", tab_memory: "Memory", blacklist: "Blacklist",
            save_to_memory: "Save to Memory", feedback_stars: "Feedback Stars", stars_1: "1 Star and above",
            stars_2: "2 Stars and above", stars_3: "3 Stars and above", stars_4: "4 Stars and above",
            stars_4_1: "4.1 Stars and above", stars_4_2: "4.2 Stars and above", stars_4_3: "4.3 Stars and above",
            stars_4_4: "4.4 Stars and above", stars_4_5: "4.5 Stars and above", stars_4_6: "4.6 Stars and above",
            stars_4_7: "4.7 Stars and above", stars_4_8: "4.8 Stars and above", stars_4_9: "4.9 Stars and above",
            stars_5: "5 Stars and above", banned_words: "Banned Words", feedback_score: "Feedback Score",
            price_range: "Price Range", max_bsr: "Subcategory rank", bsr_off: "Off — faster scan", bsr_loose: "Loose — selling (≤ 10,000)", bsr_medium: "Medium — steady sellers (≤ 3,000)", bsr_strict: "Strict — strong sellers (≤ 1,000)", asin_count: "Number of ASINs to Fetch", shipping_selection: "Shipping Selection",
            shipping_all: "All Products", shipping_prime: "Prime Only", shipping_1day: "1-Day Shipping",
            shipping_2day: "2-Day Shipping", min_stock_count: "Minimum Stock Count", stock_ignore: "Ignore Stock Filter",
            stock_exclude_warning: "Exclude Stock Warning", stock_1: "At least 1 stock", stock_2: "At least 2 stock",
            stock_3: "At least 3 stock", stock_4: "At least 4 stock", stock_5: "At least 5 stock", stock_6: "At least 6 stock",
            stock_7: "At least 7 stock", stock_8: "At least 8 stock", stock_9: "At least 9 stock", stock_10: "At least 10 stock",
            stock_11: "At least 11 stock", stock_12: "At least 12 stock", stock_13: "At least 13 stock", stock_14: "At least 14 stock",
            stock_15: "At least 15 stock", stock_16: "At least 16 stock", stock_17: "At least 17 stock", stock_18: "At least 18 stock",
            stock_19: "At least 19 stock", stock_20: "At least 20 stock", sort_order: "Sort Order", sort_random: "Random",
            sort_price_low_to_high: "Price: Low to High", sort_price_high_to_low: "Price: High to Low",
            sort_feedback_low_to_high: "Feedback Score: Low to High", sort_feedback_high_to_low: "Feedback Score: High to Low",
            sort_bsr_low_to_high: "BSR: Best to Worst (1...)", memory_limit: "Memory Limit: 20000 ASIN", copy_all: "Copy All", shuffle: "Shuffle", clear_memory: "Clear Memory",
            export_csv: "Export as CSV", export_json: "Export as JSON", saved_to_memory: "Saved to memory!",
            memory_limit_exceeded: "Memory limit (20000 ASIN) exceeded!", asins_shuffled: "ASINs shuffled!",
            asins_copied: "ASINs copied!", banned_words_copied: "Banned words copied!", memory_cleared: "Memory cleared!",
            copy_failed: "Copy failed!", export_success: "Exported successfully!", export_failed: "Export failed!",
            export_history: "Export History", howToUse: "How to Use?", asins_refreshed: "ASINs refreshed!",
            historical_asins_unavailable: "Historical ASINs unavailable, using current memory.", feature_toggles: "Amazon Features",
            toggle_stock: "Stock Quantity", toggle_prime: "Prime Indicator", toggle_rating: "Rating/Feedback",
            toggle_banned_warning: "Banned Word Warning", toggle_copy_icon: "Copy Icon", toggle_save_icon: "Save Icon",
            toggle_ebay_icon: "eBay Search Icon", toggle_bsr_display: "BSR Display Mode", bsr_general: "General", bsr_deep: "Deep",
            ebay_features: "eBay Features", ebay_chart_settings: "Product Page Settings", ebay_default_range: "Default Date Range:",
            ebay_data_display: "Data to Display:", ebay_days_7: "Last 7 Days", ebay_days_14: "Last 14 Days", ebay_days_30: "Last 30 Days",
            ebay_display_both: "Quantity & Customers", ebay_display_quantity: "Quantity Only", ebay_display_customers: "Customers Only",
            ebay_sch_settings: "Search Page Settings", ebay_sch_range: "Date Ranges to Show:", ebay_sch_info: "Info to Show:",
            ebay_sch_sold: "Sold", ebay_sch_watchers: "Watchers", ebay_sch_available: "Available", word_saved: "Word(s) saved!",
            word_exists: "This word(s) already exists.", ebay_sch_display_mode: "Data Display Mode", ebay_sch_mode_standard: "Standard (Info + Breakdown Button)",
            ebay_sch_mode_direct: "Direct Sales Breakdown", ebay_sch_seller_sale_days_label: "Last sale window (days)",
            ebay_sch_seller_sale_days_placeholder: "e.g. 7", ebay_asins_saved: "{count} ASIN(s) fetched from Amazon and saved to memory!",
            send_to_blacklist: "Send to Blacklist", sent_to_blacklist: "ASINs added to Blacklist!", no_asin_memory: "No ASIN in memory!",
            auto_collect: "Auto Collect Settings", auto_page_limit: "Number of Pages to Navigate:", auto_asin_limit: "Total ASINs to Collect:",
            filter_group_product: "Product", filter_group_sales: "Sales conditions", filter_group_collection: "Result selection", result_selection_help: "How many of the products passing the filters on each search page are taken, and in which order. Applies to page collection and to Amazon fetches from eBay products.", auto_limits_title: "Auto collect limits", auto_limits_help: "Auto collect stops at this page count or total ASIN count; leave empty for no limit. Scan page is not affected."
        },
        tr: {
            add_words: "Kelime ekle…", search_words: "Kelime ara…", add_word: "Ekle", copy_words: "Kelimeleri kopyala", select_value: "Seç…",
            title: "IndyGrab", tab_collect: "Topla", tab_filter: "Filtre", tab_memory: "Havuz", blacklist: "Kara Liste",
            save_to_memory: "Hafızaya Kaydet", feedback_stars: "Ürün puanı", stars_1: "1 Yıldız ve üstü",
            stars_2: "2 Yıldız ve üstü", stars_3: "3 Yıldız ve üstü", stars_4: "4 Yıldız ve üstü", stars_4_1: "4.1 Yıldız ve üstü",
            stars_4_2: "4.2 Yıldız ve üstü", stars_4_3: "4.3 Yıldız ve üstü", stars_4_4: "4.4 Yıldız ve üstü",
            stars_4_5: "4.5 Yıldız ve üstü", stars_4_6: "4.6 Yıldız ve üstü", stars_4_7: "4.7 Yıldız ve üstü",
            stars_4_8: "4.8 Yıldız ve üstü", stars_4_9: "4.9 Yıldız ve üstü", stars_5: "5 Yıldız ve üstü",
            banned_words: "Yasaklı Kelimeler", feedback_score: "Yorum sayısı", price_range: "Fiyat Aralığı", max_bsr: "Alt kategori sırası", bsr_off: "Kapalı — tarama hızlı", bsr_loose: "Gevşek — satışı olanlar (≤ 10.000)", bsr_medium: "Orta — düzenli satanlar (≤ 3.000)", bsr_strict: "Sıkı — güçlü satanlar (≤ 1.000)",
            asin_count: "Arama başına ASIN sayısı", shipping_selection: "Kargo Seçimi", shipping_all: "Tüm Ürünler",
            shipping_prime: "Sadece Prime", shipping_1day: "1 Günlük Kargo", shipping_2day: "2 Günlük Kargo",
            min_stock_count: "Minimum Stok Sayısı", stock_ignore: "Stok Filtresini Önemseme", stock_exclude_warning: "Stok Uyarısı Olanları Hariç Tut",
            stock_1: "En az 1 stok", stock_2: "En az 2 stok", stock_3: "En az 3 stok", stock_4: "En az 4 stok",
            stock_5: "En az 5 stok", stock_6: "En az 6 stok", stock_7: "En az 7 stok", stock_8: "En az 8 stok",
            stock_9: "En az 9 stok", stock_10: "En az 10 stok", stock_11: "En az 11 stok", stock_12: "En az 12 stok",
            stock_13: "En az 13 stok", stock_14: "En az 14 stok", stock_15: "En az 15 stok", stock_16: "En az 16 stok",
            stock_17: "En az 17 stok", stock_18: "En az 18 stok", stock_19: "En az 19 stok", stock_20: "En az 20 stok",
            sort_order: "Sıralama Şekli", sort_random: "Rastgele", sort_price_low_to_high: "Düşük Fiyattan Yükseğe",
            sort_price_high_to_low: "Yüksek Fiyattan Düşüğe", sort_feedback_low_to_high: "Düşük Feedback Skorundan Yükseğe",
            sort_feedback_high_to_low: "Yüksek Feedback Skorundan Düşüğe", sort_bsr_low_to_high: "BSR: En İyiden En Kötüye (1...)", memory_limit: "Hafıza Limiti: 20000 ASIN",
            copy_all: "Hepsini Kopyala", shuffle: "Karıştır", clear_memory: "Hafızayı Temizle", export_csv: "CSV Olarak Dışa Aktar",
            export_json: "JSON Olarak Dışa Aktar", saved_to_memory: "Hafızaya kaydedildi!",
            memory_limit_exceeded: "Hafıza limiti (20000 ASIN) aşıldı!", asins_shuffled: "ASIN'ler karıştırıldı!",
            asins_copied: "ASIN'ler kopyalandı!", banned_words_copied: "Yasaklı kelimeler kopyalandı!",
            memory_cleared: "Hafıza temizlendi!", copy_failed: "Kopyalama başarısız!", export_success: "Başarıyla dışa aktarıldı!",
            export_failed: "Dışa aktarma başarısız!", export_history: "Dışa Aktarma Geçmişi", howToUse: "Nasıl Kullanılır?",
            asins_refreshed: "ASIN'ler yenilendi!", historical_asins_unavailable: "Geçmiş ASIN'ler mevcut değil, mevcut hafıza kullanılıyor.",
            feature_toggles: "Amazon Özellikleri", toggle_stock: "Stok Miktarı", toggle_prime: "Prime Göstergesi",
            toggle_rating: "Derecelendirme/Geri Bildirim", toggle_banned_warning: "Yasaklı Kelime Uyarısı",
            toggle_copy_icon: "Kopyala Simgesi", toggle_save_icon: "Kaydet Simgesi", toggle_ebay_icon: "eBay Arama Simgesi",
            toggle_bsr_display: "BSR Gösterimi", bsr_general: "Genel", bsr_deep: "Derin", ebay_features: "eBay Özellikleri",
            ebay_chart_settings: "Ürün Sayfası Ayarları", ebay_default_range: "Varsayılan Tarih Aralığı:",
            ebay_data_display: "Gösterilecek Veri:", ebay_days_7: "Son 7 Gün", ebay_days_14: "Son 14 Gün",
            ebay_days_30: "Son 30 Gün", ebay_display_both: "Adet & Müşteri", ebay_display_quantity: "Sadece Adet",
            ebay_display_customers: "Sadece Müşteri", ebay_sch_settings: "Arama Sayfası Ayarları", ebay_sch_range: "Gösterilecek Tarih Aralıkları:",
            ebay_sch_info: "Gösterilecek Bilgiler:", ebay_sch_sold: "Satılan", ebay_sch_watchers: "İzleyen",
            ebay_sch_available: "Mevcut", word_saved: "Kelime(ler) kaydedildi!", word_exists: "Bu kelime(ler) zaten kayıtlı.",
            ebay_sch_display_mode: "Veri Gösterim Modu", ebay_sch_mode_standard: "Standart (Bilgi + Detay Butonu)",
            ebay_sch_mode_direct: "Doğrudan Satış Detayları", ebay_sch_seller_sale_days_label: "Son satış aralığı (gün)",
            ebay_sch_seller_sale_days_placeholder: "Örn. 7", ebay_asins_saved: "{count} ASIN Amazon'dan çekilip hafızaya kaydedildi!",
            send_to_blacklist: "Kara Listeye Gönder", sent_to_blacklist: "ASIN'ler Kara Listeye Eklendi!", no_asin_memory: "Hafızada ASIN yok!",
            auto_collect: "Otomatik Toplama Ayarları", auto_page_limit: "Gezilecek Sayfa Sayısı:", auto_asin_limit: "Toplanacak Toplam ASIN:",
            filter_group_product: "Ürün", filter_group_sales: "Satış koşulları", filter_group_collection: "Sonuç seçimi", result_selection_help: "Her arama sayfasında filtreleri geçen ürünlerden kaçının ve hangi sırayla alınacağı. Sayfa toplamada da eBay ürünlerinden Amazon çekiminde de geçerli.", auto_limits_title: "Otomatik toplama sınırları", auto_limits_help: "Otomatik toplama bu sayfa sayısına ya da toplam ASIN sayısına ulaşınca durur; boş bırakırsan sınır yok. Sayfayı tara düğmesini etkilemez."
        }
    };

    let saveToMemoryBtn = document.getElementById("saveToMemoryBtn");
    let copyAllBtn = document.getElementById("copyAllBtn");
    let exportCsvBtn = document.getElementById("exportCsvBtn");
    let exportJsonBtn = document.getElementById("exportJsonBtn");
    let clearMemoryBtn = document.getElementById("clearMemoryBtn");
    let mixMemoryBtn = document.getElementById("mixMemoryBtn");
    let sendToBlacklistBtn = document.getElementById("sendToBlacklistBtn");
    let ratingFilter = document.getElementById("ratingFilter");
    let feedbackFilter = document.getElementById("feedbackFilter");
    let maxFeedbackFilter = document.getElementById("maxFeedbackFilter");
    let shippingFilter = document.getElementById("shippingFilter");
    let asinCountInput = document.getElementById("asinCount");
    let minPriceFilter = document.getElementById("minPriceFilter");
    let maxPriceFilter = document.getElementById("maxPriceFilter");
    let maxBsrFilter = document.getElementById("maxBsrFilter");
    let stockFilter = document.getElementById("stockFilter");
    let sortFilter = document.getElementById("sortFilter");

    let bannedWordInput = document.getElementById("bannedWordInput");
    let addBannedWordBtn = document.getElementById("addBannedWordBtn");
    let bannedWordsContainer = document.getElementById("bannedWordsContainer");
    let searchBannedWordInput = document.getElementById("searchBannedWordInput");
    let copyBannedWordsBtn = document.getElementById("copyBannedWordsBtn");
    let bannedWordCount = document.getElementById("bannedWordCount");
    let bannedWordsList = [];

    let asinOutput = document.getElementById("asinOutput");
    let memoryOutput = document.getElementById("memoryOutput");
    let notification = document.getElementById("notification");
    let tabMemory = document.querySelector(".tab[data-tab='memory']");
    let langFlags = document.querySelectorAll(".lang-flag");
    let exportHistoryList = document.getElementById("exportHistoryList");
    let updateBtn = document.getElementById("updateBtn");
    let startAutoBtn = document.getElementById("startAutoBtn");
    let stopAutoBtn = document.getElementById("stopAutoBtn");
    let autoPageLimitInput = document.getElementById("autoPageLimit");
    let autoAsinLimitInput = document.getElementById("autoAsinLimit");

    let toggleStock = document.getElementById("toggleStock");
    let togglePrime = document.getElementById("togglePrime");
    let toggleRating = document.getElementById("toggleRating");
    let toggleBannedWarning = document.getElementById("toggleBannedWarning");
    let toggleCopyIcon = document.getElementById("toggleCopyIcon");
    let toggleSaveIcon = document.getElementById("toggleSaveIcon");
    let toggleEbayIcon = document.getElementById("toggleEbayIcon");
    let bsrDisplayMode = document.getElementById("bsrDisplayMode");

    let ebayChartDefaultDays = document.getElementById("ebayChartDefaultDays");
    let ebayChartDisplay = document.getElementById("ebayChartDisplay");
    let schDisplay7Days = document.getElementById("schDisplay7Days");
    let schDisplay14Days = document.getElementById("schDisplay14Days");
    let schDisplay30Days = document.getElementById("schDisplay30Days");
    let schDataDisplay = document.getElementById("schDataDisplay");
    let schDisplaySold = document.getElementById("schDisplaySold");
    let schDisplayWatchers = document.getElementById("schDisplayWatchers");
    let schDisplayAvailable = document.getElementById("schDisplayAvailable");
    let schDisplayMode = document.getElementById("schDisplayMode");
    let schSellerSaleDays = document.getElementById("schSellerSaleDays");

    let currentLang = "tr";
    let currentMemoryPage = 1;
    const MEMORY_ITEMS_PER_PAGE = 100;


    // Display settings still reach every open Amazon tab. Collection runs only in the panel's
    // own background window (background.js) and never in the user's tabs.
    async function broadcastToAmazonTabs(message) {
        try {
            const tabs = await chrome.tabs.query({ url: ["*://*.amazon.com/*", "*://*.amazon.co.uk/*", "*://*.amazon.de/*", "*://*.amazon.ca/*", "*://*.amazon.com.au/*"] });
            await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
        } catch (e) {}
    }

    chrome.storage.local.get("language", (data) => {
        currentLang = data.language || "tr";
        updateLanguage();
        updateDynamicUI();
        updateFlagSelection();
        updateMemoryUI();
        loadFeatureToggles();
        loadEbaySettings();
    });

    langFlags.forEach(flag => {
        flag.addEventListener("click", function () {
            currentLang = this.getAttribute("data-lang");
            chrome.storage.local.set({ language: currentLang }, () => {
                updateLanguage();
                updateDynamicUI();
                updateFlagSelection();
                updateMemoryUI();
            });
        });
    });

    function updateFlagSelection() {
        langFlags.forEach(flag => {
            flag.classList.toggle("selected", flag.getAttribute("data-lang") === currentLang);
        });
    }

    function updateLanguage() {
        document.querySelectorAll("[data-i18n]").forEach(element => {
            const key = element.getAttribute("data-i18n");
            if (element.id !== "saveToMemoryBtn" && element.id !== "copyAllBtn" && element.id !== "tabMemory") {
                element.textContent = translations[currentLang][key];
            }
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
            const key = element.getAttribute("data-i18n-placeholder");
            element.placeholder = translations[currentLang][key];
        });
        document.documentElement.lang = currentLang;
    }

    function updateDynamicUI() {
        chrome.storage.local.get(["asinList", "memoryAsins"], (data) => {
            let asinList = data.asinList || [];
            let memoryAsins = data.memoryAsins || [];
            saveToMemoryBtn.textContent = `${translations[currentLang].save_to_memory} (${asinList.length} ASIN)`;
            copyAllBtn.textContent = `${translations[currentLang].copy_all} (${memoryAsins.length} ASIN)`;
            tabMemory.textContent = `${translations[currentLang].tab_memory} (${memoryAsins.length})`;
        });
    }

    function updateMemoryUI() {
        chrome.storage.local.get("memoryAsins", (data) => {
            let memoryAsins = data.memoryAsins || [];
            memoryOutput.innerHTML = "";
            let memoryPagination = document.getElementById('memoryPagination');

            if (memoryAsins.length === 0) {
                memoryOutput.innerHTML = `<p>${translations[currentLang].memory_limit}</p>`;
                if (memoryPagination) memoryPagination.style.display = 'none';
                copyAllBtn.textContent = `${translations[currentLang].copy_all} (0 ASIN)`;
                tabMemory.textContent = `${translations[currentLang].tab_memory} (0)`;
                return;
            }

            const totalPages = Math.ceil(memoryAsins.length / MEMORY_ITEMS_PER_PAGE);
            if (currentMemoryPage > totalPages) currentMemoryPage = totalPages;
            if (currentMemoryPage < 1) currentMemoryPage = 1;

            const startIndex = (currentMemoryPage - 1) * MEMORY_ITEMS_PER_PAGE;
            const paginatedAsins = memoryAsins.slice(startIndex, startIndex + MEMORY_ITEMS_PER_PAGE);

            paginatedAsins.forEach(asin => {
                const row = document.createElement("div");
                row.className = "asin-row";
                const deleteIcon = document.createElement("img");
                deleteIcon.src = "images/delete-icon.png";
                deleteIcon.className = "delete-icon";
                deleteIcon.title = "Delete ASIN";
                deleteIcon.addEventListener("click", () => {
                    chrome.storage.local.get("memoryAsins", (data) => {
                        let updatedAsins = data.memoryAsins.filter(a => a !== asin);
                        chrome.storage.local.set({ memoryAsins: updatedAsins }, () => {
                            updateMemoryUI();
                            showNotification(`${asin} deleted!`, 1000);
                        });
                    });
                });
                const asinSpan = document.createElement("span");
                asinSpan.className = "asin-column";
                const link = document.createElement("a");
                link.href = `https://www.amazon.com/dp/${asin}`;
                link.textContent = asin;
                link.target = "_blank";
                asinSpan.appendChild(link);
                row.appendChild(deleteIcon);
                row.appendChild(asinSpan);
                memoryOutput.appendChild(row);
            });

            copyAllBtn.textContent = `${translations[currentLang].copy_all} (${memoryAsins.length} ASIN)`;
            tabMemory.textContent = `${translations[currentLang].tab_memory} (${memoryAsins.length})`;

            if (memoryPagination) {
                if (totalPages > 1) {
                    memoryPagination.style.display = 'flex';
                    memoryPagination.innerHTML = '';

                    const prevBtn = document.createElement('button');
                    prevBtn.textContent = '◀';
                    prevBtn.style.padding = '4px 10px';
                    prevBtn.style.width = 'auto';
                    prevBtn.style.margin = '0';
                    prevBtn.disabled = currentMemoryPage === 1;
                    prevBtn.onclick = () => { currentMemoryPage--; updateMemoryUI(); };

                    const info = document.createElement('span');
                    info.textContent = `${currentMemoryPage} / ${totalPages}`;
                    info.style.fontSize = '12px';
                    info.style.fontWeight = 'bold';

                    const nextBtn = document.createElement('button');
                    nextBtn.textContent = '▶';
                    nextBtn.style.padding = '4px 10px';
                    nextBtn.style.width = 'auto';
                    nextBtn.style.margin = '0';
                    nextBtn.disabled = currentMemoryPage === totalPages;
                    nextBtn.onclick = () => { currentMemoryPage++; updateMemoryUI(); };

                    memoryPagination.appendChild(prevBtn);
                    memoryPagination.appendChild(info);
                    memoryPagination.appendChild(nextBtn);
                } else {
                    memoryPagination.style.display = 'none';
                }
            }
        });
    }

    function loadFeatureToggles() {
        chrome.storage.local.get([
            "toggleStock", "togglePrime", "toggleRating",
            "toggleBannedWarning", "toggleCopyIcon", "toggleSaveIcon", "toggleEbayIcon",
            "bsrDisplayMode"
        ], (data) => {
            toggleStock.checked = data.toggleStock !== false;
            togglePrime.checked = data.togglePrime !== false;
            toggleRating.checked = data.toggleRating !== false;
            toggleBannedWarning.checked = data.toggleBannedWarning !== false;
            toggleCopyIcon.checked = data.toggleCopyIcon !== false;
            toggleSaveIcon.checked = data.toggleSaveIcon !== false;
            toggleEbayIcon.checked = data.toggleEbayIcon !== false;
            bsrDisplayMode.value = data.bsrDisplayMode || "general";
            updateFeatureToggles();
        });
    }

    function updateFeatureToggles() {
        const featureToggles = {
            toggleStock: toggleStock.checked,
            togglePrime: togglePrime.checked,
            toggleRating: toggleRating.checked,
            toggleBannedWarning: toggleBannedWarning.checked,
            toggleCopyIcon: toggleCopyIcon.checked,
            toggleSaveIcon: toggleSaveIcon.checked,
            toggleEbayIcon: toggleEbayIcon.checked,
            bsrDisplayMode: bsrDisplayMode.value
        };
        chrome.storage.local.set(featureToggles, () => {
            void broadcastToAmazonTabs({ updateFeatures: featureToggles });
        });
    }

    function loadEbaySettings() {
        chrome.storage.local.get([
            "ebayChartDefaultDays", "ebayChartDisplay", "schDisplay7Days",
            "schDisplay14Days", "schDisplay30Days", "schDataDisplay",
            "schDisplaySold", "schDisplayWatchers", "schDisplayAvailable",
            "schDisplayMode", "schSellerSaleDays", "advancedCatcher"
        ], (data) => {
            ebayChartDefaultDays.value = data.ebayChartDefaultDays || "7";
            ebayChartDisplay.value = data.ebayChartDisplay || "both";
            schDisplay7Days.checked = data.schDisplay7Days !== false;
            schDisplay14Days.checked = data.schDisplay14Days !== false;
            schDisplay30Days.checked = data.schDisplay30Days !== false;
            schDataDisplay.value = data.schDataDisplay || "both";
            schDisplaySold.checked = data.schDisplaySold !== false;
            schDisplayWatchers.checked = data.schDisplayWatchers !== false;
            schDisplayAvailable.checked = data.schDisplayAvailable !== false;
            schDisplayMode.value = data.schDisplayMode || "standard";
            schSellerSaleDays.value = data.schSellerSaleDays || "";
            updateEbaySettings();
        });
    }

    function updateEbaySettings() {
        chrome.storage.local.get(["advancedCatcher"], (data) => {
            const ebaySettings = {
                ebayChartDefaultDays: ebayChartDefaultDays.value,
                ebayChartDisplay: ebayChartDisplay.value,
                schDisplay7Days: schDisplay7Days.checked,
                schDisplay14Days: schDisplay14Days.checked,
                schDisplay30Days: schDisplay30Days.checked,
                schDataDisplay: schDataDisplay.value,
                schDisplaySold: schDisplaySold.checked,
                schDisplayWatchers: schDisplayWatchers.checked,
                schDisplayAvailable: schDisplayAvailable.checked,
                schDisplayMode: schDisplayMode.value,
                schSellerSaleDays: schSellerSaleDays.value,
                advancedCatcher: data.advancedCatcher || false
            };
            chrome.storage.local.set(ebaySettings, () => {
                chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (tabs[0] && tabs[0].url && tabs[0].url.includes("ebay.com")) {
                        chrome.tabs.sendMessage(tabs[0].id, { updateEbayFeatures: ebaySettings });
                    }
                });
            });
        });
    }

    ebayChartDefaultDays.addEventListener("change", updateEbaySettings);
    ebayChartDisplay.addEventListener("change", updateEbaySettings);
    schDisplay7Days.addEventListener("change", updateEbaySettings);
    schDisplay14Days.addEventListener("change", updateEbaySettings);
    schDisplay30Days.addEventListener("change", updateEbaySettings);
    schDataDisplay.addEventListener("change", updateEbaySettings);
    schDisplaySold.addEventListener("change", updateEbaySettings);
    schDisplayWatchers.addEventListener("change", updateEbaySettings);
    schDisplayAvailable.addEventListener("change", updateEbaySettings);
    schDisplayMode.addEventListener("change", updateEbaySettings);
    schSellerSaleDays.addEventListener("input", updateEbaySettings);

    const tabs = document.querySelectorAll(".tab");
    const tabContents = document.querySelectorAll(".tab-content");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tabContents.forEach(content => content.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab).classList.add("active");
            if (tab.dataset.tab === "memory") {
                updateExportHistoryUI();
                updateMemoryUI();
            }
            updateLanguage();
            updateDynamicUI();
        });
    });

    chrome.storage.local.get(
        ["rating", "feedback", "maxFeedback", "shipping", "asinCount", "minPrice", "maxPrice", "maxBsr", "stock", "sort", "bannedWords"],
        (data) => {
            ratingFilter.value = data.rating || "";
            feedbackFilter.value = data.feedback || "";
            maxFeedbackFilter.value = data.maxFeedback || "";
            shippingFilter.value = data.shipping || "";
            asinCountInput.value = data.asinCount || "";
            minPriceFilter.value = data.minPrice || "";
            maxPriceFilter.value = data.maxPrice || "";
            const storedBsr = data.maxBsr ? String(data.maxBsr) : "";
            // An older hand-typed value is kept as its own option instead of being silently reset.
            if (storedBsr && maxBsrFilter.options && ![...maxBsrFilter.options].some(o => o.value === storedBsr)) {
                const custom = document.createElement("option");
                custom.value = storedBsr;
                custom.textContent = `Özel (≤ ${Number(storedBsr).toLocaleString("tr-TR")})`;
                maxBsrFilter.appendChild(custom);
            }
            maxBsrFilter.value = storedBsr;
            stockFilter.value = data.stock || "";
            sortFilter.value = data.sort || "";

            const words = data.bannedWords || "";
            const initialWords = words ? words.split(',').map(w => w.trim()).filter(w => w) : [];
            bannedWordsList = [...new Set(initialWords)];
            renderBannedWords();

            updateFilters();
        }
    );

    function renderBannedWords() {
        bannedWordsContainer.innerHTML = "";
        const searchTerm = searchBannedWordInput.value.trim().toLowerCase();

        const listToDisplay = searchTerm
            ? bannedWordsList.filter(word => word.toLowerCase().includes(searchTerm))
            : bannedWordsList;

        listToDisplay.forEach(word => {
            const tag = document.createElement("div");
            tag.className = "banned-word-tag";
            tag.textContent = word;

            const removeBtn = document.createElement("span");
            removeBtn.className = "remove-word-btn";
            removeBtn.innerHTML = "&times;";
            removeBtn.onclick = () => {
                const wordToRemoveLC = word.toLowerCase();
                bannedWordsList = bannedWordsList.filter(w => w.toLowerCase() !== wordToRemoveLC);
                renderBannedWords();
                updateFilters();
            };

            tag.appendChild(removeBtn);
            bannedWordsContainer.appendChild(tag);
        });

        bannedWordCount.textContent = `${bannedWordsList.length} ${currentLang === "tr" ? "kelime" : "words"}`;
    }

    function addBannedWord() {
        const wordsToAdd = bannedWordInput.value.split(',')
            .map(w => w.trim())
            .filter(w => w);

        if (wordsToAdd.length === 0) {
            return;
        }

        let anyWordAdded = false;
        const currentWordsLC = bannedWordsList.map(w => w.toLowerCase());

        wordsToAdd.forEach(word => {
            if (!currentWordsLC.includes(word.toLowerCase())) {
                bannedWordsList.push(word);
                currentWordsLC.push(word.toLowerCase());
                anyWordAdded = true;
            }
        });

        if (anyWordAdded) {
            renderBannedWords();
            updateFilters();
            showNotification(translations[currentLang].word_saved, 2000);
        } else {
            showNotification(translations[currentLang].word_exists, 2000);
        }

        bannedWordInput.value = "";
        bannedWordInput.focus();
    }

    addBannedWordBtn.addEventListener("click", addBannedWord);
    bannedWordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addBannedWord();
        }
    });
    searchBannedWordInput.addEventListener("input", renderBannedWords);

    copyBannedWordsBtn.addEventListener("click", () => {
        if (bannedWordsList.length > 0) {
            navigator.clipboard.writeText(bannedWordsList.join(', ')).then(() => {
                showNotification(translations[currentLang].banned_words_copied, 1500);
            }).catch(() => {
                showNotification(translations[currentLang].copy_failed, 1500);
            });
        }
    });

    function updateFilters() {
        const filters = {
            rating: parseFloat(ratingFilter.value) || 0,
            feedback: parseInt(feedbackFilter.value) || 0,
            maxFeedback: parseInt(maxFeedbackFilter.value) || 0,
            minPrice: parseFloat(minPriceFilter.value) || 0,
            // Infinity YAZMA: chrome.storage JSON serileştirmesi bunu null'a çeviriyor ve
            // filtrede "price > null" her fiyatlı ürünü eliyordu. 0 = üst sınır yok.
            maxPrice: parseFloat(maxPriceFilter.value) || 0,
            maxBsr: parseInt(maxBsrFilter.value) || 0,
            bannedWords: bannedWordsList.join(','),
            shipping: shippingFilter.value,
            asinCount: asinCountInput.value,
            stock: stockFilter.value,
            sort: sortFilter.value
        };

        chrome.storage.local.set(filters);
    }

    ratingFilter.addEventListener("change", updateFilters);
    feedbackFilter.addEventListener("input", updateFilters);
    maxFeedbackFilter.addEventListener("input", updateFilters);
    shippingFilter.addEventListener("change", updateFilters);
    asinCountInput.addEventListener("input", updateFilters);
    minPriceFilter.addEventListener("input", updateFilters);
    maxPriceFilter.addEventListener("input", updateFilters);
    maxBsrFilter.addEventListener("change", updateFilters);
    stockFilter.addEventListener("change", updateFilters);
    sortFilter.addEventListener("change", updateFilters);

    chrome.storage.local.get(["autoPageLimit", "autoAsinLimit"], (data) => {
        autoPageLimitInput.value = Number.isFinite(data.autoPageLimit) ? data.autoPageLimit : "";
        autoAsinLimitInput.value = Number.isFinite(data.autoAsinLimit) ? data.autoAsinLimit : "";
    });

    // An empty limit means "no limit": the engine reads a missing value as Infinity.
    async function saveAutoCollectLimits() {
        const updates = {};
        const removals = [];
        [["autoPageLimit", autoPageLimitInput], ["autoAsinLimit", autoAsinLimitInput]].forEach(([key, input]) => {
            const value = parseInt(input.value, 10);
            if (value > 0) {
                updates[key] = value;
                input.value = value;
            } else {
                removals.push(key);
                input.value = "";
            }
        });
        if (removals.length) await chrome.storage.local.remove(removals);
        await chrome.storage.local.set(updates);
    }

    autoPageLimitInput.addEventListener("change", saveAutoCollectLimits);
    autoAsinLimitInput.addEventListener("change", saveAutoCollectLimits);

    const bgCollectInput = document.getElementById("bg-collect-input");
    const bgCollectStatus = document.getElementById("bg-collect-status");
    const BG_COLLECT_REASONS = {
        single_done: "Tarama bitti, arka plan penceresi kapandı.",
        auto_collect_page_limit: "Otomatik toplama sayfa sınırına ya da son sayfaya ulaştı, pencere kapandı.",
        auto_collect_asin_limit: "Otomatik toplama ASIN sınırına ulaştı, pencere kapandı.",
        auto_collect_stopped: "Toplama durduruldu.",
        stopped_by_user: "Toplama durduruldu.",
        window_closed: "Arka plan penceresi kapatıldı, toplama durdu.",
        timeout: "Sayfa yanıt vermedi, toplama durduruldu."
    };
    function renderBgCollect(session, last) {
        const running = Boolean(session);
        updateBtn.disabled = running;
        startAutoBtn.disabled = running;
        stopAutoBtn.disabled = !running;
        if (!bgCollectStatus) return;
        bgCollectStatus.dataset.state = running ? "running" : "idle";
        if (running) {
            bgCollectStatus.textContent = session.mode === "auto"
                ? "Otomatik toplama arka plan penceresinde sürüyor…"
                : "Sayfa arka plan penceresinde taranıyor…";
        } else if (last) {
            bgCollectStatus.textContent = BG_COLLECT_REASONS[last.reason] || "Toplama bitti.";
        } else {
            bgCollectStatus.textContent = "Hazır.";
        }
    }
    chrome.storage.local.get(["bgCollectSession", "bgCollectLast", "bgCollectInput"], (data) => {
        if (bgCollectInput) bgCollectInput.value = data.bgCollectInput || "";
        renderBgCollect(data.bgCollectSession, data.bgCollectLast);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !(changes.bgCollectSession || changes.bgCollectLast)) return;
        chrome.storage.local.get(["bgCollectSession", "bgCollectLast"], (data) => renderBgCollect(data.bgCollectSession, data.bgCollectLast));
    });
    if (bgCollectInput) {
        bgCollectInput.addEventListener("change", () => chrome.storage.local.set({ bgCollectInput: bgCollectInput.value.trim() }));
    }

    async function startBackgroundCollect(mode) {
        const input = bgCollectInput ? bgCollectInput.value.trim() : "";
        if (!input) {
            showNotification("Önce bir Amazon arama linki ya da anahtar kelime gir.", 3000);
            if (bgCollectInput) bgCollectInput.focus();
            return;
        }
        if (mode === "auto") await saveAutoCollectLimits();
        await chrome.storage.local.set({ bgCollectInput: input });
        const response = await chrome.runtime.sendMessage({ action: "bgCollectStart", input, mode });
        if (response && response.status === "invalid") {
            showNotification("Bu bir Amazon adresi değil. Desteklenen bir Amazon linki ya da anahtar kelime gir.", 3500);
        } else if (response && response.status === "busy") {
            showNotification("Arka planda zaten bir toplama sürüyor.", 3000);
        } else if (!response || response.status !== "started") {
            showNotification("Arka plan penceresi açılamadı.", 3000);
        }
    }

    updateBtn.addEventListener("click", () => void startBackgroundCollect("single"));
    startAutoBtn.addEventListener("click", () => void startBackgroundCollect("auto"));
    stopAutoBtn.addEventListener("click", () => void chrome.runtime.sendMessage({ action: "bgCollectStop" }));

    toggleStock.addEventListener("change", updateFeatureToggles);
    togglePrime.addEventListener("change", updateFeatureToggles);
    toggleRating.addEventListener("change", updateFeatureToggles);
    toggleBannedWarning.addEventListener("change", updateFeatureToggles);
    toggleCopyIcon.addEventListener("change", updateFeatureToggles);
    toggleSaveIcon.addEventListener("change", updateFeatureToggles);
    toggleEbayIcon.addEventListener("change", updateFeatureToggles);
    bsrDisplayMode.addEventListener("change", updateFeatureToggles);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.asinList) {
            chrome.storage.local.set({ asinList: message.asinList }, () => {
                updateCollectUI(message.asinList);
                updateDynamicUI();
            });
        }
        if (message.notification) {
            let notificationMessage = translations[currentLang][message.notification] || message.notification;
            if (message.notification === 'ebay_asins_saved' && message.count !== undefined) {
                notificationMessage = notificationMessage.replace('{count}', message.count);
            }
            showNotification(notificationMessage, 3000);
            if (message.notification === "saved_to_memory" || message.notification === "ebay_asins_saved") {
                updateMemoryUI();
                updateDynamicUI();
            }
        }
        if (message.action === 'saveToMemory') {
            const asin = message.product.asin;
            chrome.storage.local.get("memoryAsins", (data) => {
                let memoryAsins = data.memoryAsins || [];
                if (!memoryAsins.includes(asin)) {
                    memoryAsins.push(asin);
                    if (memoryAsins.length > 20000) {
                        memoryAsins = memoryAsins.slice(-20000);
                        showNotification(translations[currentLang].memory_limit_exceeded, 2000);
                    }
                    chrome.storage.local.set({ memoryAsins }, () => {
                        updateMemoryUI();
                        showNotification(translations[currentLang].saved_to_memory, 1000);
                        sendResponse({ success: true });
                    });
                } else {
                    sendResponse({ success: false, error: 'This ASIN is already in memory.' });
                }
            });
            return true;
        }
    });

    function updateCollectUI(asinList) {
        asinOutput.innerHTML = "";
        if (asinList.length === 0) return;
        asinList.forEach(asin => {
            const row = document.createElement("div");
            row.className = "asin-row";
            const deleteIcon = document.createElement("img");
            deleteIcon.src = "images/delete-icon.png";
            deleteIcon.className = "delete-icon";
            deleteIcon.title = "Delete ASIN";
            deleteIcon.addEventListener("click", () => {
                chrome.storage.local.get("asinList", (data) => {
                    let updatedAsins = data.asinList.filter(a => a !== asin);
                    chrome.storage.local.set({ asinList: updatedAsins }, () => {
                        updateCollectUI(updatedAsins);
                        showNotification(`${asin} deleted!`, 1000);
                    });
                });
            });
            const asinSpan = document.createElement("span");
            asinSpan.className = "asin-column";
            const link = document.createElement("a");
            link.href = `https://www.amazon.com/dp/${asin}`;
            link.textContent = asin;
            link.target = "_blank";
            asinSpan.appendChild(link);
            row.appendChild(deleteIcon);
            row.appendChild(asinSpan);
            asinOutput.appendChild(row);
        });
        saveToMemoryBtn.textContent = `${translations[currentLang].save_to_memory} (${asinList.length} ASIN)`;
    }

    function showNotification(message, duration) {
        notification.textContent = message;
        notification.classList.add("show");
        setTimeout(() => {
            notification.classList.remove("show");
        }, duration);
    }

    saveToMemoryBtn.addEventListener("click", function () {
        chrome.storage.local.get("asinList", (data) => {
            let newAsins = data.asinList || [];
            if (newAsins.length === 0) return;
            chrome.storage.local.get("memoryAsins", (data) => {
                let memoryAsins = data.memoryAsins || [];
                let combinedAsins = [...memoryAsins, ...newAsins];
                let uniqueAsins = [...new Set(combinedAsins)];
                if (uniqueAsins.length > 20000) {
                    uniqueAsins = uniqueAsins.slice(0, 20000);
                    showNotification(translations[currentLang].memory_limit_exceeded, 2000);
                } else {
                    showNotification(translations[currentLang].saved_to_memory, 1000);
                }
                currentMemoryPage = 1;
                chrome.storage.local.set({ memoryAsins: uniqueAsins }, () => {
                    updateMemoryUI();
                    chrome.storage.local.set({ asinList: [] }, () => {
                        updateCollectUI([]);
                    });
                });
            });
        });
    });

    copyAllBtn.addEventListener("click", function () {
        chrome.storage.local.get("memoryAsins", (data) => {
            let memoryAsins = data.memoryAsins || [];
            if (memoryAsins.length === 0) {
                showNotification(translations[currentLang].copy_failed, 1000);
                return;
            }
            navigator.clipboard.writeText(memoryAsins.join("\n")).then(() => {
                updateExportHistory("COPY", memoryAsins.length, memoryAsins);
                showNotification(translations[currentLang].asins_copied, 1000);
            }).catch(() => {
                showNotification(translations[currentLang].copy_failed, 1000);
            });
        });
    });

    mixMemoryBtn.addEventListener("click", function () {
        chrome.storage.local.get("memoryAsins", (data) => {
            let memoryAsins = data.memoryAsins || [];
            if (memoryAsins.length === 0) return;
            for (let i = memoryAsins.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [memoryAsins[i], memoryAsins[j]] = [memoryAsins[j], memoryAsins[i]];
            }
            currentMemoryPage = 1;
            chrome.storage.local.set({ memoryAsins }, () => {
                updateMemoryUI();
                showNotification(translations[currentLang].asins_shuffled, 1000);
            });
        });
    });

    clearMemoryBtn.addEventListener("click", function () {
        currentMemoryPage = 1;
        chrome.storage.local.set({ memoryAsins: [] }, () => {
            updateMemoryUI();
            showNotification(translations[currentLang].memory_cleared, 1000);
        });
    });

    exportCsvBtn.addEventListener("click", function () {
        chrome.storage.local.get(["memoryAsins"], (data) => {
            let memoryAsins = data.memoryAsins || [];
            if (memoryAsins.length === 0) {
                showNotification(translations[currentLang].export_failed, 1000);
                return;
            }

            const csv = "ASIN\n" + memoryAsins.join("\n") + "\n";
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `asins_${new Date().toISOString()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            updateExportHistory("CSV", memoryAsins.length, memoryAsins);
            showNotification(translations[currentLang].export_success, 1000);
        });
    });

    exportJsonBtn.addEventListener("click", function () {
        chrome.storage.local.get(["memoryAsins"], (data) => {
            let memoryAsins = data.memoryAsins || [];
            if (memoryAsins.length === 0) {
                showNotification(translations[currentLang].export_failed, 1000);
                return;
            }
            const exportData = memoryAsins.map(asin => ({ asin }));
            const json = JSON.stringify({ items: exportData }, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `asins_${new Date().toISOString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            updateExportHistory("JSON", memoryAsins.length, memoryAsins);
            showNotification(translations[currentLang].export_success, 1000);
        });
    });

    function updateExportHistory(type, asinCount, asins) {
        chrome.storage.local.get("exportHistory", (data) => {
            let exportHistory = data.exportHistory || [];
            const timestamp = new Date().toISOString();
            exportHistory.unshift({
                type,
                asinCount,
                asins: asins || [],
                customDate: new Date().toLocaleString(),
                timestamp,
                filename: type === "COPY" ? `asins_${timestamp}.txt` : `asins_${timestamp}.${type.toLowerCase()}`
            });
            if (exportHistory.length > 10) exportHistory = exportHistory.slice(0, 10);
            chrome.storage.local.set({ exportHistory }, () => {
                updateExportHistoryUI();
            });
        });
    }

    function updateExportHistoryUI() {
        chrome.storage.local.get(["exportHistory", "memoryAsins"], (data) => {
            exportHistoryList.innerHTML = "";
            const memoryAsins = data.memoryAsins || [];
            (data.exportHistory || []).forEach((item, index) => {
                const li = document.createElement("li");
                li.classList.add("history-item");
                const detailsDiv = document.createElement("div");
                detailsDiv.classList.add("history-details");
                const typeSpan = document.createElement("span");
                typeSpan.classList.add("type-asin");
                typeSpan.textContent = `${item.type} (${item.asinCount})`;
                detailsDiv.appendChild(typeSpan);
                const dateSpan = document.createElement("span");
                dateSpan.classList.add("custom-date");
                dateSpan.textContent = item.customDate;
                detailsDiv.appendChild(dateSpan);
                const actionsDiv = document.createElement("div");
                actionsDiv.classList.add("history-actions");
                const deleteIcon = document.createElement("img");
                deleteIcon.src = "images/delete-icon.png";
                deleteIcon.classList.add("history-icon");
                deleteIcon.title = "Delete Entry";
                deleteIcon.addEventListener("click", () => {
                    chrome.storage.local.get("exportHistory", (data) => {
                        let exportHistory = data.exportHistory || [];
                        exportHistory.splice(index, 1);
                        chrome.storage.local.set({ exportHistory }, () => {
                            updateExportHistoryUI();
                        });
                    });
                });
                const editIcon = document.createElement("img");
                editIcon.src = "images/edit-icon.png";
                editIcon.classList.add("history-icon");
                editIcon.title = "Edit Date";
                editIcon.addEventListener("click", () => {
                    const newDate = prompt("Enter new note (max 15 characters):", item.customDate);
                    if (newDate && newDate.length <= 15) {
                        chrome.storage.local.get("exportHistory", (data) => {
                            let exportHistory = data.exportHistory || [];
                            exportHistory[index].customDate = newDate;
                            chrome.storage.local.set({ exportHistory }, () => {
                                updateExportHistoryUI();
                            });
                        });
                    } else if (newDate) {
                        showNotification("Date must be 15 characters or less!", 2000);
                    }
                });
                const downloadIcon = document.createElement("img");
                downloadIcon.src = "images/download-icon.png";
                downloadIcon.classList.add("history-icon");
                downloadIcon.title = "Download";
                downloadIcon.addEventListener("click", () => {
                    let asins = item.asins || [];
                    let useCurrentMemory = false;
                    if (!asins || asins.length === 0) {
                        asins = memoryAsins;
                        useCurrentMemory = true;
                        showNotification(translations[currentLang].historical_asins_unavailable, 2000);
                    }
                    if (asins.length === 0) {
                        showNotification(translations[currentLang].export_failed, 1000);
                        return;
                    }
                    let blobType, content, extension;
                    if (item.type === "COPY") {
                        blobType = "text/plain";
                        content = asins.join("\n");
                        extension = "txt";
                    } else if (item.type === "CSV") {
                        blobType = "text/csv";
                        content = "ASIN\n" + asins.join("\n") + "\n";
                        extension = "csv";
                    } else {
                        blobType = "application/json";
                        // Same shape as the original JSON export.
                        content = JSON.stringify({ items: asins.map(asin => ({ asin })) }, null, 2);
                        extension = "json";
                    }
                    const blob = new Blob([content], { type: blobType });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = item.filename || `asins_${item.timestamp}.${extension}`;
                    a.click();
                    URL.revokeObjectURL(url);
                    if (!useCurrentMemory) {
                        showNotification(translations[currentLang].export_success, 1000);
                    }
                });
                actionsDiv.appendChild(editIcon);
                actionsDiv.appendChild(deleteIcon);
                actionsDiv.appendChild(downloadIcon);
                li.appendChild(detailsDiv);
                li.appendChild(actionsDiv);
                exportHistoryList.appendChild(li);
            });
        });
    }

    if (sendToBlacklistBtn) {
        sendToBlacklistBtn.addEventListener("click", function () {
            chrome.storage.local.get(["memoryAsins", "blacklistAsins"], (data) => {
                let memoryAsins = data.memoryAsins || [];
                let blacklistAsins = data.blacklistAsins || [];

                if (memoryAsins.length === 0) {
                    showNotification(translations[currentLang].no_asin_memory, 1000);
                    return;
                }

                let addedCount = 0;
                memoryAsins.forEach(asin => {
                    if (!blacklistAsins.includes(asin)) {
                        blacklistAsins.push(asin);
                        addedCount++;
                    }
                });

                chrome.storage.local.set({ blacklistAsins }, () => {
                    let msg = translations[currentLang].sent_to_blacklist;
                    if (addedCount > 0) {
                        msg += ` (+${addedCount})`;
                    }
                    showNotification(msg, 2000);
                });
            });
        });
    }

});

const style = document.createElement("style");
style.textContent = `
    .asin-row {
        display: flex;
        align-items: center;
        margin-bottom: 2px;
        font-size: 12px;
    }
    .delete-icon {
        width: 12px;
        height: 12px;
        margin-right: 4px;
        cursor: pointer;
    }
    .asin-column {
        width: 100px;
        display: inline-block;
        margin-right: 4px;
    }
    .asin-column a {
        color: #0066c0;
        text-decoration: none;
    }
    .asin-column a:hover {
        text-decoration: underline;
    }
    .asin-row {
        color: #fff;
    }
    .asin-column a {
        color: #66b0ff;
    }
    .delete-icon {
        filter: brightness(0) invert(1);
    }
`;
document.head.appendChild(style);
