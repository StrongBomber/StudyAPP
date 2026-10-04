<?php
// Optional legacy fallback. Prefer the private htdocs/.env file for new setups.
// Never put a real API key in GitHub or in a browser-side JavaScript file.
return [
    'enabled' => false,
    'nvidia_api_key' => '',
    'nvidia_model' => 'z-ai/glm-5.3-flash',
    'rate_limit_per_hour' => 30,
];
