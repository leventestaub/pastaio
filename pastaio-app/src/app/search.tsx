/**
 * Search — escape hatch for users who know what they're looking for.
 *
 * Filters: free-text query (title + description), shape chips,
 * region chips, "under 25 min" quick toggle. All AND-combined.
 *
 * Client-side filtering against findRecipes(limit: 500); KB is small
 * enough this is faster than re-querying.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { ScreenHeader } from '@/components/primitives/ScreenHeader';
import { Chip } from '@/components/primitives/Chip';
import { RecipeRow } from '@/components/primitives/RecipeRow';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { findRecipes, type RecipeSummary } from '@/services/kb';

const QUICK_THRESHOLD_MIN = 25;

export default function SearchScreen() {
  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);

  const [allRecipes, setAllRecipes] = useState<RecipeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [activeShapes, setActiveShapes] = useState<Set<string>>(new Set());
  const [activeRegions, setActiveRegions] = useState<Set<string>>(new Set());
  const [quickOnly, setQuickOnly] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // 'search' isn't in the ScreenName union, but the existing code passes it.
      setCurrentScreen('search' as any);
    }, [setCurrentScreen]),
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    findRecipes({ limit: 500 })
      .then((r) => !cancelled && setAllRecipes(r))
      .catch(() => !cancelled && setAllRecipes([]))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, []);

  const { availableShapes, availableRegions } = useMemo(() => {
    const shapes = new Set<string>();
    const regions = new Set<string>();
    for (const r of allRecipes) {
      shapes.add(r.shape_id);
      if (r.region_id) regions.add(r.region_id);
    }
    return {
      availableShapes: Array.from(shapes).sort(),
      availableRegions: Array.from(regions).sort(),
    };
  }, [allRecipes]);

  const filtered = useMemo(() => {
    let result = allRecipes;
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }
    if (activeShapes.size > 0) {
      result = result.filter((r) => activeShapes.has(r.shape_id));
    }
    if (activeRegions.size > 0) {
      result = result.filter(
        (r) => r.region_id && activeRegions.has(r.region_id),
      );
    }
    if (quickOnly) {
      result = result.filter((r) => r.cook_time_minutes <= QUICK_THRESHOLD_MIN);
    }
    return result;
  }, [allRecipes, query, activeShapes, activeRegions, quickOnly]);

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScreenHeader title="SEARCH" onBack={() => router.back()} />

      <View style={{ paddingHorizontal: space.lg, paddingBottom: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: colors.paperHi,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            borderRadius: radii.md,
          }}
        >
          <SearchIcon />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search recipes…"
            placeholderTextColor={colors.ink50}
            autoCorrect={false}
            style={{
              flex: 1,
              fontFamily: fonts.sansRegular,
              fontSize: 15,
              color: colors.ink,
              paddingVertical: 0,
            }}
          />
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg, flexDirection: 'row', gap: 8 }}>
        <Chip
          label={`Under ${QUICK_THRESHOLD_MIN} min`}
          on={quickOnly}
          onPress={() => setQuickOnly((q) => !q)}
        />
      </View>

      {availableShapes.length > 0 && (
        <View>
          <Text
            variant="mono"
            style={{ paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 6 }}
          >
            Shape
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: 8 }}
          >
            {availableShapes.map((shape) => (
              <Chip
                key={shape}
                label={shape}
                on={activeShapes.has(shape)}
                onPress={() => setActiveShapes((s) => toggle(s, shape))}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {availableRegions.length > 0 && (
        <View>
          <Text
            variant="mono"
            style={{ paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 6 }}
          >
            Region
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: 8 }}
          >
            {availableRegions.map((region) => (
              <Chip
                key={region}
                label={region}
                on={activeRegions.has(region)}
                onPress={() => setActiveRegions((s) => toggle(s, region))}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <Text
        variant="mono"
        style={{ paddingHorizontal: space.lg, marginTop: 18, marginBottom: 8 }}
      >
        {filtered.length} {filtered.length === 1 ? 'recipe' : 'recipes'}
      </Text>

      {isLoading ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.passata} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: space.lg,
            paddingBottom: 100,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
        >
          {filtered.map((r) => (
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
        </ScrollView>
      )}

      <AskAffordance variant="floating" onPress={openAgentInput} />
    </View>
  );
}

function SearchIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11 4 a7 7 0 1 0 0 14 a7 7 0 0 0 0 -14 z M 16 16 L 21 21"
        stroke={colors.ink50}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
