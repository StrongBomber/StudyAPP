# Çözüm — PDF çalışma alanı

PDF soru bankalarını tarayıcıda açıp kalemle çözmek için hazırlanmış, **InfinityFree üzerinde çalışacak şekilde yapılandırılmış** bir çalışma alanı. PDF görüntüleme, işaretleme, şekil ve fotoğraf ekleme tamamen istemci tarafında çalışır; yapay zekâ asistanı ise anahtarı tarayıcıya vermeden PHP proxy'si (`api/nvidia.php`) üzerinden NVIDIA NIM'e bağlanır.

## Özellikler

- PDF içe aktarma, sayfalar arasında gezinme ve yazılan sayfa numarasına atlama
- PDF üzerine çizim; işaretlemeleri PDF'e gömerek dışa aktarma
- Dört yazım modu: **Mürekkep**, **Kurşun**, **Fosforlu** ve **Dolma kalem**
- **Şekil aracı**: çizgi, ok, dikdörtgen, daire, elips, üçgen — sürükleyerek çizim
- **Fotoğraf ekleme**: taşıma, köşeden boyutlandırma; dışa aktarmada PDF'e gömülür
- Kalem kalınlığı ve çizgi sabitleme ayarları; desteklenen cihazlarda stylus basıncı
- Geri al/yinele, yakınlaştırma/taşıma, kırpma odağı ve görünümü sıfırlama
- Notların, çizimlerin ve soru durumlarının tarayıcıda IndexedDB ile saklanması
- Kırpım seçmeden de açık PDF sayfasını bağlam olarak kullanabilen Türkçe ders asistanı
- Örnek çalışma PDF'i: `assets/demo.pdf`

PDF.js, pdf-lib ve KaTeX dosyaları `vendor/` altında depolanır; derleme adımı gerekmez.

## InfinityFree'ye yükleme (özet)

1. Bu depodaki **tüm dosyaları** `htdocs/` klasörüne yükleyin (`.htaccess` dahil — FTP istemcinizde gizli dosyaları göstermeyi açın).
2. InfinityFree panelinden **ücretsiz SSL** kurun.
3. Yapay zekâ için `api/config.sample.php` dosyasını kopyalayıp anahtarınızı girin (ayrıntı aşağıda).
4. Kontrol: `https://alanadiniz.com/api/nvidia.php?route=diag&live=1`

Adım adım kurulum, teşhis ve sorun giderme için: [`DEPLOY_INFINITYFREE.md`](DEPLOY_INFINITYFREE.md)

## Yapay zekâ anahtarı

Asistan olmadan da uygulama tamamen çalışır. Asistan için NVIDIA NIM anahtarı (`https://build.nvidia.com`) gerekir:

- **Önerilen:** `api/config.sample.php` kopyasını `htdocs`'un BİR ÜSTÜNDEKİ klasöre `nvidia-config.php` adıyla koyun (web'den erişilemez).
- **Alternatif:** `htdocs/api/config.php` adıyla koyun (`.htaccess` doğrudan erişimi engeller).

Gerçek anahtarı asla `index.html`'e, JavaScript'e, commit'lere veya herkese açık depoya koymayın. Anahtar yanlışlıkla paylaşıldıysa NVIDIA panelinden iptal edip yenisini oluşturun. Modeli değiştirmek için yapılandırma dosyasındaki `NVIDIA_MODEL` değerini düzenleyin; varsayılan `z-ai/glm-5.3-flash`'tir.

## Yerelde deneme

PHP kuruluysa proje kökünde:

```bash
php -S 127.0.0.1:8000
```

`http://127.0.0.1:8000` adresinde arayüz açılır; AI uçları `api/nvidia.php?route=...` üzerinden çalışır (ön yüz bu adrese otomatik düşer). PHP olmadan herhangi bir statik sunucuyla da arayüzü deneyebilirsiniz; bu durumda yalnızca asistan devre dışı kalır.

## Depo yapısı

```text
.
├── index.html                 # Web uygulaması (tek dosya)
├── .htaccess                  # API yönlendirme, HTTPS, MIME, dosya koruması
├── api/
│   ├── nvidia.php             # NVIDIA NIM proxy'si (status/chat/test/diag)
│   ├── .htaccess              # config dosyalarını koruma
│   └── config.sample.php      # Anahtar yapılandırma şablonu
├── assets/demo.pdf            # Örnek PDF
├── vendor/                    # PDF.js, pdf-lib, KaTeX ve lisansları
└── DEPLOY_INFINITYFREE.md     # Kurulum ve sorun giderme kılavuzu
```

## Güvenlik ve gizlilik

- PDF'ler ve notlar sunucuya yüklenmez; tarayıcıda saklanır. Asistana gönderilen sohbet içeriği (ilk soruda açık sayfanın küçültülmüş görüntüsü dâhil) PHP proxy üzerinden NVIDIA servisine iletilir.
- `api/nvidia.php` anahtarı asla tarayıcıya veya hata mesajlarına yansıtmaz.
- Teşhis sayfası (`?route=diag`) anahtarın yalnızca var/yok bilgisini ve uzunluğunu raporlar.

## Lisans

Uygulamanın kendi kaynak kodu için ayrı bir lisans seçilmemiştir. `vendor/` altındaki üçüncü taraf bileşenlerin lisans bilgileri ilgili lisans dosyalarında ve [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) içinde yer alır.
