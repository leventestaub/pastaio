// Chip — small toggle/filter control. Used by Search filters, quick toggles,
// and the agent input's suggested-query buttons.

import React from 'react';
import { Pressable } from 'react-native';
import { Text } from './Text';
import { colors, fonts, radii } from '@/constants/theme';

interface ChipProps {
  label: string;
  on?: boolean;
  onPress: () => void;
}

export function Chip({ label, on, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        paddingHorizontal: 14,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: on ? colors.ink : colors.hairlineStrong,
        backgroundColor: on ? colors.ink : 'transparent',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: fonts.sansMedium,
          fontSize: 13,
          letterSpacing: -0.05,
          color: on ? colors.bone : colors.ink70,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
