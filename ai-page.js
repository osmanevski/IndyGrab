// AI settings page: provider keys, per-task provider, rules and usage counters.
// Background reads the same storage keys through ai-core.js; nothing here calls an API.
document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    if (!$('section-ai') || !window.IndyAI) return;

    const TASKS = ['triage', 'match', 'imageCompare'];
    const STAT_LABELS = [
        ['task.triage', 'Risk + sorgu (AI)'],
        ['rule.hit', 'Kuralla karar verildi (AI yok)'],
        ['fetch.skippedRisk', 'Riskli bulundu, çekilmedi'],
        ['match.verified', 'Eşleşme doğrulandı'],
        ['match.noMatch', 'Aynı ürün yok, kaydedilmedi'],
        ['match.unverified', 'Doğrulanamadı, filtre sonucu kaydedildi'],
        ['hash.same', 'Hash: aynı fotoğraf'],
        ['hash.different', 'Hash: farklı fotoğraf'],
        ['hash.unsure', "Hash kararsız, AI'a soruldu"],
        ['task.imageCompare', 'Görsel karşılaştırma (AI)'],
        ['deepseek.ok', 'DeepSeek başarılı istek'],
        ['deepseek.fail', 'DeepSeek başarısız deneme'],
        ['gemini.ok', 'Gemini başarılı istek'],
        ['gemini.fail', 'Gemini başarısız deneme'],
        ['claude.ok', 'Claude başarılı istek'],
        ['claude.fail', 'Claude başarısız deneme']
    ];
    const KEY_STORE = { gemini: 'geminiApiKeys', deepseek: 'deepseekApiKeys', claude: 'claudeApiKeys' };

    // keys: { provider: [key, ...] } for every provider in KEY_STORE.
    function renderKeyCount(keys) {
        const label = $('key-count-label');
        label.textContent = Object.keys(KEY_STORE).map(p => `${IndyAI.PROVIDERS[p].label} ${(keys[p] || []).length}`).join(' · ');
        label.classList.toggle('empty', Object.keys(KEY_STORE).every(p => !(keys[p] || []).length));
    }

    function keysFromStorage(data) {
        return Object.fromEntries(Object.entries(KEY_STORE).map(([p, store]) => [p, IndyAI.normalizeKeyList(data[store] || [])]));
    }

    let lastModelsSeen = {};
    // Selected model plus the model the provider reported in its last successful answer.
    function renderModels(lastModels = lastModelsSeen) {
        lastModelsSeen = lastModels;
        for (const [provider, info] of Object.entries(IndyAI.PROVIDERS)) {
            const el = $(`ai-model-${provider}`);
            if (!el) continue;
            const seen = lastModels[provider];
            const model = $(`ai-model-input-${provider}`).value.trim() || info.model;
            const isDefault = model === info.model;
            const configured = `Model: ${model}${isDefault && info.note ? ` (${info.note})` : isDefault ? '' : ' (seçili)'}`;
            el.textContent = seen
                ? `${configured} · Son yanıt: ${seen.model}, ${new Date(seen.at).toLocaleString('tr-TR')}`
                : `${configured} · Henüz yanıt alınmadı`;
        }
    }

    function renderStats(stats = {}) {
        const box = $('ai-stats');
        const rows = STAT_LABELS.filter(([key]) => stats[key]);
        if (!rows.length) {
            box.textContent = 'Henüz AI kullanımı kaydedilmedi.';
            return;
        }
        box.replaceChildren(...rows.map(([key, text]) => {
            const cell = document.createElement('div');
            cell.className = 'ai-stat';
            const value = document.createElement('strong');
            value.textContent = Number(stats[key]).toLocaleString('tr-TR');
            const caption = document.createElement('span');
            caption.textContent = text;
            cell.append(value, caption);
            return cell;
        }));
    }

    chrome.storage.local.get([...Object.values(KEY_STORE), 'aiSettings', 'aiStats', 'aiLastModels', 'aiModelLists'], data => {
        const keys = keysFromStorage(data);
        for (const p of Object.keys(KEY_STORE)) $(`${p}-keys-input`).value = keys[p].join('\n');
        renderKeyCount(keys);
        const settings = IndyAI.mergeSettings(data.aiSettings);
        for (const p of Object.keys(KEY_STORE)) {
            $(`ai-model-input-${p}`).value = settings.models[p];
            fillModelList(p, data.aiModelLists?.[p]);
        }
        renderModels(data.aiLastModels);
        TASKS.forEach(task => { $(`ai-provider-${task}`).value = settings.taskProviders[task]; });
        $('ai-risk-threshold').value = String(settings.riskBlockThreshold);
        $('ai-match-verification').checked = settings.matchVerification;
        renderStats(data.aiStats);
    });

    $('manage-keys-btn').addEventListener('click', () => {
        const keys = Object.fromEntries(Object.keys(KEY_STORE).map(p => [p, IndyAI.normalizeKeyList($(`${p}-keys-input`).value)]));
        const update = Object.fromEntries(Object.entries(KEY_STORE).map(([p, store]) => [store, keys[p]]));
        chrome.storage.local.set(update, () => {
            for (const p of Object.keys(KEY_STORE)) $(`${p}-keys-input`).value = keys[p].join('\n');
            renderKeyCount(keys);
            $('ai-keys-status').textContent = Object.keys(KEY_STORE)
                .map(p => `${keys[p].length} ${IndyAI.PROVIDERS[p].label}`).join(', ') + ' anahtarı kaydedildi.';
        });
    });

    // Suggestions: the provider's live list when fetched, otherwise the built-in defaults.
    function fillModelList(provider, fetched) {
        const ids = [...new Set([...(fetched?.length ? fetched : []), ...IndyAI.PROVIDERS[provider].suggestions])];
        $(`ai-model-list-${provider}`).replaceChildren(...ids.map(id => Object.assign(document.createElement('option'), { value: id })));
    }

    $('ai-models-refresh').addEventListener('click', async () => {
        const status = $('ai-keys-status');
        const btn = $('ai-models-refresh');
        btn.disabled = true;
        status.textContent = 'Model listeleri alınıyor…';
        try {
            const data = await chrome.storage.local.get([...Object.values(KEY_STORE), 'aiModelLists']);
            const keys = keysFromStorage(data);
            const lists = { ...(data.aiModelLists || {}) };
            const notes = [];
            for (const p of Object.keys(KEY_STORE)) {
                const label = IndyAI.PROVIDERS[p].label;
                if (!keys[p].length) { notes.push(`${label}: anahtar yok`); continue; }
                try {
                    lists[p] = await IndyAI.listModels({ provider: p, key: keys[p][0], fetchImpl: (url, init) => fetch(url, init) });
                    fillModelList(p, lists[p]);
                    notes.push(`${label}: ${lists[p].length} model`);
                } catch (e) {
                    notes.push(`${label}: alınamadı (${e.message})`);
                }
            }
            await chrome.storage.local.set({ aiModelLists: lists });
            status.textContent = notes.join(' · ');
        } finally {
            btn.disabled = false;
        }
    });

    function saveSettings() {
        chrome.storage.local.get('aiSettings', data => {
            const settings = IndyAI.mergeSettings(data.aiSettings);
            TASKS.forEach(task => { settings.taskProviders[task] = $(`ai-provider-${task}`).value; });
            settings.riskBlockThreshold = Number($('ai-risk-threshold').value);
            settings.matchVerification = $('ai-match-verification').checked;
            for (const p of Object.keys(KEY_STORE)) settings.models[p] = $(`ai-model-input-${p}`).value.trim();
            const merged = IndyAI.mergeSettings(settings);
            for (const p of Object.keys(KEY_STORE)) $(`ai-model-input-${p}`).value = merged.models[p];
            renderModels();
            chrome.storage.local.set({ aiSettings: merged });
        });
    }
    [...TASKS.map(task => `ai-provider-${task}`), ...Object.keys(KEY_STORE).map(p => `ai-model-input-${p}`), 'ai-risk-threshold', 'ai-match-verification']
        .forEach(id => $(id).addEventListener('change', saveSettings));

    $('ai-stats-reset').addEventListener('click', () => chrome.storage.local.set({ aiStats: {} }));

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.aiStats) renderStats(changes.aiStats.newValue || {});
        if (changes.aiLastModels) renderModels(changes.aiLastModels.newValue || {});
        if (Object.values(KEY_STORE).some(store => changes[store])) {
            chrome.storage.local.get(Object.values(KEY_STORE), d => renderKeyCount(keysFromStorage(d)));
        }
    });
});
