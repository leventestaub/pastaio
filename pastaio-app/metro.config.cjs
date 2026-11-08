const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('db')) {
  config.resolver.assetExts.push('db');
}
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Web SQLite needs SharedArrayBuffer, which requires COOP/COEP headers.
config.server = config.server ?? {};
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};


// Web capture only: avoid ESM builds (import.meta) of zustand etc. in the classic-script web bundle.
if (process.env.PASTAIO_WEB_CAPTURE) {
  config.resolver.unstable_enablePackageExports = false;
}
module.exports = config;
