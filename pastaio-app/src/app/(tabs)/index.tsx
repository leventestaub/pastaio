// Home tab — editorial redesign per the design pass.
//
// Hero states (FUNCTIONALITY_MAP §3.1, in priority order):
//   - mid-cook : there's an active cooking session
//   - rate     : just finished cooking and haven't rated yet
//   - warm     : cooking history exists, normal landing
//   - cold     : no cooking history yet
//
// Below the hero: Stamp/Viewfinder action tiles (hidden on rate, so the
// rating prompt isn't competing for attention) and a Last Cooked list
// (hidden if no history).
//
// All KB reads are async — wrapped in useEffect with a mounted-flag guard.
// Hydration of memoryStore is gated via useMemoryHydrated() to avoid
// flashing cold-start UI on every reload.

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Pressable, TextInput } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { PastaSigil } from '@/components/primitives/PastaSigil';
import { TonightCard, TonightCardPlaceholder } from '@/components/home/TonightCard';
import { StampTile } from '@/components/home/StampTile';
import { ViewfinderTile } from '@/components/home/ViewfinderTile';
import { colors, fonts, space, radii } from '@/constants/theme';

import { useMemoryStore, useMemoryHydrated } from '@/stores/memoryStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useCookingStore } from '@/stores/cookingStore';

import {
  findTonightPick,
  deriveRecentMetadata,
  resolveRegionName,
  type TonightPick,
} from '@/services/discover';
import {
  getRecipeDetails,
  getRecipeSummariesByIds,
  type RecipeDetails,
  type RecipeSummary,
} from '@/services/kb';
import type { CookingHistoryEntry } from '@/types';

type HeroState = 'mid-cook' | 'rate' | 'warm' | 'cold';
const ONE_HOUR_MS = 60 * 60 * 1000;

export default function HomeScreen() {
  const router = useRouter();
  const hydrated = useMemoryHydrated();
  const cookingHistory = useMemoryStore((s) => s.cookingHistory);
  const proactivityEnabled = useMemoryStore((s) => s.proactivityEnabled);
  const lastRatingPromptDismissedFor = useMemoryStore(
    (s) => s.lastRatingPromptDismissedFor,
  );
  const cookingRecipeId = useCookingStore((s) => s.cookingRecipeId);
  const currentStepIndex = useCookingStore((s) => s.currentStepIndex);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);
  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);

  // Tell session store we're on Home (used in ChatContext)
  useFocusEffect(
    React.useCallback(() => {
      setCurrentScreen('home');
    }, [setCurrentScreen]),
  );

  const heroState: HeroState = useMemo(() => {
    if (cookingRecipeId) return 'mid-cook';

    // Rate-prompt eligibility: most-recent cook must be unrated, within the
    // 1-hour window, not previously dismissed for this recipe, and the
    // proactivity setting must be on. Each gate exists for a different
    // reason — comments inline.
    const last = cookingHistory[0];
    const eligibleForRate =
      // Must have a cook entry at all
      last !== undefined &&
      // Must not be rated already
      last.rating === undefined &&
      // Spec §6.4: "within the last hour"
      Date.now() - last.cookedAt < ONE_HOUR_MS &&
      // User dismissed this prompt — respect that until window expires
      last.recipeId !== lastRatingPromptDismissedFor &&
      // Global proactivity kill-switch (Memory tab)
      proactivityEnabled;

    if (eligibleForRate) return 'rate';
    return cookingHistory.length > 0 ? 'warm' : 'cold';
  }, [
    cookingRecipeId,
    cookingHistory,
    lastRatingPromptDismissedFor,
    proactivityEnabled,
  ]);

  // Hydration gate: render nothing until persist middleware has loaded.
  // Brief — typically a single frame — but prevents flicker from cold-start
  // UI on every reload.
  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  const goIdentify = () => router.push('/identify');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <Header onMenuPress={openAgentInput} />

      <View style={{ paddingHorizontal: space.lg }}>
        {heroState === 'mid-cook' && (
          <MidCookHero
            recipeId={cookingRecipeId!}
            stepIndex={currentStepIndex}
            onResume={() => router.push(`/cooking/${cookingRecipeId}`)}
          />
        )}
        {heroState === 'rate' && <RateHero entry={cookingHistory[0]} />}
        {(heroState === 'warm' || heroState === 'cold') && (
          <TonightHero
            cold={heroState === 'cold'}
            cookingHistory={cookingHistory}
            onCook={(id) => router.push(`/recipe/${id}`)}
          />
        )}

        {heroState !== 'rate' && (
          <ActionTiles onAsk={openAgentInput} onIdentify={goIdentify} />
        )}

        {cookingHistory.length > 0 && (
          <LastCooked
            history={cookingHistory.slice(0, 3)}
            onPick={(id) => router.push(`/recipe/${id}`)}
          />
        )}
      </View>
    </ScrollView>
  );
}

// ─── Compact Header ─────────────────────────────────────────────

function Header({ onMenuPress }: { onMenuPress: () => void }) {
  const insets = useSafeAreaInsets();
  const today = new Date()
    .toLocaleDateString('en', { weekday: 'long' })
    .toLowerCase();
  const hour = new Date().getHours();
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: space.lg + 4,
        // insets.top clears the Dynamic Island / status bar; the +12pt
        // is the visual breathing room past the bar (matches CompactHeader).
        paddingTop: insets.top + 12,
        paddingBottom: 22,
      }}
    >
      <View>
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 26,
            lineHeight: 26,
            color: colors.ink,
          }}
        >
          Pastaio
        </Text>
        <Text variant="mono" style={{ marginTop: 6 }}>
          {today} {period}
        </Text>
      </View>

      <Pressable
        onPress={onMenuPress}
        hitSlop={8}
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.ink15,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12h.01M12 12h.01M19 12h.01"
            stroke={colors.ink70}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
}

// ─── Hero variants ──────────────────────────────────────────────

function TonightHero({
  cold,
  cookingHistory,
  onCook,
}: {
  cold: boolean;
  cookingHistory: CookingHistoryEntry[];
  onCook: (id: string) => void;
}) {
  const [pick, setPick] = useState<TonightPick | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ids = cookingHistory.map((h) => h.recipeId);
        const meta = await deriveRecentMetadata(ids);
        const result = await findTonightPick({
          cookingHistoryIds: ids,
          recentRegions: meta.recentRegions,
          recentShapes: meta.recentShapes,
        });
        if (mounted) {
          setPick(result);
          setLoaded(true);
        }
      } catch (err) {
        console.warn('[home] tonight load failed', err);
        if (mounted) setLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, [cookingHistory]);

  if (!loaded) return <TonightCardPlaceholder />;
  if (!pick) return null;

  return (
    <TonightCard
      title={pick.recipe.title}
      region={pick.regionDisplayName}
      cookTimeMin={pick.recipe.cook_time_minutes}
      serves={pick.recipe.serves}
      shape={pick.recipe.shape_id}
      body={cold ? 'A simple place to begin.' : pick.bodyCopy}
      onPress={() => onCook(pick.recipe.recipe_id)}
    />
  );
}

function MidCookHero({
  recipeId,
  stepIndex,
  onResume,
}: {
  recipeId: string;
  stepIndex: number;
  onResume: () => void;
}) {
  const [details, setDetails] = useState<RecipeDetails | null>(null);

  useEffect(() => {
    let mounted = true;
    getRecipeDetails(recipeId).then((d) => {
      if (mounted) setDetails(d);
    }).catch((e) => console.warn('[home] mid-cook load failed', e));
    return () => { mounted = false; };
  }, [recipeId]);

  if (!details) {
    return (
      <View style={{ marginTop: 6 }}>
        <Text variant="mono" style={{ paddingHorizontal: 4 }}>cooking now</Text>
        <View
          style={{
            marginTop: 12,
            backgroundColor: colors.ink,
            borderRadius: radii.md,
            minHeight: 140,
          }}
        />
      </View>
    );
  }

  const stepCount = details.steps.length;

  return (
    <View style={{ marginTop: 6 }}>
      <Text variant="mono" style={{ paddingHorizontal: 4 }}>cooking now</Text>
      <View
        style={{
          marginTop: 12,
          backgroundColor: colors.ink,
          borderRadius: radii.md,
          padding: 22,
          paddingVertical: 24,
        }}
      >
        <Text variant="mono" onDark style={{ opacity: 0.55 }}>
          step {stepIndex + 1} of {stepCount}
        </Text>
        <Text
          variant="display"
          onDark
          style={{ fontSize: 46, lineHeight: 44, marginTop: 10, marginBottom: 18 }}
        >
          {details.title}
        </Text>
        <Pressable onPress={onResume}>
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              fontSize: 22,
              color: colors.bone,
              textDecorationLine: 'underline',
              textDecorationColor: colors.bone,
            }}
          >
            Resume cooking →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Spec proactive trigger #4: prompt user to rate within 1 hour of
// finishing a cook. Star tap sets local state (visual feedback before
// commit). Save submits with optional note. Skip persists a dismissal
// flag so the prompt doesn't reappear within the same window.
function RateHero({ entry }: { entry: CookingHistoryEntry }) {
  const rateCooking = useMemoryStore((s) => s.rateCooking);
  const dismissRatingPromptFor = useMemoryStore(
    (s) => s.dismissRatingPromptFor,
  );
  const [details, setDetails] = useState<RecipeDetails | null>(null);
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    getRecipeDetails(entry.recipeId)
      .then((d) => {
        if (mounted) setDetails(d);
      })
      .catch((e) => console.warn('[home] rate load failed', e));
    return () => {
      mounted = false;
    };
  }, [entry.recipeId]);

  if (!details) {
    return <View style={{ marginTop: 6, paddingHorizontal: 8, height: 220 }} />;
  }

  const handleSave = () => {
    if (rating === 0) return;
    rateCooking(entry.recipeId, rating, note.trim() || undefined);
  };

  const handleSkip = () => {
    dismissRatingPromptFor(entry.recipeId);
  };

  return (
    <View style={{ marginTop: 6, paddingHorizontal: 8 }}>
      <Text variant="mono">just cooked</Text>
      <Text
        variant="display"
        style={{ fontSize: 44, lineHeight: 42, marginTop: 6, marginBottom: 18 }}
      >
        How was the {details.title.toLowerCase()}?
      </Text>

      {/* Star row */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => setRating(n as 1 | 2 | 3 | 4 | 5)}
            hitSlop={8}
          >
            {n <= rating ? <StarFilled /> : <StarOutline />}
          </Pressable>
        ))}
      </View>

      {/* Note input — appears only after a rating is picked. Keeps the
          empty state minimal and avoids a wide blank input above an
          un-engaged star row. Capped at 280 chars. */}
      {rating > 0 && (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="A note for next time (optional)"
          placeholderTextColor={colors.ink50}
          multiline
          maxLength={280}
          style={{
            fontFamily: fonts.sansRegular,
            fontSize: 14,
            color: colors.ink,
            marginTop: 18,
            paddingTop: 12,
            paddingBottom: 8,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            minHeight: 36,
          }}
        />
      )}

      {/* Action row — Save (only when rating chosen) + Skip (always). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          marginTop: rating > 0 ? 14 : 22,
        }}
      >
        {rating > 0 && (
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => ({
              backgroundColor: colors.passata,
              paddingHorizontal: 18,
              paddingVertical: 10,
              borderRadius: radii.sm,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: fonts.sansMedium,
                fontSize: 14,
                color: colors.onAperol,
              }}
            >
              Save rating
            </Text>
          </Pressable>
        )}
        <Pressable onPress={handleSkip} hitSlop={8}>
          <Text
            style={{
              fontFamily: fonts.sansRegular,
              fontStyle: 'italic',
              fontSize: 13,
              color: colors.ink50,
            }}
          >
            Skip
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function StarOutline() {
  return (
    <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L14.7 9.5 L21.7 10 L16.4 14.6 L18 21.4 L12 17.8 L6 21.4 L7.6 14.6 L2.3 10 L9.3 9.5 Z"
        stroke={colors.ink}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function StarFilled() {
  return (
    <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L14.7 9.5 L21.7 10 L16.4 14.6 L18 21.4 L12 17.8 L6 21.4 L7.6 14.6 L2.3 10 L9.3 9.5 Z"
        fill={colors.passata}
        stroke={colors.passata}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Action tiles ───────────────────────────────────────────────

function ActionTiles({ onAsk, onIdentify }: { onAsk: () => void; onIdentify: () => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
      <StampTile
        mark="✻"
        title="Ask"
        subtitle="Pastaio"
        desc="substitutions, fixes, ideas"
        onPress={onAsk}
      />
      <ViewfinderTile
        title="Identify"
        subtitle="a shape"
        desc="snap a box, get the right pasta"
        onPress={onIdentify}
      />
    </View>
  );
}

// ─── Last cooked list ───────────────────────────────────────────

function LastCooked({
  history,
  onPick,
}: {
  history: CookingHistoryEntry[];
  onPick: (id: string) => void;
}) {
  const [items, setItems] = useState<
    Array<{ summary: RecipeSummary; regionName: string; cookedAt: number; rating?: number }>
  >([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ids = history.map((h) => h.recipeId);
        const summaries = await getRecipeSummariesByIds(ids);
        const byId = new Map(summaries.map((s) => [s.recipe_id, s]));
        const enriched = await Promise.all(
          history.map(async (h) => {
            const summary = byId.get(h.recipeId);
            if (!summary) return null;
            const regionName = await resolveRegionName(summary.region_id);
            return {
              summary,
              regionName,
              cookedAt: h.cookedAt,
              rating: h.rating,
            };
          }),
        );
        const filtered = enriched.filter((x): x is NonNullable<typeof x> => x !== null);
        if (mounted) setItems(filtered);
      } catch (err) {
        console.warn('[home] last cooked load failed', err);
      }
    })();
    return () => { mounted = false; };
  }, [history]);

  if (items.length === 0) return null;

  return (
    <View style={{ marginTop: 22 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          paddingHorizontal: 4,
          paddingBottom: 8,
        }}
      >
        <Text variant="mono" style={{ color: colors.ink }}>last cooked</Text>
        <Text variant="mono">{items.length}</Text>
      </View>

      <View
        style={{
          backgroundColor: colors.paperHi,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
          overflow: 'hidden',
        }}
      >
        {items.map((r, i) => (
          <Pressable
            // Composite key: cookedAt is unique-ish per cook event;
            // index disambiguates the rare case of two cooks at the
            // same millisecond. Plain recipe_id breaks when the user
            // has cooked the same recipe more than once.
            key={`${r.cookedAt}-${i}`}
            onPress={() => onPick(r.summary.recipe_id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 14,
              paddingHorizontal: 16,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.hairline,
              backgroundColor: pressed ? colors.bone : 'transparent',
            })}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                backgroundColor: colors.paper,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PastaSigil shape={r.summary.shape_id} size={28} color={colors.ink} />
            </View>

            <View style={{ flex: 1 }}>
              <Text variant="h3" numberOfLines={1}>{r.summary.title}</Text>
              <Text variant="meta" style={{ marginTop: 2 }}>
                {r.regionName}{r.regionName ? ' · ' : ''}{formatWhen(r.cookedAt)}
              </Text>
            </View>

            {r.rating != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Svg width={11} height={11} viewBox="0 0 24 24">
                  <Path
                    d="M12 3 L14.7 9.5 L21.7 10 L16.4 14.6 L18 21.4 L12 17.8 L6 21.4 L7.6 14.6 L2.3 10 L9.3 9.5 Z"
                    fill={colors.passata}
                  />
                </Svg>
                <Text variant="mono" accent>{r.rating}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function formatWhen(cookedAtMs: number): string {
  const days = Math.floor((Date.now() - cookedAtMs) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(cookedAtMs).toLocaleDateString('en', { weekday: 'long' });
}