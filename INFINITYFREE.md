# InfinityFree dağıtım rehberi

Bu proje InfinityFree’nin ücretsiz web hosting hesabı için statik arayüz ve PHP NVIDIA proxy’si olarak hazırlanmıştır. InfinityFree’de `server.py` çalıştırılmaz; Python uygulaması desteklenmediği için PHP uç noktaları kullanılır. Arayüz `/api/nvidia/status.php` ve `/api/nvidia/chat.php` yollarına aynı alan adı üzerinden istek gönderir.

## 1. Alan adını bağla

InfinityFree özel alan adı satmaz; alan adını bir kayıt firmasından alıp hosting hesabına ekle. InfinityFree ücretsiz alt alan adı da sunar. Özel alan adı için:

1. InfinityFree Client Area’dan hosting hesabını ve siteyi oluştur.
2. Domain/DNS ekranında özel alan adını siteye ekle.
3. Alan adı kayıt firmasındaki DNS veya nameserver ayarlarını InfinityFree panelinde gösterilen değerlerle güncelle. Değerleri bu dokümandan kopyalama; hesabına özel olan paneldekileri kullan.
4. DNS yayılımını bekle, alan adının açıldığını doğrula ve hosting panelinden SSL’yi etkinleştir.
5. Siteyi HTTPS adresinden aç. Bu uygulamanın API çağrıları aynı alan adına gider.

InfinityFree’nin özellikleri ve alan adı seçenekleri: <https://www.infinityfree.com/>. Güvenlik sisteminin aynı alan adına yapılan tarayıcı istekleri ve dış servislere giden sunucu istekleriyle ilgili açıklaması: <https://forum.infinityfree.com/t/browser-security-system-features-and-limitations/49353>.

## 2. Yükleme dosyalarını hazırla

Depo kökünde çalıştır:

```bash
bash scripts/build-infinityfree.sh
```

Paket `dist/infinityfree/` klasörüne hazırlanır. `server.py`, Python bağımlılıkları, testler ve Git dosyaları pakete konmaz. `dist/` yerel dağıtım çıktısıdır, Git’e eklenmez.

## 3. Dosyaları web köküne yükle

InfinityFree File Manager veya FTP ile seçtiğin alan adının `htdocs/` web kökünü aç. `dist/infinityfree/` klasörünü değil, **içindeki dosya ve klasörleri** `htdocs/` içine yükle. Sonuçta yapı yaklaşık şöyle görünmeli:

```text
htdocs/
├── .htaccess               # .mjs MIME türü ve config.php erişim koruması
├── config.example.php      # Sunucu tarafı AI yapılandırma şablonu
├── index.html
├── assets/demo.pdf
├── vendor/
└── api/nvidia/
    ├── .htaccess
    ├── chat.php
    ├── common.php
    ├── status.php
    └── test.php
```

Ardından `https://alan-adin/` adresini aç. PDF görüntüleme, çizim ve notlar PHP anahtarı olmadan da çalışır; PDF ve notlar tarayıcıda tutulur.

## 4. AI asistanını sunucu anahtarıyla bağla

InfinityFree kurulumunda `.env` dosyası gerekmez. Anahtar ya hostingin sunucu ortamında `API_KEY` olarak tanımlanır ya da korumalı PHP yapılandırma dosyasında tutulur. Anahtar hiçbir zaman HTML/JavaScript’e veya tarayıcıya gönderilmez.

1. `htdocs/config.example.php` dosyasını aynı klasöre `config.php` adıyla kopyala.
2. Sunucudaki `htdocs/config.php` dosyasını aç ve yeni, gizli anahtarını ekle:

```php
<?php
return [
    'enabled' => true,
    'api_key' => 'YENI_ANAHTARINI_BURAYA_YAZ',
    'rate_limit_per_hour' => 30,
];
```

3. Kaydet, siteyi sert yenile ve **Kurulum rehberi → Kaydettim — test et** düğmesine bas.

Kök `.htaccess` yapılandırma dosyasının HTTP üzerinden indirilmesini engeller; `.gitignore` ve dağıtım paketi de gerçek `config.php` dosyasını depoya veya pakete almaz. Gerçek anahtarı GitHub’a, `index.html` içine veya sohbet kutusuna yazma. Yerel Python geliştirmesinde `.env` hâlâ isteğe bağlıdır; InfinityFree’de gerekli değildir.

PHP proxy’si isteği sunucudan gönderir ve IP başına saatlik istek sınırı uygular. “Bağlantıyı test et” bir küçük AI isteği kullandığından kotadan bir istek düşer. Test başarısızsa ekrandaki hata; sunucu ayarı, anahtar, dış bağlantı veya `.rate-limit.json` yazma izni sorununu ayırt etmeye yardımcı olur.

> **Kota uyarısı:** Anahtar sunucuda gizli kalsa da AI açık olduğunda site ziyaretçileri asistanı kullanabilir ve kotanı tüketebilir. IP sınırı temel korumadır; kimlik doğrulama değildir. Site herkese açık olacaksa AI’ı kapalı tutmayı veya önüne ayrı bir oturum açma sistemi koymayı değerlendir.

## Sık karşılaşılan sorunlar

- **Ana sayfa açılmıyor:** `index.html` doğrudan `htdocs/` içinde olmalı; `htdocs/proje/index.html` içine yüklediysen adresin de `/proje/` olmalıdır. Önerilen kurulum dosyaları doğrudan web köküne koyar.
- **Arayüz tepkisiz veya PDF.js yüklenmiyor:** `htdocs/.htaccess` dosyasının yüklendiğini doğrula; bu dosya InfinityFree’de PDF.js’in `.mjs` dosyalarının JavaScript modülü olarak sunulmasını sağlar. Ayrıca `vendor/` klasörünü ve alt klasörlerini eksiksiz yükle; FTP’de ikili dosyaları ASCII modunda aktarma.
- **AI bağlantısı hazır değil:** `htdocs/config.php` dosyasının varlığını, `enabled => true` ve `api_key` değerlerini kontrol et; alternatif olarak hosting ortamında `API_KEY` tanımlı olmalı. Ardından AI panelindeki durumu yenileyip bağlantı testini çalıştır.
- **AI isteğinde 403/502:** InfinityFree dış API’lere giden site isteklerine izin verdiğini belirtir; ancak aynı siteye farklı bir host adıyla (`www` ve `www` olmayan alan adı gibi) çapraz istek gönderme. Siteyi ve API’yi tek bir HTTPS host adı üzerinden kullan. Sunucu tarafı PHP cURL veya NVIDIA erişimi hosting hesabında çalışmıyorsa AI özelliğini başka bir backend’de barındırmak gerekir.
- **Harici mobil uygulamadan API kullanımı:** InfinityFree ücretsiz planı genel API hostingi ve çapraz alan adı isteklerini kısıtlar. Bu dağıtım yalnızca aynı web sitesini ziyaret eden tarayıcı içindir.
