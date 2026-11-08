// src/app/methodology.tsx
/**
 * Methodology screen — pushed from Memory tab footer.
 *
 * Composes:
 *   1. MethodologyContent (hand-ported principles)
 *   2. KB version metadata block
 *   3. All sources, grouped by tier (descending authority)
 *
 * No agent affordance — this is the trust surface, like Memory.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/primitives/Text';
import { ScreenHeader } from '@/components/primitives/ScreenHeader';
import { SourceCard } from '@/components/SourceCard';
import { MethodologyContent } from '@/components/methodology/MethodologyContent';
import { colors, fonts, radii, space } from '@/constants/theme';
import {
  getAllSources,
  getKbVersion,
  type Source,
  type KbVersion,
} from '@/services/kb';

export default function MethodologyScreen() {
  const [sources, setSources] = useState<Source[]>([]);
  const [version, setVersion] = useState<KbVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAllSources(), getKbVersion()])
      .then(([s, v]) => {
        if (cancelled) return;
        setSources(s);
        setVersion(v);
      })
      .catch(() => {})
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, []);

  const sourcesByTier = useMemo(() => {
    const groups = new Map<1 | 2 | 3, Source[]>();
    for (const s of sources) {
      const list = groups.get(s.source_tier) ?? [];
      list.push(s);
      groups.set(s.source_tier, list);
    }
    return groups;
  }, [sources]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScreenHeader title="METHODOLOGY" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          <Text variant="mono" accent>
            Sources & methodology
          </Text>
          <Text
            variant="display"
            style={{ fontSize: 40, lineHeight: 42, marginTop: 6 }}
          >
            How we know what we know.
          </Text>
        </View>

        <MethodologyContent />

        {/* KB version block */}
        <View style={{ paddingHorizontal: space.lg, marginTop: space.xl * 1.2 }}>
          <Text variant="mono" muted style={{ marginBottom: space.md }}>
            This version
          </Text>
          {version ? (
            <View style={styles.versionCard}>
              <VersionRow
                label="Methodology"
                value={version.methodology_version}
              />
              <VersionRow
                label="Built"
                value={formatBuiltAt(version.built_at)}
              />
              <VersionRow
                label="Recipes"
                value={String(version.recipe_count)}
              />
              <VersionRow
                label="Sources"
                value={String(version.source_count)}
              />
              <VersionRow
                label="Substitutions"
                value={String(version.substitution_count)}
                last
              />
            </View>
          ) : (
            <Text variant="body" muted style={{ fontStyle: 'italic' }}>
              Version metadata unavailable.
            </Text>
          )}
        </View>

        {/* All sources */}
        <View style={{ paddingHorizontal: space.lg, marginTop: space.xl * 1.2 }}>
          <Text variant="mono" muted style={{ marginBottom: space.md }}>
            Every source
          </Text>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 24, alignItems: 'center' }}>
            <ActivityIndicator color={colors.passata} />
          </View>
        ) : sources.length === 0 ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <Text variant="body" muted style={{ fontStyle: 'italic' }}>
              No sources recorded yet.
            </Text>
          </View>
        ) : (
          <>
            {([1, 2, 3] as const).map((tier) => {
              const tierSources = sourcesByTier.get(tier) ?? [];
              if (tierSources.length === 0) return null;
              return (
                <View key={tier} style={{ marginBottom: space.lg }}>
                  <View style={{ paddingHorizontal: space.lg, marginBottom: space.md }}>
                    <Text variant="h2">
                      {romanNumeral(tier)}.{' '}
                      <Text variant="h2" accent>
                        Tier {tier}
                      </Text>
                    </Text>
                    <Text variant="meta" style={{ marginTop: 2 }}>
                      {tierLabel(tier)} · {tierSources.length}{' '}
                      {tierSources.length === 1 ? 'source' : 'sources'}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
                    {tierSources.map((source) => (
                      <SourceCard
                        key={source.source_id}
                        source={source}
                        showTier={false}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function VersionRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.versionRow,
        last && { borderBottomWidth: 0 },
      ]}
    >
      <Text variant="mono" muted>{label}</Text>
      <Text
        style={{
          fontFamily: fonts.sansMedium,
          fontSize: 14,
          color: colors.ink,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function formatBuiltAt(iso: string): string {
  // Backend ships ISO timestamp; show as "3 May 2026" — month name reads
  // editorial vs. raw 2026-05-03.
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function romanNumeral(n: 1 | 2 | 3): string {
  return ['I', 'II', 'III'][n - 1];
}

function tierLabel(tier: 1 | 2 | 3): string {
  return {
    1: 'Primary — legal codification',
    2: 'Authoritative secondary',
    3: 'Contemporary convention',
  }[tier];
}

const styles = StyleSheet.create({
  versionCard: {
    backgroundColor: colors.paperHi,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
});