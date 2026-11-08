// _layout.tsx — root layout.
//
// What this does:
//   1. Loads seven fonts via expo-font
//   2. Warms up the KB so the first /chat call doesn't pay open-and-copy cost
//   3. Hides the native Expo splash as soon as JS boots, then hands off to
//      our custom SplashGate which holds its own animated splash visible
//      until BOTH fonts+KB are ready AND the ribbon animation completes
//   4. Wraps everything in SafeAreaProvider so useSafeAreaInsets() works
//      throughout the app (expo-router auto-mounts one in current versions
//      but docs have been inconsistent across versions — explicit provider
//      is a defensive no-op if redundant)
//   5. Mounts the Stack navigator with four tabs and five pushed screens
//   6. Mounts the AgentInput overlay above the navigator

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { openKb } from '@/services/kb';
import { AgentInput } from '@/components/AgentInput';
import { SplashGate } from '@/components/splash/SplashGate';
import { colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  // already hidden — no-op
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Fraunces-Italic-Light':  require('../../assets/fonts/Fraunces_9pt-LightItalic.ttf'),
    'Fraunces-Italic':        require('../../assets/fonts/Fraunces_9pt-Italic.ttf'),
    'Fraunces-Regular':       require('../../assets/fonts/Fraunces_9pt-Regular.ttf'),
    'Geist-Regular':          require('../../assets/fonts/Geist-Regular.ttf'),
    'Geist-Medium':           require('../../assets/fonts/Geist-Medium.ttf'),
    'Geist-SemiBold':         require('../../assets/fonts/Geist-SemiBold.ttf'),
    'GeistMono-Regular':      require('../../assets/fonts/GeistMono-Regular.ttf'),
  });

  const [kbReady, setKbReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    openKb()
      .then(() => mounted && setKbReady(true))
      .catch((err) => {
        console.warn('[layout] kb warmup failed', err);
        if (mounted) setKbReady(true); // fail-open
      });
    return () => { mounted = false; };
  }, []);

  const ready = fontsLoaded && kbReady;

  // Hide the native Expo splash as soon as fonts are loaded — fonts are
  // required to render anything text-bearing under SplashGate. We don't
  // wait for KB here because SplashGate covers the screen during KB warmup.
  // The ribbon animation overlaps with KB work; total cold-start feels
  // shorter even though absolute time isn't.
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Don't render the tree until fonts are loaded — RN crashes on missing
  // font families in Text. KB readiness is handled by SplashGate (the
  // overlay covers any unstyled-but-mounted screens underneath).
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <SplashGate ready={ready}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="identify" />
            <Stack.Screen name="recipe/[id]" />
            <Stack.Screen name="shape/[shape]" />
            <Stack.Screen name="search" />
            <Stack.Screen
              name="cooking/[id]"
              options={{
                // Per FUNCTIONALITY_MAP §3.9 — back gesture disabled in cooking.
                gestureEnabled: false,
              }}
            />
          </Stack>

          <AgentInput />
        </SplashGate>

        <StatusBar style="dark" />
      </View>
    </SafeAreaProvider>
  );
}