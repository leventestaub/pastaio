/**
 * Discover screen — the recipe-finding entry point.
 *
 * Three sections per the discover.ts rewrite (Tonight is Home-only now):
 *   I.   Spotlight       — horizontal strip, first card inverted to ink
 *   II.  Quick            — list card, time numerals on left
 *   III. Haven't tried   — horizontal strip
 *
 * Section algorithmic logic lives in services/discover.ts; this file only
 * renders. Sections refresh on cooking history change AND on tab focus.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { CompactHeader } from '@/components/primitives/CompactHeader';
import { SectionHead } from '@/components/primitives/SectionHead';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { useMemoryStore } from '@/stores/memoryStore';
import {
  buildDiscover,
  deriveRecentMetadata,
  type DiscoverSection,
} from '@/services/discover';
import type { RecipeSummary } from '@/services/kb';

const STRIP_CARD_WIDTH = 240;

export default function DiscoverScreen() {
  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);
  const cookingHistory = useMemoryStore((s) => s.cookingHistory);

  const [sections, setSections] = useState<DiscoverSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      // 'discover' isn't in the ScreenName union but the existing code
      // already passes it — preserving behavior.
      setCurrentScreen('discover' as any);
    }, [setCurrentScreen]),
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const cookingHistoryIds = Array.from(
          new Set(cookingHistory.map((h) => h.recipeId)),
        );
        const meta = await deriveRecentMetadata(cookingHistoryIds);
        const result = await buildDiscover({
          cookingHistoryIds,
          recentRegions: meta.recentRegions,
          recentShapes: meta.recentShapes,
        });
        if (!cancelled) {
          setSections(result);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSections([]);
          setIsLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cookingHistory]);

  const today = new Date().toLocaleDateString('en', { weekday: 'long' }).toLowerCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <CompactHeader
          title="Discover"
          kicker={today}
          right={<SearchButton onPress={() => router.push('/search')} />}
        />

        {isLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.passata} />
          </View>
        ) : (
          sections.map((section, i) => (
            <SectionRenderer
              key={section.id}
              section={section}
              numeral={ROMAN[i]}
            />
          ))
        )}

        <View style={{ height: 28 }} />
        <Text variant="mono" dim style={{ textAlign: 'center' }}>
          — fine —
        </Text>
      </ScrollView>

      <AskAffordance variant="floating" onPress={openAgentInput} />
    </View>
  );
}

const ROMAN = ['I.', 'II.', 'III.', 'IV.'];

function SectionRenderer({
  section,
  numeral,
}: {
  section: DiscoverSection;
  numeral: string;
}) {
  // Quick gets a list treatment; Spotlight + Haven't Tried get strip carousels.
  const isList = section.id === 'quick';

  const rightKicker =
    section.id === 'quick' ? "under 25′" :
    section.recipes.length > 0 ? `${section.recipes.length} ${section.recipes.length === 1 ? 'pick' : 'picks'}` :
    undefined;

  // Title may already say "Spotlight: Lazio" — strip the colon prefix
  // to render just "Spotlight" as the section title; the region goes in
  // the right kicker. This keeps the typography consistent.
  let displayTitle = section.title;
  let regionKicker: string | undefined;
  const colonIdx = section.title.indexOf(':');
  if (colonIdx > 0) {
    displayTitle = section.title.slice(0, colonIdx).trim();
    regionKicker = section.title.slice(colonIdx + 1).trim();
  }

  return (
    <View>
      <SectionHead
        numeral={numeral}
        title={displayTitle}
        rightKicker={regionKicker ?? rightKicker}
      />

      {section.subtitle && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: 12 }}>
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              fontSize: 18,
              lineHeight: 24,
              letterSpacing: -0.18,
              color: colors.ink70,
              fontStyle: 'italic',
            }}
          >
            {section.subtitle}
          </Text>
        </View>
      )}

      {section.recipes.length === 0 ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: 6 }}>
          <Text variant="body" muted style={{ fontStyle: 'italic' }}>
            (KB will fill this in over time.)
          </Text>
        </View>
      ) : isList ? (
        <View
          style={{
            marginHorizontal: space.lg,
            marginTop: 8,
            backgroundColor: colors.paperHi,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.hairline,
            overflow: 'hidden',
          }}
        >
          {section.recipes.map((r, i) => (
            <QuickListRow
              key={r.recipe_id}
              recipe={r}
              first={i === 0}
              onPress={() => router.push(`/recipe/${r.recipe_id}`)}
            />
          ))}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: space.lg,
            paddingTop: 8,
            paddingBottom: 4,
            gap: 10,
          }}
        >
          {section.recipes.map((r, i) => (
            <StripCard
              key={r.recipe_id}
              recipe={r}
              index={i}
              onPress={() => router.push(`/recipe/${r.recipe_id}`)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function StripCard({
  recipe, index, onPress,
}: {
  recipe: RecipeSummary; index: number; onPress: () => void;
}) {
  // First card in Spotlight is inverted (dark fill) for visual punch.
  const inverted = index === 0;
  const num = String(index + 1).padStart(2, '0');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: STRIP_CARD_WIDTH,
        minHeight: 180,
        padding: space.lg,
        borderRadius: radii.md,
        backgroundColor: inverted ? colors.ink : colors.paperHi,
        borderWidth: inverted ? 0 : 1,
        borderColor: colors.hairline,
        justifyContent: 'space-between',
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View>
        <Text variant="mono" onDark={inverted} style={{ marginBottom: 8, opacity: inverted ? 0.55 : 1 }}>
          № {num}
        </Text>
        <Text
          variant="h2"
          onDark={inverted}
          style={{ fontSize: 22, lineHeight: 23 }}
          numberOfLines={3}
        >
          {recipe.title}
        </Text>
      </View>
      <Text
        variant="meta"
        onDark={inverted}
        style={{ opacity: inverted ? 0.55 : 1, marginTop: 12 }}
        numberOfLines={1}
      >
        {[recipe.sauce_category_id?.replace(/-/g, ' '), `${recipe.cook_time_minutes} min`]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Pressable>
  );
}

function QuickListRow({
  recipe, first, onPress,
}: {
  recipe: RecipeSummary; first: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
        backgroundColor: pressed ? colors.bone : 'transparent',
      })}
    >
      <View style={{ minWidth: 38, flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 30,
            lineHeight: 30,
            color: colors.passata,
          }}
        >
          {recipe.cook_time_minutes}
        </Text>
        <Text variant="mono" muted style={{ marginLeft: 1, fontSize: 11 }}>
          ′
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="h3" numberOfLines={1}>{recipe.title}</Text>
        <Text variant="meta" numberOfLines={1} style={{ marginTop: 2 }}>
          {[recipe.region_id, recipe.sauce_category_id?.replace(/-/g, ' ')]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <ChevronRight />
    </Pressable>
  );
}

function ChevronRight() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 6 L15 12 L9 18"
        stroke={colors.ink30}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SearchButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.ink15,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
        <Path
          d="M11 4 a7 7 0 1 0 0 14 a7 7 0 0 0 0 -14 z M 16 16 L 21 21"
          stroke={colors.ink70}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </Svg>
    </Pressable>
  );
}
