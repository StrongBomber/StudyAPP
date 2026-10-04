<?php
declare(strict_types=1);

const STUDYAPP_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
const STUDYAPP_NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const STUDYAPP_MAX_REQUEST_BYTES = 8 * 1024 * 1024;

function studyapp_json(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    echo $body === false ? '{"error":{"message":"Sunucu yanıtı oluşturulamadı."}}' : $body;
    exit;
}

function studyapp_config(): array
{
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) {
        return [];
    }

    $config = require $path;
    return is_array($config) ? $config : [];
}

function studyapp_model(array $config): string
{
    $model = trim((string) ($config['nvidia_model'] ?? STUDYAPP_DEFAULT_MODEL));
    return $model !== '' ? $model : STUDYAPP_DEFAULT_MODEL;
}

function studyapp_is_configured(array $config): bool
{
    return ($config['enabled'] ?? false) === true
        && trim((string) ($config['nvidia_api_key'] ?? '')) !== ''
        && function_exists('curl_init');
}

function studyapp_status(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        header('Allow: GET');
        studyapp_json(405, ['error' => ['message' => 'Bu uç nokta yalnızca GET kabul eder.']]);
    }

    $config = studyapp_config();
    studyapp_json(200, [
        'configured' => studyapp_is_configured($config),
        'model' => studyapp_model($config),
    ]);
}

/**
 * File-backed, per-client hourly limit. The client address is hashed before it
 * is written, and the storage file is blocked from direct web access.
 * Returns "allowed", "limited", or "unavailable" (fail closed).
 */
function studyapp_rate_limit(int $limit): string
{
    $path = __DIR__ . '/.rate-limit.json';
    $handle = @fopen($path, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        if (is_resource($handle)) {
            fclose($handle);
        }
        return 'unavailable';
    }

    rewind($handle);
    $contents = stream_get_contents($handle);
    $buckets = is_string($contents) ? json_decode($contents, true) : null;
    if (!is_array($buckets)) {
        $buckets = [];
    }

    $now = time();
    $cutoff = $now - 3600;
    foreach ($buckets as $key => $timestamps) {
        if (!is_array($timestamps)) {
            unset($buckets[$key]);
            continue;
        }
        $timestamps = array_values(array_filter($timestamps, static function ($timestamp) use ($cutoff): bool {
            return is_int($timestamp) && $timestamp > $cutoff;
        }));
        if ($timestamps === []) {
            unset($buckets[$key]);
        } else {
            $buckets[$key] = $timestamps;
        }
    }

    $clientKey = hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $timestamps = $buckets[$clientKey] ?? [];
    if (!is_array($timestamps)) {
        $timestamps = [];
    }

    $state = count($timestamps) >= $limit ? 'limited' : 'allowed';
    if ($state === 'allowed') {
        $timestamps[] = $now;
    }
    $buckets[$clientKey] = $timestamps;

    $encoded = json_encode($buckets);
    rewind($handle);
    $writeOk = $encoded !== false
        && ftruncate($handle, 0)
        && fwrite($handle, $encoded) !== false
        && fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $writeOk ? $state : 'unavailable';
}

function studyapp_same_origin_json_request(): bool
{
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''), 2)[0]));
    if ($contentType !== 'application/json') {
        return false;
    }

    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return true;
    }

    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHost = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    $requestHost = preg_replace('/:\\d+$/', '', $requestHost) ?? '';
    return is_string($originHost)
        && $requestHost !== ''
        && hash_equals($requestHost, strtolower($originHost));
}

function studyapp_chat(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        studyapp_json(405, ['error' => ['message' => 'Bu uç nokta yalnızca POST kabul eder.']]);
    }
    if (!studyapp_same_origin_json_request()) {
        studyapp_json(403, ['error' => ['message' => 'İstek aynı web sitesinden gönderilmelidir.']]);
    }

    $config = studyapp_config();
    if (!studyapp_is_configured($config)) {
        studyapp_json(424, ['error' => ['message' => 'AI sohbeti kapalı. InfinityFree ayarlarında api/nvidia/config.php dosyasını yapılandır.']]);
    }

    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > STUDYAPP_MAX_REQUEST_BYTES) {
        studyapp_json(413, ['error' => ['message' => 'İstek çok büyük.']]);
    }

    $rawBody = file_get_contents('php://input');
    if (!is_string($rawBody) || $rawBody === '') {
        studyapp_json(400, ['error' => ['message' => 'İstek gövdesi boş.']]);
    }
    if (strlen($rawBody) > STUDYAPP_MAX_REQUEST_BYTES) {
        studyapp_json(413, ['error' => ['message' => 'İstek çok büyük.']]);
    }

    $payload = json_decode($rawBody, true);
    if (!is_array($payload) || $payload === [] || array_keys($payload) === range(0, count($payload) - 1)) {
        studyapp_json(400, ['error' => ['message' => 'İstek geçerli bir JSON nesnesi olmalı.']]);
    }

    $model = studyapp_model($config);
    $requestedModel = $payload['model'] ?? $model;
    if (!is_string($requestedModel) || $requestedModel !== $model) {
        studyapp_json(400, ['error' => ['message' => 'İstenen model sunucu ayarıyla eşleşmiyor.']]);
    }

    $messages = $payload['messages'] ?? null;
    if (!is_array($messages) || $messages === [] || count($messages) > 60) {
        studyapp_json(400, ['error' => ['message' => 'Sohbet mesajları eksik veya çok uzun.']]);
    }
    foreach ($messages as $message) {
        if (!is_array($message)
            || !in_array($message['role'] ?? null, ['system', 'user', 'assistant'], true)
            || !isset($message['content'])
            || (!is_string($message['content']) && !is_array($message['content']))) {
            studyapp_json(400, ['error' => ['message' => 'Sohbet mesaj biçimi geçersiz.']]);
        }
    }

    $maxTokens = filter_var($payload['max_tokens'] ?? 1800, FILTER_VALIDATE_INT);
    $temperatureValue = $payload['temperature'] ?? 0.5;
    $topPValue = $payload['top_p'] ?? 1.0;
    if ($maxTokens === false || !is_numeric($temperatureValue) || !is_numeric($topPValue)) {
        studyapp_json(400, ['error' => ['message' => 'Model ayarları geçersiz.']]);
    }
    $temperature = (float) $temperatureValue;
    $topP = (float) $topPValue;
    if ($maxTokens < 1 || $maxTokens > 4096 || $temperature < 0 || $temperature > 2 || $topP <= 0 || $topP > 1) {
        studyapp_json(400, ['error' => ['message' => 'Model ayarları izin verilen aralığın dışında.']]);
    }

    $limit = (int) ($config['rate_limit_per_hour'] ?? 30);
    $limit = max(1, min(500, $limit));
    $rateState = studyapp_rate_limit($limit);
    if ($rateState === 'limited') {
        header('Retry-After: 3600');
        studyapp_json(429, ['error' => ['message' => 'Bu IP için saatlik AI kullanım sınırına ulaşıldı. Daha sonra tekrar dene.']]);
    }
    if ($rateState !== 'allowed') {
        studyapp_json(503, ['error' => ['message' => 'AI kullanım sınırı denetlenemedi. Biraz sonra tekrar dene.']]);
    }

    $apiKey = trim((string) $config['nvidia_api_key']);
    $body = json_encode([
        'model' => $model,
        'messages' => $messages,
        'temperature' => $temperature,
        'top_p' => $topP,
        'max_tokens' => $maxTokens,
        'stream' => false,
    ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($body === false) {
        studyapp_json(400, ['error' => ['message' => 'İstek kodlanamadı.']]);
    }

    $curl = curl_init(STUDYAPP_NVIDIA_CHAT_URL);
    if ($curl === false) {
        studyapp_json(424, ['error' => ['message' => 'Sunucuda PHP cURL etkin değil.']]);
    }
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
            'Accept: application/json',
        ],
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'StudyAPP/1.0',
        CURLOPT_FOLLOWLOCATION => false,
    ]);

    $response = curl_exec($curl);
    $curlErrorNumber = curl_errno($curl);
    $upstreamStatus = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    if ($response === false) {
        error_log('StudyAPP NVIDIA request failed; cURL error ' . $curlErrorNumber);
        studyapp_json(502, ['error' => ['message' => 'NVIDIA servisine şu anda ulaşılamıyor. Biraz sonra tekrar dene.']]);
    }

    $upstream = json_decode($response, true);
    if (!is_array($upstream)) {
        studyapp_json(502, ['error' => ['message' => 'NVIDIA servisi geçersiz bir yanıt döndürdü.']]);
    }

    if ($upstreamStatus < 200 || $upstreamStatus >= 300) {
        if ($upstreamStatus === 401 || $upstreamStatus === 403) {
            $message = 'NVIDIA API anahtarı reddedildi. Sunucudaki anahtarı kontrol et.';
        } elseif ($upstreamStatus === 404) {
            $message = 'NVIDIA sunucusunda seçili model bulunamadı. Model ayarını kontrol et.';
        } elseif ($upstreamStatus === 429) {
            $message = 'NVIDIA API kullanım kotasına ulaşıldı. Biraz bekleyip tekrar dene.';
        } elseif ($upstreamStatus === 503) {
            $message = 'NVIDIA modeli şu anda yoğun. Biraz bekleyip tekrar dene.';
        } elseif ($upstreamStatus >= 500) {
            $message = 'NVIDIA servisi geçici bir hata döndürdü (' . $upstreamStatus . ').';
        } else {
            $message = 'NVIDIA isteği reddedildi (' . $upstreamStatus . '). Modeli ve mesajları kontrol et.';
        }
        $safeStatus = in_array($upstreamStatus, [400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504], true)
            ? $upstreamStatus
            : 502;
        studyapp_json($safeStatus, ['error' => ['message' => $message]]);
    }

    $text = $upstream['choices'][0]['message']['content'] ?? '';
    if (!is_string($text)) {
        $text = '';
    }
    studyapp_json(200, ['text' => $text, 'model' => $model]);
}
