// SectionHead — the Roman-numeral section header used on Discover and Memory.
//
// Layout: [I.] [Spotlight] ─────────── [LAZIO]
//          ^mono ^h2 italic   ^hairline   ^mono right
//
// numeral is required; rightKicker optional. Hairline takes remaining width.

import React from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { colors, space } from '@/constants/theme';

interface SectionHeadProps {
  numeral: string;        // "I.", "II.", "III." — caller controls casing/punctuation
  title: string;
  rightKicker?: string;
}

export function SectionHead({ numeral, title, rightKicker }: SectionHeadProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 12,
        paddingHorizontal: space.lg,
        paddingTop: space.xl,
        paddingBottom: 4,
      }}
    >
      <Text variant="mono" accent style={{ fontSize: 11 }}>
        {numeral}
      </Text>
      <Text variant="h2" style={{ flexShrink: 0 }}>
        {title}
      </Text>
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: colors.hairlineStrong,
          marginBottom: 6,
        }}
      />
      {rightKicker && (
        <Text variant="mono" style={{ marginBottom: 2 }}>
          {rightKicker}
        </Text>
      )}
    </View>
  );
}
