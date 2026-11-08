// RecipeRow — full-width row for recipe lists. Sigil avatar, title, meta
// line, optional right slot. Used by Cookbook, Search, Shape results.
//
// For lists where rows nest inside a card with internal dividers, set
// `embedded={true}` on all but the first to omit the rounded background
// (keeps the card's outer radius/border doing the work).

import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from './Text';
import { PastaSigil } from './PastaSigil';
import { colors, radii, space } from '@/constants/theme';

interface RecipeRowProps {
  title: string;
  shape: string;          // shape_id, lowercased — passed to PastaSigil
  metaParts: (string | null | undefined)[];   // ["Liguria", "herb-based", "25 min"] — falsy filtered
  onPress: () => void;
  onLongPress?: () => void;
  right?: React.ReactNode;
  embedded?: boolean;
}

export function RecipeRow({
  title, shape, metaParts, onPress, onLongPress, right, embedded,
}: RecipeRowProps) {
  const meta = metaParts.filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: embedded ? 'transparent' : colors.paperHi,
        borderWidth: embedded ? 0 : 1,
        borderColor: colors.hairline,
        borderRadius: embedded ? 0 : radii.md,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          backgroundColor: colors.paper,
          borderWidth: 1,
          borderColor: colors.hairline,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <PastaSigil shape={shape} size={26} color={colors.ink70} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" numberOfLines={1}>{title}</Text>
        {meta && (
          <Text variant="meta" numberOfLines={1} style={{ marginTop: 2 }}>
            {meta}
          </Text>
        )}
      </View>

      {right}
    </Pressable>
  );
}
