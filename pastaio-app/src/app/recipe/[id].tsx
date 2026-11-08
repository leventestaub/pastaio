/**
 * Recipe screen (pushed, dynamic).
 *
 * Editorial layout per prototype:
 *   - ScreenHeader with region kicker + bookmark toggle right
 *   - Sauce/time/serves kicker line in passata
 *   - Display-italic title at 44pt
 *   - Body description
 *   - RestrictionConflictBanner (warning tint, taps to agent)
 *   - Active substitutions card (passata left border)
 *   - Ingredients list with passata bullet, override notation
 *   - Method with passata numerals
 *   - "Start cooking" primary + Ask Pastaio inline affordance
 *
 * Sets activeRecipeId in sessionStore on focus so the agent knows which
 * recipe is being viewed (load-bearing for hero substitution query).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { ScreenHeader } from '@/components/primitives/ScreenHeader';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { ExpandableSection } from '@/components/primitives/ExpandableSection';
import { RestrictionConflictBanner } from '@/components/RestrictionConflictBanner';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { useCookingStore } from '@/stores/cookingStore';
import { getRecipeDetails, type RecipeDetails } from '@/services/kb';
import { resolveRegionName } from '@/services/discover';

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const setActiveRecipeId = useSessionStore((s) => s.setActiveRecipeId);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);
  const saveToCookbook = useMemoryStore((s) => s.saveToCookbook);
  const removeFromCookbook = useMemoryStore((s) => s.removeFromCookbook);
  const isInCookbook = useMemoryStore((s) => s.cookbook.includes(id));
  const startCooking = useCookingStore((s) => s.startCooking);
  const overrides = useCookingStore((s) => s.ingredientOverrides);

  const [recipe, setRecipe] = useState<RecipeDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [regionName, setRegionName] = useState<string>('');

  useFocusEffect(
      useCallback(() => {
        setCurrentScreen('recipe');
        setActiveRecipeId(id);
        return () => setActiveRecipeId(null);
      }, [id, setCurrentScreen, setActiveRecipeId]),
    );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    getRecipeDetails(id)
      .then(async (r) => {
        if (cancelled) return;
        if (!r) {
          setLoadError(`Recipe '${id}' not found in KB`);
          return;
        }
        setRecipe(r);
        const name = await resolveRegionName(r.region_id).catch(() => '');
        if (!cancelled) setRegionName(name);
      })
      .catch((e) => !cancelled && setLoadError(String(e)))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [id]);

  const handleStartCooking = () => {
    startCooking(id);
    router.push(`/cooking/${id}`);
  };

  const handleToggleSave = () => {
    if (isInCookbook) removeFromCookbook(id);
    else saveToCookbook(id);
  };

  const ingredientLines = useMemo(() => {
    if (!recipe) return [];
    return recipe.ingredients.map((ing) => {
      const override = overrides.find((o) =>
        ing.name.toLowerCase().includes(o.original.toLowerCase()),
      );
      return { ing, override };
    });
  }, [recipe, overrides]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.passata} />
      </View>
    );
  }

  if (loadError || !recipe) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <ScreenHeader title="RECIPE" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
          <Text variant="display" style={{ fontSize: 28, lineHeight: 30, marginBottom: 10 }}>
            Recipe not found.
          </Text>
          <Text variant="body" muted style={{ textAlign: 'center' }}>
            {loadError ?? `id: ${id}`}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScreenHeader
        title={(regionName || recipe.region_id || '').toUpperCase() || undefined}
        onBack={() => router.back()}
        right={
          <Pressable onPress={handleToggleSave} hitSlop={10}>
            <BookmarkIcon filled={isInCookbook} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20 }}>
          <Text variant="mono" accent>
            {[
              recipe.sauce_category_id?.replace(/-/g, ' '),
              `${recipe.cook_time_minutes} min`,
              `serves ${recipe.serves}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          <Text
            variant="display"
            style={{ fontSize: 44, lineHeight: 44, marginTop: 6, marginBottom: 14 }}
          >
            {recipe.title}
          </Text>

          <Text variant="body" style={{ marginBottom: 8 }}>
            {recipe.description}
          </Text>

          {recipe.traditional_notes && recipe.traditional_notes.trim().length > 0 && (
            <ExpandableSection title="Tradition & context">
              <Text variant="body" style={{ lineHeight: 24 }}>
                {recipe.traditional_notes.trim()}
              </Text>
            </ExpandableSection>
          )}
        </View>

        <RestrictionConflictBanner ingredients={recipe.ingredients} />

        {overrides.length > 0 && (
          <View style={{
            marginHorizontal: 16,
            marginTop: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
            backgroundColor: colors.paperHi,
            borderRadius: radii.md,
            borderLeftWidth: 3,
            borderLeftColor: colors.passata,
          }}>
            <Text variant="mono" style={{ marginBottom: 6 }}>
              Active substitutions
            </Text>
            {overrides.map((o, i) => (
              <Text
                key={i}
                style={{
                  fontFamily: fonts.sansRegular,
                  fontSize: 13,
                  color: colors.ink70,
                  lineHeight: 19,
                }}
              >
                {o.original} → {o.replacement}
              </Text>
            ))}
          </View>
        )}

        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Text variant="mono">Ingredients</Text>
          <View style={{ marginTop: 12 }}>
            {ingredientLines.map(({ ing, override }, i) => {
              const last = i === ingredientLines.length - 1;
              const displayName = override
                ? override.replacement
                : `${formatAmount(ing.amount, ing.unit)} ${ing.name}`;
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 8,
                    borderBottomWidth: last ? 0 : 1,
                    borderBottomColor: colors.hairline,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.passata,
                      flexShrink: 0,
                    }}
                  />
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: fonts.sansRegular,
                      fontSize: 15,
                      lineHeight: 21,
                      color: colors.ink70,
                    }}
                  >
                    {override
                      ? `${formatAmount(ing.amount, ing.unit)} ${displayName}`
                      : displayName}
                    {ing.notes && !override ? (
                      <Text variant="meta" style={{ color: colors.ink50 }}>
                        {' — ' + ing.notes}
                      </Text>
                    ) : null}
                  </Text>
                  {override && (
                    <Text
                      variant="meta"
                      style={{ marginLeft: 'auto', color: colors.ink50 }}
                      numberOfLines={1}
                    >
                      was {ing.name}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Text variant="mono">Method</Text>
          <View style={{ marginTop: 12, gap: 14 }}>
            {recipe.steps.map((s) => (
              <View
                key={s.order}
                style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}
              >
                <Text
                  style={{
                    fontFamily: fonts.displayItalic,
                    fontSize: 28,
                    lineHeight: 28,
                    color: colors.passata,
                    minWidth: 28,
                  }}
                >
                  {s.order}
                </Text>
                <Text variant="body" style={{ flex: 1, paddingTop: 4 }}>
                  {s.text.trim()}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 32, gap: 10 }}>
          <Pressable
            onPress={handleStartCooking}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 14,
              backgroundColor: colors.passata,
              borderRadius: radii.md,
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: fonts.sansSemibold,
                fontSize: 15,
                color: colors.bone,
              }}
            >
              Start cooking
            </Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path
                d="M5 12 H 18 M 13 6 L 19 12 L 13 18"
                stroke={colors.bone}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>

          <AskAffordance variant="inline" onPress={openAgentInput} />
        </View>

        <Pressable
          onPress={() => router.push(`/recipe-sources/${id}`)}
          style={({ pressed }) => ({
            paddingHorizontal: 20,
            paddingTop: 28,
            paddingBottom: 8,
            opacity: pressed ? 0.6 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          })}
        >
          <Text variant="mono" muted>
            View sources
          </Text>
          <Text variant="mono" muted>›</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function formatAmount(amount: number | null, unit: string | null): string {
  if (amount === null || amount === undefined) {
    return unit ?? '';
  }
  const a = Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  if (!unit) return a;
  return `${a} ${unit}`;
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d="M6 3 L18 3 L18 21 L12 17 L6 21 Z" fill={colors.passata} />
      </Svg>
    );
  }
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3 L18 3 L18 21 L12 17 L6 21 Z"
        stroke={colors.ink}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
