// Build-time overrides on top of app.json, used by the GitHub Pages workflow:
//   PASTAIO_BASE_URL     sub-path the web export is served from (e.g. /pastaio)
//   PASTAIO_BACKEND_URL  production backend (the Vercel deployment)
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.PASTAIO_BASE_URL && { baseUrl: process.env.PASTAIO_BASE_URL }),
  },
  extra: {
    ...config.extra,
    backendUrl: {
      ...config.extra.backendUrl,
      production: process.env.PASTAIO_BACKEND_URL || config.extra.backendUrl.production,
    },
  },
});
