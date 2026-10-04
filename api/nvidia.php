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
const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_BODY_BYTES = 20971520; // 20 MB

@set_time_limit(0);
@ini_set('display_errors', '0');

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
    $uri = $_SERVER['REQUEST_URI'] ?? '';
    $path = (string) parse_url($uri, PHP_URL_PATH);
    if (preg_match('~/api/nvidia/(status|chat|test)/?$~', $path, $m)) {
        return $m[1];
    }
    // Fallback: ?route=... when rewriting passes the route as a query arg.
    $route = $_GET['route'] ?? '';
    if (in_array($route, ['status', 'chat', 'test'], true)) {
        return $route;
    }
    return '';
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

    $ch = curl_init(NVIDIA_CHAT_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $config['api_key'],
        ],
    ]);

    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlErr = curl_errno($ch);
    curl_close($ch);

    if ($response === false || $curlErr !== 0) {
        // Never echo credentials or raw transport errors to the client.
        json_out(502, ['error' => ['message' => 'NVIDIA servisine ulaşılamadı. Biraz bekleyip tekrar dene.']]);
    }

    if ($status === 200) {
        $data = json_decode((string) $response, true);
        $text = '';
        if (is_array($data)) {
            $text = $data['choices'][0]['message']['content'] ?? '';
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

// ---- Router -----------------------------------------------------------------

$route = detect_route();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$config = load_config();

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
