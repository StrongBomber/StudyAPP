# Çözüm — PDF çalışma alanı

PDF soru bankalarını tarayıcıda açıp kalemle çözmek için hazırlanmış, **tamamen istemci tarafında çalışan** bir çalışma alanı. Sunucu, veritabanı veya API anahtarı gerektirmez; tek bir `index.html` ve `vendor/` klasörüyle her statik barındırmada (InfinityFree dahil) çalışır.

## Özellikler

- PDF içe aktarma, sayfalar arasında gezinme ve yazılan sayfa numarasına atlama
- PDF üzerine çizim; işaretlemeleri PDF'e gömerek dışa aktarma
- Dört yazım modu: **Mürekkep**, **Kurşun**, **Fosforlu** ve **Dolma kalem**
- **Şekil aracı**: çizgi, ok, dikdörtgen, daire, elips, üçgen — sürükleyerek çizim
- **Fotoğraf ekleme**: taşıma, köşeden boyutlandırma; dışa aktarmada PDF'e gömülür
- Kalem kalınlığı ve çizgi sabitleme ayarları; desteklenen cihazlarda stylus basıncı
- Geri al/yinele, yakınlaştırma/taşıma, soru alanına odaklanma (kırpma odağı)
- Notların, çizimlerin ve soru durumlarının tarayıcıda IndexedDB ile saklanması
- Örnek çalışma PDF'i: `assets/demo.pdf`

PDF.js ve pdf-lib dosyaları `vendor/` altında depolanır; derleme adımı gerekmez.

## InfinityFree'ye yükleme (özet)

1. Bu depodaki **tüm dosyaları** `htdocs/` klasörüne yükleyin (`.htaccess` dahil — FTP istemcinizde gizli dosyaları göstermeyi açın).
2. InfinityFree panelinden **ücretsiz SSL** kurun.
3. Siteyi açın — başka hiçbir yapılandırma gerekmez.

Adım adım kurulum için: [`DEPLOY_INFINITYFREE.md`](DEPLOY_INFINITYFREE.md)

## Yerelde deneme

Herhangi bir statik sunucu yeterlidir, örneğin:

```bash
python3 -m http.server 8000
```

`http://127.0.0.1:8000` adresinde arayüz açılır.

## Depo yapısı

```text
.
├── index.html                 # Web uygulaması (tek dosya)
├── .htaccess                  # HTTPS, MIME, dosya koruması
├── assets/demo.pdf            # Örnek PDF
├── vendor/                    # PDF.js, pdf-lib ve lisansları
└── DEPLOY_INFINITYFREE.md     # Kurulum kılavuzu
```

## Güvenlik ve gizlilik

- PDF'ler, çizimler ve notlar hiçbir sunucuya gönderilmez; yalnızca tarayıcının IndexedDB deposunda saklanır.
- Uygulama dışarıya hiçbir ağ isteği yapmaz (tüm kütüphaneler `vendor/` altından yüklenir).

## Lisans

Uygulamanın kendi kaynak kodu için ayrı bir lisans seçilmemiştir. `vendor/` altındaki üçüncü taraf bileşenlerin lisans bilgileri ilgili lisans dosyalarında ve [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) içinde yer alır.
