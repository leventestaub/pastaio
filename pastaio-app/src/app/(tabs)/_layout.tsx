// (tabs)/_layout.tsx — tab bar restyle.
//
// Four tabs per FUNCTIONALITY_MAP §2: Home (index), Discover, Cookbook, Memory.
// Custom tabBar prop replaces stock chrome with mono-uppercase labels and
// custom pasta-shape icons. Active state uses passata color; inactive is ink30.
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
                <ShapeIcon kind={iconKey} color={focused ? colors.passata : colors.ink30} />
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

function ShapeIcon({ kind, color }: { kind: IconKey; color: string }) {
  const size = 22;
  const sp = {
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  switch (kind) {
    case 'home': // orecchiette dimple
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M5 13c0-4 3-7 7-7s7 3 7 7-3 5-7 5-7-1-7-5z" {...sp} />
          <Path d="M9 13c0-2 1.5-3.5 3-3.5s3 1.5 3 3.5-1.5 2.5-3 2.5-3-.5-3-2.5z" {...sp} strokeWidth={1} />
        </Svg>
      );
    case 'discover': // fusilli spiral
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M9 4c4 1 4 4 0 5s-4 4 0 5 4 4 0 5" {...sp} />
          <Path d="M15 4c-4 1-4 4 0 5s4 4 0 5-4 4 0 5" {...sp} />
        </Svg>
      );
    case 'cookbook': // tagliatelle nest
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 8c4-2 8-2 12 0M4 12c4-2 8-2 12 0M4 16c4-2 8-2 12 0" {...sp} />
          <Path d="M16 6c2 0 4 2 4 5s-2 7-4 7" {...sp} />
        </Svg>
      );
    case 'memory': // farfalle bowtie
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 7l8 5-8 5V7zM20 7l-8 5 8 5V7z" {...sp} />
          <Circle cx={12} cy={12} r={1.4} {...sp} strokeWidth={1} />
        </Svg>
      );
  }
}
