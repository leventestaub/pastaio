# Pastaio — Knowledge Base Research Principles

This document describes how the Pastaio knowledge base was built. It exists
because the project's core claim — that the KB encodes verified Italian
culinary reasoning, rather than pattern-matched cooking advice — only
holds if the sourcing is auditable. Every recipe, substitution rule,
regional tradition, and shape entry in the KB was researched against
the principles below.

The KB is small by design. ~40-50 recipes, ~25 substitution rules,
~5-7 regional traditions, ~30-40 pasta shapes. The aim is depth and
defensibility, not coverage.

## What the KB is for

The KB is what differentiates Pastaio from a chatbot that knows about
Italian food. Large language models can produce plausible Italian cooking
advice from training data, but the reasoning is opaque, sources are
unverified, and the model will confidently state contested orthodoxies
as fact. The KB exists to ground the agent's answers in named,
verifiable sources, with honest acknowledgment of what's regulated, what's
convention, and what's contested.

When the agent suggests a substitution, names a regional tradition, or
states what's traditional in a recipe, the underlying KB entry is
traceable to a source the user can read for themselves.

## Source hierarchy

Sources are ranked by tier. Higher-tier sources are preferred. Lower-tier
sources are used when no higher-tier source exists, and are labeled as such.

### Tier 1 — Primary

Direct legal or municipal codification of recipes and ingredients:

- **EU regulations** (DOP, IGP, STG specifications) via EUR-Lex.
  Examples: Amatriciana Tradizionale STG (Regulation 2020/395),
  Mozzarella di Bufala Campana DOP, Parmigiano Reggiano DOP,
  Pesto Genovese basilico DOP.
- **Italian Mipaaf register** of traditional agri-food products
  (Prodotti Agroalimentari Tradizionali).
- **Municipal disciplinari** — formal recipe specifications adopted by
  the originating town. Comune di Amatrice's amatriciana disciplinare
  is the canonical example.

### Tier 2 — Authoritative secondary

Editorially curated sources with culinary or scholarly authority:

- **Accademia Italiana della Cucina** publications — particularly their
  formally deposited recipes (e.g., the Bolognese ragù deposited at the
  Bologna Chamber of Commerce in 1982).
- **Slow Food Foundation** Presidia documentation — rigorous
  documentation of traditional ingredients and preparations, with
  particular strength for regional and endangered traditions.
- **Italian regional government** culinary and agricultural ministries,
  where they publish documentation of regional food traditions.
- **Italian Wikipedia** — used as a *finding aid*, not a primary
  citation. When Italian Wikipedia cites primary sources, those
  primary sources are linked directly. Wikipedia itself is cited only
  when no higher-tier source exists and Wikipedia's own citations are
  strong.

### Tier 3 — Contemporary convention

Used when no Tier 1 or 2 source exists, and labeled as such:

- **La Cucina Italiana** magazine
- **Gambero Rosso**
- **Identità Golose**
- **Dissapore**
- **Giallo Zafferano** — used for recipe-level ingredient lists where
  no authority exists, never as authority on tradition.

### Excluded

Not used regardless of what they say:

- Random food blogs (unless the author is a recognized food historian
  or the blog is itself citing primary sources).
- Pinterest, Reddit, social media.
- AI-generated content sites.
- Aggregator sites that don't cite their own sources.
- English-language American food media (Serious Eats, NYT Cooking, etc.)
  for matters of *Italian tradition* — though they're acceptable for
  *technique and food science* discussions where their expertise is
  demonstrable.

## Cookbook handling

Several authoritative cookbooks are commonly cited in Italian food
research but are copyrighted and not freely accessible. The KB does NOT
cite these as if read directly:

- Marcella Hazan — *Essentials of Classic Italian Cooking*
- Pellegrino Artusi — *La scienza in cucina e l'arte di mangiar bene*
- Oretta Zanini De Vita — *Encyclopedia of Pasta*
- Ada Boni — *Il talismano della felicità*

These are cited only via excerpts and quotations in trusted secondary
sources, with the secondary source linked. The source_type is labeled
`cookbook_excerpt_via_citation` so the audit trail shows the indirection.

## Methodology

For every KB entry, the research process is:

1. **Pre-register the expected finding.** Before searching, write a
   one-sentence prediction of what authoritative sources will say. This
   creates a record that lets a reader (or the researcher) catch
   confirmation bias — searches that "find" exactly what was expected
   without contrary evidence are flagged for re-examination.

2. **Search Tier 1 and Tier 2 first.** Drop to Tier 3 only when the
   higher tiers are silent on the question.

3. **Require at least two independent sources** per substantive claim.
   "Independent" means the sources do not share a single upstream — two
   recipe blogs that copied from the same Wikipedia article are one
   source, not two.

4. **Quote short passages** that justify each claim, in the original
   language, with translation. The excerpt field is what makes the
   citation auditable — without it, the URL is just a pointer.

5. **Document contradictions.** When sources disagree, the disagreement
   is recorded in the entry's notes field, not flattened. Contested
   orthodoxies are themselves valuable culinary information.

6. **Label confidence honestly.** Each entry carries one of:
   - `directly_stated` — the source explicitly states the claim.
   - `inferred_from_source` — the source implies but does not state
     the claim.
   - `synthesized_across_sources` — no single source states the claim,
     but multiple agree.

7. **Drop entries that can't be sourced.** If a planned KB entry turns
   out to have no defensible source after research, it is dropped and
   logged in the methodology audit, not fabricated.

## Evidence strength labels

Each entry carries an evidence_strength label reflecting the strongest
authority backing it:

- `stg_dop_protected` — EU regulation explicitly codifies the rule.
- `comune_disciplinare` — municipality has a formal recipe specification.
- `accademia_published` — Accademia Italiana della Cucina has published
  the recipe or rule.
- `slow_food_presidia` — Slow Food has documented the tradition.
- `cookbook_consensus` — multiple authoritative cookbooks agree
  (cited via secondary excerpts).
- `contemporary_convention` — modern Italian culinary publications
  agree, but no formal authority codifies it.

Lower labels are not wrong. Many genuine Italian traditions have no
formal codification. But the label tells the user — and any reader of
the KB — what kind of authority they're looking at.

## Honest acknowledgments

A few things to be clear about:

**Translation.** Italian primary sources are read in Italian and translated
into English for the KB's English-language fields. The translations are
done by the researcher. Subtle nuance may be lost; the original-language
excerpts are preserved alongside translations so a reader who wants to
verify can do so.

**Researcher expertise.** The researcher (the KB curator and the LLM
assisting with retrieval) is not an Italian cooking expert. The KB's
defensibility rests on the *sources*, not on the researcher's
independent culinary judgment. This is by design — the project's whole
point is that the reasoning comes from named authorities, not from the
researcher's pattern-matching.

**Coverage gaps.** The KB covers what it covers. Italian regional cooking
is enormous and the KB selects representative dishes rather than
attempting comprehensiveness. Dishes outside the KB are not implicitly
non-canonical; they're just not in this particular curation.

**Contested orthodoxies.** Italian food culture has many vigorous
arguments about what's traditional. The KB attempts to represent these
honestly rather than picking sides. When the KB says a substitution is
"contested," it means contemporary Italian sources actually disagree —
not that the researcher couldn't decide.

## How to verify the KB yourself

The KB's sources are accessible — deliberately not in the foreground
of the app, but reachable for anyone who wants to check them. The
"Sources & Methodology" page (linked from the Memory tab) lists every
source cited in the KB, organized by entry, with direct URLs, short
quoted excerpts, and source-tier labels.

This placement is intentional. Surfacing citations next to every recipe
or substitution suggestion would change how the app reads — from
"knowledgeable cooking assistant" to "reference work with footnotes."
The sources matter for defensibility and verifiability, not for everyday
use. Most users will never open the methodology page; the people who
care about sourcing will, and that's enough.

If a source URL returns a 404, the source has gone offline. If a
quoted excerpt no longer appears at the linked URL, the source has
changed since the KB was built. Both happen and the KB cannot prevent
them — they're a known limitation of citing live web sources. The
quoted excerpt provides a partial defense: even if the URL changes,
the excerpt is reproducible evidence of what the source said at
research time.

## Versioning

The KB is versioned. Each entry records the date it was researched
and the methodology version (`v1` for the initial curation). When a
KB entry is revised — to correct an error, update a source URL, or
add a newly-discovered authority — the revision is logged.

This document describes methodology v1.
