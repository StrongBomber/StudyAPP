# Çözüm — PDF çalışma alanı

PDF soru bankaları ve ders notları üzerinde çalışmak için hazırlanmış, **iPadOS Safari ve Apple Pencil odaklı**, tamamen tarayıcıda çalışan bir çalışma alanı. Apple Pencil ile basınca duyarlı çiz; parmakla sayfayı taşı ve iki parmakla yakınlaştır. Veriler iPad'de kalır; sunucu, hesap, API veya API anahtarı gerekmez.

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
- Her sayfaya bağlı not yazmak ve sayfaları tamamlandı olarak işaretlemek
- Çizim ve şekilleri yeni PDF'e gömerek indirmek
- En son açılan belgeyi, sayfayı ve ilerlemeyi otomatik geri yüklemek

PDF'ler, çizimler, eklenen görseller ve notlar **tarayıcının IndexedDB alanında bu cihazda** saklanır. Dışarıya PDF veya not gönderen bir API ya da üçüncü taraf analitik yoktur. Tarayıcı verisini temizlemek veya belgeyi kenar çubuğundan kaldırmak kayıtları siler. Eski Çözüm sürümündeki yerel PDF, çizim ve notlar ilk açılışta yeni çalışma alanına aktarılır; kaynak kayıtlar aktarım sırasında silinmez.

## Yerelde çalıştırma

Bir statik HTTP sunucusu yeterlidir; derleme adımı yoktur:

```bash
python3 -m http.server 8000
```

Ardından `http://127.0.0.1:8000` adresini aç. PDF.js ES modülü ve worker'ı `.mjs` MIME türüyle sunulmalıdır; `file://` yerine HTTP/HTTPS kullan.

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
  *LICENSE*.txt
```

Ayrıntılı kurulum ve kontrol listesi: [`DEPLOY_INFINITYFREE.md`](DEPLOY_INFINITYFREE.md).

## Proje yapısı

- `index.html` — erişilebilir uygulama iskeleti
- `styles.css` — duyarlı, mobil uyumlu arayüz
- `src/app.js` — etkileşimler, araçlar, otomatik kayıt ve sayfa ilerlemesi
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
