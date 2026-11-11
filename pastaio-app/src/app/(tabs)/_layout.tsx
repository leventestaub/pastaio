// (tabs)/_layout.tsx — tab bar restyle.
//
// Four tabs per FUNCTIONALITY_MAP §2: Home (index), Discover, Cookbook, Memory.
// Custom tabBar prop replaces stock chrome with mono-uppercase labels and
// kitchen-object icons (pot, map pin, recipe book, notebook). Active state uses passata color; inactive is ink30.
//
// Note: the file STATE.md describes was built with these four tabs, but
// the source you sent showed index+explore. I've gone with the documented
// four — adjust route names below if your real files differ.

import React from 'react';
import { View, Pressable } from 'react-native';
import { Tabs } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text } from '@/components/primitives/Text';
import { colors, fonts } from '@/constants/theme';

type IconKey = 'home' | 'discover' | 'cookbook' | 'memory';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.bone,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            paddingTop: 8,
            paddingBottom: 24,
            paddingHorizontal: 8,
          }}
        >
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const label = route.name === 'index' ? 'home' : route.name;
            const iconKey: IconKey =
              route.name === 'index' ? 'home' : (route.name as IconKey);

            return (
              <Pressable
                key={route.key}
                onPress={() => navigation.navigate(route.name)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 6,
                  gap: 4,
                }}
              >
                <TabIcon kind={iconKey} color={focused ? colors.passata : colors.ink30} />
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 9,
                    letterSpacing: 0.72,
                    textTransform: 'uppercase',
                    color: focused ? colors.passata : colors.ink30,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="cookbook" />
      <Tabs.Screen name="memory" />
    </Tabs>
  );
}

function TabIcon({ kind, color }: { kind: IconKey; color: string }) {
  const size = 22;
  const sp = {
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  switch (kind) {
    case 'home': // steaming pot: what you're cooking
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M5 11h14v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" {...sp} />
          <Path d="M3 11h18" {...sp} />
          <Path d="M9 4.5c-.8.8-.8 1.7 0 2.5M12 4c-.8.8-.8 1.7 0 2.5M15 4.5c-.8.8-.8 1.7 0 2.5" {...sp} />
        </Svg>
      );
    case 'discover': // map pin: shapes and regions
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" {...sp} />
          <Circle cx={12} cy={10} r={2.4} {...sp} />
        </Svg>
      );
    case 'cookbook': // recipe book with ribbon
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M6 4h11a1 1 0 0 1 1 1v15H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" {...sp} />
          <Path d="M5 18a2 2 0 0 1 2-2h11" {...sp} />
          <Path d="M10 4v6l1.5-1.2L13 10V4" {...sp} />
        </Svg>
      );
    case 'memory': // notebook with pencil: what Pastaio remembers
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M6 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...sp} />
          <Path d="M8 8h5M8 11h5M8 14h3" {...sp} />
          <Path d="M19 7l1.2 1.2-5 5-1.7.5.5-1.7z" {...sp} />
        </Svg>
      );
  }
}
