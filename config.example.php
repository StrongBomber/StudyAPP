<?php
// Copy to config.php in the web root and add the key server-side.
// The real config.php is Git-ignored and blocked from direct HTTP access.
// If the host provides an API_KEY environment variable, it takes precedence.
return [
    'enabled' => true,
    'api_key' => '',
    'rate_limit_per_hour' => 30,
];
