// Shared AI layer for the service worker: provider key queues (Gemini, DeepSeek, Claude),
// deterministic risk rules, perceptual image hash and prompt/response handling.
// No DOM and no chrome.* access here, so the same file runs under node tests.
(function (root) {
    'use strict';

    const PROVIDERS = {
        gemini: { label: 'Gemini', model: 'gemini-3.8-flash', note: 'Gemini 3.8 Flash' },
        // DeepSeek keeps one alias for its newest Flash release (DeepSeek-V4.1-Flash as of 2026-09-13).
        deepseek: { label: 'DeepSeek', model: 'deepseek-flash', note: "DeepSeek'in en yeni Flash modeline yönlenir" },
        claude: { label: 'Claude', model: 'claude-haiku-5-5', note: 'Claude Haiku 5.5' }
    };

    const DEFAULT_AI_SETTINGS = {
        // Preferred provider per task; the other providers are the automatic fallbacks.
        taskProviders: { triage: 'deepseek', match: 'deepseek', imageCompare: 'gemini' },
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
        merged.riskBlockThreshold = Number.isFinite(Number(merged.riskBlockThreshold)) ? Number(merged.riskBlockThreshold) : DEFAULT_AI_SETTINGS.riskBlockThreshold;
        merged.matchVerification = merged.matchVerification !== false;
        return merged;
    }

    function normalizeKeyList(input) {
        const list = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
        return [...new Set(list.map(k => String(k).trim()).filter(k => k.length > 10))];
    }

    function providerOrder(task, settings, keys) {
        const preferred = mergeSettings(settings).taskProviders[task] || 'gemini';
        const order = [preferred, ...Object.keys(PROVIDERS).filter(p => p !== preferred)];
        return order.filter(p => Array.isArray(keys && keys[p]) && keys[p].length > 0);
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
    // A caller returns { text } on success, { retry: true } to try the next key of the same
    // provider, or { retry: false } to skip straight to the next provider.
    const RETRY_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504, 529]);

    async function callGemini({ key, prompt, images, maxTokens, fetchImpl }) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${encodeURIComponent(key)}`;
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
                    thinkingConfig: { thinkingLevel: 'LOW' },
                    maxOutputTokens: Math.max(1024, maxTokens * 4)
                }
            })
        });
        if (!res.ok) return { retry: RETRY_STATUSES.has(res.status), status: res.status, reason: `Gemini HTTP ${res.status}` };
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
        if (!text) return { retry: false, reason: 'Gemini: ' + (data?.promptFeedback?.blockReason || 'boş yanıt') };
        return { text, model: data?.modelVersion || PROVIDERS.gemini.model };
    }

    async function callDeepSeek({ key, prompt, images, maxTokens, fetchImpl }) {
        const content = images.length
            ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))]
            : prompt;
        const res = await fetchImpl('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: PROVIDERS.deepseek.model,
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
        if (!res.ok) return { retry: RETRY_STATUSES.has(res.status), status: res.status, reason: `DeepSeek HTTP ${res.status}` };
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) return { retry: false, reason: 'DeepSeek: boş yanıt' };
        return { text, model: data?.model || PROVIDERS.deepseek.model };
    }

    async function callClaude({ key, prompt, images, maxTokens, fetchImpl }) {
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2026-10-21',
                // Extension pages send an Origin header; the API refuses those without this opt-in.
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: PROVIDERS.claude.model,
                // Haiku 5.5 thinks by default and its thinking would share max_tokens with the JSON
                // answer; disabling it is allowed at effort high or below. Sampling parameters are rejected.
                thinking: { type: 'disabled' },
                output_config: { effort: 'low' },
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
        if (!res.ok) return { retry: RETRY_STATUSES.has(res.status), status: res.status, reason: `Claude HTTP ${res.status}` };
        const data = await res.json();
        if (data?.stop_reason === 'refusal') return { retry: false, reason: 'Claude: istek reddedildi' };
        const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        if (!text) return { retry: false, reason: 'Claude: boş yanıt' };
        return { text, model: data?.model || PROVIDERS.claude.model };
    }

    const CALLERS = { gemini: callGemini, deepseek: callDeepSeek, claude: callClaude };

    async function runAiTask({ task, prompt, images = [], maxTokens = 300, keys, settings, fetchImpl, onAttempt }) {
        const order = providerOrder(task, settings, keys);
        if (!order.length) return { error: true, noKeys: true, reason: 'API anahtarı yok' };
        let lastReason = 'Çalışan API anahtarı yok';
        for (const provider of order) {
            for (const key of keys[provider]) {
                let result;
                try {
                    result = await CALLERS[provider]({ key, prompt, images, maxTokens, fetchImpl });
                } catch (e) {
                    result = { retry: true, reason: `${PROVIDERS[provider].label}: bağlantı hatası` };
                }
                const json = result.text !== undefined ? parseJsonLoose(result.text) : null;
                if (onAttempt) onAttempt({ task, provider, ok: !!json, status: result.status || (json ? 200 : 0) });
                if (json) return { ok: true, json, provider, model: result.model };
                lastReason = result.text !== undefined ? `${PROVIDERS[provider].label}: yanıt çözülemedi` : (result.reason || lastReason);
                if (result.text === undefined && result.retry === false) break;
            }
        }
        return { error: true, reason: lastReason };
    }

    const api = {
        PROVIDERS, DEFAULT_AI_SETTINGS, mergeSettings, normalizeKeyList, providerOrder,
        ruleRisk, dHashFromGray, hammingHex, hashVerdict,
        triagePrompt, matchPrompt, imageComparePrompt,
        parseJsonLoose, normalizeTriage, normalizeMatch, amazonSearchUrlFor, runAiTask
    };
    root.IndyAI = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
