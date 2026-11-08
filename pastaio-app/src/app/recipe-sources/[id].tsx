// src/app/recipe-sources/[id].tsx
/**
 * Per-recipe sources screen. Pushed from recipe screen's "View sources" link.
 *
 * Lists every source cited by this recipe, flat-sorted by tier
 * (descending authority), then alphabetically by source name. Each
 * source row shows: name, type label + tier, accessed date, original-
 * language excerpt, optional English translation, tap-through to URL.
 *
 * No grouping by tier — at v1 KB scale most recipes will cluster in
 * 1-2 tiers and tier-as-row-metadata reads cleaner than 1-row groups.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Text } from '@/components/primitives/Text';
import { ScreenHeader } from '@/components/primitives/ScreenHeader';
import { SourceCard } from '@/components/SourceCard';
import { colors, space } from '@/constants/theme';
import {
  getSourcesForRecipe,
  getRecipeDetails,
  type Source,
} from '@/services/kb';

export default function RecipeSourcesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [sources, setSources] = useState<Source[]>([]);
  const [recipeTitle, setRecipeTitle] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([
      getSourcesForRecipe(id),
      getRecipeDetails(id),
    ])
      .then(([s, r]) => {
        if (cancelled) return;
        setSources(s);
        setRecipeTitle(r?.title ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setSources([]);
      })
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScreenHeader title="SOURCES" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          <Text variant="mono" accent>
            Cited for
          </Text>
          <Text
            variant="display"
            style={{ fontSize: 36, lineHeight: 38, marginTop: 6 }}
          >
            {recipeTitle}
          </Text>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.passata} />
          </View>
        ) : sources.length === 0 ? (
          <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
            <Text
              variant="body"
              muted
              style={{ textAlign: 'center', fontStyle: 'italic' }}
            >
              No sources recorded for this recipe.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: space.md }}>
            {sources.map((source) => (
              <SourceCard
                key={source.source_id}
                source={source}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}