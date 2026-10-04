# InfinityFree dağıtım rehberi

Bu proje InfinityFree’nin ücretsiz web hosting hesabı için statik arayüz ve PHP NVIDIA proxy’si olarak hazırlanmıştır. Varsayılan kurulumda arayüz `/api/nvidia/status.php` ve `/api/nvidia/chat.php` yollarına aynı alan adı üzerinden istek gönderir. InfinityFree’de `server.py` çalıştırılmaz; Python desteklenmediği için backend PHP’dir. Alternatif olarak PHP proxy yerine Railway’de Python backend kullanabilirsin; bunun için [`RAILWAY.md`](RAILWAY.md) rehberini izle.

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
├── index.html
├── app-config.js
├── assets/demo.pdf
├── vendor/
└── api/nvidia/
    ├── .htaccess
    ├── chat.php
    ├── common.php
    ├── config.example.php
    └── status.php
```

Ardından `https://alan-adin/` adresini aç. PDF görüntüleme, çizim ve notlar PHP anahtarı olmadan da çalışır; PDF ve notlar tarayıcıda tutulur.

> Railway backend kullanacaksan paketi oluşturmadan önce `app-config.js` içindeki `apiBaseUrl` alanına Railway HTTPS adresini yaz. PHP proxy ayarını kapalı bırak ve adımlar için [`RAILWAY.md`](RAILWAY.md) dosyasına geç.

## 4. AI asistanını (InfinityFree PHP proxy’siyle) isteğe bağlı etkinleştir

Aşağıdaki yöntem yalnızca AI backend’ini doğrudan InfinityFree üzerinde çalıştırmak içindir. AI varsayılan olarak kapalıdır. NVIDIA NIM anahtarını oluşturduktan sonra hosting hesabındaki `htdocs/api/nvidia/` klasöründe `config.example.php` dosyasını `config.php` adıyla kopyala ve yalnızca sunucudaki kopyayı düzenle:

```php
<?php
return [
    'enabled' => true,
    'nvidia_api_key' => 'nvapi-ANAHTARINI_BURAYA_YAZ',
    'nvidia_model' => 'z-ai/glm-5.3-flash',
    'rate_limit_per_hour' => 30,
];
```

`config.php` dosyası `.gitignore` içindedir ve paket oluşturucu tarafından dağıtıma kopyalanmaz. Bu dosyayı GitHub’a, `index.html` içine veya başka istemci tarafı dosyalara koyma. `api/nvidia/.htaccess` yapılandırma dosyasına doğrudan HTTP erişimini engeller. InfinityFree ortamında `putenv`/özel environment variable ayarına güvenilmediğinden anahtar bu PHP yapılandırma dosyasında tutulur.

Anahtar girildikten sonra sayfayı yenile ve asistanı aç. PHP cURL dış NVIDIA isteğini yapar; anahtar tarayıcıya gönderilmez. PHP proxy’si IP başına saatte 30 istekle sınırlar. İlk AI isteği başarısız olursa cURL/SSL erişimini, anahtar ve model adını, ayrıca `.rate-limit.json` dosyasının `api/nvidia/` altında yazılabildiğini kontrol et. Yapılandırma/anahtar hatalarını çözmeden önce `enabled` değerini `false` bırak.

> **Kota uyarısı:** Anahtar sunucuda gizli kalsa da AI açık olduğunda site ziyaretçileri asistanı kullanabilir ve NVIDIA kotanı tüketebilir. IP sınırı temel korumadır; kimlik doğrulama değildir. Site herkese açık olacaksa AI’ı kapalı tutmayı veya önüne ayrı bir oturum açma sistemi koymayı değerlendir.

## Sık karşılaşılan sorunlar

- **Ana sayfa açılmıyor:** `index.html` doğrudan `htdocs/` içinde olmalı; `htdocs/proje/index.html` içine yüklediysen adresin de `/proje/` olmalıdır. Önerilen kurulum dosyaları doğrudan web köküne koyar.
- **PDF.js/font dosyaları yüklenmiyor:** `vendor/` klasörünü ve alt klasörlerini eksiksiz yükle; FTP’de ikili dosyaları ASCII modunda aktarma.
- **Asistan “bağlı değil” diyor:** İlk kurulumda bu beklenir. `api/nvidia/config.php` var mı, `enabled` `true` mu, key doğru mu ve site aynı HTTPS alan adında mı kontrol et.
- **AI isteğinde 403/502:** InfinityFree dış API’lere giden site isteklerine izin verdiğini belirtir; ancak aynı siteye farklı bir host adıyla (`www` ve `www` olmayan alan adı gibi) çapraz istek gönderme. Siteyi ve API’yi tek bir HTTPS host adı üzerinden kullan. Sunucu tarafı PHP cURL veya NVIDIA erişimi hosting hesabında çalışmıyorsa AI özelliğini başka bir backend’de barındırmak gerekir.
- **Harici mobil uygulamadan API kullanımı:** InfinityFree ücretsiz planı genel API hostingi ve çapraz alan adı isteklerini kısıtlar. Bu dağıtım yalnızca aynı web sitesini ziyaret eden tarayıcı içindir.
