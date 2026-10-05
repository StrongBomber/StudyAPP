# InfinityFree'ye Yayınlama Kılavuzu

Çözüm iPadOS Safari ve Apple Pencil için tasarlanmış statik bir web uygulamasıdır. Pencil basınç/eğim verisi, çizim, IndexedDB kayıtları ve PDF dışa aktarma tarayıcıda gerçekleşir; PHP, sunucu veritabanı, API anahtarı veya derleme adımı gerekmez.

## 1. Dosyaları yükleme

Aşağıdaki dosyaları ve klasörleri, dizin yapısını koruyarak `htdocs/` içine yükle:

```text
htdocs/
├── index.html
├── styles.css
├── .htaccess                  ← gizli dosyaları göstermeyi aç
├── assets/
│   ├── demo.pdf
│   └── favicon.svg
├── src/
│   ├── app.js
│   ├── export.js
│   ├── renderer.js
│   ├── storage.js
│   └── stroke.js
└── vendor/
    ├── pdf.min.mjs
    ├── pdf.worker.min.mjs
    ├── pdf-lib.min.js
    └── lisans dosyaları
```

FTP kullanıyorsan FileZilla'da **Sunucu → Gizli dosyaları görüntülemeye zorla** seçeneğini aç; `.htaccess` bu yüzden gözden kaçabilir. `src/` veya `vendor/` altındaki dosyaları yeniden adlandırma.

## 2. SSL (HTTPS)

1. InfinityFree kontrol panelinde **Free SSL Certificates** bölümünden alan adın için sertifika iste.
2. Panelin istediği DNS doğrulamasını tamamla ve sertifikayı etkinleştir.
3. Kökteki `.htaccess` dosyası, SSL etkin olduktan sonra HTTP trafiğini HTTPS'e yönlendirir.

Sertifika kurulmadan önce yönlendirme sorun çıkarırsa `.htaccess` içindeki HTTPS yönlendirme bloğunu geçici olarak yorum satırına al.

## 3. Yayından sonra kontrol

- [ ] Ana sayfa açılıyor ve stiller yükleniyor
- [ ] PDF.js dosyaları yükleniyor (`vendor/pdf.min.mjs` ve `vendor/pdf.worker.min.mjs`)
- [ ] **Örnek belgeyle dene** çalışıyor
- [ ] Kendi PDF'in açılıyor ve sayfalar arasında geçiliyor
- [ ] Apple Pencil 2 ile farklı basınçta ince/kalın çizgi; eğimle dolma ve kurşun kalem davranışı
- [ ] Fırça türleri, renk/kalınlık/opaklık ayarı, silgi ve şekiller çalışıyor
- [ ] Parmak çizim yapmıyor; sayfayı kaydırıyor ve iki parmakla yakınlaştırıyor
- [ ] PNG/JPEG/WebP/GIF/BMP görsel ekleme, taşıma ve boyutlandırma çalışıyor
- [ ] Yenileyince son belge, görseller ve çizimler geri geliyor
- [ ] **PDF indir** işaretlemeleri PDF'e ekliyor

## Sorun giderme

| Belirti | Kontrol / çözüm |
|---|---|
| Boş sayfa veya stil yok | `styles.css` ve `src/` klasörünün tam yüklendiğini, ardından sert yenileme yaptığını doğrula. |
| PDF yüklenmiyor | `.htaccess` içindeki `.mjs` MIME türünü ve `vendor/pdf.worker.min.mjs` dosyasının varlığını kontrol et. |
| Örnek belge yüklenmiyor | `assets/demo.pdf` dosyasının doğru dizinde olduğunu ve sunucunun PDF dosyalarını sunduğunu kontrol et. |
| PDF indirilemiyor | `vendor/pdf-lib.min.js` dosyasını ve tarayıcının indirme engelini kontrol et. |
| Kayıtlı belge görünmüyor | Aynı tarayıcı/profil ve normal pencereyi kullan; gizli mod kapandığında yerel veriler silinebilir. |
| Eski dosyalar görünüyor | Tarayıcıda `Ctrl+Shift+R` / `⌘+Shift+R` ile sert yenileme yap. |

PDF'ler, çizimler ve sayfa notları sunucuya gönderilmez; aynı tarayıcı profilinin IndexedDB alanında kalır. Tarayıcı depolamasını temizlemek bu verileri kaldırır.
