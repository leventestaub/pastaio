// src/components/methodology/MethodologyContent.tsx
/**
 * Hand-ported research principles content.
 *
 * Composed from Text primitives directly — no markdown library.
 * Edits to copy happen here; no separate doc to keep in sync.
 *
 * Repo-side RESEARCH_PRINCIPLES.md is for the developer audience
 * (more detail, methodology version log, examples). This is the
 * in-app curation: ~640 words, phone-readable, same voice.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/primitives/Text';
import { colors, fonts, space } from '@/constants/theme';

export function MethodologyContent() {
  return (
    <View style={styles.container}>
      <Text variant="body" style={styles.lead}>
        The Pastaio knowledge base is small by design — about 50 recipes,
        every entry sourced. This is how it's built and why it matters.
      </Text>

      <H2>What this knowledge base is for</H2>
      <P>
        A large language model can produce plausible Italian cooking
        advice from training data, but the reasoning is opaque, sources
        are unverified, and the model will state contested orthodoxies
        as fact. The knowledge base exists to ground the agent's
        answers in named, verifiable sources — and to be honest about
        what's regulated, what's convention, and what's contested.
      </P>
      <P>
        When the agent suggests a substitution, names a regional
        tradition, or states what's traditional in a recipe, the
        underlying entry is traceable to a source you can read for
        yourself.
      </P>

      <H2>Source hierarchy</H2>
      <P>
        Sources are ranked by tier. Higher-tier sources are preferred.
        Lower tiers are used when no higher-tier source exists, and
        labeled as such.
      </P>

      <TierBlock numeral="I" label="Primary">
        Direct legal or municipal codification. EU regulations (DOP,
        IGP, STG specifications) via EUR-Lex. The Italian Mipaaf
        register of traditional agri-food products. Municipal
        disciplinari — formal recipe specifications adopted by the
        originating town, like Comune di Amatrice's amatriciana
        disciplinare.
      </TierBlock>

      <TierBlock numeral="II" label="Authoritative secondary">
        Editorially curated sources with culinary or scholarly
        authority. Accademia Italiana della Cucina publications,
        particularly their formally deposited recipes. Slow Food
        Foundation Presidia documentation. Italian regional government
        culinary and agricultural ministries. Italian Wikipedia is
        used as a finding aid — its citations are followed to primary
        sources, and Wikipedia is cited directly only when no
        higher-tier source exists.
      </TierBlock>

      <TierBlock numeral="III" label="Contemporary convention">
        Used when no Tier 1 or 2 source covers the question. Italian
        culinary publications like La Cucina Italiana, Gambero Rosso,
        and Identità Golose. Recipe magazines for ingredient-level
        details, never as authority on tradition.
      </TierBlock>

      <TierBlock numeral="—" label="Not used">
        Random food blogs, social media, AI-generated content, and
        aggregators that don't cite their own sources.
        English-language American food media is acceptable for
        technique and food science, but not for matters of Italian
        tradition.
      </TierBlock>

      <H2>How entries are researched</H2>
      <P>
        For every entry, the process is the same. Search the higher
        tiers first; only drop to Tier 3 when the higher tiers are
        silent. Require at least two independent sources per
        substantive claim — two recipe blogs that copied from the same
        Wikipedia article are one source, not two. Quote a short
        passage from each source, in the original language, with
        translation. The excerpt is what makes the citation auditable.
      </P>
      <P>
        When sources disagree, the disagreement is recorded, not
        flattened. Contested orthodoxies are themselves valuable
        culinary information — carbonara's history of pork choices,
        pesto's regional variants, the century-long argument about
        cream in Roman pasta dishes.
      </P>
      <P>
        If a planned entry can't be sourced after research, it's
        dropped. Not fabricated, not guessed.
      </P>
      <P>
        Each entry carries an evidence-strength label naming the
        strongest authority backing it — from EU-regulated
        specifications down to contemporary convention. Lower labels
        are not wrong. Many genuine Italian traditions have no formal
        codification. The label tells you what kind of authority
        you're looking at.
      </P>

      <H2>What this isn't</H2>

      <Acknowledgment lead="A claim of expertise.">
        The curator is not an Italian cooking expert. The collection's
        defensibility rests on its sources, not on the curator's
        independent judgment. This is the point — the reasoning comes
        from named authorities, not from pattern-matching.
      </Acknowledgment>

      <Acknowledgment lead="Comprehensive.">
        Italian regional cooking is enormous. This collection selects
        representative dishes rather than attempting coverage. Dishes
        outside it are not implicitly non-canonical; they're just not
        in this particular curation.
      </Acknowledgment>

      <Acknowledgment lead="A neutral arbiter.">
        Italian food culture has many vigorous arguments about what's
        traditional. Entries represent these honestly rather than
        picking sides. When something is labeled contested, it means
        contemporary Italian sources actually disagree.
      </Acknowledgment>

      <Acknowledgment lead="A perfect translation.">
        Italian primary sources are read in Italian and translated
        into English by the curator. Subtle nuance may be lost. The
        original-language excerpts are preserved alongside
        translations so you can verify for yourself.
      </Acknowledgment>

      <Acknowledgment lead="Permanent.">
        Sources go offline. Pages get rewritten. The quoted excerpts
        in each source entry are reproducible evidence of what the
        source said at research time, even if the URL drifts.
      </Acknowledgment>
    </View>
  );
}

// ── Internal type primitives, scoped to methodology ──────────────

function H2({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="h2" style={styles.h2}>
      {children}
    </Text>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="body" style={styles.p}>
      {children}
    </Text>
  );
}

function TierBlock({
  numeral,
  label,
  children,
}: {
  numeral: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.tier}>
      <View style={styles.tierHeader}>
        <Text
          style={{
            fontFamily: fonts.displayItalic,
            fontSize: 22,
            lineHeight: 22,
            color: colors.passata,
            minWidth: 28,
          }}
        >
          {numeral}
        </Text>
        <Text variant="h3" style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <Text variant="body" style={styles.tierBody}>
        {children}
      </Text>
    </View>
  );
}

function Acknowledgment({
  lead,
  children,
}: {
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.ack}>
      <Text
        style={{
          fontFamily: fonts.displayItalic,
          fontSize: 18,
          lineHeight: 22,
          color: colors.ink,
          marginBottom: 4,
        }}
      >
        {lead}
      </Text>
      <Text variant="body">{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
  },
  lead: {
    fontSize: 17,
    lineHeight: 26,
    color: colors.ink,
    marginBottom: space.xl,
  },
  h2: {
    marginTop: space.xl,
    marginBottom: space.md,
  },
  p: {
    lineHeight: 24,
    marginBottom: space.md,
  },
  tier: {
    marginTop: space.md,
    marginBottom: space.md,
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    marginBottom: 6,
  },
  tierBody: {
    lineHeight: 23,
    paddingLeft: 36,
  },
  ack: {
    marginBottom: space.lg,
  },
});