// ViewfinderTile — outlined frame with camera-style corner brackets and a
// reticle. The "camera" metaphor for the Identify entry point on Home.
// Pairs with StampTile.

import React from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Text } from '@/components/primitives/Text';
import { colors, fonts } from '@/constants/theme';

interface ViewfinderTileProps {
  title: string;
  subtitle?: string;
  desc?: string;
  onPress: () => void;
}

const ARM_LEN = 14;
const ARM_STROKE = 1.5;
const ARM_INSET = 6;

export function ViewfinderTile({ title, subtitle, desc, onPress }: ViewfinderTileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        position: 'relative',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.ink15,
        borderRadius: 4,
        paddingTop: 20,
        paddingHorizontal: 16,
        paddingBottom: 16,
        minHeight: 124,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <CornerBrackets />
      <Reticle />

      <Text variant="mono" style={{ marginBottom: 12, fontSize: 9, letterSpacing: 1.4 }}>
        CAMERA
      </Text>

      <Text variant="display" style={{ fontSize: 26, lineHeight: 26, color: colors.ink }}>
        {title}
      </Text>

      {subtitle && (
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 18,
            lineHeight: 20,
            letterSpacing: -0.18,
            color: colors.passata,
            marginTop: 2,
          }}
        >
          {subtitle}
        </Text>
      )}

      {desc && (
        <Text
          variant="mono"
          style={{ marginTop: 12, fontSize: 9, letterSpacing: 1.1 }}
        >
          {desc.toUpperCase()}
        </Text>
      )}
    </Pressable>
  );
}

function CornerBrackets() {
  const arm = (extra: object) => (
    <View style={[{ position: 'absolute', backgroundColor: colors.ink }, extra]} />
  );
  return (
    <>
      {arm({ top: ARM_INSET, left: ARM_INSET, width: ARM_LEN, height: ARM_STROKE })}
      {arm({ top: ARM_INSET, left: ARM_INSET, width: ARM_STROKE, height: ARM_LEN })}
      {arm({ top: ARM_INSET, right: ARM_INSET, width: ARM_LEN, height: ARM_STROKE })}
      {arm({ top: ARM_INSET, right: ARM_INSET, width: ARM_STROKE, height: ARM_LEN })}
      {arm({ bottom: ARM_INSET, left: ARM_INSET, width: ARM_LEN, height: ARM_STROKE })}
      {arm({ bottom: ARM_INSET, left: ARM_INSET, width: ARM_STROKE, height: ARM_LEN })}
      {arm({ bottom: ARM_INSET, right: ARM_INSET, width: ARM_LEN, height: ARM_STROKE })}
      {arm({ bottom: ARM_INSET, right: ARM_INSET, width: ARM_STROKE, height: ARM_LEN })}
    </>
  );
}

function Reticle() {
  return (
    <View style={{ position: 'absolute', top: '50%', right: 14, marginTop: -9 }}>
      <Svg width={18} height={18} viewBox="0 0 18 18">
        <Circle cx={9} cy={9} r={6} stroke={colors.ink30} strokeWidth={0.8} fill="none" />
        <Circle cx={9} cy={9} r={1.2} fill={colors.ink30} />
        <Line x1={9} y1={0} x2={9} y2={3} stroke={colors.ink30} strokeWidth={0.8} />
        <Line x1={9} y1={15} x2={9} y2={18} stroke={colors.ink30} strokeWidth={0.8} />
        <Line x1={0} y1={9} x2={3} y2={9} stroke={colors.ink30} strokeWidth={0.8} />
        <Line x1={15} y1={9} x2={18} y2={9} stroke={colors.ink30} strokeWidth={0.8} />
      </Svg>
    </View>
  );
}
