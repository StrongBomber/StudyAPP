# InfinityFree'ye Yayınlama Kılavuzu

Bu proje **tamamen statiktir**: PDF açma, çizim, şekil/fotoğraf ekleme ve
kayıt işlemlerinin hepsi tarayıcıda çalışır. Sunucu tarafında PHP, veritabanı
veya API anahtarı gerekmez.

```text
Tarayıcı ──► index.html (statik: PDF + çizim + şekil/fotoğraf + IndexedDB kaydı)
```

## 1. Dosyaları yükleme

Bu depodaki **tüm dosyaları** olduğu gibi `htdocs/` klasörüne yükleyin
(FTP veya InfinityFree Dosya Yöneticisi):

```text
htdocs/
├── index.html
├── .htaccess                  ← gizli dosya! FTP'de "gizli dosyaları göster" açık olsun
├── assets/demo.pdf
└── vendor/                    (tamamı: pdf.min.mjs, pdf.worker.min.mjs, pdf-lib.min.js)
```

> FTP için [FileZilla](https://filezilla-project.org/) önerilir (hesap FTP
> bilgileri InfinityFree kontrol panelinde yazar). FileZilla'da
> *Sunucu → Gizli dosyaları görüntülemeye zorla* seçeneğini açın.
> Dosya Yöneticisi kullanıyorsanız projeyi zip'leyip sunucuda çıkarabilirsiniz.

`README.md` ve bu kılavuz gibi belge dosyaları sunucuya yüklense de `.htaccess`
bunlara tarayıcı erişimini engeller; isterseniz hiç yüklemeyebilirsiniz.

## 2. SSL (HTTPS) kurulumu

1. InfinityFree kontrol panelinde **Free SSL Certificates** bölümünden
   domain'iniz için sertifika isteyin (Let's Encrypt / GoGetSSL).
2. İstenen CNAME kaydını panel üzerinden onaylayın ve sertifikayı kurun.
3. Kökteki `.htaccess` HTTPS yönlendirmesini zaten içeriyor; sertifika aktif
   olunca site otomatik olarak HTTPS'e yönlenir.

> SSL kurulumunu yapana kadar yönlendirme sorun çıkarırsa `.htaccess` içindeki
> üç satırlık HTTPS bloğunun başına `#` koyarak geçici olarak kapatabilirsiniz.

## 3. Kontrol listesi

- [ ] `https://alanadiniz.com/` açılıyor ve örnek belge görünüyor
- [ ] "PDF aç" ile kendi PDF'iniz yükleniyor
- [ ] Kalemle çizim yapılıp sayfa değiştirince çizim korunuyor
- [ ] "PDF indir" işaretlemeleri gömülmüş PDF veriyor
- [ ] Sayfayı yenileyince çizimler ve notlar geri geliyor (IndexedDB)

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Sayfa açılmıyor / 403 | `index.html`'in doğrudan `htdocs/` içinde olduğunu doğrulayın. |
| PDF açılmıyor | `vendor/pdf.min.mjs` ve `vendor/pdf.worker.min.mjs` dosyalarının yüklendiğini ve `.htaccess`'in `.mjs` için MIME türü tanımladığını kontrol edin. |
| PDF indirilemiyor | `vendor/pdf-lib.min.js` dosyasının yüklendiğini kontrol edin. |
| Çizimler kayboluyor | Tarayıcının gizli/özel modunda IndexedDB kalıcı olmayabilir; normal modda deneyin. |
