---
title: IndyGrab — çalışma alanı tasarımı uygulaması
created: 2026-09-12
modified: 2026-09-12
type: implementation-report
status: 🟡 in progress
tags: [indygrab, design, testing]
---

# Uygulanan kapsam

- Ana panel: sol gezinme, tek çalışma alanı, hash ile konum ve yenilemede geri dönüş.
- Araştırma: mağaza, ürün, kuyruk, satıcı/kategori kuralları birbirinden ayrıldı.
- Amazon: panel toplaması ayrı, odak almayan bir arka plan penceresinde çalışır; açık Amazon
  sekmelerine dokunmaz, bitince pencere kapanır (13 Eylül; önceki hedef sekme seçicisi kaldırıldı).
  Açıkça seçilen sekme kapanırsa başka bir sekmeye sessiz geçiş yapılmaz.
- Filtre: mevcut kriterler ve storage değerleri korunarak gruplama, etkin filtre
  özeti, Türkçe varsayılan ve temel metin düzeltmeleri. Kayıtlı dil tercihi korunur.
- ASIN havuzu: doğrudan gezinme; tüm eski kopyalama/karıştırma/export kontrolleri korunur.
- Görünüm ayarları ayrı alanda. Son satış günü kısıtı görünüm ayarı olmadığı için
  eBay araştırma kontrollerine taşındı.
- Açık/koyu tema, klavye odağı, dar ekran düzeni ve azaltılmış hareket.
- “İşlendi” metni mevcut fetched boolean'ını anlatır; sonuç ASIN sayısı uydurulmaz.
  Düşük AI puanı bir garanti olarak sunulmaz.

# Mimari

`popup.js`: mevcut filtre/ASIN denetleyicisi; arka plan toplama oturumu `background.js` içinde.
`research.js`: mevcut araştırma işlevleri + açık gezinme.
`workspace.js`: yalnız sunum (filtre özeti, alan gruplama ve gezinme eşleme).
`workspace.css`: yeni tasarım sistemi. `workspace-legacy.css`: korunmuş eski
kontrollerin uyumluluk stilleri, düşük öncelikli CSS layer içinde.
DOM kimlikleri ve background/content-script protokolleri korundu. Tarama motoru,
kuyruk eşzamanlılığı, BSR istekleri, hafıza şeması ve üretim kurulumu değiştirilmedi.
`popup.js` satır sonları LF olarak normalize edildi.

# Doğrulama

- `node --test tests/amazon-target.test.cjs`: 5/5 geçti.
- `tests/extension_smoke.py`: 18/18 geçti, sıfır pageerror. Gerçek unpacked eklenti, izole Chromium profili,
  dış HTTP/HTTPS istekleri engelli; yerel Amazon HTML fixture'ı ile gerçek content script.
- Tüm eski research.html ID'lerinin tekilliği; örnek mağaza/ürün/ASIN yükleme;
  gezinme ve tekrar tıklama; sayfa yenilemede havuz; filtre storage değerleri;
  hedef yokken güvenli davranış; hedef sekmeden toplama ve havuza kaydetme;
  koyu/açık tema; 760/390px taşma; uncaught hata kontrolü.
- Testin varsayılan çıktıları `/private/tmp/indygrab-qa artifacts` altındadır.
- Canlı Amazon/eBay sayfaları, uzun taramalar, Gemini çağrıları ve uzak Windows
  kurulumu bu testin kapsamı değildir. Bu aşama canlı geçiş yapılmış demek değildir.

# Sonraki aşama

Osman'ın ana araştırma ve filtre ekranlarına görsel geri bildirimi; ardından
canlı kaynaklarla kontrollü örnek tarama. Bağımsız başlık/Mixer/ASIN kara listesi
sayfaları erişilebilir ve mevcut işlevleriyle korunmuştur; bunların iç tasarımları
henüz yeni panelle aynı ölçekte yenilenmedi. Background'daki boş/başarılı/hatalı
sonuç ayrımı ve BSR hız sınırlaması ayrı motor işleri olarak duruyor.

# Kota ve delegasyon

Astra: mimari, ana tasarım, entegrasyon ve son test.
Sol: hedef sekme modülü + birim testleri; ayrı kısa görevde eklenti test iskeleti.
Opus: tek salt-okunur CSS/yerleşim değerlendirmesi; Claude Pro oturumu doğrulandı.
Ek API satın alımı veya ücretli fallback kurulmadı.
CodexBar başlangıç: Codex 5 saat %32 / hafta %5; Claude %0 / %5.
Ara kontrol (2026-09-12 23:19 İstanbul): Codex yeni 5 saat penceresinde %9 / hafta %17;
Claude %4 / %5. Bunlar hesap genelidir; görev veya oturum bazında maliyet ayrımı değildir.

# AI katmanı (13 Eylül)

- `ai-core.js`: sağlayıcı-bağımsız katman. Gemini (`gemini-3.8-flash`, sampling parametresi yok, düşünme LOW) ve DeepSeek
  (`deepseek-flash` = en yeni Flash, 13 Eylül itibarıyla V4.1; düşünme modu kapalı, JSON modu) sağlayıcı başına tek anahtar
  (2026-10-26: çoklu anahtar rotasyonu kaldırıldı; Claude eklendi). 408/429/5xx/529 aynı anahtarla bir kez yeniden
  denenir, diğer hatalar ve boş yanıt sıradaki sağlayıcıya geçer. Kural riski, dHash, istemler.
- Ö2/Ö3/Ö5: yeni keşfedilen üründe otomatik AI yok. Amazon çekiminden hemen önce kural,
  kuraldan geçerse tek AI isteği risk + temiz Amazon sorgusu üretir; eşik (varsayılan 7)
  ve üstü `fetched` + `fetchSkipReason` ile atlanır. AI yoksa orijinal sorguyla çekilir.
- Ö4: eBay→Amazon çekiminde filtreyi geçen ilk 10 aday görselle doğrulanır, yalnız
  eşleşenler kalır (BSR isteğinden önce). AI yanıt veremezse filtre sonucu kaydedilir,
  ürün `aiMatch: unverified` işaretlenir.
- Ö1: satıcı görsel karşılaştırması önce dHash (≤10 aynı, ≥22 farklı), arası AI.
- AI ayarları sayfası: iki sağlayıcının anahtarları, iş başına sağlayıcı (diğeri yedek),
  risk eşiği, eşleşme doğrulaması, `aiStats` sayaçları, ayarlı ve son yanıt veren model (`aiLastModels`). Anahtar/toplu analiz kimlikleri korundu.
- Doğrulama: `node --test tests/ai-core.test.cjs`,
  `tests/extension_smoke.py` (22), `tests/ai_flow_e2e.py` (ağ kapalı, sahte DeepSeek/Amazon).
  Test notu: `wait_for_function` async yüklemi beklemez — storage beklemeleri `wait_js` ile
  yoklanır; eklentinin `chrome.tabs.create` sekmeleri Playwright route'undan geçmez.
- Canlı Gemini/DeepSeek anahtarıyla ve gerçek eBay/Amazon sayfalarıyla henüz denenmedi.
