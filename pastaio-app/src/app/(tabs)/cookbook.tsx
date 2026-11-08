/**
 * Cookbook screen — saved recipes list.
 *
 * Reads saved IDs from memoryStore, fetches summaries from KB, renders
 * RecipeRow per entry. Long-press to remove.
 *
 * Empty state branches on whether the user has cooking history. With
 * history + proactivity on, we render the sparse-cookbook starter
 * (spec proactive trigger #5): templated copy + 2-3 unseen suggestions
 * from the user's most-cooked region. Without history (or with
 * proactivity off), we render the cold empty state.
 *
 * Stale IDs (saved recipes no longer in KB) are silently dropped.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { CompactHeader } from '@/components/primitives/CompactHeader';
import { RecipeRow } from '@/components/primitives/RecipeRow';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { colors, fonts, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { getRecipeSummariesByIds, type RecipeSummary } from '@/services/kb';
import {
  buildCookbookStarter,
  type CookbookStarter,
} from '@/services/cookbookStarter';

export default function CookbookScreen() {
  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);
  const cookbook = useMemoryStore((s) => s.cookbook);
  const cookingHistory = useMemoryStore((s) => s.cookingHistory);
  const proactivityEnabled = useMemoryStore((s) => s.proactivityEnabled);
  const removeFromCookbook = useMemoryStore((s) => s.removeFromCookbook);

  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [starter, setStarter] = useState<CookbookStarter | null>(null);

  useFocusEffect(
    useCallback(() => {
      setCurrentScreen('cookbook');
    }, [setCurrentScreen]),
  );

  // Load saved recipes for the populated state.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    // Defensive dedup: if the store ever ends up with the same recipe
    // saved twice (race in saveToCookbook, replay during persist
    // hydration, etc.) we don't want to render dup React keys. Trust
    // the store but verify here at the read boundary.
    const uniqueIds = Array.from(new Set(cookbook));
    getRecipeSummariesByIds(uniqueIds)
      .then((r) => !cancelled && setRecipes(r))
      .catch(() => !cancelled && setRecipes([]))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [cookbook]);

  // Load starter only when the cookbook is empty, proactivity is on,
  // AND there's cooking history to derive a dominant region from.
  // Skip the work otherwise — no reason to query the KB for nothing.
  useEffect(() => {
    let cancelled = false;
    if (
      cookbook.length > 0 ||
      !proactivityEnabled ||
      cookingHistory.length === 0
    ) {
      setStarter(null);
      return;
    }
    buildCookbookStarter({
      cookingHistoryIds: cookingHistory.map((h) => h.recipeId),
      savedRecipeIds: cookbook,
    })
      .then((s) => !cancelled && setStarter(s))
      .catch((err) => {
        console.warn('[cookbook] starter load failed', err);
        if (!cancelled) setStarter(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cookbook, cookingHistory, proactivityEnabled]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <CompactHeader
        title="Cookbook"
        kicker={
          cookbook.length === 0
            ? 'nothing saved'
            : `${recipes.length} saved`
        }
      />

      {isLoading ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.passata} />
        </View>
      ) : recipes.length === 0 ? (
        starter ? <StarterEmpty starter={starter} /> : <EmptyState />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: space.lg,
            paddingBottom: 100,
            gap: 10,
          }}
          showsVerticalScrollIndicator={false}
        >
          {recipes.map((r) => (
            <RecipeRow
              key={r.recipe_id}
              title={r.title}
              shape={r.shape_id}
              metaParts={[
                r.region_id,
                r.sauce_category_id?.replace(/-/g, ' '),
                `${r.cook_time_minutes} min`,
              ]}
              onPress={() => router.push(`/recipe/${r.recipe_id}`)}
              onLongPress={() => removeFromCookbook(r.recipe_id)}
              right={<BookmarkFilled />}
            />
          ))}

          <Text
            variant="mono"
            dim
            style={{ textAlign: 'center', marginTop: 16 }}
          >
            long-press to remove
          </Text>
        </ScrollView>
      )}

      <AskAffordance variant="floating" onPress={openAgentInput} />
    </View>
  );
}

// Cold empty state — shown when there's no cooking history yet, or when
// proactivity is off. Keeps the original copy from FUNCTIONALITY_MAP.md.
function EmptyState() {
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 40, alignItems: 'center' }}>
      <Text
        variant="display"
        style={{ fontSize: 28, lineHeight: 28, marginBottom: 14, textAlign: 'center' }}
      >
        Nothing saved yet.
      </Text>
      <Text variant="body" style={{ textAlign: 'center', marginBottom: 24 }}>
        Save recipes from Discover or after cooking — they'll live here.
      </Text>
      <Pressable
        onPress={() => router.push('/(tabs)/discover')}
        style={({ pressed }) => ({
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
          borderRadius: 999,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text
          style={{
            fontFamily: fonts.sansMedium,
            fontSize: 14,
            color: colors.ink,
          }}
        >
          Browse Discover
        </Text>
      </Pressable>
    </View>
  );
}

// Sparse-cookbook starter — spec proactive trigger #5. Renders templated
// copy referencing the user's most-cooked region plus 2-3 unseen
// suggestions. Tap a row to push the Recipe screen.
function StarterEmpty({ starter }: { starter: CookbookStarter }) {
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: space.lg,
        paddingTop: 24,
        paddingBottom: 100,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ paddingHorizontal: 4, marginBottom: 24 }}>
        <Text variant="mono">a few to start</Text>
        <Text
          variant="display"
          style={{
            fontSize: 30,
            lineHeight: 32,
            marginTop: 8,
          }}
        >
          You've been cooking {starter.dominantRegionName} dishes — here are a few you might want to save for next time.
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        {starter.suggestions.map((r) => (
          <RecipeRow
            key={r.recipe_id}
            title={r.title}
            shape={r.shape_id}
            metaParts={[
              r.region_id,
              r.sauce_category_id?.replace(/-/g, ' '),
              `${r.cook_time_minutes} min`,
            ]}
            onPress={() => router.push(`/recipe/${r.recipe_id}`)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function BookmarkFilled() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path
        d="M6 3 L18 3 L18 21 L12 17 L6 21 Z"
        fill={colors.passata}
      />
    </Svg>
  );
}