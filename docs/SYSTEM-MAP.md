---
title: IndyGrab — çalışma ağacı ve yeniden tasarım kapsamı
created: 2026-09-12
modified: 2026-09-12
type: technical-map
status: 🟡 in progress
tags: [indygrab, ux, architecture]
---

# İnceleme sınırı

Kaynak: `a52a947`, yerel temiz main'den `codex/indygrab-design` dalı.
Worktree: `/private/tmp/indygrab-design`. Ana kurulumda uygulama kodu değiştirilmedi.
Bu rapor yerel kod incelemesidir; canlı eBay/Amazon doğrulaması yapılmadı.
15 JavaScript dosyasının `node --check` kontrolü geçti. Test paketi/package.json yok.
`ui-contract-baseline.json`, altı HTML sayfasının ID/script ve JS mesaj envanteridir.
Geçici worktree kalıcı arşiv değildir; sonraki uygulama commit'leri bu dalda tutulmalı.

# Sistemin ağacı

```text
IndyGrab — Chrome MV3
├── popup.html + launcher.js: hızlı erişim, sayaçlar, aktif Amazon sekmesinde toplama
├── research.html: ana kontrol paneli
│   ├── research.js
│   │   ├── Mağazalar: bağlantı çözümleme, tarama modu, hassasiyet, eşzamanlılık
│   │   ├── Ürünler: arama/sıralama/sayfalama, risk, Amazon'a tekli/toplu gönderme
│   │   ├── AI kuyruğu: mağaza analizi, tekrar deneme, başlat/durdur/temizle
│   │   ├── Satıcı kara listesi: süreli/süresiz engeller
│   │   └── Yasaklı ana/alt kategoriler
│   └── popup.js (eski popup denetleyicisi, artık BU SAYFADA)
│       ├── Toplama: aktif sekmeye komut, otomatik toplama limitleri
│       ├── Filtre: Amazon ürün kriterleri + sayfa üzeri gösterim ayarları
│       └── Hafıza: ASIN havuzu, seçim, kopyalama, karıştırma, dışa aktarma/geçmiş
├── background.js: sekmeler, üç ayrı kuyruk, risk/görsel AI, alarmlar
│   └── title_generator.js: Amazon detay ve AI başlık kuyrukları
├── Sayfaya enjekte edilen betikler
│   ├── content_ebay.js: satış geçmişi, aday ürün, satıcı keşfi, kategori kontrolü
│   ├── content_amazon.js: DOM okuma, filtre, BSR detayı, sayfalama, hafıza
│   ├── content_easync.js: adres kopyalama
│   └── content_amazon_paste.js: adres aktarımı
├── titles.html + titles.js: başlık/detay üretimi, düzenleme, durumlar, CSV
├── blacklist.html + blacklist.js: ASIN kara listesi, dosyadan ekleme, toplu silme
├── mixer.html + mixer.js: liste karıştırma, tekrarlar, kopyalama/indirme
├── options.html + options.js: yerel mod bilgisi
└── theme.js: sayfalar arasında ortak koyu/açık tema
```

`content.js` dosyası da mevcut fakat manifest'in content-script listesinde yok.
Dosya adından aktif motor olduğu sonucu çıkarılmamalı. Silme bu aşamanın kapsamında değil.

# Uçtan uca süreçler

## 1. eBay araştırması ve keşif döngüsü

1. Mağaza adı veya `/str/`, `/usr/`, `_ssn` bağlantısı girilir.
2. `research.js:resolveToSearchUrl` satıcı arama URL'sini üretir; kayıt `savedSellerLinks`.
3. Kullanıcı canlı/satılmış modu, yakalama hassasiyeti ve eşzamanlılık seçer.
4. `automationControl` → `storeQueue` → `processNextInQueue` → `idg_auto` sekmeleri.
5. `content_ebay.js` kategori, sonuç ve satış geçmişini işler; sayfaları tarar.
6. `/bin/purchaseHistory` satırlarından 7/14/30 günlük satış miktarı ve C sayıları çıkar.
7. Hassasiyet eşiğini geçen ürün `addPotentialProduct` ile `potentialProducts` içine girer.
8. Satıcı keşfi/görsel karşılaştırması yeni mağazalar bulabilir; kayıtlı mağazalara geri besler.
9. `autoAddToQueue` açıksa panelin storage dinleyicisi uygun bağlantıları `analysisQueue`'ya ekler.

İki eBay kuyruğu aynı şey değildir: mağaza otomasyonunda seçilen eşzamanlılık kullanılır;
analiz kuyruğu en fazla 7 sekme açar. Her iki açılış döngüsünde 2 saniyelik aralık vardır.
Analiz kuyruğu tüm ürünlerin risk puanlamasıyla da aynı şey değildir; ayrı işlemlerdir.

## 2. eBay adayından Amazon ASIN havuzuna

1. Ürün kartındaki Amazon eylemi veya “Tümünü Çek” kullanılır.
2. Toplu akış `potentialProducts.filter(p => !p.fetched)` ile başlar.
3. Ürünün `amazonSearchUrl` adresi `indygrab_auto_collect=true` ile açılır.
4. Amazon sonuçları DOM'dan okunur; kara liste ve ürün filtreleri uygulanır.
5. Gerekirse BSR detayları çekilir; sonuçlar seçilen sıraya konur.
6. `asinCount` kadar ASIN seçilir (boş değer bu akışta 5).
7. `memoryAsins` ile birleştirilir, tekilleştirilir; üst sınır 20.000.
8. `closeSelf` ürünün `fetched` işaretini günceller ve sekmeyi kapatır.

Toplu Amazon kuyruğu: en fazla 3 sekme, açılış aralığı 2 saniye, 90 saniye takılma
eşiği, 1 dakikalık watchdog. Tespit edilen blokta 120 saniyelik bekleme ve yeniden sıra.
Watchdog periyodik olduğu için 90 saniye kesin kapanma saati değildir.
Başlıkla Amazon araması, doğrulanmış birebir ürün eşleşmesi anlamına gelmez.

## 3. Doğrudan Amazon toplama

Amazon arama/ürün sayfası → popup'ta Sayfayı Tara → `requestASINs` → aynı Amazon
filtre motoru → geçici `asinList` → Hafızaya Kaydet → `memoryAsins`.
Otomatik mod sayfalar arasında ilerler, hafızaya yazar, sayfa/ASIN limitlerini izler.
`collectedPages` ve `visitedPages` yeniden işleme/sayfalama davranışında rol oynar.

## 4. Havuzdan çıktı

Hafıza → seçim/kopyalama/karıştırma → CSV veya JSON ve dışa aktarma geçmişi.
Hafıza → Başlıklar → Amazon detay kuyruğu → Gemini başlık kuyruğu → elle düzenleme/CSV.
`generatedTitles` ASIN anahtarlı kayıtları tutar. API anahtarları yerel storage'dadır;
AI çağrıları Google'a gider. “Yerel” ifadesi AI verisinin cihazdan çıkmadığı anlamına gelmez.

# Filtrelerin gerçek kapsamı

| Grup | Ölçüt | Etkilediği süreç |
| --- | --- | --- |
| eBay tarama | `scanMode`: live/sold | Mağaza ve analiz sekmelerinin URL'si |
| eBay yakalama | wide: C30 ≥ 1; normal: C7 ≥ 1 veya C30 ≥ 3; strict: C7 ≥ 3 | Aday ürün kaydı |
| eBay kısıtları | Satıcı kara listesi, yasaklı ana/alt kategori, `schSellerSaleDays` | İlgili keşif/tarama yolları |
| Satıcı AI keşfi | feedback > 100, kayıtlı/engelli satıcıyı atlama, görsel karşılaştırma | Satıcı önerilerinin kaydı |
| Amazon ürün | rating, feedback min/max, fiyat min/max | DOM ürün elemesi |
| Amazon teslimat/stok | Prime, 1/2 gün; asgari stok/uyarıyı dışla | DOM ürün elemesi |
| Amazon yasaklar | Marka/başlıkta yasaklı kelime, ASIN kara listesi; başlıkta ©/™/® | ASIN seçimi |
| Amazon BSR | maxBsr, BSR sıralama | Detay çağrısından sonra eleme/sıralama |
| Amazon seçim | fiyat/feedback/BSR/rastgele sıra, asinCount | Filtreden geçenlerden kaçının alınacağı |
| Otomatik limit | autoPageLimit, autoAsinLimit | Sayfalama/toplama durması |
| Gösterim | grafik günleri, miktar/alıcı, sayfa üstü ikon/alanlar | Görünürlük; ürün elemesiyle karıştırılmamalı |
| Paylaşılan | bannedWords | Amazon filtresi yanında başlık üretiminde atlama |

C sayıları kodda uygun tarihli satış geçmişi satırlarının sayılmasıyla üretiliyor.
İsim/yorumlarda “farklı müşteri” denmesi benzersiz alıcı tekilleştirmesinin kanıtı değil.
Amazon boş üst fiyat sınırı `0/null/undefined/''` olduğunda sınırsızdır.
Fiyat veya puan okunamamışsa mevcut bazı kontroller ürünü geçirir; tasarımda “bilinmiyor”
ile “uygun” aynı gösterilmemeli. Bu davranışı değiştirmek ayrı iş kuralı değişikliğidir.

# Mevcut sürümde koddan görülen sorunlar

1. **Panelin Amazon sekmesini hedeflemesi:** `popup.js` otomatik başlatırken
   `chrome.tabs.query({active:true,currentWindow:true})` yapar ve Amazon URL'si ister.
   Normal kullanımda aktif sekme research.html olduğundan uyarıyla geri döner.
   Popup'taki launcher ise Amazon sekmesinin üstünde açıldığında doğru bağlamdadır.
   Çözüm hedefi: panelde açık Amazon sekmesini açıkça seçme ve hedefi gösterme.
2. **Sonuç ile tamamlanma karışıyor:** `closeSelf` sıfır ASIN sonucunda da çağrılır;
   `fetched=true` verimli sonuç kanıtı değildir. Hata-finally yolu da kapanabilir.
   Yeni durum tasarımı başarılı/boş/blok/hata ayrımını gerektirir; bunun için motor
   veri üretmeli. UI bu ayrımı eski boolean'dan uydurmamalı.
3. **“Tümünü” görünür liste değildir:** toplu çekim tüm çekilmemiş kayıtları alır;
   ekrandaki arama/sıralama görünümüyle kapsam aynı sanılmamalı.
4. **Sekme davranışı sürprizli:** aktif nav'a tekrar basmak tüm bölümleri gösterir.
5. **Amazon filtresinde eBay görünüm ayarları var:** kaynak, filtre ve görünüm kavramları karışıyor.
6. **BSR ek yükü:** adaylar Promise.all ile detaya gider; sekme içi eşzamanlılık kapısı var
   ama bu yolun ayrıca genel hız/backoff düzeni yok. Tasarım yenilenirken varsayılanı açılmamalı.
7. **Yoğun bağlılık:** DOM ID'leri ve storage anahtarları iki panel betiği tarafından
   kullanılıyor. Ayrıca research.js çalışma anında CSS ve düğmeler ekliyor; yalnız HTML/CSS
   değişimi tüm ekranları kapsamaz. Eski lineage adlarının tamamının temizlendiği iddiası
   güncel kodda doğrulanmıyor (`asl-*` sınıfları hâlâ var); kör isim değiştirme yapılmamalı.

Bu bulgular canlı tarayıcıda yeniden üretilmiş hata raporları değil, incelenen kod yollarıdır.

# Hedef bilgi mimarisi — ilk taslak

```text
IndyGrab
├── Araştırma
│   ├── eBay mağazaları ve tarama
│   ├── Keşfedilen ürünler ve risk inceleme
│   └── Mağaza analiz kuyruğu
├── Amazon toplama
│   ├── Kaynak: açık Amazon sekmesi / eBay adayları
│   ├── Ürün filtreleri ve seçilecek ASIN sayısı
│   └── Toplama işi ve ilerleme
├── ASIN havuzu
│   ├── Kayıtlar, seçim, kara listeye taşıma
│   ├── Başlık hazırlama
│   └── Dışa aktarma ve geçmiş
├── Kurallar
│   ├── eBay satıcıları / kategorileri
│   └── Amazon ASIN'leri / yasaklı kelimeler
└── Ayarlar ve yardımcı araçlar
    ├── API, dil, tema, sayfa üzeri gösterim
    └── Mixer ve adres aktarımı
```

# Özellik kaybetmeden geliştirme sırası

1. **Referans davranış:** mevcut eklenti için izole profilde dolu/boş örnek veriler;
   tüm denetimlerin DOM ve storage bağlantıları. Gerçek sırlar/anahtarlar test verisi olmaz.
2. **Panel kabuğu:** gezinme, yazı/renk/boşluk sistemi, ortak bileşenler. İlk geçişte
   mesaj adları, filtre değerleri ve storage biçimi korunur. Popup hızlı işlem alanı kalır.
3. **Amazon çalışma alanı:** hedef sekme seçimi, filtre grupları, etkin filtre özeti,
   açık limitler. Aktif-sekme kusuru davranış testiyle düzeltilir.
4. **Araştırma çalışma alanı:** mağaza→ürün→Amazon geçişi, iş kapsamını belirten eylemler,
   risk inceleme ve kuyruk görünürlüğü. Silme eylemleri birincil işlemlerden ayrılır.
5. **Havuz ve yardımcı ekranlar:** başlık, dışa aktarma/geçmiş, iki kara liste, Mixer,
   dil/tema ve sayfa üstü araçlar ortak tasarımda korunur.
6. **Kontrollü geçiş:** yeni worktree eklentisi ayrı Chrome profilinde yüklenir; aynı
   profil farklı unpacked path için farklı extension ID/storage verebilir. Boş veri
   görmek veri kaybı olarak yorumlanmamalı. Canlı profil ve uzak kurulum ancak doğrulama sonrası.

Kabul matrisi: mağaza ekleme/çözümleme; canlı/satılmış ve üç hassasiyet; başlat/duraklat/
durdur; kategori ve iki kara liste; ürün arama/sıralama/sayfalama; tekli/toplu risk;
tekli/toplu Amazon; filtrelerin sınır/boş değerleri; sıfır sonuç ve blok; worker yeniden
başlama; manuel/otomatik ASIN toplama; limit/tekilleştirme; başlık düzenleme; CSV/JSON ve
geçmiş; Mixer; adres kopyala/yapıştır; iki tema/dil; klavye kullanımı ve taşmayan düzen.
Görsel önizleme, storage mock'u veya sözdizimi testi gerçek eklenti kabulünün yerine geçmez.
