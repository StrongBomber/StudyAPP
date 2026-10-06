# InfinityFree'ye Yayınlama Kılavuzu

Çözüm iPadOS Safari ve Apple Pencil 2 için tasarlanmış bir web uygulamasıdır. Çizim, PDF ve yerel kayıtlar tarayıcıda kalır. İsteğe bağlı AI öğretmeni aynı alan adındaki PHP proxy'sini kullanır; bunun için PHP cURL, dışarı HTTPS bağlantısı ve sunucuda `NVIDIA_API_KEY` ortam değişkeni gerekir. NVIDIA anahtarını hiçbir istemci dosyasına veya Git'e ekleme.

## 1. Dosyaları yükleme

Aşağıdaki dosyaları ve klasörleri, dizin yapısını koruyarak `htdocs/` içine yükle:

```text
htdocs/
├── index.html
├── styles.css
├── .htaccess                  ← gizli dosyaları göstermeyi aç
├── api/
│   └── chat.php               ← NVIDIA anahtarı sunucuda kalır
├── assets/
│   ├── demo.pdf
│   └── favicon.svg
├── src/
│   ├── ai.css
│   ├── app.js
│   ├── export.js
│   ├── renderer.js
│   ├── storage.js
│   └── stroke.js
└── vendor/
    ├── pdf.min.mjs
    ├── pdf.worker.min.mjs
    ├── pdf-lib.min.js
    ├── cmaps/                 ← PDF karakter kümeleri
    ├── standard_fonts/        ← standart font dosyaları
    └── lisans dosyaları
```

FTP kullanıyorsan FileZilla'da **Sunucu → Gizli dosyaları görüntülemeye zorla** seçeneğini aç; `.htaccess` bu yüzden gözden kaçabilir. `src/` veya `vendor/` altındaki dosyaları yeniden adlandırma.

## 2. SSL (HTTPS)

1. InfinityFree kontrol panelinde **Free SSL Certificates** bölümünden alan adın için sertifika iste.
2. Panelin istediği DNS doğrulamasını tamamla ve sertifikayı etkinleştir.
3. Kökteki `.htaccess` dosyası, SSL etkin olduktan sonra HTTP trafiğini HTTPS'e yönlendirir.

Sertifika kurulmadan önce yönlendirme sorun çıkarırsa `.htaccess` içindeki HTTPS yönlendirme bloğunu geçici olarak yorum satırına al.

## 3. AI öğretmeni için sunucu ayarı (isteğe bağlı)

1. Barındırma hizmetinde PHP 8+ ve cURL uzantısının etkin olduğunu; sunucunun `integrate.api.nvidia.com` adresine HTTPS çıkışı yapabildiğini doğrula.
2. Sunucu/PHP işlem ortamında `NVIDIA_API_KEY` adlı ortam değişkenini gizli biçimde tanımla. Anahtarı `index.html`, JavaScript, Git'e eklenen `.htaccess`, sohbet isteği veya bir ekran görüntüsüne koyma. Yayımlamadan önce sağlayıcı konsolunda daha önce paylaşılmış anahtarları iptal edip yenile.
3. `https://alan-adin/api/chat.php` adresine tarayıcıdan GET yapmak `405` döndürür; bu beklenen bir davranıştır. AI sohbeti POST isteği kullanır. Eksik ortam değişkeni `503` verir.
4. InfinityFree hesabın PHP süreçlerine ortam değişkeni atamaya izin vermiyorsa AI özelliği o hostingte çalışmaz; sırf çalıştırmak için anahtarı herkese açık dosyaya koyma. Çizim ve PDF özellikleri AI olmadan da çalışır.

Sohbet mesajları NVIDIA'ya iletilir. PDF dosyası, çizimler ve sayfa notları gönderilmez. Açık sayfanın seçilebilir metni yalnızca kullanıcı AI panelindeki onay kutusunu seçtiğinde istek gövdesine eklenir. Proxy istek hızını sınırlamak için istemci IP'sinden NVIDIA anahtarıyla bir HMAC üretir; ham IP sayaç dosyasına yazılmaz.

## 4. Yayından sonra kontrol

- [ ] Ana sayfa açılıyor ve stiller yükleniyor
- [ ] PDF.js motoru, worker'ı, `vendor/cmaps/` ve `vendor/standard_fonts/` dosyaları yükleniyor
- [ ] **Örnek belgeyle dene** çalışıyor
- [ ] Kendi PDF'in açılıyor ve sayfalar arasında geçiliyor
- [ ] Apple Pencil 2 ile çizginin kesintisiz ve düşük gecikmeli izlendiği; farklı basınçta ince/kalın çizgi, eğim ve açıyla dolma, fırça, kurşun ve keçeli kalem davranışı
- [ ] AI asistanı sunucu `NVIDIA_API_KEY` ayarlıysa yanıt veriyor; PDF metni kutu işaretlenmeden gönderilmiyor, işaretliyken yalnızca seçilebilir açık sayfa metni gönderiliyor
- [ ] Basınç duyarlılığı ve çizgi dengeleme ayarları, renk/kalınlık/opaklık, silgi ve şekiller çalışıyor
- [ ] Parmak çizim yapmıyor; sayfayı kaydırıyor ve iki parmakla yakınlaştırıyor
- [ ] PNG/JPEG/WebP/GIF/BMP görsel ekleme, taşıma ve boyutlandırma çalışıyor
- [ ] Yenileyince son belge, görseller ve çizimler geri geliyor
- [ ] **PDF indir** işaretlemeleri PDF'e ekliyor

## Sorun giderme

| Belirti | Kontrol / çözüm |
|---|---|
| Boş sayfa veya stil yok | `styles.css` ve `src/` klasörünün tam yüklendiğini, ardından sert yenileme yaptığını doğrula. |
| PDF yüklenmiyor | `.htaccess` içindeki `.mjs` MIME türünü ve `vendor/pdf.worker.min.mjs` dosyasını kontrol et. Yazılar/karakterler eksikse `vendor/cmaps/` ve `vendor/standard_fonts/` dizinlerinin eksiksiz yüklendiğini doğrula. |
| Örnek belge yüklenmiyor | `assets/demo.pdf` dosyasının doğru dizinde olduğunu ve sunucunun PDF dosyalarını sunduğunu kontrol et. |
| PDF indirilemiyor | `vendor/pdf-lib.min.js` dosyasını ve tarayıcının indirme engelini kontrol et. |
| AI panelinde 503 | PHP `getenv('NVIDIA_API_KEY')` değerinin boş olmadığını ve cURL uzantısının açık olduğunu sunucuda doğrula; anahtarı tarayıcıya koyma. |
| AI panelinde 502 / 429 | Sunucudan dışarı HTTPS erişimini, NVIDIA hesabını/limitini ve `api/chat.php` POST yanıtını kontrol et. |
| AI sayfa metnini okuyamıyor | Taranmış/görüntü tabanlı PDF'lerde seçilebilir metin olmayabilir; sayfa metni otomatik OCR yapılmaz. |
| Kayıtlı belge görünmüyor | Aynı tarayıcı/profil ve normal pencereyi kullan; gizli mod kapandığında yerel veriler silinebilir. |
| Eski dosyalar görünüyor | Tarayıcıda `Ctrl+Shift+R` / `⌘+Shift+R` ile sert yenileme yap. |

PDF'ler, çizimler ve sayfa notları tarayıcı profilinin IndexedDB alanında kalır. AI sohbet mesajları NVIDIA API'sine iletilir; seçilebilir PDF sayfa metni ise yalnızca AI panelindeki onay kutusu kullanıcı tarafından seçildiğinde gönderilir. Tarayıcı depolamasını temizlemek yerel belgeleri ve notları kaldırır.
