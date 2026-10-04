# Railway API backend + InfinityFree web frontend

Bu kurulumda GitHub kaynak kodunu tutar, Railway Python uygulamasını derleyip API backend olarak çalıştırır, InfinityFree ise web arayüzünü (statik HTML/JS/CSS ve dosyalar) sunar:

```text
GitHub branch → Railway deploy (Python/NVIDIA API)
InfinityFree htdocs → index.html + uygulama dosyaları
Tarayıcı → Railway API (CORS ile yalnızca alan adınız)
```

Railway, GitHub deposundan otomatik dağıtım yapabilir. `railpack.json` Railway/Railpack için `0.0.0.0` üzerinde başlatma komutunu verir; uygulama Railway’in verdiği `PORT` değişkenini okur. Railway belgeleri de dışarıdan erişim için `0.0.0.0` ve atanan portun kullanılmasını ister: <https://docs.railway.com/guides/vibe-coding-deploy>.

## 1. Railway’i GitHub’a bağla

1. Railway hesabında **New Project → Deploy from GitHub repo** seç.
2. GitHub erişimini yetkilendirip `StrongBomber/StudyAPP` deposunu ve bu çalışma için `arena/01a105d1-studyapp` branch’ini seç.
3. Railway servisi `requirements.txt` üzerinden Python bağımlılıklarını kurar. Root Directory boş kalsın; `railpack.json` depo kökündedir.
4. Deploy tamamlandığında servisin **Settings / Networking** bölümünden public domain oluştur. Railway’in verdiği HTTPS adresini not et.

Railway’in GitHub kaynak deposundan deploy ve başlangıç komutu bilgileri: <https://docs.railway.com/builds/build-and-start-commands>.

## 2. Railway Variables ayarla

Servisin **Variables** bölümünde:

```text
NVIDIA_API_KEY=<NVIDIA NIM anahtarın>
APP_CORS_ORIGINS=https://alan-adin.example,https://www.alan-adin.example
APP_RATE_LIMIT_PER_HOUR=30
```

`APP_CORS_ORIGINS` değerine InfinityFree’de gerçekten kullanacağın her **tam origin’i** yaz: `https://` ile başlat, yol veya son `/` ekleme, birden fazla alan adını virgülle ayır. Ücretsiz InfinityFree alt alan adını veya hem `www` hem kök alan adını kullanacaksan onları da ekle. Alan adı henüz belli değilse bunu yayınlamadan önce güncelle.

`NVIDIA_MODEL` isteğe bağlıdır; varsayılan `z-ai/glm-5.3-flash` kullanılır. `PORT` değerini elle tanımlama; Railway kendisi verir. Gerçek NVIDIA anahtarını GitHub’a, `app-config.js` içine veya InfinityFree dosyalarına koyma.

## 3. InfinityFree frontend’ini Railway API’ye bağla

Railway public HTTPS domainini aldıktan sonra depo kökündeki `app-config.js` dosyasında yalnızca `apiBaseUrl` değerini düzenle:

```js
window.STUDYAPP_CONFIG = {
  apiBaseUrl: 'https://studyapp-api-production.up.railway.app'
};
```

Adresin sonuna `/` veya `/api` ekleme. Bu dosyada sır olarak saklanması gereken hiçbir şey bulunmamalı.

Sonra InfinityFree dosya paketini oluştur:

```bash
bash scripts/build-infinityfree.sh
```

`dist/infinityfree/` içeriğini alan adının `htdocs/` klasörüne yükle. `app-config.js` pakete kopyalanır; API adresi bu pakette de yer alır. Böylece arayüz istekleri InfinityFree PHP proxy’si yerine Railway Python API’sine gider.

## 4. Bağlantıyı kontrol et

1. Railway deploy loglarında servis `0.0.0.0` üzerinde başladığını doğrula.
2. Tarayıcıdan `https://RAILWAY-DOMAIN/api/nvidia/status` adresini aç; JSON yanıtı gelmeli. Yapılandırma eksikse `configured` false olur.
3. InfinityFree sitesini HTTPS üzerinden açıp AI asistanını dene.
4. Tarayıcı geliştirici araçlarında CORS hatası varsa Railway’de `APP_CORS_ORIGINS` değerinin sayfanın adresiyle birebir eşleştiğini kontrol et (www/kök alan adı ve https/http farkı dâhil).

## Güvenlik notu

CORS yalnızca tarayıcıların hangi web kaynağını okuyabileceğini sınırlar; API anahtarı yerine geçen bir giriş sistemi değildir. Backend IP başına saatlik istek sınırı uygular, fakat bu tam kimlik doğrulama veya kota garantisi sağlamaz. Site herkese açıksa ziyaretçiler AI’ı kullanabilir; NVIDIA kullanımını düzenli takip et. Railway backend’ini başka uygulamalara açık genel API olarak kullanma.
