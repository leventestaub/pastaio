/**
 * Memory screen — the trust surface.
 *
 * Renders everything stored in memoryStore. Each entry editable/deletable.
 * Reset wipes everything, export writes JSON to share sheet.
 *
 * Deliberately no agent affordance — this is where the user inspects
 * what the app knows about them; agent presence here would undercut the
 * trust framing.
 *
 * Tone: plainer than other screens. Clarity beats warmth on a trust surface.
 */
import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { router } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { CompactHeader } from '@/components/primitives/CompactHeader';
import { SectionHead } from '@/components/primitives/SectionHead';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { exportMemoryToShareSheet } from '@/services/memoryExport';

export default function MemoryScreen() {
  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);

  const dietaryRestrictions = useMemoryStore((s) => s.dietaryRestrictions);
  const observations = useMemoryStore((s) => s.observations);
  const cookingHistory = useMemoryStore((s) => s.cookingHistory);
  const proactivityEnabled = useMemoryStore((s) => s.proactivityEnabled);

  const removeRestriction = useMemoryStore((s) => s.removeRestriction);
  const removeObservation = useMemoryStore((s) => s.removeObservation);
  const setProactivityEnabled = useMemoryStore((s) => s.setProactivityEnabled);
  const resetAll = useMemoryStore((s) => s.resetAll);
  const addObservation = useMemoryStore((s) => s.addObservation);
  const addRestriction = useMemoryStore((s) => s.addRestriction);

  const [isExporting, setIsExporting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setCurrentScreen('memory');
    }, [setCurrentScreen]),
  );

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportMemoryToShareSheet();
    } catch (e) {
      Alert.alert('Export failed', String(e));
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = () => {
    Alert.alert(
      'Reset all data?',
      'This wipes everything Pastaio knows about you. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetAll() },
      ],
    );
  };

  const totalKnown =
    dietaryRestrictions.length + observations.length + cookingHistory.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <CompactHeader
          title="Memory"
          kicker={`on-device · ${totalKnown} ${totalKnown === 1 ? 'thing known' : 'things known'}`}
        />

        <SectionHead
          numeral="I."
          title="Dietary"
          rightKicker={String(dietaryRestrictions.length)}
        />
        <View style={{ paddingHorizontal: space.lg, gap: 8, marginTop: 8 }}>
          {dietaryRestrictions.length === 0 ? (
            <EmptyLine text="None set." />
          ) : (
            dietaryRestrictions.map((r) => (
              <EntryCard
                key={r.restriction}
                primary={r.customText ?? r.restriction.replace(/_/g, '-')}
                onRemove={() => removeRestriction(r.restriction)}
              />
            ))
          )}
          <Pressable
            style={styles.addButton}
            onPress={() => addRestriction({ restriction: 'vegetarian' })}
          >
            <Text variant="mono">+ add restriction</Text>
          </Pressable>
        </View>

        <SectionHead
          numeral="II."
          title="Observations"
          rightKicker={String(observations.length)}
        />
        <View style={{ paddingHorizontal: space.lg, paddingTop: 4 }}>
          <Text
            style={{
              fontFamily: fonts.displayItalic,
              fontSize: 14,
              color: colors.ink50,
              fontStyle: 'italic',
              marginBottom: 8,
            }}
          >
            What Pastaio has noticed
          </Text>
          <View style={{ gap: 8 }}>
            {observations.length === 0 ? (
              <EmptyLine text="None yet." />
            ) : (
              observations.map((o, i) => (
                <EntryCard
                  key={`${o.observation}-${i}`}
                  primary={o.observation}
                  secondary={`${o.category} · ${o.context}`}
                  onRemove={() => removeObservation(i)}
                />
              ))
            )}
            <Pressable
              style={styles.addButton}
              onPress={() =>
                addObservation({
                  observation: 'prefers parsley over basil in pesto-style dishes',
                  category: 'food',
                  context: 'orecchiette session',
                })
              }
            >
              <Text variant="mono">+ add sample observation</Text>
            </Pressable>
          </View>
        </View>

        <SectionHead
          numeral="III."
          title="History"
          rightKicker={String(cookingHistory.length)}
        />
        <View style={{ paddingHorizontal: space.lg, gap: 8, marginTop: 8 }}>
          {cookingHistory.length === 0 ? (
            <EmptyLine text="Nothing cooked yet." />
          ) : (
            cookingHistory.map((h, i) => (
              <View key={`${h.recipeId}-${i}`} style={styles.historyRow}>
                <Text variant="h3" numberOfLines={1}>{h.recipeId}</Text>
                <Text variant="meta">
                  {formatDate(h.cookedAt)}
                  {h.rating ? ` · ${h.rating} ${h.rating === 1 ? 'star' : 'stars'}` : ' · unrated'}
                </Text>
              </View>
            ))
          )}
        </View>

        <SectionHead numeral="IV." title="Settings" />
        <View style={{ paddingHorizontal: space.lg, marginTop: 8 }}>
          <Pressable
            onPress={() => setProactivityEnabled(!proactivityEnabled)}
            style={({ pressed }) => [
              styles.settingsRow,
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="h3">Proactive suggestions</Text>
              <Text variant="meta" style={{ marginTop: 2 }}>
                Surfaces hints when context fits.
              </Text>
            </View>
            <View
              style={[
                styles.toggle,
                proactivityEnabled && { backgroundColor: colors.passata },
              ]}
            >
              <View
                style={[
                  styles.toggleKnob,
                  proactivityEnabled && { transform: [{ translateX: 18 }] },
                ]}
              />
            </View>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg, marginTop: 36, gap: 10 }}>
          <Pressable
            onPress={handleExport}
            disabled={isExporting}
            style={({ pressed }) => [
              styles.actionButton,
              { opacity: pressed || isExporting ? 0.7 : 1 },
            ]}
          >
            <Text variant="body" style={{ fontFamily: fonts.sansMedium }}>
              {isExporting ? 'Exporting…' : 'Export data (JSON)'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [
              styles.dangerButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text
              variant="body"
              style={{ color: colors.passataDark, fontFamily: fonts.sansMedium }}
            >
              Reset all data
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push('/methodology')}
          style={({ pressed }) => ({
            paddingHorizontal: space.lg,
            paddingTop: 32,
            paddingBottom: space.md,
            opacity: pressed ? 0.6 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          })}
        >
          <Text variant="mono" muted>
            Sources & methodology
          </Text>
          <Text variant="mono" muted>›</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function EntryCard({
  primary,
  secondary,
  onRemove,
}: {
  primary: string;
  secondary?: string;
  onRemove: () => void;
}) {
  return (
    <View style={styles.entryCard}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text variant="body" style={{ color: colors.ink }}>
          {primary}
        </Text>
        {secondary && (
          <Text variant="meta" style={{ marginTop: 2 }} numberOfLines={1}>
            {secondary}
          </Text>
        )}
      </View>
      <Pressable onPress={onRemove} hitSlop={12}>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 5 L19 19 M5 19 L19 5"
            stroke={colors.ink50}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Text variant="body" muted style={{ paddingVertical: 6, fontStyle: 'italic' }}>
      {text}
    </Text>
  );
}

function formatDate(ms: number): string {
  const days = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString('en', { weekday: 'long' });
}

const styles = StyleSheet.create({
  addButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.paperHi,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
  },
  historyRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.paperHi,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.paperHi,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
  },
  toggle: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ink30,
    padding: 2,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.bone,
  },
  actionButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
  },
  dangerButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.passataDark,
    borderRadius: radii.md,
  },
});
