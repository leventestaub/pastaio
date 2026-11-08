// AskAffordance — the single "Ask Pastaio" entry point.
//
// FUNCTIONALITY_MAP §4.8 calls for visual consistency: same icon, same label,
// same treatment everywhere. The prototype quietly broke that with four
// different visual treatments. This component picks ONE treatment per
// context and owns it.
//
// Variants:
//   floating — bottom-right FAB. Default for Discover, Cookbook, Search, Shape.
//   inline   — full-width button below primary CTAs. Used on Recipe.
//   header   — compact pill for cooking-screen header (slightly larger per spec).
//
// All three render the same icon + label "Ask Pastaio". Color logic is shared:
// dark fill (ink) on paper backgrounds, never aperol — keeps aperol reserved
// for Tonight folder tab and primary CTAs.

import React from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from './Text';
import { colors, radii, space } from '@/constants/theme';

type Variant = 'floating' | 'inline' | 'header';

interface AskAffordanceProps {
  onPress: () => void;
  variant?: Variant;
}

export function AskAffordance({ onPress, variant = 'floating' }: AskAffordanceProps) {
  if (variant === 'inline') {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          paddingVertical: 12,
          paddingHorizontal: space.lg,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
          backgroundColor: 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <SparkIcon size={14} color={colors.passata} />
        <Text variant="body" style={{ fontFamily: 'Geist-Medium', fontSize: 14, color: colors.ink }}>
          Ask Pastaio
        </Text>
      </Pressable>
    );
  }

  if (variant === 'header') {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: radii.pill,
          backgroundColor: colors.ink,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <SparkIcon size={13} color={colors.bone} />
        <Text variant="body" style={{ fontFamily: 'Geist-Medium', fontSize: 13, color: colors.bone }}>
          Ask
        </Text>
      </Pressable>
    );
  }

  // Default: floating FAB. Bottom-right of screen content.
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: space.lg, bottom: space.lg }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: radii.pill,
          backgroundColor: colors.ink,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <SparkIcon size={14} color={colors.bone} />
        <Text variant="body" style={{ fontFamily: 'Geist-Medium', fontSize: 14, color: colors.bone }}>
          Ask Pastaio
        </Text>
      </Pressable>
    </View>
  );
}

function SparkIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L13.8 8.4 L19 10 L13.8 11.6 L12 17 L10.2 11.6 L5 10 L10.2 8.4 Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
