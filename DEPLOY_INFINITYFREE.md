# InfinityFree'ye Yayınlama Kılavuzu

Bu proje **tamamen InfinityFree'ye göre** yapılandırılmıştır. InfinityFree
Python/Node çalıştırmaz; bu yüzden yapay zekâ asistanı PHP proxy'si
(`api/nvidia.php`) üzerinden NVIDIA NIM'e bağlanır. Ön yüz tamamen statiktir.

```text
Tarayıcı ──► index.html (statik, PDF + çizim + şekil/fotoğraf istemci tarafı)
         ──► /api/nvidia/status|chat|test ──► .htaccess ──► api/nvidia.php ──► NVIDIA NIM
```

> `.htaccess` yüklenmemiş olsa bile uygulama çalışır: ön yüz bu durumda
> otomatik olarak `/api/nvidia.php?route=...` adresine geçer.

## 1. Dosyaları yükleme

Bu depodaki **tüm dosyaları** olduğu gibi `htdocs/` klasörüne yükleyin
(FTP veya InfinityFree Dosya Yöneticisi):

```text
htdocs/
├── index.html
├── .htaccess                  ← gizli dosya! FTP'de "gizli dosyaları göster" açık olsun
├── api/
│   ├── nvidia.php
│   ├── .htaccess
│   └── config.sample.php
├── assets/demo.pdf
└── vendor/                    (tamamı: pdf.min.mjs, pdf.worker.min.mjs, pdf-lib.min.js, katex/)
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

## 3. Yapay zekâ asistanını etkinleştirme

Asistan olmadan da uygulama tamamen çalışır (PDF açma, çizim, şekil, fotoğraf,
kayıt). Asistan için NVIDIA NIM anahtarı gerekir:

1. `api/config.sample.php` dosyasını kopyalayın.
2. **Önerilen:** Kopyayı `htdocs`'un BİR ÜSTÜNDEKİ klasöre `nvidia-config.php`
   adıyla koyun (InfinityFree'de `htdocs` ile aynı seviyede, web'den erişilemez):

   ```text
   /home/volXX/epiz_XXXXXX/
   ├── nvidia-config.php     ← anahtar burada (web kökü DIŞINDA)
   └── htdocs/
       └── ...
   ```

   **Alternatif:** `htdocs/api/config.php` adıyla koyun — `api/.htaccess`
   doğrudan erişimi engeller.
3. Dosyadaki `NVIDIA_API_KEY` değerine anahtarınızı yazın.
4. Kontrol: `https://alanadiniz.com/api/nvidia.php?route=diag` →
   `anahtar_ayarli: true` ve `sonuc` alanında başarı mesajı görünmelidir.
   Gerçek istekle test için adrese `&live=1` ekleyin.

**Anahtarı asla** `index.html`'e, JavaScript'e veya Git deposuna koymayın.
(`.gitignore` `api/config.php` ve `nvidia-config.php`'yi zaten hariç tutar.)

## 4. InfinityFree sınırlamaları ve bilinmesi gerekenler

| Konu | Durum |
| --- | --- |
| Python / Node | Yok — AI proxy'si bu yüzden PHP'dir; ön yüz derlemesizdir. |
| PHP sürümü | 8.x; `curl` ve `json` eklentileri mevcut, proxy bunları kullanır. |
| SSL sertifika sorunu | Sunucunun CA paketi bozuksa proxy otomatik olarak doğrulamasız yeniden dener. |
| Çalışma süresi | Uzun AI yanıtları zaman aşımına uğrarsa asistan otomatik yeniden dener. |
| İstek boyutu | InfinityFree POST limiti (~10 MB) uygulamanın gönderdiği küçültülmüş sayfa görüntüleri için fazlasıyla yeterlidir. |
| Güvenlik sistemi | InfinityFree istekleri tarayıcı doğrulamasından (çerez) geçirir. Site içi istekler sorunsuz çalışır; `curl` gibi harici araçlarla test bu yüzden başarısız olabilir — testi tarayıcıdan yapın. |

## 5. Yayın sonrası kontrol listesi

- [ ] `https://alanadiniz.com/` → uygulama açılıyor
- [ ] "Örnek PDF" açılıyor (`assets/demo.pdf` yüklendi mi?)
- [ ] PDF üzerine çizim yapılıp sayfa değiştirince korunuyor (IndexedDB)
- [ ] Şekil aracı ve fotoğraf ekleme çalışıyor
- [ ] `vendor/` tam yüklendi mi? (Sayfa boşsa eksik `pdf.min.mjs` olabilir —
      tarayıcı konsolunda 404 kontrol edin)
- [ ] `/api/nvidia.php?route=diag&live=1` → `sonuc: BAŞARILI`
- [ ] Asistan sohbeti yanıt veriyor

## Sorun giderme

### 🔍 Önce teşhis sayfasını açın

AI çalışmıyorsa tarayıcıdan şu adresi ziyaret edin:

```text
https://alanadiniz.com/api/nvidia.php?route=diag&live=1
```

Bu sayfa PHP sürümünü, cURL durumunu, anahtarın bulunup bulunmadığını,
sunucudan NVIDIA'ya dışa giden bağlantının kurulup kurulamadığını ve gerçek bir
test isteğinin sonucunu JSON olarak raporlar. `sonuc` alanı sorunu Türkçe
açıklar (anahtar geçersiz, model bulunamadı, bağlantı engelli vb.). Teşhis
sayfası anahtarınızı asla göstermez.

### Sık karşılaşılan durumlar

- **`.htaccess` yüklenmemiş:** Uygulama yine çalışır (ön yüz otomatik olarak
  `/api/nvidia.php?route=...` adresine geçer) ama HTTPS yönlendirmesi, MIME
  türleri ve belge koruması için `.htaccess`'i yüklemeniz önerilir.
- **Sayfa açılıyor ama PDF yüklenmiyor:** `vendor/pdf.min.mjs` ve
  `vendor/pdf.worker.min.mjs` yüklendiğinden emin olun; tarayıcı konsolunda
  404/MIME hatası olup olmadığına bakın.
- **`/api/nvidia/status` 404 dönüyor:** `api/nvidia.php` eksik olabilir.
  Doğrudan test: `https://alanadiniz.com/api/nvidia.php?route=status`.
- **Asistan "anahtar ayarlı değil" diyor:** Teşhis sayfasındaki
  `yapilandirma_kaynagi` alanına bakın. `nvidia-config.php` → `htdocs` ile
  AYNI seviyede (içinde değil) olmalı; alternatif `htdocs/api/config.php`.
  Dosyanın `<?php return [...];` biçiminde olduğundan ve anahtarın
  `NVIDIA_API_KEY` alanına tırnak içinde yazıldığından emin olun.
- **Teşhiste SSL hatası görünüyor:** Proxy, sunucunun CA paketi bozuksa SSL
  doğrulamasını otomatik atlayarak yeniden dener (`ssl_dogrulama_atlandi: true`
  olarak raporlanır); ek işlem gerekmez.
- **Asistan zaman aşımına uğruyor:** GLM gibi muhakemeli modeller yoğun
  saatlerde yavaş yanıt verebilir; uygulama 95 saniyede isteği iptal edip
  yeniden dener. Sorun sürerse biraz bekleyip tekrar deneyin.
