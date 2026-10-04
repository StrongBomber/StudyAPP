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

Bu sayfa şunları JSON olarak raporlar — `sonuc` alanı sorunu Türkçe açıklar:

- PHP sürümü, `max_execution_time`, cURL durumu, yapılandırma kaynağı
- **Bağlantı sondası**: DNS / TCP bağlantı / TLS / ilk yanıt / toplam süre
  ölçümleri, bağlanılan IP, cURL hata metni
- **Canlı test** (`&live=1`): gerçek "Say OK" isteğinin HTTP durumu, cURL hata
  metni, tüm süre ölçümleri ve NVIDIA'nın döndürdüğü ham hata özeti
- **`son_kayitlar`**: geçmiş AI isteklerinin hata günlüğü (aşağıya bakın)

Teşhis sayfası ve günlük **anahtarınızı ve sohbet içeriğinizi asla içermez**.

### 📒 Otomatik hata günlüğü

Her chat/test isteğinin sonucu `api/debug.log` dosyasına kaydedilir: cURL hata
metni, bağlantı süresi, ilk yanıt süresi (TTFB), toplam süre, HTTP durumu,
NVIDIA'nın hata mesajı, model, mesaj sayısı ve istek boyutu. Günlük ~256 KB'ı
aşınca kendini sıfırlar; tarayıcıdan doğrudan erişim `.htaccess` ile engellidir
— son kayıtları teşhis sayfasındaki `son_kayitlar` alanından okuyun.

### ⏱️ Zaman aşımı teşhisi ve model değiştirme

Canlı test `ZAMAN AŞIMI` veriyorsa süre ölçümlerine bakın:

- `baglanti_sn` küçük (ör. 0.2) + "0 bytes received" → bağlantı kuruluyor ama
  **model yanıt üretmiyor** (NVIDIA kuyruğu yoğun). Çalışan bir model bulun:

  1. **Güncel model listesini görün** (hesabınızın gerçekten erişebildikleri):

     ```text
     .../api/nvidia.php?route=models
     .../api/nvidia.php?route=models&q=flash      ← adında "flash" geçenler
     .../api/nvidia.php?route=models&q=vision     ← görsel destekliler
     ```

  2. **Adayları canlı test edin** — uygulama ilk soruda sayfa görüntüsü
     gönderdiği için `&vision=1` ile görsel desteğini de sınayın:

     ```text
     .../api/nvidia.php?route=diag&live=1&model=MODEL_ADI&vision=1
     ```

  3. Muhakemeli modellerde (GLM, Qwen...) düşünme modunu kapatmak yanıtı çok
     hızlandırabilir: `&thinking=0` ekleyerek test edin; işe yararsa
     yapılandırmaya `'NVIDIA_THINKING' => false` yazın.

  4. **Elle model seçimi:** Asistan panelinin başlığındaki açılır menüden
     model seçebilirsiniz. Menüde görünen modeller `NVIDIA_MODELS` ayarından
     gelir (varsayılan: `moonshotai/kimi-k3`, `z-ai/glm-5.3-flash`,
     `z-ai/glm-5.3`); seçiminiz tarayıcıda hatırlanır:

     ```php
     'NVIDIA_MODELS' => 'moonshotai/kimi-k3, z-ai/glm-5.3-flash, z-ai/glm-5.3',
     ```

  5. Çalışan modeli yapılandırmada `NVIDIA_MODEL` yapın ve yoğunluğa karşı
     **yedek zincir** tanımlayın — birincil model yanıt vermezse proxy
     otomatik olarak sıradakini dener:

     ```php
     'NVIDIA_MODEL' => 'hizli-ve-vision-model',
     'NVIDIA_FALLBACK_MODELS' => 'ikinci-model, ucuncu-model',
     ```

- HTTP **410** görürseniz model emekliye ayrılmıştır (`meta/llama-3.1-8b`
  gibi) — `?route=models` listesinden güncel bir model seçin.
- `baglanti_sn` = 0 ve cURL hatası bağlantıya işaret ediyor → hosting dışa
  giden isteği engelliyor; `son_kayitlar` ve `curl_hata` metnini not alın.

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
