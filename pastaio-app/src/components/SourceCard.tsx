// src/components/SourceCard.tsx
/**
 * Source card — lifted from the per-recipe sources screen so the
 * methodology screen can reuse it.
 *
 * Renders one source with kicker (tier + type label, or just type),
 * source name, original-language excerpt with translation underneath
 * if non-empty, and an "Open source" affordance. Tapping the whole
 * card opens the URL via Linking.
 *
 * showTier defaults to true. The methodology screen passes false
 * because tier is already in the surrounding group header.
 */
import React from 'react';
import {
  View,
  Pressable,
  Linking,
  StyleSheet,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { colors, fonts, radii, space } from '@/constants/theme';
import type { Source, SourceType } from '@/services/kb';

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  eu_regulation: 'EU regulation',
  mipaaf_register: 'MIPAAF register',
  comune_disciplinare: 'Comune disciplinare',
  accademia_publication: 'Accademia Italiana della Cucina',
  slow_food_documentation: 'Slow Food',
  italian_wikipedia_with_citations: 'Italian Wikipedia',
  italian_culinary_magazine: 'Culinary magazine',
  regional_government: 'Regional government',
  cookbook_excerpt_via_citation: 'Cookbook (via citation)',
};

type Props = {
  source: Source;
  showTier?: boolean;
  onPress?: () => void;
};

export function SourceCard({ source, showTier = true, onPress }: Props) {
  const typeLabel = SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type;
  const hasTranslation = source.excerpt_translation.trim().length > 0;
  const accessedYear = source.accessed_date.slice(0, 4);
  const accessedMonth = source.accessed_date.slice(5, 7);

  const handlePress = async () => {
    if (onPress) {
      onPress();
      return;
    }
    const supported = await Linking.canOpenURL(source.source_url);
    if (supported) {
      await Linking.openURL(source.source_url);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        pressed && { backgroundColor: colors.paper2 },
      ]}
    >
      <View style={styles.kickerRow}>
        <Text variant="mono" muted>
          {showTier ? `Tier ${source.source_tier} · ${typeLabel}` : typeLabel}
        </Text>
        <Text variant="mono" dim>
          accessed {accessedYear}-{accessedMonth}
        </Text>
      </View>

      <Text
        style={{
          fontFamily: fonts.sansSemibold,
          fontSize: 15,
          lineHeight: 21,
          color: colors.ink,
          marginTop: 4,
        }}
      >
        {source.source_name}
      </Text>

      <View style={styles.excerptBlock}>
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 15,
            lineHeight: 22,
            color: colors.ink70,
          }}
        >
          “{source.quoted_excerpt.trim()}”
        </Text>

        {hasTranslation && (
          <Text
            variant="body"
            muted
            style={{ marginTop: space.sm, lineHeight: 22 }}
          >
            {source.excerpt_translation.trim()}
          </Text>
        )}
      </View>

      <View style={styles.urlRow}>
        <Text variant="mono" accent>
          Open source
        </Text>
        <Svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          style={{ marginLeft: 6 }}
        >
          <Path
            d="M7 17 L17 7 M9 7 L17 7 L17 15"
            stroke={colors.passata}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paperHi,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.lg,
  },
  kickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  excerptBlock: {
    marginTop: space.md,
    paddingLeft: space.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.passata,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
  },
});