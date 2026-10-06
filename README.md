# Çözüm — PDF çalışma alanı

PDF soru bankaları ve ders notları üzerinde çalışmak için hazırlanmış, **iPadOS Safari ve Apple Pencil 2 odaklı** bir çalışma alanı. Apple Pencil ile basınca duyarlı çiz; parmakla sayfayı taşı ve iki parmakla yakınlaştır. PDF'ler, çizimler ve notlar cihazda kalır. İsteğe bağlı AI öğretmeni sunucu tarafındaki PHP proxy'sini kullanır; NVIDIA anahtarı tarayıcıya gönderilmez ve PDF sayfa metni yalnızca kullanıcı açıkça paylaşmayı seçerse modele iletilir.

## Neler yapabilirsin?

- PDF açmak, sürükleyip bırakmak ve örnek belgeyle başlamak
- Sayfalar arasında gezinmek, sayfaya sığdırmak ve yakınlaştırmak
- Basınca göre kalınlaşıp incelen tükenmez, kontrastlı dolma kalem, fırça kalem, dokulu kurşun kalem, kesik uçlu keçeli ve fosforlu kalem
- Apple Pencil basınç/eğim/açı verisi, tahmin edilen Pencil örnekleri ve ayarlanabilir basınç duyarlılığı/çizgi dengeleme
- Uzun çizgilerde düşük gecikmeli önizleme; bırakınca aynı çizginin tam kaliteli vektör olarak işlenmesi
- Silgi, sayfayı taşıma ve vektörel çizgi, ok, dikdörtgen, elips ve üçgen araçları
- Parmakla sayfayı kaydırmak; iki parmakla yakınlaştırmak (parmakla çizim kapalı)
- Renk, kalınlık, opaklık, basınç tepkisi ve dengeyi ayrı ayarlamak; kalem tercihlerini sonraki oturum için hatırlamak
- Apple Pencil gezinmesini destekleyen iPad'lerde uca göre şekillenen imleç önizlemesi görmek
- Sayfaya görsel eklemek, sürükleyerek taşımak ve köşeden boyutlandırmak
- Geri al / yinele ve klavye kısayolları
- NVIDIA GLM-5.3-Flash ile AI çalışma asistanı; sohbet mesajları dışında PDF metni varsayılan olarak paylaşılmaz ve açık sayfanın metni ayrı bir onay kutusuyla seçilebilir
- Her sayfaya bağlı not yazmak ve sayfaları tamamlandı olarak işaretlemek
- Çizim ve şekilleri yeni PDF'e gömerek indirmek
- En son açılan belgeyi, sayfayı ve ilerlemeyi otomatik geri yüklemek

PDF'ler, çizimler, eklenen görseller ve notlar **tarayıcının IndexedDB alanında bu cihazda** saklanır. AI sohbetinde yazdığın mesajlar NVIDIA'nın API'sine sunucu proxy'si üzerinden gönderilir; PDF dosyası, çizimler ve sayfa notları gönderilmez. PDF sayfa metni de ancak AI panelindeki açık onay kutusunu seçtiğinde o isteğe eklenir. Sohbet geçmişi bu oturumda tutulur, cihazına kaydedilmez. AI proxy kötüye kullanımı önlemek için istemci IP'sini NVIDIA anahtarıyla HMAC'leyerek istek sayısını sınırlar; ham IP bu uygulamanın sayaç dosyasına yazılmaz. Tarayıcı verisini temizlemek veya belgeyi kenar çubuğundan kaldırmak yerel kayıtları siler. Eski Çözüm sürümündeki yerel PDF, çizim ve notlar ilk açılışta yeni çalışma alanına aktarılır; kaynak kayıtlar aktarım sırasında silinmez.

## Yerelde çalıştırma

PDF çalışma alanı için derleme adımı gerekmez. Statik sunucuyla arayüz ve çizim araçları açılır; AI endpoint'inin çalışması için PHP 8+ (cURL etkin) gerekir:

```bash
php -S 0.0.0.0:8000 -t .
```

Sunucuyu başlatmadan önce `NVIDIA_API_KEY` değişkenini PHP sürecine güvenli biçimde tanımla. Anahtarı komuta, dosyaya, tarayıcıya veya Git'e yazma. Bu değişken yoksa AI paneli yapılandırma hatası gösterir. Yalnızca statik dosya sunucusu kullanılırsa `api/chat.php` çalışmayacağından AI devre dışı kalır. PDF.js ES modülü ve worker'ı `.mjs` MIME türüyle sunulmalı; CMap ve standart font dizinleri `vendor/` altında bulunmalı. `file://` yerine HTTP/HTTPS kullan.

## InfinityFree'ye yükleme

Aşağıdaki dosya ve klasörleri `htdocs/` içine, yapısını bozmadan yükle:

```text
index.html
styles.css
.htaccess
assets/
  demo.pdf
  favicon.svg
src/
  app.js
  export.js
  renderer.js
  storage.js
  stroke.js
vendor/
  pdf.min.mjs
  pdf.worker.min.mjs
  pdf-lib.min.js
  cmaps/          # PDF.js karakter kümeleri
  standard_fonts/ # gömülü olmayan standart fontlar
  *LICENSE*.txt
```

Ayrıntılı kurulum ve kontrol listesi: [`DEPLOY_INFINITYFREE.md`](DEPLOY_INFINITYFREE.md).

## Proje yapısı

- `index.html` — erişilebilir uygulama iskeleti
- `styles.css`, `src/ai.css` — duyarlı arayüz ve AI paneli stilleri
- `src/app.js` — etkileşimler, araçlar, otomatik kayıt, AI sohbeti ve sayfa ilerlemesi
- `api/chat.php` — NVIDIA anahtarını yalnızca sunucuda tutan, sınırlandırılmış AI proxy'si
- `src/renderer.js` — PDF.js sayfa çizimi, Apple Pencil girişi ve kanvas katmanları
- `src/stroke.js` — basınç/eğim duyarlı yumuşatılmış fırça geometrisi
- `src/storage.js` — IndexedDB tabanlı yerel çalışma alanı
- `src/export.js` — aynı fırça geometrisini pdf-lib ile vektörel dışa aktarma
- `vendor/` — yerel PDF.js ve pdf-lib dosyaları; derleme/harici CDN gerekmez
- `assets/demo.pdf` — örnek belge

## Kısayollar

| Kısayol | İşlev |
|---|---|
| `⌘/Ctrl + O` | PDF aç |
| `⌘/Ctrl + Z` | Geri al |
| `⌘/Ctrl + Shift + Z` veya `⌘/Ctrl + Y` | Yinele |
| `P` / `H` / `E` / `S` | Kalem / fosforlu / silgi / şekil |
| `Space` basılı tut | Sayfayı taşı |
| `←` / `→` | Önceki / sonraki sayfa |
| `Ctrl + kaydırma` | Yakınlaştır / uzaklaştır |

## Doğrulama

Kaynak dosyalarının sözdizimini kontrol etmek için:

```bash
for file in src/*.js; do node --check "$file"; done
```

## Üçüncü taraf lisansları

PDF.js ve pdf-lib lisansları `vendor/` altındaki lisans dosyalarında ve [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) içinde yer alır.
