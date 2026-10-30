// Shared AI layer for the service worker: one API key per provider (Gemini, DeepSeek, Claude, OpenRouter),
// deterministic risk rules, perceptual image hash and prompt/response handling.
// No DOM and no chrome.* access here, so the same file runs under node tests.
(function (root) {
    'use strict';

    // model is the default; suggestions seed the model picker before a live list is fetched.
    const PROVIDERS = {
        gemini: { label: 'Gemini', model: 'gemini-3.8-flash', note: 'Gemini 3.8 Flash', suggestions: ['gemini-3.8-flash', 'gemini-3.1-flash-lite'] },
        // DeepSeek keeps one alias for its newest Flash release (DeepSeek-V4.1-Flash as of 2026-09-13).
        deepseek: { label: 'DeepSeek', model: 'deepseek-flash', note: "DeepSeek'in en yeni Flash modeline yönlenir", suggestions: ['deepseek-flash', 'deepseek-v4-pro'] },
        claude: { label: 'Claude', model: 'claude-haiku-5-5', note: 'Claude Haiku 5.5', suggestions: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] },
        openrouter: { label: 'OpenRouter', model: 'openai/gpt-5.6-luna', note: 'OpenRouter üzerinden GPT-5.6 Luna', suggestions: ['openai/gpt-5.6-luna', 'anthropic/claude-haiku-5.5', 'google/gemini-4-argon'] }
    };
    const MODEL_ID = /^[A-Za-z0-9][\w.:\/-]{1,79}$/;

    const DEFAULT_AI_SETTINGS = {
        // Preferred provider per task; the other providers are the automatic fallbacks.
        taskProviders: { triage: 'deepseek', match: 'deepseek', imageCompare: 'gemini' },
        // Model per provider; an empty or malformed entry falls back to PROVIDERS[p].model.
        models: Object.fromEntries(Object.entries(PROVIDERS).map(([p, info]) => [p, info.model])),
        // Products scoring at or above this are not fetched from Amazon. 0 = never block.
        riskBlockThreshold: 7,
        // Only AI-confirmed ASINs are saved on eBay → Amazon fetches.
        matchVerification: true,
        // dHash hamming distance: <= same → same photo, >= different → other photo, between → ask AI.
        hashSameMax: 10,
        hashDifferentMin: 22,
        // Candidate count sent to the match check (search page order).
        matchCandidateLimit: 10
    };

    function mergeSettings(stored) {
        const s = stored && typeof stored === 'object' ? stored : {};
        const merged = { ...DEFAULT_AI_SETTINGS, ...s };
        merged.taskProviders = { ...DEFAULT_AI_SETTINGS.taskProviders, ...(s.taskProviders || {}) };
        for (const task of Object.keys(merged.taskProviders)) {
            if (!PROVIDERS[merged.taskProviders[task]]) merged.taskProviders[task] = DEFAULT_AI_SETTINGS.taskProviders[task];
        }
        merged.models = { ...DEFAULT_AI_SETTINGS.models, ...(s.models || {}) };
        for (const p of Object.keys(PROVIDERS)) {
            const model = String(merged.models[p] || '').trim();
            merged.models[p] = MODEL_ID.test(model) ? model : PROVIDERS[p].model;
        }
        for (const p of Object.keys(merged.models)) if (!PROVIDERS[p]) delete merged.models[p];
        merged.riskBlockThreshold = Number.isFinite(Number(merged.riskBlockThreshold)) ? Number(merged.riskBlockThreshold) : DEFAULT_AI_SETTINGS.riskBlockThreshold;
        merged.matchVerification = merged.matchVerification !== false;
        delete merged.stopOnAiFailure;
        return merged;
    }

    // One API key per provider, stored as a string. Older versions kept a list per provider
    // (<provider>ApiKeys); its first entry is taken over by migrateKeyStorage.
    const KEY_STORAGE = { gemini: 'geminiApiKey', deepseek: 'deepseekApiKey', claude: 'claudeApiKey', openrouter: 'openrouterApiKey' };
    const LEGACY_KEY_STORAGE = { gemini: 'geminiApiKeys', deepseek: 'deepseekApiKeys', claude: 'claudeApiKeys' };

    function normalizeKey(input) {
        const key = String(input || '').trim();
        return key.length > 10 && !/\s/.test(key) ? key : '';
    }

    // data: chrome.storage.local values for KEY_STORAGE and LEGACY_KEY_STORAGE names. While a
    // legacy list exists it wins: the oldest versions left a stale single geminiApiKey beside it.
    function keysFromStorage(data) {
        const d = data || {};
        return Object.fromEntries(Object.keys(PROVIDERS).map(p => {
            const legacy = d[LEGACY_KEY_STORAGE[p]];
            if (Array.isArray(legacy)) return [p, legacy.map(normalizeKey).find(Boolean) || ''];
            return [p, normalizeKey(d[KEY_STORAGE[p]])];
        }));
    }

    // null when storage already uses single keys; otherwise what to write and which lists to drop.
    function migrateKeyStorage(data) {
        const remove = Object.values(LEGACY_KEY_STORAGE).filter(name => data && data[name] !== undefined);
        if (!remove.length) return null;
        const keys = keysFromStorage(data);
        return { set: Object.fromEntries(Object.entries(KEY_STORAGE).map(([p, name]) => [name, keys[p]])), remove };
    }

    function providerOrder(task, settings, keys) {
        const preferred = mergeSettings(settings).taskProviders[task] || 'gemini';
        const order = [preferred, ...Object.keys(PROVIDERS).filter(p => p !== preferred)];
        return order.filter(p => !!normalizeKey(keys && keys[p]));
    }

    // ---- Deterministic risk rules (Ö3) -------------------------------------------------
    // Only unambiguous title signals. Anything unclear is left to the AI triage.
    const VERO_BRANDS = [
        'nike', 'adidas', 'lego', 'disney', 'marvel', 'pokemon', 'nintendo', 'playstation', 'xbox',
        'iphone', 'ipad', 'airpods', 'macbook', 'apple watch', 'samsung galaxy', 'bose', 'beats by dre',
        'dyson', 'yeti', 'hydro flask', 'the north face', 'under armour', 'gucci', 'louis vuitton',
        'chanel', 'rolex', 'ray-ban', 'oakley', 'harry potter', 'star wars', 'hello kitty', 'barbie',
        'hot wheels', 'ugg', 'carhartt', 'lululemon', 'nerf', 'funko', 'peppa pig', 'paw patrol',
        'dewalt', 'milwaukee', 'makita', 'otterbox', 'lifeproof', 'garmin', 'gopro', 'fitbit',
        'kitchenaid', 'vitamix', 'keurig', 'nespresso', 'zippo', 'leatherman', 'victorinox', 'swarovski',
        'nfl', 'nba', 'mlb', 'nhl'
    ];
    const HAZARD_RULES = [
        { score: 8, reason: 'Lityum pil / enerji riski', words: ['lithium', 'li-ion', 'lipo battery', 'power bank', 'rechargeable battery', 'hoverboard'] },
        { score: 9, reason: 'Silah / kesici alet', words: ['knife', 'dagger', 'machete', 'brass knuckles', 'taser', 'stun gun', 'pepper spray', 'crossbow', 'bb gun', 'airsoft gun', 'ammo'] },
        { score: 8, reason: 'Tütün / yanıcı madde', words: ['vape', 'e-cigarette', 'butane', 'propane', 'aerosol'] },
        { score: 8, reason: 'Medikal / takviye', words: ['supplement', 'capsules', 'fda approved', 'medical device', 'hearing aid'] },
        { score: 7, reason: 'Kablosuz elektronik (FCC)', words: ['bluetooth', 'wi-fi', 'wifi', '2.4ghz', '2.4g wireless'] }
    ];
    const AFTERMARKET_CUE = /\b(for|fits|fit|compatible with|replacement for|works with)\s+(the\s+)?$/;

    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function wordMatch(text, word) {
        const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}(?=$|[^a-z0-9])`, 'i');
        const m = re.exec(text);
        return m ? m.index + m[1].length : -1;
    }

    function ruleRisk(title) {
        const text = String(title || '').toLowerCase();
        if (!text.trim()) return null;
        for (const brand of VERO_BRANDS) {
            const at = wordMatch(text, brand);
            if (at === -1) continue;
            // "Case for iPhone 15": the brand names the device it fits, not the product.
            if (AFTERMARKET_CUE.test(text.slice(Math.max(0, at - 24), at))) continue;
            return { riskScore: 9, reason: `VeRO markası: ${brand}`, source: 'rule' };
        }
        for (const rule of HAZARD_RULES) {
            const hit = rule.words.find(w => wordMatch(text, w) !== -1);
            if (hit) return { riskScore: rule.score, reason: `${rule.reason} (${hit})`, source: 'rule' };
        }
        return null;
    }

    // ---- Perceptual image hash (Ö1) -----------------------------------------------------
    // gray: 9×8 luminance values, row by row. Result: 16 hex chars (64 bits).
    function dHashFromGray(gray, width = 9, height = 8) {
        if (!gray || gray.length < width * height) throw new Error('dHash needs 9x8 grayscale input');
        let hex = '';
        let nibble = 0;
        let bits = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width - 1; x++) {
                nibble = (nibble << 1) | (gray[y * width + x] > gray[y * width + x + 1] ? 1 : 0);
                if (++bits === 4) { hex += nibble.toString(16); nibble = 0; bits = 0; }
            }
        }
        return hex;
    }

    function hammingHex(a, b) {
        if (!a || !b || a.length !== b.length) return Infinity;
        let distance = 0;
        for (let i = 0; i < a.length; i++) {
            let v = parseInt(a[i], 16) ^ parseInt(b[i], 16);
            while (v) { distance += v & 1; v >>= 1; }
        }
        return distance;
    }

    function hashVerdict(distance, settings) {
        const s = mergeSettings(settings);
        if (distance <= s.hashSameMax) return 'same';
        if (distance >= s.hashDifferentMin) return 'different';
        return 'unsure';
    }

    // ---- Prompts -----------------------------------------------------------------------
    function triagePrompt({ title, price, seller }) {
        return `ROLE: You are a vigilant risk assessment AI for Amazon-to-eBay dropshippers. Protect the seller's account from VeRO strikes, design patents, dangerous goods and compliance violations. You also write the Amazon search query used to find this product.

PRODUCT (eBay listing, image attached):
- Title: "${String(title || '').replace(/"/g, "'")}"
- Price: ${price || 'unknown'}
- Seller: ${seller || 'unknown'}

RISK SCORE (integer 1-10):
1-3 SAFE: generic unbranded utility items, plain household goods, standard accessories. No complex electronics.
4-6 MODERATE: simple wired electronics, unbranded cosmetics/supplements, basic mechanical tools.
7-10 HIGH: major brands / VeRO (Apple, Nike, Lego, Disney...), Bluetooth/Wi-Fi/2.4GHz electronics, lithium or rechargeable batteries, flammables, distinctive patented designs, FDA/medical, weapons, celebrity faces, movie characters or brand logos visible in the image.
Aftermarket exception: "compatible with / for / fits <brand>" is generic (1-3) when that brand's logo is NOT visible on the product image.

AMAZON QUERY: 3-8 words naming the product type and its defining attributes (material, size, count, shape). Remove marketing and listing words (new, free shipping, fast, 2026, lot, sale, hot, best) and seller codes. Keep a brand only if it is the product's own brand.

Return ONLY a JSON object: {"riskScore": 3, "reason": "max 5 words", "amazonQuery": "..."}`;
    }

    function matchPrompt({ title }, candidates) {
        const list = candidates.map((c, i) => `${i + 2}. ASIN ${c.asin}: "${String(c.title || '').replace(/"/g, "'")}"`).join('\n');
        return `You verify dropshipping product matches.
Image 1 is the REFERENCE eBay listing: "${String(title || '').replace(/"/g, "'")}".
The following images are Amazon search results, in this order:
${list}

A candidate MATCHES only if it is the same physical product: same item type, design, shape and construction, and the same quantity/pack size when either title states one. Color may differ only if the reference does not specify a color. Similar-looking items of a different model, size or pack count are NOT matches. If unsure, do not include it.

Return ONLY a JSON object listing matching ASINs from the list above: {"matches": ["B0XXXXXXXX"]}. Use an empty array when none match.`;
    }

    function imageComparePrompt() {
        return `Compare these two images strictly. Image 1 is the reference product, image 2 a candidate.
Decide whether both come from the EXACT SAME source photograph (same object, camera angle, lighting, shadows and framing), ignoring resolution, compression and small crops.
Return ONLY a JSON object: {"analysis": "one short sentence", "isMatch": true}`;
    }

    // ---- Response handling ---------------------------------------------------------------
    function parseJsonLoose(text) {
        if (text && typeof text === 'object') return text;
        let clean = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start) return null;
        try { return JSON.parse(clean.slice(start, end + 1)); } catch (e) { return null; }
    }

    function normalizeTriage(json) {
        if (!json || typeof json !== 'object') return null;
        const raw = json.riskScore ?? json.score ?? json.risk_score ?? json.puan;
        const score = parseInt(raw, 10);
        if (!Number.isFinite(score)) return null;
        const query = String(json.amazonQuery ?? json.amazon_query ?? json.query ?? '')
            .replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return {
            riskScore: Math.min(10, Math.max(1, score)),
            reason: String(json.reason ?? json.sebep ?? 'Belirtilmedi').slice(0, 80),
            amazonQuery: query || null
        };
    }

    function normalizeMatch(json, candidates) {
        if (!json || !Array.isArray(json.matches)) return null;
        const allowed = new Set(candidates.map(c => c.asin));
        return [...new Set(json.matches.map(a => String(a).trim().toUpperCase()).filter(a => allowed.has(a)))];
    }

    function amazonSearchUrlFor(originalUrl, query) {
        if (!query) return originalUrl;
        try {
            const url = new URL(originalUrl);
            url.searchParams.set('k', query);
            return url.toString();
        } catch (e) {
            return 'https://www.amazon.com/s?k=' + encodeURIComponent(query).replace(/%20/g, '+');
        }
    }

    // ---- Provider calls ------------------------------------------------------------------
    // A caller returns { text } on success, { retry: true } for a temporary failure worth one
    // more try with the same key, or { retry: false } to move straight to the next provider.
    const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
    const RETRY_DELAY_MS = 2000;
    const RETRY_DELAY_MAX_MS = 10000;

    function httpFailure(label, res) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        return {
            retry: TRANSIENT_STATUSES.has(res.status),
            status: res.status,
            retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
            reason: `${label} HTTP ${res.status}`
        };
    }

    // thinkingLevel exists from Gemini 3 on; older models would reject it.
    function geminiThinkingConfig(model) {
        const version = parseFloat((/^gemini-(\d+(?:\.\d+)?)/.exec(model) || [])[1]);
        return version >= 3 ? { thinkingLevel: 'LOW' } : undefined;
    }

    async function callGemini({ key, model, prompt, images, maxTokens, fetchImpl }) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mimeType, data: i.data } }))] }],
                safetySettings: ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT']
                    .map(c => ({ category: `HARM_CATEGORY_${c}`, threshold: 'BLOCK_NONE' })),
                // Gemini 3.8 Flash deprecates sampling parameters and rejects "minimal" thinking;
                // thinking tokens share the output budget, so leave room beyond the JSON answer.
                generationConfig: {
                    responseMimeType: 'application/json',
                    thinkingConfig: geminiThinkingConfig(model),
                    maxOutputTokens: Math.max(1024, maxTokens * 4)
                }
            })
        });
        if (!res.ok) return httpFailure('Gemini', res);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
        if (!text) return { retry: false, reason: 'Gemini: ' + (data?.promptFeedback?.blockReason || 'boş yanıt') };
        return { text, model: data?.modelVersion || model };
    }

    function chatContent(prompt, images) {
        return images.length
            ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))]
            : prompt;
    }

    async function callDeepSeek({ key, model, prompt, images, maxTokens, fetchImpl }) {
        const content = chatContent(prompt, images);
        const res = await fetchImpl('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: 'You answer with a single valid json object and nothing else.' },
                    { role: 'user', content }
                ],
                response_format: { type: 'json_object' },
                // Thinking is on by default for deepseek-flash; its reasoning would consume
                // max_tokens and leave the JSON answer empty, and it ignores temperature.
                thinking: { type: 'disabled' },
                temperature: 0,
                max_tokens: maxTokens
            })
        });
        if (!res.ok) return httpFailure('DeepSeek', res);
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) return { retry: false, reason: 'DeepSeek: boş yanıt' };
        return { text, model: data?.model || model };
    }

    const CLAUDE_HEADERS = {
        'anthropic-version': '2026-10-21',
        // Extension pages send an Origin header; the API refuses those without this opt-in.
        'anthropic-dangerous-direct-browser-access': 'true'
    };

    // Request fields that differ by Claude model. Sampling parameters are rejected on all current ones.
    function claudeModelOptions(model) {
        const body = {};
        const headers = {};
        // Haiku can switch thinking off (only at effort high or below), so the JSON answer gets the
        // whole max_tokens; Opus 5.5, Sonnet 5.5 and Fable reject "disabled" and think adaptively.
        if (/haiku/.test(model)) body.thinking = { type: 'disabled' };
        // effort errors on Haiku 4.5, Sonnet 4.5 and older models.
        if (!/claude-(haiku-4|sonnet-4-5|opus-4-[01]|[a-z]+-[0-3]\b|[0-3]-)/.test(model)) body.output_config = { effort: 'low' };
        // A safety-classifier refusal on these models is re-run server-side on a fallback model.
        if (/^claude-(opus-5|sonnet-5-5|fable-5)/.test(model)) {
            body.fallbacks = 'default';
            headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        }
        return { body, headers };
    }

    async function callClaude({ key, model, prompt, images, maxTokens, fetchImpl }) {
        const options = claudeModelOptions(model);
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, ...CLAUDE_HEADERS, ...options.headers },
            body: JSON.stringify({
                model,
                ...options.body,
                max_tokens: Math.max(1024, maxTokens * 4),
                system: 'You answer with a single valid JSON object and nothing else.',
                messages: [{
                    role: 'user',
                    content: [
                        ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } })),
                        { type: 'text', text: prompt }
                    ]
                }]
            })
        });
        if (!res.ok) return httpFailure('Claude', res);
        const data = await res.json();
        if (data?.stop_reason === 'refusal') return { retry: false, reason: 'Claude: istek reddedildi' };
        const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        if (!text) return { retry: false, reason: 'Claude: boş yanıt' };
        return { text, model: data?.model || model };
    }

    async function callOpenRouter({ key, model, prompt, images, maxTokens, fetchImpl }) {
        const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: 'You answer with a single valid JSON object and nothing else.' },
                    { role: 'user', content: chatContent(prompt, images) }
                ],
                // OpenRouter drops what the chosen model does not support. Reasoning tokens share
                // the output budget, so leave room beyond the JSON answer.
                response_format: { type: 'json_object' },
                reasoning: { effort: 'low', exclude: true },
                max_tokens: Math.max(1024, maxTokens * 4)
            })
        });
        if (!res.ok) return httpFailure('OpenRouter', res);
        const data = await res.json();
        // An upstream failure can arrive as HTTP 200 with an error object.
        const error = data?.error || data?.choices?.[0]?.error;
        if (error) return { retry: TRANSIENT_STATUSES.has(error.code), status: error.code, reason: `OpenRouter HTTP ${error.code}` };
        const text = data?.choices?.[0]?.message?.content;
        if (!text) return { retry: false, reason: 'OpenRouter: boş yanıt' };
        return { text, model: data?.model || model };
    }

    const CALLERS = { gemini: callGemini, deepseek: callDeepSeek, claude: callClaude, openrouter: callOpenRouter };

    // Text models the key can use, from the provider's own model list. Throws on HTTP errors.
    const NON_TEXT_MODEL = /embed|tts|audio|live|image|imagen|veo|aqa|learnlm|gemma/i;
    // OpenRouter lists hundreds of models; the tasks send product photos and expect text back.
    function openRouterModelFits(m) {
        const { input_modalities: input = [], output_modalities: output = [] } = m.architecture || {};
        return input.includes('image') && output.includes('text') && !String(m.id).endsWith(':batch');
    }
    async function listModels({ provider, key, fetchImpl }) {
        let res;
        if (provider === 'gemini') {
            res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
        } else if (provider === 'deepseek') {
            res = await fetchImpl('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` } });
        } else if (provider === 'claude') {
            res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1000', { headers: { 'x-api-key': key, ...CLAUDE_HEADERS } });
        } else if (provider === 'openrouter') {
            res = await fetchImpl('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } });
        } else {
            throw new Error(`Bilinmeyen sağlayıcı: ${provider}`);
        }
        if (!res.ok) throw new Error(`${PROVIDERS[provider].label} HTTP ${res.status}`);
        const data = await res.json();
        const ids = provider === 'gemini'
            ? (data?.models || [])
                .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                .map(m => String(m.name || '').replace(/^models\//, ''))
                .filter(id => id.startsWith('gemini') && !NON_TEXT_MODEL.test(id))
            : (data?.data || []).filter(m => provider !== 'openrouter' || openRouterModelFits(m)).map(m => String(m.id || ''));
        return [...new Set(ids.filter(id => MODEL_ID.test(id)))];
    }

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function runAiTask({ task, prompt, images = [], maxTokens = 300, keys, settings, fetchImpl, onAttempt, sleepImpl = wait }) {
        const order = providerOrder(task, settings, keys);
        const { models } = mergeSettings(settings);
        if (!order.length) return { error: true, noKeys: true, reason: 'API anahtarı yok' };
        let lastReason = 'AI yanıt vermedi';
        for (const provider of order) {
            const key = normalizeKey(keys[provider]);
            let delay = RETRY_DELAY_MS;
            for (let attempt = 0; attempt < 2; attempt++) {
                if (attempt) await sleepImpl(Math.min(RETRY_DELAY_MAX_MS, delay));
                let result;
                try {
                    result = await CALLERS[provider]({ key, model: models[provider], prompt, images, maxTokens, fetchImpl });
                } catch (e) {
                    result = { retry: true, reason: `${PROVIDERS[provider].label}: bağlantı hatası` };
                }
                const json = result.text !== undefined ? parseJsonLoose(result.text) : null;
                if (onAttempt) onAttempt({ task, provider, ok: !!json, status: result.status || (json ? 200 : 0) });
                if (json) return { ok: true, json, provider, model: result.model };
                lastReason = result.text !== undefined ? `${PROVIDERS[provider].label}: yanıt çözülemedi` : (result.reason || lastReason);
                if (result.text !== undefined || !result.retry) break;
                delay = result.retryAfterMs || RETRY_DELAY_MS;
            }
        }
        return { error: true, reason: lastReason };
    }

    const api = {
        PROVIDERS, DEFAULT_AI_SETTINGS, mergeSettings, KEY_STORAGE, LEGACY_KEY_STORAGE,
        normalizeKey, keysFromStorage, migrateKeyStorage, providerOrder,
        ruleRisk, dHashFromGray, hammingHex, hashVerdict,
        triagePrompt, matchPrompt, imageComparePrompt,
        parseJsonLoose, normalizeTriage, normalizeMatch, amazonSearchUrlFor, runAiTask, listModels
    };
    root.IndyAI = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
