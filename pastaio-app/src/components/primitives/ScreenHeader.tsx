// ScreenHeader — header for pushed screens (Recipe, Identify, Shape,
// Search). Tab screens use CompactHeader. Cooking uses a custom inline
// header (different layout — End/Step/Ask).
//
// Reads the top safe-area inset to clear the Dynamic Island / notch.

import React from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { colors, space } from '@/constants/theme';

interface ScreenHeaderProps {
  title?: string;
  onBack: () => void;
  right?: React.ReactNode;
}

// Visual top padding *after* the safe area inset. Pushed screens want
// less above-bar padding than tab screens — back button visually anchors
// the top edge.
const HEADER_PAD_TOP = 6;

export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.lg,
        paddingTop: insets.top + HEADER_PAD_TOP,
        paddingBottom: space.md,
      }}
    >
      <Pressable onPress={onBack} hitSlop={12} style={{ width: 32 }}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M15 5 L8 12 L15 19"
            stroke={colors.ink}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>

      <View style={{ flex: 1, alignItems: 'center' }}>
        {title && <Text variant="mono">{title}</Text>}
      </View>

      <View style={{ width: 32, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}
