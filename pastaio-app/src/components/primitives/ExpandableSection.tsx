// src/components/primitives/ExpandableSection.tsx
import { useState, useRef } from 'react';
import {
  View,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
  StyleSheet,
} from 'react-native';
import { Text } from './Text';
import { colors, space, motion } from '@/constants/theme';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
};

export function ExpandableSection({
  title,
  children,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rotation = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = () => {
    LayoutAnimation.configureNext({
      duration: motion.base,
      update: { type: 'easeInEaseOut' },
      create: { type: 'easeInEaseOut', property: 'opacity' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    Animated.timing(rotation, {
      toValue: expanded ? 0 : 1,
      duration: motion.base,
      useNativeDriver: true,
    }).start();
    setExpanded(!expanded);
  };

  const chevronRotation = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.hairline} />
      <Pressable
        onPress={toggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
        hitSlop={6}
      >
        <Text variant="mono" style={styles.title}>
          {title}
        </Text>
        <Animated.Text
          style={[
            styles.chevron,
            { transform: [{ rotate: chevronRotation }] },
          ]}
        >
          ›
        </Animated.Text>
      </Pressable>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: space.lg,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
  },
  title: {
    flex: 1,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 22,
    color: colors.ink50,
    marginLeft: space.sm,
    // glyph sits low without this
    marginTop: -3,
  },
  body: {
    marginTop: space.md,
    paddingBottom: space.xs,
  },
});