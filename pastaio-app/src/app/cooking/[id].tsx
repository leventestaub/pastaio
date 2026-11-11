/**
 * Cooking screen — immersive cooking flow.
 *
 * Visual:
 *   - Custom header: End cooking (left) / Step N of M (center) / Ask pill (right)
 *   - Active timer card (ink fill or passata when done)
 *   - Giant ghosted "01" numeral behind italic step text
 *   - Inline pill button to start the step's timer (when present)
 *   - Idle help banner after 8s (FUNCTIONALITY_MAP §6 trigger 3)
 *   - Ingredient drawer (collapsible, sticky-bottom)
 *   - Bottom nav: Previous / Next step (or Done on last step)
 *
 * End cooking confirms via platform alert. Done on last step records
 * the cook in memory history before dismissing.
 *
 * Tab bar hidden + back gesture disabled at the navigator level.
 *
 * Header reads useSafeAreaInsets so its content (End/Step/Ask) sits
 * below the Dynamic Island / status bar.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { Banner } from '@/components/primitives/Banner';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { useCookingStore } from '@/stores/cookingStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { getRecipeDetails, type RecipeDetails } from '@/services/kb';
import { ingredientName } from '@/constants/ingredientNames';

const IDLE_HELP_MS = 8000;

// Header padding *after* the safe area inset.
const HEADER_PAD_TOP = 8;
const HEADER_PAD_BOTTOM = 14;

// Bottom nav padding *after* the bottom safe area inset (home indicator).
const BOTTOM_NAV_PAD_BOTTOM = 12;

export default function CookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const setCookingStep = useSessionStore((s) => s.setCookingStep);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);

  const currentStepIndex = useCookingStore((s) => s.currentStepIndex);
  const overrides = useCookingStore((s) => s.ingredientOverrides);
  const nextStep = useCookingStore((s) => s.nextStep);
  const previousStep = useCookingStore((s) => s.previousStep);
  const startTimer = useCookingStore((s) => s.startTimer);
  const cancelTimer = useCookingStore((s) => s.cancelTimer);
  const endCooking = useCookingStore((s) => s.endCooking);
  const timers = useCookingStore((s) => s.timers);

  const recordCooking = useMemoryStore((s) => s.recordCooking);

  const [recipe, setRecipe] = useState<RecipeDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showIdle, setShowIdle] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setCurrentScreen('cooking');
      return () => setCookingStep(null);
    }, [setCurrentScreen, setCookingStep]),
  );

  // Keep the agent's view of "this step" in sync with the screen.
  useEffect(() => {
    if (!recipe || recipe.steps.length === 0) return;
    const index = Math.max(0, Math.min(currentStepIndex, recipe.steps.length - 1));
    setCookingStep({
      number: index + 1,
      total: recipe.steps.length,
      text: recipe.steps[index].text,
    });
  }, [recipe, currentStepIndex, setCookingStep]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    getRecipeDetails(id)
      .then((r) => {
        if (cancelled) return;
        if (!r) setLoadError(`Recipe '${id}' not found in KB`);
        else setRecipe(r);
      })
      .catch((e) => !cancelled && setLoadError(String(e)))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    setShowIdle(false);
    const t = setTimeout(() => setShowIdle(true), IDLE_HELP_MS);
    return () => clearTimeout(t);
  }, [currentStepIndex]);

  const handleEnd = () => {
    Alert.alert(
      'End this cooking session?',
      'You can rate the recipe afterward.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End',
          style: 'destructive',
          onPress: () => {
            recordCooking({ recipeId: id, cookedAt: Date.now() });
            endCooking();
            router.dismissAll();
          },
        },
      ],
    );
  };

  const handleNextOrDone = () => {
    if (!recipe) return;
    const isLast = currentStepIndex >= recipe.steps.length - 1;
    if (isLast) {
      recordCooking({ recipeId: id, cookedAt: Date.now() });
      endCooking();
      router.dismissAll();
    } else {
      nextStep();
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.passata} />
      </View>
    );
  }

  if (loadError || !recipe) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, padding: space.lg, paddingTop: insets.top + 40, justifyContent: 'center' }}>
        <Text variant="display" style={{ fontSize: 28, lineHeight: 30, marginBottom: 8 }}>
          Cannot start cooking.
        </Text>
        <Text variant="body" muted style={{ marginBottom: 24 }}>
          {loadError ?? `id: ${id}`}
        </Text>
        <Pressable
          onPress={() => router.dismissAll()}
          style={{ paddingVertical: 12, borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: radii.md, alignItems: 'center' }}
        >
          <Text variant="body">Back to home</Text>
        </Pressable>
      </View>
    );
  }

  const stepCount = recipe.steps.length;
  const safeIndex = Math.max(0, Math.min(currentStepIndex, stepCount - 1));
  const step = recipe.steps[safeIndex];
  const isLast = safeIndex >= stepCount - 1;
  const stepNum = String(safeIndex + 1).padStart(2, '0');

  const activeTimer = timers[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* Header — clears Dynamic Island via safe-area inset */}
      <View
        style={{
          paddingTop: insets.top + HEADER_PAD_TOP,
          paddingHorizontal: space.lg,
          paddingBottom: HEADER_PAD_BOTTOM,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Pressable onPress={handleEnd} hitSlop={8}>
          <Text variant="body" muted style={{ fontSize: 13 }}>
            End cooking
          </Text>
        </Pressable>
        <Text variant="mono">
          Step {safeIndex + 1} of {stepCount}
        </Text>
        <AskAffordance variant="header" onPress={openAgentInput} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 220 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTimer && (
          <ActiveTimerCard
            timer={activeTimer}
            onCancel={() => cancelTimer(activeTimer.id)}
          />
        )}

        <View style={{ paddingHorizontal: 24, paddingTop: 40, paddingBottom: 80 }}>
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              // lineHeight must be >= fontSize on iOS or the glyph's
              // ascent extends above the line box and gets clipped by
              // the parent ScrollView's overflow boundary. Visual
              // tightness comes from marginBottom on this Text + the
              // container's overflow context, not from a tight lineHeight.
              fontSize: 110,
              lineHeight: 116,
              color: colors.passata,
              opacity: 0.18,
              marginBottom: -56,
            }}
          >
            {stepNum}
          </Text>
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              fontSize: 30,
              lineHeight: 36,
              letterSpacing: -0.3,
              color: colors.ink,
            }}
          >
            {step.text.trim()}
          </Text>

          {step.timer_seconds && step.timer_seconds > 0 && !activeTimer && (
            <Pressable
              onPress={() =>
                startTimer({
                  durationMinutes: Math.round(step.timer_seconds! / 60),
                  label: `step ${safeIndex + 1}`,
                })
              }
              style={({ pressed }) => ({
                marginTop: 26,
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 12,
                paddingHorizontal: 18,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                borderRadius: 999,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <TimerIcon size={16} color={colors.passata} />
              <Text variant="body" style={{ fontSize: 14 }}>
                Start {Math.floor(step.timer_seconds / 60)}-min timer
              </Text>
            </Pressable>
          )}
        </View>

        {showIdle && (
          <Banner
            tint="help"
            title="Stuck on this step?"
            sub="Ask Pastaio"
            onPress={openAgentInput}
          />
        )}
      </ScrollView>

      {/* Drawer toggle (sticky above the bottom nav). Position derives
          from the same insets-aware bottom calc so it lifts off the home
          indicator on iPhone. */}
      <Pressable
        onPress={() => setDrawerOpen((v) => !v)}
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 70 + insets.bottom + BOTTOM_NAV_PAD_BOTTOM,
          backgroundColor: colors.paperHi,
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: radii.md,
          paddingVertical: 10,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text variant="mono">Ingredients</Text>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Path
            d={drawerOpen ? 'M6 9 L12 15 L18 9' : 'M6 15 L12 9 L18 15'}
            stroke={colors.ink70}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>

      {drawerOpen && (
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 70 + insets.bottom + BOTTOM_NAV_PAD_BOTTOM + 50,
            backgroundColor: colors.paperHi,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radii.md,
            paddingVertical: 14,
            paddingHorizontal: 16,
            maxHeight: 280,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: -8 },
            elevation: 8,
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            {recipe.ingredients.map((ing, i) => {
              const override = overrides.find((o) =>
                ing.name.toLowerCase().includes(o.original.toLowerCase()),
              );
              const last = i === recipe.ingredients.length - 1;
              return (
                <View
                  key={i}
                  style={{
                    paddingVertical: 6,
                    borderBottomWidth: last ? 0 : 1,
                    borderBottomColor: colors.hairline,
                  }}
                >
                  <Text variant="body" style={{ fontSize: 13, color: colors.ink70 }}>
                    {override
                      ? `${override.replacement} (was ${ingredientName(ing.name)})`
                      : ingredientName(ing.name)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Bottom nav — adds bottom inset for home indicator on iPhone. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + BOTTOM_NAV_PAD_BOTTOM,
          flexDirection: 'row',
          gap: 10,
          backgroundColor: colors.paper,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
        }}
      >
        <Pressable
          onPress={previousStep}
          disabled={safeIndex === 0}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 14,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            borderRadius: radii.md,
            alignItems: 'center',
            opacity: safeIndex === 0 ? 0.4 : pressed ? 0.7 : 1,
          })}
        >
          <Text variant="body" style={{ fontFamily: fonts.sansMedium }}>
            Previous
          </Text>
        </Pressable>
        <Pressable
          onPress={handleNextOrDone}
          style={({ pressed }) => ({
            flex: 2,
            paddingVertical: 14,
            backgroundColor: colors.passata,
            borderRadius: radii.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
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
            {isLast ? 'Done' : 'Next step'}
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
      </View>
    </View>
  );
}

function ActiveTimerCard({
  timer,
  onCancel,
}: {
  timer: { id: string; durationMinutes: number; label?: string; startedAt: number };
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const totalSec = timer.durationMinutes * 60;
  const elapsedSec = Math.floor((now - timer.startedAt) / 1000);
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const done = remainingSec === 0;
  const fmt = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}`;

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 14,
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: radii.md,
        backgroundColor: done ? colors.passata : colors.ink,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View>
        <Text variant="mono" onDark style={{ opacity: 0.7 }}>
          {done ? 'Time' : timer.label ?? 'Timer'}
        </Text>
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 32,
            // Explicit lineHeight prevents iOS clipping italic ascenders.
            lineHeight: 38,
            color: colors.bone,
            marginTop: 2,
          }}
        >
          {fmt}
        </Text>
      </View>
      <Pressable
        onPress={onCancel}
        style={({ pressed }) => ({
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          borderRadius: radii.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text variant="body" onDark style={{ fontSize: 13 }}>
          {done ? 'Dismiss' : 'Cancel'}
        </Text>
      </Pressable>
    </View>
  );
}

function TimerIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 7 v 5 l 3 3 M 5 12 a 7 7 0 1 0 14 0 a 7 7 0 0 0 -14 0 z M 9 3 H 15"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
