const test = require('node:test');
const assert = require('node:assert/strict');
const AI = require('../ai-core.js');

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deepseekOk = content => jsonResponse(200, { model: 'DeepSeek-V4.1-Flash', choices: [{ message: { content } }] });
const geminiOk = text => jsonResponse(200, { modelVersion: 'gemini-3.8-flash', candidates: [{ content: { parts: [{ text }] } }] });

test('rule risk flags VeRO brands and hazards but not aftermarket or generic titles', () => {
    assert.equal(AI.ruleRisk("Nike Air Max 90 Men's Running Shoes").riskScore, 9);
    assert.equal(AI.ruleRisk('Clear Case for iPhone 15 Pro Max'), null);
    assert.equal(AI.ruleRisk('Replacement band compatible with Garmin Venu'), null);
    assert.equal(AI.ruleRisk('Rechargeable Lithium Battery Pack 5000mAh').riskScore, 8);
    assert.equal(AI.ruleRisk('Bluetooth Speaker Waterproof').riskScore, 7);
    assert.equal(AI.ruleRisk('Bamboo Cutting Board with Juice Groove'), null);
    assert.equal(AI.ruleRisk('Apple Slicer Stainless Steel'), null);
    assert.equal(AI.ruleRisk('Snickers bar lot'), null, 'substring "nike" inside a word must not match');
});

test('dHash and hamming distance classify identical, different and borderline photos', () => {
    const gradient = Array.from({ length: 72 }, (_, i) => 72 - i);
    const flat = Array.from({ length: 72 }, () => 10);
    const a = AI.dHashFromGray(gradient);
    assert.equal(a.length, 16);
    assert.equal(AI.hammingHex(a, a), 0);
    assert.equal(AI.hammingHex('0000000000000000', 'ffffffffffffffff'), 64);
    assert.equal(AI.hammingHex(a, AI.dHashFromGray(flat)), 64);
    assert.equal(AI.hashVerdict(3, {}), 'same');
    assert.equal(AI.hashVerdict(15, {}), 'unsure');
    assert.equal(AI.hashVerdict(40, {}), 'different');
    assert.equal(AI.hammingHex('00', 'abc'), Infinity);
});

test('settings merge keeps defaults and rejects unknown providers', () => {
    const s = AI.mergeSettings({ taskProviders: { match: 'gemini', triage: 'openai' }, riskBlockThreshold: '5' });
    assert.equal(s.taskProviders.match, 'gemini');
    assert.equal(s.taskProviders.triage, 'deepseek');
    assert.equal(s.taskProviders.imageCompare, 'gemini');
    assert.equal(s.riskBlockThreshold, 5);
    assert.equal(s.matchVerification, true);
    assert.deepEqual(AI.normalizeKeyList('sk-aaaaaaaaaaaa\n\n  sk-aaaaaaaaaaaa \nshort\nsk-bbbbbbbbbbbb'), ['sk-aaaaaaaaaaaa', 'sk-bbbbbbbbbbbb']);
});

test('DeepSeek request uses deepseek-flash, JSON mode and data-URL images; 429 moves to the next key', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return calls.length === 1 ? jsonResponse(429, {}) : deepseekOk('{"riskScore": 2, "reason": "Generic", "amazonQuery": "bamboo cutting board"}');
    };
    const r = await AI.runAiTask({
        task: 'triage', prompt: 'json please', images: [{ mimeType: 'image/jpeg', data: 'AAAA' }],
        keys: { deepseek: ['sk-first-key-000', 'sk-second-key-00'], gemini: ['AIza-gemini-key-0'] },
        settings: {}, fetchImpl
    });
    assert.equal(r.ok, true);
    assert.equal(r.provider, 'deepseek');
    assert.equal(r.model, 'DeepSeek-V4.1-Flash', 'answering model comes from the response');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer sk-second-key-00');
    assert.equal(calls[1].body.model, 'deepseek-flash');
    assert.deepEqual(calls[1].body.response_format, { type: 'json_object' });
    assert.deepEqual(calls[1].body.thinking, { type: 'disabled' }, 'thinking would spend max_tokens before the JSON answer');
    assert.equal(calls[1].body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
    assert.match(calls[1].body.messages[0].content, /json/);
    assert.deepEqual(AI.normalizeTriage(r.json), { riskScore: 2, reason: 'Generic', amazonQuery: 'bamboo cutting board' });
});

test('exhausted preferred provider falls back to the other provider; 400 skips remaining keys', async () => {
    const urls = [];
    const fetchImpl = async url => {
        urls.push(url);
        if (url.includes('deepseek')) return jsonResponse(400, {});
        return geminiOk('```json\n{"matches": ["B0AAAAAAA1", "B0NOTLISTED"]}\n```');
    };
    const candidates = [{ asin: 'B0AAAAAAA1', title: 'a' }, { asin: 'B0AAAAAAA2', title: 'b' }];
    const attempts = [];
    const r = await AI.runAiTask({
        task: 'match', prompt: 'x', keys: { deepseek: ['sk-one-000000', 'sk-two-000000'], gemini: ['AIza-key-00000'] },
        settings: { taskProviders: { match: 'deepseek' } }, fetchImpl, onAttempt: a => attempts.push(a)
    });
    assert.equal(r.provider, 'gemini');
    assert.equal(urls.filter(u => u.includes('deepseek')).length, 1, '400 must not burn the second DeepSeek key');
    assert.match(urls[1], /gemini-3\.8-flash:generateContent/);
    assert.deepEqual(AI.normalizeMatch(r.json, candidates), ['B0AAAAAAA1']);
    assert.deepEqual(attempts.map(a => [a.provider, a.ok]), [['deepseek', false], ['gemini', true]]);
});

test('no keys and total failure are reported as errors, not empty successes', async () => {
    const none = await AI.runAiTask({ task: 'triage', prompt: 'x', keys: { gemini: [], deepseek: [] }, settings: {}, fetchImpl: async () => { throw new Error('unused'); } });
    assert.equal(none.error, true);
    assert.equal(none.noKeys, true);
    const down = await AI.runAiTask({ task: 'triage', prompt: 'x', keys: { gemini: ['AIza-key-00000'] }, settings: {}, fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(down.error, true);
    assert.match(down.reason, /bağlantı/);
    assert.equal(AI.normalizeMatch({ matches: 'nope' }, []), null);
    assert.equal(AI.normalizeTriage({ reason: 'no score' }), null);
});

test('cleaned query replaces only the k parameter of the Amazon search URL', () => {
    const url = AI.amazonSearchUrlFor('https://www.amazon.com/s?k=NEW+2026+Bamboo+Board+FAST&ref=nb', 'bamboo cutting board');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('k'), 'bamboo cutting board');
    assert.equal(parsed.searchParams.get('ref'), 'nb');
    assert.equal(AI.amazonSearchUrlFor('https://www.amazon.com/s?k=x', null), 'https://www.amazon.com/s?k=x');
});

test('Gemini request targets gemini-3.8-flash without deprecated sampling parameters', async () => {
    let seen;
    const r = await AI.runAiTask({
        task: 'imageCompare', prompt: 'x', images: [{ mimeType: 'image/jpeg', data: 'BBBB' }],
        keys: { gemini: ['AIza-key-00000'] }, settings: {},
        fetchImpl: async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return geminiOk('{"isMatch": true}'); }
    });
    assert.equal(AI.PROVIDERS.gemini.model, 'gemini-3.8-flash');
    assert.match(seen.url, /models\/gemini-3\.8-flash:generateContent/);
    assert.equal('temperature' in seen.body.generationConfig, false, 'sampling parameters are deprecated on 3.8 Flash');
    assert.equal(seen.body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
    assert.ok(seen.body.generationConfig.maxOutputTokens >= 1024, 'thinking shares the output budget');
    assert.equal(seen.body.contents[0].parts[1].inline_data.data, 'BBBB');
    assert.equal(r.model, 'gemini-3.8-flash');
});

const claudeOk = text => jsonResponse(200, { model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] });

test('Claude request uses the Messages API with base64 images first and low effort; 529 moves to the next key', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return calls.length === 1 ? jsonResponse(529, {}) : claudeOk('{"riskScore": 3, "reason": "Generic", "amazonQuery": "wool felt coasters"}');
    };
    const r = await AI.runAiTask({
        task: 'triage', prompt: 'json please', images: [{ mimeType: 'image/jpeg', data: 'CCCC' }],
        keys: { claude: ['sk-ant-first-000', 'sk-ant-second-00'] },
        settings: { taskProviders: { triage: 'claude' } }, fetchImpl
    });
    assert.equal(r.ok, true);
    assert.equal(r.provider, 'claude');
    assert.equal(r.model, 'claude-haiku-5-5');
    assert.equal(calls.length, 2, '529 overloaded is retried on the next key');
    const { url, init, body } = calls[1];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'sk-ant-second-00');
    assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.deepEqual(body.thinking, { type: 'disabled' }, 'thinking would spend max_tokens before the JSON answer');
    assert.deepEqual(body.output_config, { effort: 'low' }, 'disabled thinking needs effort high or below');
    assert.equal('temperature' in body, false, 'sampling parameters are rejected');
    assert.equal('fallbacks' in body || 'anthropic-beta' in init.headers, false, 'Haiku has no server-side fallback');
    assert.deepEqual(body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'CCCC' } });
    assert.equal(body.messages[0].content[1].text, 'json please');
    assert.deepEqual(AI.normalizeTriage(r.json), { riskScore: 3, reason: 'Generic', amazonQuery: 'wool felt coasters' });
});

test('Claude refusal skips to the next provider instead of burning keys', async () => {
    const urls = [];
    const r = await AI.runAiTask({
        task: 'match', prompt: 'x', keys: { claude: ['sk-ant-one-0000', 'sk-ant-two-0000'], gemini: ['AIza-key-00000'] },
        settings: { taskProviders: { match: 'claude' } },
        fetchImpl: async url => {
            urls.push(url);
            return url.includes('anthropic') ? jsonResponse(200, { stop_reason: 'refusal', content: [] }) : geminiOk('{"matches": []}');
        }
    });
    assert.equal(r.provider, 'gemini');
    assert.equal(urls.filter(u => u.includes('anthropic')).length, 1);
    assert.equal(AI.mergeSettings({ taskProviders: { imageCompare: 'claude' } }).taskProviders.imageCompare, 'claude');
});

test('selected models reach each provider and Claude request fields follow the model', async () => {
    const s = AI.mergeSettings({ models: { gemini: ' gemini-2.5-flash ', deepseek: 'bad model id!', claude: 'claude-opus-5-5', openai: 'x' } });
    assert.deepEqual(s.models, { gemini: 'gemini-2.5-flash', deepseek: 'deepseek-flash', claude: 'claude-opus-5-5' });
    assert.equal(AI.mergeSettings({}).models.claude, 'claude-haiku-5-5');

    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return jsonResponse(500, {}); };
    await AI.runAiTask({
        task: 'triage', prompt: 'x', keys: { gemini: ['AIza-key-00000'], deepseek: ['sk-deepseek-000'], claude: ['sk-ant-key-0000'] },
        settings: { models: s.models, taskProviders: { triage: 'gemini' } }, fetchImpl
    });
    const [gemini, deepseek, claude] = seen;
    assert.match(gemini.url, /models\/gemini-2\.5-flash:generateContent/);
    assert.equal(gemini.body.generationConfig.thinkingConfig, undefined, 'thinkingLevel is Gemini 3+ only');
    assert.equal(deepseek.body.model, 'deepseek-flash');
    assert.equal(claude.body.model, 'claude-opus-5-5');
    assert.equal('thinking' in claude.body, false, 'Opus 5.5 rejects disabled thinking');
    assert.deepEqual(claude.body.output_config, { effort: 'low' });
    assert.equal(claude.body.fallbacks, 'default');
    assert.equal(claude.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

test('live model lists keep text models only', async () => {
    const gemini = await AI.listModels({
        provider: 'gemini', key: 'AIza-key-00000',
        fetchImpl: async () => jsonResponse(200, { models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] }
        ] })
    });
    assert.deepEqual(gemini, ['gemini-3.8-flash']);
    let claudeInit;
    const claude = await AI.listModels({
        provider: 'claude', key: 'sk-ant-key-0000',
        fetchImpl: async (url, init) => { claudeInit = init; return jsonResponse(200, { data: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }] }); }
    });
    assert.deepEqual(claude, ['claude-haiku-5-5', 'claude-sonnet-5-5']);
    assert.equal(claudeInit.headers['x-api-key'], 'sk-ant-key-0000');
    await assert.rejects(AI.listModels({ provider: 'deepseek', key: 'sk-x-00000000', fetchImpl: async () => jsonResponse(401, {}) }), /DeepSeek HTTP 401/);
});
