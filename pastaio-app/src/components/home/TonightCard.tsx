// TonightCard — the signature element of the redesigned Home.
//
// Anatomy:
//   - Folder tab "TONIGHT · {region}" sticking up from the top, in passata.
//   - Two-column body: left = info (time/serves kicker, recipe title set in
//     display italic, body copy), right = stub (sigil + hand-drawn arrow +
//     "cook" mono kicker).
//   - Perforated dotted line dividing the columns (ticket aesthetic).
//
// Title rendering: the prototype's split-on-first-space treatment broke on
// real Italian titles ("Bucatini all'amatriciana" became "Bucatini" /
// "all'amatriciana." with bad linebreaks; "Orecchiette con cime di rapa"
// was worse). Single-line title with size-down for long ones is the v1
// answer. If the recipe schema adds display1/display2 fields later, swap
// in the two-line treatment then.

import React from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/components/primitives/Text';
import { PastaSigil } from '@/components/primitives/PastaSigil';
import { colors, fonts, space } from '@/constants/theme';

interface TonightCardProps {
  title: string;
  region: string;          // human-readable, e.g. "Liguria"
  cookTimeMin: number;
  serves: number;
  shape: string;           // canonical shape name from KB, e.g. "trofie"
  body: string;            // 1-2 sentences, why this pick fits
  onPress: () => void;
}

const PERF_DOT_HEIGHT = 6;

export function TonightCard({
  title, region, cookTimeMin, serves, shape, body, onPress,
}: TonightCardProps) {
  // Title sizing: shrinks for long titles. Empirical breakpoints; 38 for
  // ~10 chars, 32 for ~16, 26 above. Target: title fits on 2 lines max in
  // the available ~210px wide left column.
  const titleSize = title.length <= 12 ? 38 : title.length <= 18 ? 32 : 26;
  const titleLineHeight = Math.round(titleSize * 0.95);

  return (
    <View style={{ marginTop: 14, marginHorizontal: space.lg }}>
      {/* Folder tab — passata fill, sits above the card top edge */}
      <View
        style={{
          position: 'absolute',
          top: -14,
          left: 20,
          zIndex: 2,
          backgroundColor: colors.passata,
          paddingHorizontal: 12,
          paddingTop: 5,
          paddingBottom: 6,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
        }}
      >
        <Text variant="mono" style={{ color: colors.bone, fontSize: 10, letterSpacing: 1.6 }}>
          TONIGHT · {region.toUpperCase()}
        </Text>
      </View>

      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          backgroundColor: colors.paperHi,
          borderColor: colors.hairlineStrong,
          borderWidth: 1,
          borderRadius: 14,
          overflow: 'hidden',
          minHeight: 168,
          opacity: pressed ? 0.96 : 1,
        })}
      >
        {/* LEFT — info column */}
        <View style={{ flex: 1, padding: space.lg, paddingTop: 24, paddingRight: space.md }}>
          <Text variant="mono" style={{ marginBottom: 10 }}>
            {cookTimeMin} min · serves {serves}
          </Text>

          <Text
            style={{
              fontFamily: fonts.displayItalicLight,
              fontSize: titleSize,
              lineHeight: titleLineHeight,
              letterSpacing: -titleSize * 0.025,
              color: colors.ink,
              marginBottom: 14,
            }}
          >
            {title}
          </Text>

          <Text variant="body" style={{ fontSize: 13, lineHeight: 19, maxWidth: 220 }}>
            {body}
          </Text>
        </View>

        {/* PERFORATED tear line */}
        <View style={{ width: 1, marginVertical: 8 }}>
          <PerforationLine />
        </View>

        {/* RIGHT — stub column (96px wide) */}
        <View
          style={{
            width: 96,
            backgroundColor: colors.paper,
            paddingVertical: 20,
            paddingHorizontal: 8,
            paddingBottom: 16,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <PastaSigil shape={shape} size={70} color={colors.ink} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="mono" style={{ color: colors.passata, fontSize: 9, letterSpacing: 1.4 }}>
              COOK
            </Text>
            <HandArrow />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// Loading state — same frame, no content. Used while KB query resolves.
export function TonightCardPlaceholder({ region }: { region?: string }) {
  return (
    <View style={{ marginTop: 14, marginHorizontal: space.lg }}>
      <View
        style={{
          position: 'absolute',
          top: -14,
          left: 20,
          zIndex: 2,
          backgroundColor: colors.passata,
          paddingHorizontal: 12,
          paddingTop: 5,
          paddingBottom: 6,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
        }}
      >
        <Text variant="mono" style={{ color: colors.bone, fontSize: 10, letterSpacing: 1.6 }}>
          TONIGHT{region ? ` · ${region.toUpperCase()}` : ''}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: colors.paperHi,
          borderColor: colors.hairlineStrong,
          borderWidth: 1,
          borderRadius: 14,
          minHeight: 168,
        }}
      />
    </View>
  );
}

// Vertical column of dots, drawn as a single SVG.
function PerforationLine() {
  return (
    <Svg width={1} height={150} viewBox="0 0 1 150" preserveAspectRatio="none">
      {Array.from({ length: 25 }).map((_, i) => (
        <Path
          key={i}
          d={`M 0 ${i * PERF_DOT_HEIGHT} L 0 ${i * PERF_DOT_HEIGHT + 3}`}
          stroke={colors.ink30}
          strokeWidth={1}
        />
      ))}
    </Svg>
  );
}

// Hand-drawn-feel arrow, intentionally imperfect.
function HandArrow() {
  return (
    <Svg width={22} height={14} viewBox="0 0 22 14" fill="none">
      <Path d="M1 7 Q 11 7.4, 19 6.5" stroke={colors.ink} strokeWidth={1} strokeLinecap="round" />
      <Path d="M14 2 Q 18 5.5, 19 6.5 Q 18 9, 14 12" stroke={colors.ink} strokeWidth={1} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
