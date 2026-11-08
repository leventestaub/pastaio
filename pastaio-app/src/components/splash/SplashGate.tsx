import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SplashLogo } from './SplashLogo';

interface Props {
  /**
   * True when the app's startup work is complete (KB warmup, fonts loaded,
   * persistent state hydrated). Splash waits for BOTH this and the animation
   * to finish before fading out.
   */
  ready: boolean;
  children: React.ReactNode;
}

const FADE_OUT_DURATION_MS = 220;
const MIN_HOLD_MS = 150; // brief settle on the final logo before fading

export function SplashGate({ ready, children }: Props) {
  const [animationDone, setAnimationDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [overlayOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!animationDone || !ready) return;
    const t = setTimeout(() => {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: FADE_OUT_DURATION_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setHidden(true);
      });
    }, MIN_HOLD_MS);
    return () => clearTimeout(t);
  }, [animationDone, ready, overlayOpacity]);

  return (
    <View style={styles.root}>
      {children}
      {!hidden && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]}
          pointerEvents="none"
        >
          <SplashLogo onComplete={() => setAnimationDone(true)} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
