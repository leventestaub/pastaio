// Banner — proactive-surface presentation primitive.
//
// Three tints per FUNCTIONALITY_MAP §4.2:
//   warning  — restriction conflicts. "heads up, something to know."
//   suggest  — regional nudges, cookbook empty starter. "here's an idea."
//   help     — cooking idle. "we're here if you need us." Subtler.
//
// Intentionally dumb. Wrappers like RestrictionConflictBanner own the
// trigger logic and read stores; this component just renders.

import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, radii, space } from '@/constants/theme';

type Tint = 'warning' | 'suggest' | 'help';

interface BannerProps {
  tint: Tint;
  title: string;
  sub?: string;
  onPress?: () => void;
  style?: ViewStyle;
}

const tintStyle: Record<Tint, { bg: string; border: string; titleColor: string; subColor: string }> = {
  warning: {
    bg:        colors.passataTint,
    border:    colors.passata,
    titleColor: colors.passataDark,
    subColor:   colors.passataDark,
  },
  suggest: {
    bg:        colors.paperHi,
    border:    colors.passata,
    titleColor: colors.ink,
    subColor:   colors.passata,
  },
  help: {
    bg:        colors.paper2,
    border:    colors.ink30,
    titleColor: colors.ink70,
    subColor:   colors.ink50,
  },
};

export function Banner({ tint, title, sub, onPress, style }: BannerProps) {
  const t = tintStyle[tint];
  const Container: any = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      style={[
        {
          marginHorizontal: space.lg,
          marginVertical: space.md,
          paddingVertical: 14,
          paddingHorizontal: space.lg,
          borderRadius: radii.md,
          borderLeftWidth: 3,
          borderLeftColor: t.border,
          backgroundColor: t.bg,
        },
        style,
      ]}
    >
      <Text variant="body" style={{ color: t.titleColor, lineHeight: 20 }}>
        {title}
      </Text>
      {sub && (
        <Text variant="body" style={{ color: t.subColor, fontSize: 13, marginTop: 2 }}>
          {sub}
          {onPress ? ' →' : ''}
        </Text>
      )}
    </Container>
  );
}
