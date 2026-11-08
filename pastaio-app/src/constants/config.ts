// pastaio-app/src/constants/config.ts
//
// Backend URL configuration. Picks LAN URL in development (Metro server) and
// Cloud Run URL in published EAS Update bundles loaded via Expo Go.
//
// Why __DEV__ and not Updates.channel: Expo Go always reports
// Updates.channel as null regardless of which channel published the bundle,
// because Expo Go is a generic runtime not bound to any channel. This is
// documented behavior. __DEV__ is the reliable signal: it's true when running
// through Metro on your laptop, false in published EAS Update bundles.
//
// In dev (Metro): __DEV__ === true → LAN URL
// In published bundle (Expo Go or standalone build): __DEV__ === false → Cloud Run

import Constants from 'expo-constants';

interface BackendUrlMap {
  development: string;
  production: string;
}

function getBackendUrl(): string {
  const urls = Constants.expoConfig?.extra?.backendUrl as BackendUrlMap | undefined;
  if (!urls) {
    throw new Error(
      'Missing app.json extra.backendUrl. Both development and production ' +
      'URLs must be defined under extra.backendUrl.'
    );
  }
  const url = __DEV__ ? urls.development : urls.production;
  if (!url) {
    throw new Error(
      `No backendUrl configured for ${__DEV__ ? 'development' : 'production'} in app.json`
    );
  }
  return url;
}

export const BACKEND_URL = getBackendUrl();