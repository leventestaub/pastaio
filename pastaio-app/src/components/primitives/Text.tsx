// Text primitive. Replaces the prototype's className-based type system
// (.t-display, .t-h2, .t-mono, etc.) with a variant prop.
//
// Use:
//   <Text variant="display">Trofie</Text>
//   <Text variant="mono" muted>thursday evening</Text>
//   <Text variant="h2" style={{ color: colors.passata }}>Spotlight</Text>
//
// Color overrides via style prop, NOT a `color` prop — keeps the API minimal
// and avoids reinventing what TextStyle already does.

import React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { type, colors, TypeKey } from '@/constants/theme';

interface TextProps extends RNTextProps {
  variant?: TypeKey;
  // Convenience props for common ink-stop overrides
  muted?: boolean;       // → ink50 (the meta voice)
  dim?: boolean;         // → ink30
  accent?: boolean;      // → passata
  onDark?: boolean;      // → bone (when on aperol/ink fills)
  // Override fontSize without losing other variant attrs (lineHeight scales)
  size?: number;
}

export function Text({
  variant = 'body',
  muted,
  dim,
  accent,
  onDark,
  size,
  style,
  children,
  ...rest
}: TextProps) {
  const base = type[variant];

  const overrides: TextStyle = {};
  if (muted)  overrides.color = colors.ink50;
  if (dim)    overrides.color = colors.ink30;
  if (accent) overrides.color = colors.passata;
  if (onDark) overrides.color = colors.bone;
  if (size != null) {
    overrides.fontSize = size;
    const baseLH = (base as TextStyle).lineHeight;
    const baseFS = (base as TextStyle).fontSize;
    if (baseLH != null && baseFS != null) {
      overrides.lineHeight = (baseLH / baseFS) * size;
    }
  }

  return (
    <RNText style={[base, overrides, style]} {...rest}>
      {children}
    </RNText>
  );
}
