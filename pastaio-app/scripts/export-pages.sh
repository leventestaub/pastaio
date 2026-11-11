#!/usr/bin/env sh
# Static web export for GitHub Pages, served from /pastaio.
# Usage: PASTAIO_BACKEND_URL=https://<project>.vercel.app sh scripts/export-pages.sh
set -e
export PASTAIO_BASE_URL=/pastaio PASTAIO_WEB_CAPTURE=1 CI=1
rm -rf dist
npx expo export -p web
# Pages can't send COOP/COEP headers, which web SQLite needs; the service
# worker adds them (one reload on the first visit).
for f in $(find dist -name '*.html'); do
  sed -i 's#<head>#<head><script src="/pastaio/coi-serviceworker.js"></script>#' "$f"
done
# Deep links to dynamic routes (/recipe/<id>) fall back to the app shell.
cp dist/index.html dist/404.html
touch dist/.nojekyll
