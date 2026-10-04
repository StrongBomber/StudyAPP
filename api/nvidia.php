<?php
/**
 * NVIDIA NIM chat proxy for PHP hosting (InfinityFree compatible).
 *
 * PHP port of server.py's /api/nvidia/* endpoints so the app can run on
 * hosts that support PHP but not Python. Routes (via root .htaccess):
 *   GET  /api/nvidia/status
 *   POST /api/nvidia/chat
 *   POST /api/nvidia/test
 *
 * The API key is NEVER sent to the browser. It is read, in order, from:
 *   1. ../../nvidia-config.php  (one level ABOVE the web root — recommended)
 *   2. api/config.php           (inside the web root, protected by .htaccess)
 *   3. NVIDIA_API_KEY / NVIDIA_MODEL environment variables
 */

declare(strict_types=1);

const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_CHAT_URL = NVIDIA_BASE_URL . '/chat/completions';
const MAX_BODY_BYTES = 20971520; // 20 MB

@set_time_limit(0);
@ini_set('display_errors', '0');

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
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function load_config(): array
{
    $apiKey = '';
    $model = '';

    // 1) Config file above the web root (safest on shared hosting).
    $aboveRoot = dirname(__DIR__, 2) . '/nvidia-config.php';
    // 2) Config file next to this script (protected by api/.htaccess).
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
            }
        }
        if ($apiKey !== '') {
            break;
        }
    }

    // 3) Environment variables, if the host provides them.
    if ($apiKey === '') {
        $apiKey = trim((string) (getenv('NVIDIA_API_KEY') ?: ''));
    }
    if ($model === '') {
        $model = trim((string) (getenv('NVIDIA_MODEL') ?: ''));
    }
    if ($model === '') {
        $model = DEFAULT_MODEL;
    }

    return ['api_key' => $apiKey, 'model' => $model];
}

function detect_route(): string
{
    // ?route=... works even when .htaccess rewriting is unavailable.
    $route = $_GET['route'] ?? '';
    if (in_array($route, ['status', 'chat', 'test', 'diag'], true)) {
        return $route;
    }
    $uri = $_SERVER['REQUEST_URI'] ?? '';
    $path = (string) parse_url($uri, PHP_URL_PATH);
    if (preg_match('~/api/nvidia/(status|chat|test|diag)/?$~', $path, $m)) {
        return $m[1];
    }
    return '';
}

/**
 * cURL POST with automatic CA-bundle fallback. Some shared hosts
 * (InfinityFree included) occasionally miss a usable CA bundle; on an
 * SSL-verification error we retry once without peer verification so the
 * feature keeps working. Returns [response|false, httpStatus, curlErrno, sslFallbackUsed].
 */
function curl_nvidia_request(string $url, array $headers, ?string $body, int $timeout): array
{
    $sslFallback = false;
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
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        curl_close($ch);

        // 35/58/60/77: SSL handshake or CA-bundle problems → retry unverified once.
        if ($response === false && $attempt === 0 && in_array($errno, [35, 58, 60, 77], true)) {
            $sslFallback = true;
            continue;
        }
        return [$response, $status, $errno, $sslFallback];
    }
    return [false, 0, 0, $sslFallback];
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

function provider_error_message(int $status, string $model): string
{
    if ($status === 401 || $status === 403) {
        return 'NVIDIA API anahtarı reddedildi. Anahtarın geçerli ve NVIDIA endpoint erişiminin açık olduğunu kontrol et.';
    }
    if ($status === 404) {
        return "NVIDIA endpoint bu modeli bulamadı: {$model}. NVIDIA_MODEL ayarını kontrol et.";
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

    $configuredModel = $config['model'];
    $model = (string) ($payload['model'] ?? $configuredModel);
    if ($model === '') {
        $model = $configuredModel;
    }
    if ($model !== $configuredModel) {
        json_out(400, ['error' => ['message' => 'İstenen model NVIDIA_MODEL sunucu ayarıyla eşleşmiyor.']]);
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

    $body = json_encode([
        'model' => $model,
        'messages' => $messages,
        'temperature' => $temperature,
        'top_p' => $topP,
        'max_tokens' => $maxTokens,
        'stream' => false,
    ], JSON_UNESCAPED_UNICODE);

    [$response, $status, $curlErr, ] = curl_nvidia_request(NVIDIA_CHAT_URL, [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $config['api_key'],
    ], $body, 90);

    if ($response === false || $curlErr !== 0) {
        // Never echo credentials or raw transport errors to the client.
        $hint = $curlErr === 28
            ? 'NVIDIA yanıtı zaman aşımına uğradı. Biraz bekleyip tekrar dene.'
            : 'NVIDIA servisine ulaşılamadı. Sunucunun dışa giden bağlantılarını /api/nvidia.php?route=diag adresinden kontrol et.';
        json_out(502, ['error' => ['message' => $hint]]);
    }

    if ($status === 200) {
        $data = json_decode((string) $response, true);
        $text = '';
        if (is_array($data)) {
            $message = $data['choices'][0]['message'] ?? [];
            $text = $message['content'] ?? '';
            // Reasoning models may leave `content` empty and put the answer
            // (or at least the reasoning) in `reasoning_content`.
            if (!is_string($text) || trim($text) === '') {
                $fallback = $message['reasoning_content'] ?? '';
                $text = is_string($fallback) ? $fallback : '';
            }
        }
        if (!is_string($text)) {
            $text = '';
        }
        json_out(200, ['text' => $text, 'model' => $model]);
    }

    $allowed = [400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504];
    if (!in_array($status, $allowed, true)) {
        $status = 502;
    }
    json_out($status, ['error' => ['message' => provider_error_message($status, $model)]]);
}

/**
 * Self-diagnosis endpoint: browse to /api/nvidia.php?route=diag
 * (add &live=1 to also run a tiny real completion against NVIDIA).
 * Reveals configuration/connectivity problems without exposing the key.
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
        'curl_eklentisi' => extension_loaded('curl'),
        'yapilandirma_kaynagi' => $configSource,
        'anahtar_ayarli' => $config['api_key'] !== '',
        'anahtar_uzunlugu' => strlen($config['api_key']),
        'model' => $config['model'],
        'yonlendirme' => isset($_GET['route']) ? 'query (?route=...)' : 'htaccess rewrite',
    ];

    if (!extension_loaded('curl')) {
        $report['sonuc'] = 'HATA: cURL eklentisi yok — proxy çalışamaz.';
        json_out(200, $report);
    }

    // Outbound connectivity probe (no key needed; 401 = reachable).
    [$resp, $status, $errno, $sslFallback] = curl_nvidia_request(
        NVIDIA_BASE_URL . '/models',
        ['Accept: application/json'],
        null,
        12
    );
    $report['nvidia_baglanti'] = [
        'http_durumu' => $status,
        'curl_hata_kodu' => $errno,
        'ssl_dogrulama_atlandi' => $sslFallback,
        'erisilebilir' => $resp !== false && $status > 0,
    ];
    if ($resp === false || $status === 0) {
        $report['sonuc'] = 'HATA: Sunucudan NVIDIA API\'ye dışa giden bağlantı kurulamıyor (curl hata ' . $errno . '). Hosting dışa giden istekleri engelliyor olabilir.';
        json_out(200, $report);
    }

    if ($config['api_key'] === '') {
        $report['sonuc'] = 'HATA: API anahtarı bulunamadı. nvidia-config.php dosyasını htdocs klasörünün BİR ÜSTÜNE, ya da config.php dosyasını api/ içine koy.';
        json_out(200, $report);
    }

    if (isset($_GET['live'])) {
        $body = json_encode([
            'model' => $config['model'],
            'messages' => [['role' => 'user', 'content' => 'Say OK']],
            'max_tokens' => 16,
            'temperature' => 0,
            'stream' => false,
        ]);
        [$liveResp, $liveStatus, $liveErrno, ] = curl_nvidia_request(NVIDIA_CHAT_URL, [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $config['api_key'],
        ], $body, 60);
        $excerpt = '';
        if (is_string($liveResp)) {
            $flat = (string) preg_replace('/\s+/', ' ', $liveResp);
            $excerpt = function_exists('mb_substr') ? mb_substr($flat, 0, 400) : substr($flat, 0, 400);
            if (!preg_match('//u', $excerpt)) {
                $excerpt = '(ikili veri)';
            }
        }
        $report['canli_test'] = [
            'http_durumu' => $liveStatus,
            'curl_hata_kodu' => $liveErrno,
            'yanit_ozeti' => $excerpt,
        ];
        $report['sonuc'] = $liveStatus === 200
            ? 'BAŞARILI: Anahtar ve model çalışıyor. Sorun devam ediyorsa tarayıcı konsolundaki ağ hatalarına bak.'
            : 'HATA: NVIDIA isteği ' . $liveStatus . ' döndürdü (401/403 = anahtar geçersiz, 404 = model adı yanlış, 429 = kota).';
    } else {
        $report['sonuc'] = 'Bağlantı ve anahtar hazır görünüyor. Gerçek istekle denemek için adrese &live=1 ekle.';
    }
    json_out(200, $report);
}

// ---- Router -----------------------------------------------------------------

$route = detect_route();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$config = load_config();

if ($route === 'diag') {
    handle_diag($config);
}

if ($route === 'status') {
    if ($method !== 'GET') {
        json_out(405, ['error' => ['message' => 'Method not allowed.']]);
    }
    json_out(200, ['configured' => $config['api_key'] !== '', 'model' => $config['model']]);
}

if ($route === 'chat' || $route === 'test') {
    if ($method !== 'POST') {
        json_out(405, ['error' => ['message' => 'Method not allowed.']]);
    }
    handle_chat($route === 'test', $config);
}

json_out(404, ['error' => ['message' => 'API endpoint not found.']]);
