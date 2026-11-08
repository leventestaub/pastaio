// CompactHeader — italic wordmark + mono kicker + optional right slot.
//
// Adds the device's top safe-area inset to its padding so the wordmark
// always sits below the Dynamic Island, status bar, and notch. The inset
// is read via useSafeAreaInsets() — Expo Router auto-mounts a
// SafeAreaProvider at the root, but we keep an explicit one in _layout.tsx
// for safety.
//
// Visual: title in display italic at 26pt, kicker in mono uppercase below,
// right slot for action buttons (search button on Discover, etc.).

import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { colors, fonts } from '@/constants/theme';

interface CompactHeaderProps {
  title: string;
  kicker?: string;
  right?: React.ReactNode;
}

// Visual top padding *after* the safe area inset. Tight; the wordmark
// itself sits ~26pt tall and we want it to feel close to the device edge
// while still leaving breathing room past Dynamic Island.
const HEADER_PAD_TOP = 12;
const HEADER_PAD_BOTTOM = 22;

export function CompactHeader({ title, kicker, right }: CompactHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: insets.top + HEADER_PAD_TOP,
        paddingBottom: HEADER_PAD_BOTTOM,
      }}
    >
      <View>
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 26,
            lineHeight: 26,
            color: colors.ink,
          }}
        >
          {title}
        </Text>
        {kicker && (
          <Text variant="mono" style={{ marginTop: 6 }}>
            {kicker}
          </Text>
        )}
      </View>
      {right ?? null}
    </View>
  );
}
