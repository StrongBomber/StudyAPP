<?php
/**
 * ÖRNEK yapılandırma — bu dosyayı KOPYALAYIP düzenleyin, bunu düzenlemeyin.
 *
 * Önerilen (daha güvenli): Bu dosyayı htdocs klasörünün BİR ÜSTÜNE
 * "nvidia-config.php" adıyla kopyalayın (ör. /home/volXX/.../kullanici/nvidia-config.php).
 * Web kökünün dışında olduğu için tarayıcıdan asla erişilemez.
 *
 * Alternatif: Aynı klasörde "config.php" adıyla kopyalayın
 * (api/.htaccess doğrudan erişimi engeller).
 *
 * GERÇEK ANAHTARI ASLA GIT DEPOSUNA COMMIT ETMEYİN.
 */

return [
    // NVIDIA NIM API anahtarınız (https://build.nvidia.com adresinden alınır).
    'NVIDIA_API_KEY' => '',

    // İsteğe bağlı: farklı bir model kullanmak isterseniz değiştirin.
    // Varsayılan model yoğun saatlerde yavaşsa diag sayfasında
    // &live=1&model=... ile hızlı bir model bulup buraya yazın.
    'NVIDIA_MODEL' => 'z-ai/glm-5.3-flash',

    // İsteğe bağlı: sohbet isteği zaman aşımı (saniye, 10-300 arası).
    // Yorum satırını kaldırıp değeri değiştirebilirsiniz; varsayılan 90.
    // 'NVIDIA_TIMEOUT' => 90,
];
