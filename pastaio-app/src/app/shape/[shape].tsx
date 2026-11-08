/**
 * Shape results — recipes for an identified shape.
 *
 * Editorial layout per prototype:
 *   - "From {region}" kicker in passata
 *   - Display title at 48pt with a smaller "recipes." descender below
 *   - Suggest-tinted Banner with templated proactive note
 *   - List of recipe rows
 *
 * Proactive note rules unchanged from the existing implementation —
 * memory-aware copy decided locally based on shape's region and the
 * dominant region in recent cooking history.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';

import { Text } from '@/components/primitives/Text';
import { ScreenHeader } from '@/components/primitives/ScreenHeader';
import { RecipeRow } from '@/components/primitives/RecipeRow';
import { Banner } from '@/components/primitives/Banner';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { useMemoryStore } from '@/stores/memoryStore';
const setActiveShape = useSessionStore((s) => s.setActiveShape);
import {
  findRecipes,
  getShape,
  getRecipeSummariesByIds,
  type RecipeSummary,
  type ShapeDetails,
} from '@/services/kb';

export default function ShapeResultsScreen() {
  const { shape: shapeId } = useLocalSearchParams<{ shape: string }>();

  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);
  const cookingHistory = useMemoryStore((s) => s.cookingHistory);

  const [shape, setShape] = useState<ShapeDetails | null>(null);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [recentSummaries, setRecentSummaries] = useState<RecipeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      // 'identify' reused — there's no 'shape' in ScreenName. Existing behavior.
      setCurrentScreen('identify');
      setActiveShape(shapeId);
      return () => setActiveShape(null);
    }, [shapeId, setCurrentScreen, setActiveShape]),
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([
      getShape(shapeId).catch(() => null),
      findRecipes({ shape_id: shapeId, limit: 20 }),
    ])
      .then(([s, r]) => {
        if (cancelled) return;
        setShape(s);
        setRecipes(r);
      })
      .catch(() => {
        if (cancelled) return;
        setShape(null);
        setRecipes([]);
      })
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [shapeId]);

  useEffect(() => {
    let cancelled = false;
    const recentIds = Array.from(new Set(cookingHistory.map((h) => h.recipeId))).slice(0, 5);
    if (recentIds.length === 0) {
      setRecentSummaries([]);
      return;
    }
    getRecipeSummariesByIds(recentIds)
      .then((s) => !cancelled && setRecentSummaries(s))
      .catch(() => !cancelled && setRecentSummaries([]));
    return () => { cancelled = true; };
  }, [cookingHistory]);

  const proactiveNote = useMemo(
    () => (shape ? buildProactiveNote(shape, recentSummaries) : null),
    [shape, recentSummaries],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScreenHeader title="SHAPE" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          {shape?.region_canonical_name && (
            <Text variant="mono" accent>
              From {shape.region_canonical_name}
            </Text>
          )}
          <Text
            variant="display"
            style={{ fontSize: 48, lineHeight: 48, marginTop: 6 }}
          >
            {shape?.canonical_name ?? shapeId}
          </Text>
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              fontSize: 28,
              lineHeight: 30,
              color: colors.ink50,
              marginTop: 4,
            }}
          >
            recipes.
          </Text>
        </View>

        {proactiveNote && (
          <Banner
            tint="suggest"
            title={proactiveNote.title}
            sub={proactiveNote.sub}
          />
        )}

        {isLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.passata} />
          </View>
        ) : recipes.length === 0 ? (
          <View style={{ paddingHorizontal: 24, paddingTop: 40, alignItems: 'center' }}>
            <Text variant="body" muted style={{ textAlign: 'center', fontStyle: 'italic' }}>
              No recipes for this shape in the knowledge base yet.
            </Text>
          </View>
        ) : (
          <View
            style={{
              marginHorizontal: 16,
              backgroundColor: colors.paperHi,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              overflow: 'hidden',
            }}
          >
            {recipes.map((r, i) => (
              <View
                key={r.recipe_id}
                style={{
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <RecipeRow
                  embedded
                  title={r.title}
                  shape={r.shape_id}
                  metaParts={[
                    r.region_id,
                    r.sauce_category_id?.replace(/-/g, ' '),
                    `${r.cook_time_minutes} min`,
                  ]}
                  onPress={() => router.push(`/recipe/${r.recipe_id}`)}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <AskAffordance variant="floating" onPress={openAgentInput} />
    </View>
  );
}

// Same proactive logic as existing shape screen, returning split title+sub.
function buildProactiveNote(
  shape: ShapeDetails,
  recent: RecipeSummary[],
): { title: string; sub: string } | null {
  if (!shape.region_id) {
    if (shape.traditional_sauces.length > 0) {
      const sauces = shape.traditional_sauces
        .map((s) => s.replace(/-/g, ' '))
        .join(' or ');
      return {
        title: `Pairs traditionally with ${sauces} sauces.`,
        sub: 'Tradition, not a rule',
      };
    }
    return null;
  }

  if (recent.length === 0) {
    return shape.region_canonical_name
      ? {
          title: `${shape.region_canonical_name} cooking is a great place to start.`,
          sub: 'Cold start — try anything',
        }
      : null;
  }

  const regionCounts = new Map<string, number>();
  for (const r of recent) {
    if (r.region_id) {
      regionCounts.set(r.region_id, (regionCounts.get(r.region_id) ?? 0) + 1);
    }
  }
  let dominantRegion: string | null = null;
  let dominantCount = 0;
  for (const [region, count] of regionCounts) {
    if (count > dominantCount) {
      dominantRegion = region;
      dominantCount = count;
    }
  }

  if (dominantRegion === shape.region_id && shape.region_canonical_name) {
    return {
      title: `Continuing your ${shape.region_canonical_name} streak.`,
      sub: "You've cooked from this region before",
    };
  }

  if (
    dominantRegion &&
    dominantRegion !== shape.region_id &&
    shape.region_canonical_name
  ) {
    const dominantPretty =
      dominantRegion.charAt(0).toUpperCase() + dominantRegion.slice(1);
    return {
      title: `You've been cooking ${dominantPretty} recently.`,
      sub: `Try something from ${shape.region_canonical_name}`,
    };
  }

  return null;
}
