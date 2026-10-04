<?php
/**
 * NVIDIA NIM chat proxy for PHP hosting (InfinityFree compatible).
 *
 * Routes (via root .htaccess, or directly as /api/nvidia.php?route=...):
 *   GET  /api/nvidia/status   — anahtar yapılandırılmış mı?
 *   POST /api/nvidia/chat     — sohbet isteği
 *   POST /api/nvidia/test     — küçük doğrulama isteği
 *   GET  /api/nvidia/diag     — teşhis raporu (&live=1 canlı test,
 *                               &model=... farklı model dene,
 *                               &timeout=NN canlı test süresi sınırı)
 *
 * Hata ayıklama: Her chat/test isteğinin sonucu api/debug.log dosyasına
 * kaydedilir (cURL hata metni, bağlantı/ilk yanıt/toplam süre, HTTP durumu,
 * NVIDIA'nın döndürdüğü hata, model). API ANAHTARI VE SOHBET İÇERİĞİ ASLA
 * KAYDEDİLMEZ. Son kayıtlar teşhis raporunun "son_kayitlar" alanında görünür.
 *
 * Anahtar sırayla şuralardan okunur:
 *   1. ../../nvidia-config.php  (web kökünün BİR ÜSTÜ — önerilen)
 *   2. api/config.php           (web kökü içinde, .htaccess korumalı)
 *   3. NVIDIA_API_KEY / NVIDIA_MODEL ortam değişkenleri
 */

declare(strict_types=1);

const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
// Arayüzde elle seçilebilen modeller (yapılandırmada NVIDIA_MODELS ile değiştirilebilir).
const DEFAULT_MODELS = ['moonshotai/kimi-k3', 'z-ai/glm-5.3-flash', 'z-ai/glm-5.3'];
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_CHAT_URL = NVIDIA_BASE_URL . '/chat/completions';
const MAX_BODY_BYTES = 20971520; // 20 MB
const DEBUG_LOG_FILE = __DIR__ . '/debug.log';
const DEBUG_LOG_MAX_BYTES = 262144; // ~256 KB; aşılırsa dosya sıfırlanır

@set_time_limit(0);
@ini_set('display_errors', '0');
@date_default_timezone_set('Europe/Istanbul');

// PHP < 8.1 uyumluluğu (bazı paylaşımlı hostingler eski sürüm çalıştırır).
if (!function_exists('array_is_list')) {
    function array_is_list(array $array): bool
    {
        $i = 0;
        foreach ($array as $key => $_) {
            if ($key !== $i++) {
                return false;
            }
        }
        return true;
    }
}

function json_out(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function load_config(): array
{
    $apiKey = '';
    $model = '';
    $timeout = 0;
    $fallbacks = '';
    $thinking = null;

    $aboveRoot = dirname(__DIR__, 2) . '/nvidia-config.php';
    $local = __DIR__ . '/config.php';

    foreach ([$aboveRoot, $local] as $file) {
        if (is_readable($file)) {
            $cfg = include $file;
            if (is_array($cfg)) {
                if ($apiKey === '' && isset($cfg['NVIDIA_API_KEY'])) {
                    $apiKey = trim((string) $cfg['NVIDIA_API_KEY']);
                }
                if ($model === '' && isset($cfg['NVIDIA_MODEL'])) {
                    $model = trim((string) $cfg['NVIDIA_MODEL']);
                }
                if ($timeout === 0 && isset($cfg['NVIDIA_TIMEOUT'])) {
                    $timeout = (int) $cfg['NVIDIA_TIMEOUT'];
                }
                if ($fallbacks === '' && isset($cfg['NVIDIA_FALLBACK_MODELS'])) {
                    $fallbacks = trim((string) $cfg['NVIDIA_FALLBACK_MODELS']);
                }
                if ($thinking === null && array_key_exists('NVIDIA_THINKING', $cfg)) {
                    $thinking = (bool) $cfg['NVIDIA_THINKING'];
                }
            }
        }
        if ($apiKey !== '') {
            break;
        }
    }

    if ($apiKey === '') {
        $apiKey = trim((string) (getenv('NVIDIA_API_KEY') ?: ''));
    }
    if ($model === '') {
        $model = trim((string) (getenv('NVIDIA_MODEL') ?: ''));
    }
    if ($model === '') {
        $model = DEFAULT_MODEL;
    }
    if ($timeout < 10 || $timeout > 300) {
        $timeout = 90;
    }
    if ($fallbacks === '') {
        $fallbacks = trim((string) (getenv('NVIDIA_FALLBACK_MODELS') ?: ''));
    }

    $fallbackList = [];
    foreach (explode(',', $fallbacks) as $candidate) {
        $candidate = trim($candidate);
        if ($candidate !== '' && $candidate !== $model && preg_match('~^[\w.\-/]{1,120}$~', $candidate)) {
            $fallbackList[] = $candidate;
        }
    }

    // Arayüzde seçilebilir model listesi: NVIDIA_MODELS (virgülle ayrık) veya varsayılan üçlü.
    $modelsRaw = '';
    foreach ([$aboveRoot, $local] as $file) {
        if (is_readable($file)) {
            $cfg = include $file;
            if (is_array($cfg) && isset($cfg['NVIDIA_MODELS'])) {
                $modelsRaw = trim((string) $cfg['NVIDIA_MODELS']);
                break;
            }
        }
    }
    if ($modelsRaw === '') {
        $modelsRaw = trim((string) (getenv('NVIDIA_MODELS') ?: ''));
    }
    $modelList = [];
    foreach (explode(',', $modelsRaw) as $candidate) {
        $candidate = trim($candidate);
        if ($candidate !== '' && preg_match('~^[\w.\-/]{1,120}$~', $candidate)) {
            $modelList[] = $candidate;
        }
    }
    if (!$modelList) {
        $modelList = DEFAULT_MODELS;
    }
    // Birincil model her zaman listede olsun (başta).
    if (!in_array($model, $modelList, true)) {
        array_unshift($modelList, $model);
    }
    $modelList = array_values(array_unique($modelList));

    return [
        'api_key' => $apiKey,
        'model' => $model,
        'models' => $modelList,
        'timeout' => $timeout,
        'fallback_models' => array_values(array_unique($fallbackList)),
        'thinking' => $thinking,
    ];
}

function detect_route(): string
{
    // ?route=... works even when .htaccess rewriting is unavailable.
    $route = $_GET['route'] ?? '';
    if (in_array($route, ['status', 'chat', 'test', 'diag', 'models'], true)) {
        return $route;
    }
    $uri = $_SERVER['REQUEST_URI'] ?? '';
    $path = (string) parse_url($uri, PHP_URL_PATH);
    if (preg_match('~/api/nvidia/(status|chat|test|diag|models)/?$~', $path, $m)) {
        return $m[1];
    }
    return '';
}

/**
 * cURL isteği + otomatik CA paketi fallback'i + ayrıntılı zamanlama ölçümü.
 *
 * Dönen dizi:
 *   body            string|false  ham yanıt gövdesi
 *   http            int           HTTP durum kodu (0 = yanıt yok)
 *   errno           int           cURL hata numarası (0 = yok)
 *   error           string        cURL hata metni (anahtar içermez)
 *   ssl_fallback    bool          SSL doğrulaması atlanarak mı başarıldı?
 *   dns_sn          float         DNS çözümleme süresi
 *   baglanti_sn     float         TCP bağlantı süresi
 *   ssl_sn          float         TLS el sıkışma süresi
 *   ilk_yanit_sn    float         ilk bayta kadar geçen süre (TTFB)
 *   toplam_sn       float         toplam süre
 *   ip              string        bağlanılan IP
 */
function curl_nvidia_request(string $url, array $headers, ?string $body, int $timeout): array
{
    $sslFallback = false;
    $result = [
        'body' => false, 'http' => 0, 'errno' => 0, 'error' => '',
        'ssl_fallback' => false, 'dns_sn' => 0.0, 'baglanti_sn' => 0.0,
        'ssl_sn' => 0.0, 'ilk_yanit_sn' => 0.0, 'toplam_sn' => 0.0, 'ip' => '',
    ];

    for ($attempt = 0; $attempt < 2; $attempt++) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => $attempt === 0,
            CURLOPT_SSL_VERIFYHOST => $attempt === 0 ? 2 : 0,
            CURLOPT_HTTPHEADER => $headers,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($ch, $opts);

        $start = microtime(true);
        $response = curl_exec($ch);
        $elapsed = microtime(true) - $start;

        $info = curl_getinfo($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        curl_close($ch);

        // 35/58/60/77: SSL el sıkışma veya CA paketi sorunu → doğrulamasız bir kez daha dene.
        if ($response === false && $attempt === 0 && in_array($errno, [35, 58, 60, 77], true)) {
            $sslFallback = true;
            continue;
        }

        $result['body'] = $response;
        $result['http'] = (int) ($info['http_code'] ?? 0);
        $result['errno'] = $errno;
        $result['error'] = $error;
        $result['ssl_fallback'] = $sslFallback;
        $result['dns_sn'] = round((float) ($info['namelookup_time'] ?? 0), 3);
        $result['baglanti_sn'] = round((float) ($info['connect_time'] ?? 0), 3);
        $result['ssl_sn'] = round((float) ($info['appconnect_time'] ?? 0), 3);
        $result['ilk_yanit_sn'] = round((float) ($info['starttransfer_time'] ?? 0), 3);
        $result['toplam_sn'] = round($elapsed, 3);
        $result['ip'] = (string) ($info['primary_ip'] ?? '');
        return $result;
    }
    $result['ssl_fallback'] = $sslFallback;
    return $result;
}

/** Hata günlüğüne bir satır JSON ekler. Anahtar ve sohbet içeriği yazılmaz. */
function debug_log(array $entry): void
{
    if (is_file(DEBUG_LOG_FILE) && (int) @filesize(DEBUG_LOG_FILE) > DEBUG_LOG_MAX_BYTES) {
        @unlink(DEBUG_LOG_FILE);
    }
    $entry = ['zaman' => date('Y-m-d H:i:s')] + $entry;
    @file_put_contents(
        DEBUG_LOG_FILE,
        json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n",
        FILE_APPEND | LOCK_EX
    );
}

/** Günlüğün son N kaydını (yeniden eskiye) döndürür. */
function read_debug_tail(int $limit = 15): array
{
    if (!is_readable(DEBUG_LOG_FILE)) {
        return [];
    }
    $lines = @file(DEBUG_LOG_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!is_array($lines)) {
        return [];
    }
    $tail = array_slice($lines, -$limit);
    $out = [];
    foreach (array_reverse($tail) as $line) {
        $decoded = json_decode($line, true);
        $out[] = is_array($decoded) ? $decoded : $line;
    }
    return $out;
}

/** NVIDIA yanıt gövdesinden sağlayıcı hata mesajını çıkarır (kısaltılmış). */
function extract_provider_error($responseBody): string
{
    if (!is_string($responseBody) || $responseBody === '') {
        return '';
    }
    $data = json_decode($responseBody, true);
    $message = '';
    if (is_array($data)) {
        $message = $data['error']['message'] ?? ($data['detail'] ?? ($data['message'] ?? ''));
        if (is_array($message)) {
            $message = json_encode($message, JSON_UNESCAPED_UNICODE);
        }
    }
    if (!is_string($message) || $message === '') {
        $flat = (string) preg_replace('/\s+/', ' ', $responseBody);
        $message = $flat;
    }
    $message = function_exists('mb_substr') ? mb_substr($message, 0, 300) : substr($message, 0, 300);
    return preg_match('//u', $message) ? $message : '(ikili veri)';
}

function read_payload(): array
{
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > MAX_BODY_BYTES) {
        json_out(413, ['error' => ['message' => 'Request is too large.']]);
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        json_out(400, ['error' => ['message' => 'Request body is empty.']]);
    }
    if (strlen($raw) > MAX_BODY_BYTES) {
        json_out(413, ['error' => ['message' => 'Request is too large.']]);
    }
    $payload = json_decode($raw, true);
    if (!is_array($payload) || array_is_list($payload)) {
        json_out(400, ['error' => ['message' => 'Request must be a JSON object.']]);
    }
    return $payload;
}

/** Sohbet isteği gövdesini kurar; thinking ayarı varsa chat_template_kwargs ekler. */
function build_chat_body(string $model, array $messages, float $temperature, float $topP, int $maxTokens, ?bool $thinking): ?string
{
    $payload = [
        'model' => $model,
        'messages' => $messages,
        'temperature' => $temperature,
        'top_p' => $topP,
        'max_tokens' => $maxTokens,
        'stream' => false,
    ];
    if ($thinking !== null) {
        // Muhakemeli modellerde (GLM, Qwen vb.) düşünme modunu aç/kapat.
        $payload['chat_template_kwargs'] = ['thinking' => $thinking];
    }
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE);
    return $encoded === false ? null : $encoded;
}

function provider_error_message(int $status, string $model): string
{
    if ($status === 401 || $status === 403) {
        return 'NVIDIA API anahtarı reddedildi. Anahtarın geçerli ve NVIDIA endpoint erişiminin açık olduğunu kontrol et.';
    }
    if ($status === 404) {
        return "NVIDIA endpoint bu modeli bulamadı: {$model}. NVIDIA_MODEL ayarını kontrol et.";
    }
    if ($status === 410) {
        return "Bu model artık sunulmuyor (emekliye ayrılmış): {$model}. /api/nvidia.php?route=models adresinden güncel bir model seçip NVIDIA_MODEL ayarını değiştir.";
    }
    if ($status === 429) {
        return 'NVIDIA API hız sınırı veya kullanım kotasına ulaşıldı. Biraz bekleyip tekrar dene.';
    }
    if ($status === 503) {
        return 'NVIDIA modeli şu anda yoğun. Biraz bekleyip tekrar dene.';
    }
    if ($status >= 500) {
        return "NVIDIA servisi geçici bir hata döndürdü ({$status}).";
    }
    return "NVIDIA isteği reddedildi ({$status}). Modeli ve mesaj biçimini kontrol et.";
}

function handle_chat(bool $test, array $config): void
{
    $payload = read_payload();

    if ($config['api_key'] === '') {
        json_out(424, ['error' => ['message' => 'NVIDIA_API_KEY sunucuda ayarlı değil. nvidia-config.php (veya api/config.php) dosyasına anahtarı ekle.']]);
    }

    // Arayüzden elle seçilen model, izinli listede olmalı.
    $configuredModel = $config['model'];
    $allowedModels = array_values(array_unique(array_merge(
        [$configuredModel],
        $config['models'],
        $config['fallback_models']
    )));
    $model = (string) ($payload['model'] ?? $configuredModel);
    if ($model === '') {
        $model = $configuredModel;
    }
    if (!in_array($model, $allowedModels, true)) {
        json_out(400, ['error' => ['message' => 'İstenen model izinli model listesinde yok. NVIDIA_MODELS ayarını kontrol et.']]);
    }

    $messages = $payload['messages'] ?? null;
    if (!is_array($messages) || !array_is_list($messages) || count($messages) < 1 || count($messages) > 60) {
        json_out(400, ['error' => ['message' => 'Sohbet mesajları eksik veya çok uzun.']]);
    }
    foreach ($messages as $item) {
        if (!is_array($item) || !in_array($item['role'] ?? null, ['system', 'user', 'assistant'], true)) {
            json_out(400, ['error' => ['message' => 'Sohbet mesaj biçimi geçersiz.']]);
        }
        $content = $item['content'] ?? null;
        if (!is_string($content) && !is_array($content)) {
            json_out(400, ['error' => ['message' => 'Sohbet mesaj içeriği geçersiz.']]);
        }
    }

    $maxTokensRaw = $payload['max_tokens'] ?? ($test ? 12 : 1800);
    $temperatureRaw = $payload['temperature'] ?? 0.5;
    $topPRaw = $payload['top_p'] ?? 1.0;
    if (!is_numeric($maxTokensRaw) || !is_numeric($temperatureRaw) || !is_numeric($topPRaw)) {
        json_out(400, ['error' => ['message' => 'Model ayarları geçersiz.']]);
    }
    $maxTokens = (int) $maxTokensRaw;
    $temperature = (float) $temperatureRaw;
    $topP = (float) $topPRaw;
    if ($maxTokens < 1 || $maxTokens > 4096 || $temperature < 0 || $temperature > 2 || $topP <= 0 || $topP > 1) {
        json_out(400, ['error' => ['message' => 'Model ayarları izin verilen aralığın dışında.']]);
    }

    // ---- Model zinciri: birincil model + yapılandırılmış yedekler ----------
    $chain = array_merge([$model], $config['fallback_models']);
    $chain = array_values(array_unique($chain));
    // Zincir birden fazlaysa her denemeye süre sınırı koy ki toplam,
    // ön yüzün 150 sn'lik iptal sınırını aşmasın.
    $perAttemptTimeout = $test ? 60 : (count($chain) > 1 ? min($config['timeout'], 55) : $config['timeout']);

    $res = null;
    $usedModel = $model;
    foreach ($chain as $attemptIndex => $attemptModel) {
        $body = build_chat_body($attemptModel, $messages, $temperature, $topP, $maxTokens, $config['thinking']);

        $res = curl_nvidia_request(NVIDIA_CHAT_URL, [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $config['api_key'],
        ], $body, $perAttemptTimeout);
        $usedModel = $attemptModel;

        // ---- Hata ayıklama günlüğü (anahtar ve sohbet içeriği YOK) ----
        $logEntry = [
            'uc' => $test ? 'test' : 'chat',
            'model' => $attemptModel,
            'deneme' => ($attemptIndex + 1) . '/' . count($chain),
            'http' => $res['http'],
            'curl_hata_no' => $res['errno'],
            'curl_hata' => $res['error'],
            'dns_sn' => $res['dns_sn'],
            'baglanti_sn' => $res['baglanti_sn'],
            'ssl_sn' => $res['ssl_sn'],
            'ilk_yanit_sn' => $res['ilk_yanit_sn'],
            'toplam_sn' => $res['toplam_sn'],
            'ip' => $res['ip'],
            'ssl_dogrulama_atlandi' => $res['ssl_fallback'],
            'mesaj_sayisi' => count($messages),
            'istek_boyutu_bayt' => strlen((string) $body),
            'zaman_asimi_siniri_sn' => $perAttemptTimeout,
        ];
        if ($res['http'] !== 200) {
            $logEntry['saglayici_hata'] = extract_provider_error($res['body']);
        }
        debug_log($logEntry);

        if ($res['http'] === 200) {
            break; // başarı — zinciri durdur
        }

        // Yedeğe geçilebilir durumlar: zaman aşımı/bağlantı hatası veya
        // modele özgü geçici/kalıcı servis hataları. Anahtar/istek hataları
        // (400, 401, 403, 413, 422) yedek modelle de düzelmez → zinciri kes.
        $retryable = $res['errno'] !== 0
            || in_array($res['http'], [404, 408, 409, 410, 429, 500, 502, 503, 504], true);
        if (!$retryable) {
            break;
        }
    }

    if ($res['body'] === false || $res['errno'] !== 0) {
        $detail = $res['error'] !== '' ? $res['error'] : ('curl hata ' . $res['errno']);
        $chainNote = count($chain) > 1 ? ' (yedek modeller de denendi)' : '';
        if ($res['errno'] === 28) {
            $hint = 'NVIDIA ' . $perAttemptTimeout . ' sn içinde yanıt vermedi' . $chainNote . ' — model kuyruğu yoğun olabilir. Biraz bekleyip tekrar dene; sorun sürerse diag sayfasından farklı bir modeli test et.';
        } else {
            $hint = 'NVIDIA servisine ulaşılamadı (' . $detail . ')' . $chainNote . '. Ayrıntılar için /api/nvidia.php?route=diag adresine bak.';
        }
        json_out(502, ['error' => ['message' => $hint]]);
    }

    if ($res['http'] === 200) {
        $data = json_decode((string) $res['body'], true);
        $text = '';
        if (is_array($data)) {
            $message = $data['choices'][0]['message'] ?? [];
            $text = $message['content'] ?? '';
            // Muhakemeli modeller yanıtı reasoning_content alanında bırakabilir.
            if (!is_string($text) || trim($text) === '') {
                $fallback = $message['reasoning_content'] ?? '';
                $text = is_string($fallback) ? $fallback : '';
            }
        }
        if (!is_string($text)) {
            $text = '';
        }
        json_out(200, ['text' => $text, 'model' => $usedModel]);
    }

    $status = $res['http'];
    $allowed = [400, 401, 403, 404, 408, 409, 410, 413, 422, 429, 500, 502, 503, 504];
    if (!in_array($status, $allowed, true)) {
        $status = 502;
    }
    json_out($status, ['error' => ['message' => provider_error_message($status, $usedModel)]]);
}

/**
 * Model listesi: /api/nvidia.php?route=models
 *   &q=flash   yalnızca adı eşleşenleri göster (örn. flash, vision, nemotron)
 * NVIDIA hesabınızın şu anda erişebildiği modellerin kimliklerini döndürür.
 */
function handle_models(array $config): void
{
    $headers = ['Accept: application/json'];
    if ($config['api_key'] !== '') {
        $headers[] = 'Authorization: Bearer ' . $config['api_key'];
    }
    $res = curl_nvidia_request(NVIDIA_BASE_URL . '/models', $headers, null, 20);
    if ($res['body'] === false || $res['http'] !== 200) {
        json_out(502, ['error' => [
            'message' => 'Model listesi alınamadı (HTTP ' . $res['http'] . ', curl ' . $res['errno'] . ': ' . $res['error'] . ').',
        ]]);
    }
    $data = json_decode((string) $res['body'], true);
    $ids = [];
    foreach ((array) ($data['data'] ?? []) as $item) {
        if (is_array($item) && isset($item['id']) && is_string($item['id'])) {
            $ids[] = $item['id'];
        }
    }
    sort($ids, SORT_STRING | SORT_FLAG_CASE);
    $query = trim((string) ($_GET['q'] ?? ''));
    if ($query !== '') {
        $ids = array_values(array_filter($ids, static fn (string $id): bool => stripos($id, $query) !== false));
    }
    json_out(200, [
        'toplam' => count($ids),
        'filtre' => $query === '' ? null : $query,
        'ipucu' => 'Bir modeli denemek için: ?route=diag&live=1&model=MODEL_ADI — görsel desteğini de test etmek için &vision=1 ekleyin.',
        'modeller' => $ids,
    ]);
}

/**
 * Teşhis: /api/nvidia.php?route=diag
 *   &live=1        gerçek (küçük) sohbet isteği de çalıştır
 *   &model=...     canlı testte farklı bir modeli dene (yalnızca teşhis için)
 *   &timeout=NN    canlı test süre sınırı, 20-120 sn (varsayılan 60)
 *   &vision=1      canlı teste küçük bir görsel ekle (görüntü desteğini sınar
 *                  — uygulama ilk soruda sayfa görüntüsü gönderir!)
 *   &thinking=0|1  muhakemeli modellerde düşünme modunu kapatıp/açıp dene
 */
function handle_diag(array $config): void
{
    $aboveRoot = dirname(__DIR__, 2) . '/nvidia-config.php';
    $local = __DIR__ . '/config.php';
    $configSource = 'yok';
    if (is_readable($aboveRoot)) {
        $configSource = 'htdocs üstü nvidia-config.php';
    } elseif (is_readable($local)) {
        $configSource = 'api/config.php';
    } elseif (getenv('NVIDIA_API_KEY')) {
        $configSource = 'ortam değişkeni';
    }

    $report = [
        'php_surumu' => PHP_VERSION,
        'php_max_execution_time' => (string) ini_get('max_execution_time'),
        'curl_eklentisi' => extension_loaded('curl'),
        'yapilandirma_kaynagi' => $configSource,
        'anahtar_ayarli' => $config['api_key'] !== '',
        'anahtar_uzunlugu' => strlen($config['api_key']),
        'model' => $config['model'],
        'sohbet_zaman_asimi_sn' => $config['timeout'],
        'gunluk_yazilabilir' => is_writable(__DIR__),
        'yonlendirme' => isset($_GET['route']) ? 'query (?route=...)' : 'htaccess rewrite',
    ];

    if (!extension_loaded('curl')) {
        $report['sonuc'] = 'HATA: cURL eklentisi yok — proxy çalışamaz.';
        json_out(200, $report);
    }

    // 1) Dışa giden bağlantı sondası (anahtar gerekmez; 401 = erişilebilir).
    $probe = curl_nvidia_request(NVIDIA_BASE_URL . '/models', ['Accept: application/json'], null, 12);
    $report['nvidia_baglanti'] = [
        'http_durumu' => $probe['http'],
        'curl_hata_kodu' => $probe['errno'],
        'curl_hata' => $probe['error'],
        'dns_sn' => $probe['dns_sn'],
        'baglanti_sn' => $probe['baglanti_sn'],
        'ssl_sn' => $probe['ssl_sn'],
        'ilk_yanit_sn' => $probe['ilk_yanit_sn'],
        'toplam_sn' => $probe['toplam_sn'],
        'ip' => $probe['ip'],
        'ssl_dogrulama_atlandi' => $probe['ssl_fallback'],
        'erisilebilir' => $probe['body'] !== false && $probe['http'] > 0,
    ];
    if ($probe['body'] === false || $probe['http'] === 0) {
        $report['son_kayitlar'] = read_debug_tail();
        $report['sonuc'] = 'HATA: Sunucudan NVIDIA API\'ye dışa giden bağlantı kurulamıyor (curl ' . $probe['errno'] . ': ' . $probe['error'] . '). Hosting dışa giden istekleri engelliyor olabilir.';
        json_out(200, $report);
    }

    if ($config['api_key'] === '') {
        $report['son_kayitlar'] = read_debug_tail();
        $report['sonuc'] = 'HATA: API anahtarı bulunamadı. nvidia-config.php dosyasını htdocs klasörünün BİR ÜSTÜNE, ya da config.php dosyasını api/ içine koy.';
        json_out(200, $report);
    }

    // 2) İsteğe bağlı canlı test.
    if (isset($_GET['live'])) {
        $liveModel = trim((string) ($_GET['model'] ?? ''));
        if ($liveModel === '' || !preg_match('~^[\w.\-/]{1,120}$~', $liveModel)) {
            $liveModel = $config['model'];
        }
        $liveTimeout = (int) ($_GET['timeout'] ?? 60);
        $liveTimeout = max(20, min(120, $liveTimeout));

        $useVision = isset($_GET['vision']);
        if ($useVision) {
            // 1x1 kırmızı PNG — modelin görüntü girdisini kabul edip etmediğini sınar.
            $pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            $liveMessages = [[
                'role' => 'user',
                'content' => [
                    ['type' => 'text', 'text' => 'What color is this image? Answer with one word.'],
                    ['type' => 'image_url', 'image_url' => ['url' => $pixel]],
                ],
            ]];
        } else {
            $liveMessages = [['role' => 'user', 'content' => 'Say OK']];
        }

        $liveThinking = null;
        if (isset($_GET['thinking'])) {
            $liveThinking = ((string) $_GET['thinking']) === '1';
        }

        $livePayload = [
            'model' => $liveModel,
            'messages' => $liveMessages,
            'max_tokens' => 64,
            'temperature' => 0,
            'stream' => false,
        ];
        if ($liveThinking !== null) {
            $livePayload['chat_template_kwargs'] = ['thinking' => $liveThinking];
        }
        $body = json_encode($livePayload);
        $live = curl_nvidia_request(NVIDIA_CHAT_URL, [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $config['api_key'],
        ], $body, $liveTimeout);

        $report['canli_test'] = [
            'model' => $liveModel,
            'gorsel_testi' => $useVision,
            'thinking_ayari' => $liveThinking,
            'zaman_asimi_siniri_sn' => $liveTimeout,
            'http_durumu' => $live['http'],
            'curl_hata_kodu' => $live['errno'],
            'curl_hata' => $live['error'],
            'dns_sn' => $live['dns_sn'],
            'baglanti_sn' => $live['baglanti_sn'],
            'ssl_sn' => $live['ssl_sn'],
            'ilk_yanit_sn' => $live['ilk_yanit_sn'],
            'toplam_sn' => $live['toplam_sn'],
            'ip' => $live['ip'],
            'ssl_dogrulama_atlandi' => $live['ssl_fallback'],
            'saglayici_yanit_ozeti' => extract_provider_error($live['body']),
        ];

        debug_log([
            'uc' => 'diag-live',
            'model' => $liveModel,
            'gorsel_testi' => $useVision,
            'thinking_ayari' => $liveThinking,
            'http' => $live['http'],
            'curl_hata_no' => $live['errno'],
            'curl_hata' => $live['error'],
            'baglanti_sn' => $live['baglanti_sn'],
            'ilk_yanit_sn' => $live['ilk_yanit_sn'],
            'toplam_sn' => $live['toplam_sn'],
            'zaman_asimi_siniri_sn' => $liveTimeout,
        ]);

        if ($live['http'] === 200) {
            $answer = '';
            $liveData = json_decode((string) $live['body'], true);
            if (is_array($liveData)) {
                $liveMsg = $liveData['choices'][0]['message'] ?? [];
                $answer = is_string($liveMsg['content'] ?? null) ? trim($liveMsg['content']) : '';
                if ($answer === '' && is_string($liveMsg['reasoning_content'] ?? null)) {
                    $answer = '(reasoning) ' . trim($liveMsg['reasoning_content']);
                }
            }
            $answer = function_exists('mb_substr') ? mb_substr($answer, 0, 120) : substr($answer, 0, 120);
            $report['canli_test']['model_yaniti'] = $answer;
            $report['sonuc'] = 'BAŞARILI: ' . $liveModel . ' modeli ' . $live['toplam_sn'] . ' sn içinde yanıt verdi'
                . ($useVision ? ' (görsel girdi kabul edildi)' : '')
                . '. Bu modeli kullanmak için yapılandırmada NVIDIA_MODEL değerini güncelleyin.';
        } elseif ($live['errno'] === 28) {
            $report['sonuc'] = 'ZAMAN AŞIMI: Bağlantı kuruldu (' . $live['baglanti_sn'] . ' sn) ama ' . $liveModel . ' modeli ' . $liveTimeout . ' sn içinde yanıt üretmedi. Model kuyruğu yoğun olabilir. ?route=models&q=flash ile güncel model listesine bakın ve &model=... ile hızlı bir modeli test edin; muhakemeli modellerde &thinking=0 da deneyin.';
        } elseif ($live['errno'] !== 0) {
            $report['sonuc'] = 'HATA: cURL ' . $live['errno'] . ' — ' . $live['error'];
        } else {
            $report['sonuc'] = 'HATA: NVIDIA ' . $live['http'] . ' döndürdü (401/403 = anahtar geçersiz, 404 = model adı yanlış, 429 = kota). Ayrıntı: ' . $report['canli_test']['saglayici_yanit_ozeti'];
        }
    } else {
        $report['sonuc'] = 'Bağlantı ve anahtar hazır görünüyor. Gerçek istekle denemek için adrese &live=1 ekle. Güncel model listesi: ?route=models — farklı model denemek için &live=1&model=MODEL_ADI, görsel desteği için &vision=1, muhakeme kapatmak için &thinking=0 kullan.';
    }

    $report['son_kayitlar'] = read_debug_tail();
    json_out(200, $report);
}

// ---- Router -----------------------------------------------------------------

$route = detect_route();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$config = load_config();

if ($route === 'diag') {
    handle_diag($config);
}

if ($route === 'models') {
    handle_models($config);
}

if ($route === 'status') {
    if ($method !== 'GET') {
        json_out(405, ['error' => ['message' => 'Method not allowed.']]);
    }
    json_out(200, [
        'configured' => $config['api_key'] !== '',
        'model' => $config['model'],
        'models' => $config['models'],
    ]);
}

if ($route === 'chat' || $route === 'test') {
    if ($method !== 'POST') {
        json_out(405, ['error' => ['message' => 'Method not allowed.']]);
    }
    handle_chat($route === 'test', $config);
}

json_out(404, ['error' => ['message' => 'API endpoint not found.']]);
