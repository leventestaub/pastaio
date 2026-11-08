// StampTile — postage-stamp aesthetic. Solid passata fill with serrated
// dotted edges (paper-colored dots positioned along each side, half-clipped).
//
// Used as the "Ask" action tile on Home. Pairs with ViewfinderTile in a
// 2-column grid; both metaphors retained per user direction.

import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/primitives/Text';
import { colors, fonts } from '@/constants/theme';

interface StampTileProps {
  mark?: string;       // small display-font glyph at top, e.g. "✻"
  title: string;       // large display-italic title
  subtitle?: string;   // smaller italic subtitle
  desc?: string;       // mono kicker at bottom
  onPress: () => void;
}

const DOT_COUNT = 11;
const DOT_SIZE = 6;

export function StampTile({ mark, title, subtitle, desc, onPress }: StampTileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        position: 'relative',
        backgroundColor: colors.passata,
        paddingTop: 20,
        paddingHorizontal: 16,
        paddingBottom: 16,
        minHeight: 124,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <SerratedEdges />

      <View style={{ zIndex: 1 }}>
        {mark && (
          <Text
            style={{
              fontFamily: fonts.displayRegular,
              fontSize: 22,
              color: colors.bone,
              opacity: 0.85,
              lineHeight: 22,
              marginBottom: 12,
            }}
          >
            {mark}
          </Text>
        )}

        <Text
          variant="display"
          style={{ fontSize: 26, lineHeight: 26, color: colors.bone }}
        >
          {title}
        </Text>

        {subtitle && (
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              fontSize: 18,
              lineHeight: 20,
              letterSpacing: -0.18,
              color: colors.bone,
              opacity: 0.78,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        )}
      </View>

      {desc && (
        <Text
          variant="mono"
          style={{
            color: colors.bone,
            opacity: 0.6,
            marginTop: 12,
            fontSize: 9,
            letterSpacing: 1.1,
          }}
        >
          {desc.toUpperCase()}
        </Text>
      )}
    </Pressable>
  );
}

function SerratedEdges() {
  const dotStyle = {
    position: 'absolute' as const,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.paper,
  };

  const positions = (orientation: 'top' | 'bottom' | 'left' | 'right') => {
    return Array.from({ length: DOT_COUNT }).map((_, i) => {
      const pct = ((i + 0.5) / DOT_COUNT) * 100;
      const offsetStr = `${pct}%` as any;
      switch (orientation) {
        case 'top':
          return { top: -DOT_SIZE / 2, left: offsetStr, marginLeft: -DOT_SIZE / 2 };
        case 'bottom':
          return { bottom: -DOT_SIZE / 2, left: offsetStr, marginLeft: -DOT_SIZE / 2 };
        case 'left':
          return { left: -DOT_SIZE / 2, top: offsetStr, marginTop: -DOT_SIZE / 2 };
        case 'right':
          return { right: -DOT_SIZE / 2, top: offsetStr, marginTop: -DOT_SIZE / 2 };
      }
    });
  };

  return (
    <>
      {(['top', 'bottom', 'left', 'right'] as const).flatMap((side) =>
        positions(side).map((pos, i) => (
          <View key={`${side}-${i}`} style={[dotStyle, pos]} />
        ))
      )}
    </>
  );
}
