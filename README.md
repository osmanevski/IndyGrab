<p align="center">
  <img src="assets/wordmark-indygrab.png" alt="IndyGrab" width="420">
</p>

# IndyGrab

Amazon ve eBay üzerinde dropshipping / online arbitraj için ürün araştırmasını otomatikleştiren, sunucusuz çalışan bir Chrome eklentisi (Manifest V3). eBay mağazalarını tarayıp satan ürünleri bulur, bunları Amazon'da arayıp ASIN havuzuna toplar; risk ve eşleşme kontrolünde isteğe bağlı olarak AI kullanır.

> **English:** A serverless Chrome extension (Manifest V3) for eBay/Amazon product research. It scans eBay stores for items that actually sell, looks them up on Amazon, and collects the matching ASINs into a local pool, with optional AI checks for brand risk and product matching. No account, no backend: all data stays in the browser's local storage. The interface is in Turkish.

## Ne yapar

**eBay araştırması**
- Satıcı mağazalarını canlı listelemeler ya da satılmış ürünler üzerinden otomatik tarar.
- Mağaza adı, `/str/`, `/usr/` ve `/sch/?_ssn=` girdilerini gerçek satıcı aramasına çözer.
- Ürün başına 7 / 14 / 30 günlük satış sayısını çıkarır; yakalama hassasiyeti ayarlanır (Geniş / Normal / Sıkı).
- Satıcı kara listesi ve yasaklı ana/alt kategorilerle taramayı daraltır.

**Amazon toplama**
- eBay'de bulunan adayları Amazon'da arar ve sonuçlardan ASIN toplar.
- Panelden başlatılan toplama ayrı, odak almayan bir pencerede çalışır; açık Amazon sekmelerine dokunmaz.
- Filtreler: puan, yorum sayısı, fiyat aralığı, Prime ve teslimat süresi, stok, yasaklı kelime ve marka, ASIN kara listesi.
- ASIN havuzu tekilleştirilir; kopyalama, karıştırma ve CSV / JSON dışa aktarma vardır.

**AI (isteğe bağlı)**
- VeRO / marka / tehlikeli ürün için önce kural tabanlı, sonra AI destekli risk puanı.
- Amazon araması için başlık temizleme ve eBay ürünüyle Amazon sonucunun eşleşme kontrolü.
- Aynı ürünü satan başka satıcıları bulmak için görsel karşılaştırma.
- Google Gemini, DeepSeek, Anthropic Claude ve OpenRouter desteklenir; her sağlayıcı için kendi API anahtarınızla çalışır. Anahtar yoksa ya da AI yanıt vermezse iş durur ve AI olmadan devam edilip edilmeyeceği sorulur; onay vermeden AI'lı özellikler AI'sız çalışmaz.

**Yardımcı araçlar**
- Mixer: ASIN listelerini karıştırma, tekrarları ayıklama, kopyalama ve indirme.
- Easync sipariş sayfasından adres kopyalayıp Amazon'a aktarma.
- Koyu ve açık tema.

## Kurulum

1. Depoyu indirin ya da klonlayın:
   ```bash
   git clone https://github.com/osmanevski/IndyGrab.git
   ```
2. Chrome'da `chrome://extensions` sayfasını açın ve sağ üstten **Geliştirici modu**'nu etkinleştirin.
3. **Paketlenmemiş öğe yükle** ile klasörü seçin.
4. AI özellikleri için ana paneldeki AI bölümüne kendi [Gemini](https://aistudio.google.com/app/apikey), DeepSeek, [Claude](https://platform.claude.com/settings/keys) ve/veya [OpenRouter](https://openrouter.ai/settings/keys) anahtarınızı girin.

Güncellemek için klasörde `git pull` çalıştırıp `chrome://extensions` sayfasında eklentiyi yenileyin. Windows'ta aynı işi `IndyGrab-Guncelle.bat` yapar; yerelde değişiklik varsa güncellemeden durur.

## Gizlilik ve izinler

- Hesap, lisans doğrulama, telemetri ya da uzak senkronizasyon yoktur. Mağazalar, ürünler, ASIN havuzu, ayarlar ve API anahtarları tarayıcının yerel deposunda tutulur.
- Eklenti yalnızca eBay, Amazon ve Easync sayfalarıyla çalışır.
- AI kullanılırsa ürün başlıkları ve görselleri seçtiğiniz sağlayıcıya (Google Gemini, DeepSeek, Anthropic Claude ya da OpenRouter ve onun yönlendirdiği model sağlayıcısı) gönderilir. "Yerel" ifadesi bu veriyi kapsamaz.
- `cookies` izni, ürün fiyat ve stok bilgisini oturumunuzla Amazon'dan okumak için kullanılır; çerezler Amazon dışında bir yere gönderilmez.
- `bookmarks` izni, kaydettiğiniz bağlantıları "IndyGrab" adlı yer imi klasörüne eklemek içindir.

## Geliştirme

Derleme adımı ve bağımlılık yoktur; kaynak dosyalar doğrudan yüklenir.

```bash
node --test tests/ai-core.test.cjs     # AI katmanı birim testleri
python3 tests/extension_smoke.py       # gerçek eklenti, ağ kapalı duman testi
python3 tests/ai_flow_e2e.py           # AI akışı, çevrimdışı uçtan uca
python3 tests/bg_collect_e2e.py        # arka plan penceresinde toplama, çevrimdışı
```

Python testleri Playwright ve Chromium ister. Testler canlı eBay ya da Amazon'a bağlanmaz.

Mimari ve süreç akışları: [`docs/SYSTEM-MAP.md`](docs/SYSTEM-MAP.md).

## Sorumluluk

Bu araç eBay ya da Amazon ile bağlantılı değildir. Otomatik tarama bu sitelerin kullanım koşullarını ihlal edebilir ve hesabınızın kısıtlanmasına yol açabilir; kullanım sorumluluğu size aittir. Risk puanı ve ürün eşleşmesi tahmindir, listelemeden önce kendiniz doğrulayın.
