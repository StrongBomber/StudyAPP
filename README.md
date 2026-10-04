# Çözüm — PDF çalışma alanı

PDF soru bankalarını tarayıcıda açıp kalemle çözmek için hazırlanmış bir çalışma alanı. PDF görüntüleme ve işaretleme tarayıcıda çalışır. İsteğe bağlı yapay zekâ sohbeti anahtarı istemciye açmadan NVIDIA NIM’e bağlanır: yerel geliştirmede `server.py`, InfinityFree dağıtımında PHP uç noktaları kullanılır.

> InfinityFree Python uygulaması çalıştırmaz. Bu nedenle InfinityFree’ye özel PHP proxy’si eklendi; NVIDIA anahtarını HTML/JavaScript’e koymayın. Kurulum adımları için [`INFINITYFREE.md`](INFINITYFREE.md) dosyasına bakın.

## Özellikler

- PDF içe aktarma, sayfalar arasında gezinme ve yazılan sayfa numarasına atlama
- PDF üzerine çizim; işaretlemeleri PDF’e gömerek dışa aktarma
- Dört yazım modu: **Mürekkep**, **Kurşun**, **Fosforlu** ve **Dolma kalem**
- Kalem kalınlığı ve çizgi sabitleme ayarları; desteklenen cihazlarda stylus basıncı
- Geri al/yinele, yakınlaştırma/taşıma, kırpma odağı ve görünümü sıfırlama
- Notların, çizimlerin ve soru durumlarının tarayıcıda IndexedDB ile saklanması
- Kırpım seçmeden de açık PDF sayfasını bağlam olarak kullanabilen Türkçe ders asistanı
- Örnek çalışma PDF’i: `assets/demo.pdf`

Stylus basıncı ve fiziksel kalem hissi cihazdan cihaza değişir; uygun bir cihazda ayrıca denenmelidir.

## Gereksinimler

- Yerel geliştirme için Python 3.10 veya üzeri
- InfinityFree tarafında yerel yapay zekâ proxy’si için PHP ve cURL; alternatif Railway backend’i için Railway hesabı
- NVIDIA NIM erişimi ve `NVIDIA_API_KEY` (yalnızca yapay zekâ sohbeti için)
- İsteğe bağlı: testlerde JavaScript sözdizimi kontrolü için Node.js

PDF.js, pdf-lib ve KaTeX dosyaları `vendor/` altında depolanır; ön yüz için npm derleme adımı gerekmez. InfinityFree’ye yüklenirken Python sunucusu kullanılmaz; yapay zekâ PHP uç noktalarından geçer.

## Yerelde çalıştırma

### macOS / Linux (Bash)

```bash
git clone https://github.com/your-name/your-repo.git
cd your-repo
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Yapay zekâ özelliğini kullanacaksanız anahtarı terminalde gizli olarak girin ve aynı oturumdan sunucuyu başlatın:

```bash
read -r -s -p "NVIDIA_API_KEY: " NVIDIA_API_KEY
printf '\n'
export NVIDIA_API_KEY
.venv/bin/python server.py
```

Yapay zekâ olmadan arayüzü denemek için anahtar adımını atlayabilirsiniz; asistan devre dışı kalır. Sunucu varsayılan olarak `http://127.0.0.1:5173` adresinde açılır.

### Windows PowerShell

```powershell
git clone https://github.com/your-name/your-repo.git
cd your-repo
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Yapay zekâ özelliği için anahtarı gizli giriş olarak okuyup sunucuyu başlatın:

```powershell
$secureKey = Read-Host "NVIDIA_API_KEY" -AsSecureString
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { $env:NVIDIA_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr) }
.\.venv\Scripts\python.exe server.py
```

Modeli değiştirmek isterseniz sunucuyu başlatmadan önce `NVIDIA_MODEL` ortam değişkenini ayarlayın; varsayılan model `z-ai/glm-5.3-flash`’tir.

## InfinityFree’ye dağıtım

InfinityFree’de yayınlamak için PHP dağıtım dosyalarını hazırlayın:

```bash
bash scripts/build-infinityfree.sh
```

Oluşan `dist/infinityfree/` içeriğini alan adınızın `htdocs/` web köküne FTP veya File Manager ile yükleyin. Python sunucusu ve test dosyaları pakete alınmaz. Yapay zekâ varsayılan olarak kapalıdır; etkinleştirmek için [`INFINITYFREE.md`](INFINITYFREE.md) adımlarını izleyin. Anahtarı InfinityFree PHP modunda hostingdeki `api/nvidia/config.php`, Railway modunda ise yalnızca Railway Variables alanına girin.

### İsteğe bağlı Railway backend

GitHub’dan Railway’e Python API deploy edip InfinityFree’yi yalnızca arayüz için kullanabilirsin. `railpack.json`, CORS ve `app-config.js` adımları [`RAILWAY.md`](RAILWAY.md) dosyasında.

## GitHub deposuna yükleme

Zip’i açtıktan sonra proje klasöründe çalıştırın; `USERNAME` ve `REPOSITORY` değerlerini kendi GitHub bilgilerinizle değiştirin:

```bash
git init
git add .
git commit -m "İlk sürüm"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

`.gitignore` yerel anahtar dosyalarını (`.env`), Python sanal ortamlarını, önbellekleri ve arşivleri hariç tutar. Depoya yalnızca paylaşmayı amaçladığınız dosyaları eklediğinizi `git status` ile kontrol edin.

## Güvenlik ve gizlilik

- Gerçek anahtarı kaynak dosyalarına, commit’lere, issue’lara veya herkese açık depoya koymayın. Anahtar yanlışlıkla paylaşıldıysa NVIDIA panelinden iptal edip yenisini oluşturun.
- NVIDIA anahtarını istemciye veya GitHub’a koymayın; InfinityFree PHP modunda hosting `config.php` dosyasında, Railway modunda Railway Variables içinde tutun. PHP ve Railway proxy’leri temel IP/saat sınırı uygular. CORS bir oturum açma sistemi değildir; AI açıkken site ziyaretçileri NVIDIA kotanı kullanabilir, tüketimi takip et.
- GitHub Pages Python veya PHP API’sini çalıştırmaz. InfinityFree dağıtımı için `scripts/build-infinityfree.sh` paketini kullanın.
- PDF’ler ve notlar uygulama sunucusuna yüklenmez; tarayıcıda saklanır. Asistana gönderilen sohbet içeriği (ilk soruda açık sayfanın küçültülmüş görüntüsü dâhil) seçili backend üzerinden NVIDIA servisine iletilir.

## Testler

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Testler sunucu doğrulamalarını ve ön yüz sözleşmelerini denetler; gerçek NVIDIA isteği göndermez ve gerçek API anahtarı gerektirmez. JavaScript sözdizimi testi Node.js kuruluysa çalışır. GitHub Actions iş akışı testleri push ve pull request’lerde çalıştırır.

Örnek PDF’i yeniden oluşturmak için Node.js ile `node make-demo.cjs` çalıştırın. Bu işlem `assets/demo.pdf` dosyasının üzerine yazar.

## Depo yapısı

```text
.
├── index.html                 # Web uygulaması
├── server.py                  # Python/NVIDIA backend (yerel veya Railway)
├── api/nvidia/                # InfinityFree PHP uç noktaları ve örnek ayar
├── app-config.js              # Gizli olmayan API adresi yapılandırması
├── railpack.json              # Railway başlatma ayarı
├── scripts/build-infinityfree.sh
├── requirements.txt           # Python sunucu bağımlılıkları
├── assets/demo.pdf            # Örnek PDF
├── vendor/                    # PDF.js, pdf-lib, KaTeX ve lisansları
├── tests/                     # Python, ön yüz ve dağıtım testleri
└── .github/workflows/tests.yml
```

## Lisans

Uygulamanın kendi kaynak kodu için ayrı bir lisans seçilmemiştir; bu depoda proje kökü `LICENSE` dosyası bulunmaz. GitHub’da herkese açık yayımlamadan önce kendi lisansınızı seçin. `vendor/` altındaki üçüncü taraf bileşenlerin lisans bilgileri ilgili lisans dosyalarında ve [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) içinde yer alır.
