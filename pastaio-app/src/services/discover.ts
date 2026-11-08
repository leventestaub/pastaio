/**
 * Discover sections — KB-driven, memory-aware, cold-start tolerant.
 *
 * Each section is a pure function that takes the KB query layer + memory
 * and returns a list of recipes plus a section-level note. UI just renders.
 *
 * Tonight is exported separately and is NOT part of buildDiscover() — the
 * Home tab owns Tonight, the Discover tab does not duplicate it. Discover
 * has three sections (Spotlight, Quick, Haven't Tried).
 *
 * Each Discover section returns at most 5 recipes. Empty results render an
 * appropriate empty/honest message in the UI.
 */
import {
  findRecipes,
  getRecipeSummariesByIds,
  openKb,
  type RecipeSummary,
} from '@/services/kb';

export type DiscoverSection = {
  id: 'regional_spotlight' | 'quick' | 'you_havent_tried';
  title: string;
  subtitle?: string;
  recipes: RecipeSummary[];
};

const SECTION_LIMIT = 5;
const QUICK_THRESHOLD_MIN = 25;

export type DiscoverInput = {
  cookingHistoryIds: string[];
  recentRegions: string[];
  recentShapes: string[];
};

/**
 * Build the three Discover sections in one call. Tonight is intentionally
 * not included — it lives only on Home (see findTonightPick below).
 */
export async function buildDiscover(
  input: DiscoverInput,
): Promise<DiscoverSection[]> {
  const [spotlight, quick, untried] = await Promise.all([
    buildRegionalSpotlight(),
    buildQuick(),
    buildYouHaventTried(input),
  ]);
  return [spotlight, quick, untried];
}

// ── Tonight (Home only) ─────────────────────────────────────────────
//
// Single-recipe pick for the Home Tonight card. Memory-aware with cold
// fallback. Returns null only if the KB has zero recipes.

export type TonightPick = {
  recipe: RecipeSummary;
  regionDisplayName: string;     // e.g. "Liguria" — pre-resolved for UI
  bodyCopy: string;              // why this pick fits, 1-2 sentences
};

export async function findTonightPick(input: {
  cookingHistoryIds: string[];
  recentRegions: string[];
  recentShapes: string[];
}): Promise<TonightPick | null> {
  // Cold start: pick a curated default. When the KB grows a "starter" tag
  // or similar, prefer that. For now: first recipe.
  if (input.cookingHistoryIds.length === 0) {
    const fallback = await findRecipes({ limit: 1 });
    if (fallback.length === 0) return null;
    const recipe = fallback[0];
    return {
      recipe,
      regionDisplayName: await resolveRegionName(recipe.region_id),
      bodyCopy: 'A simple place to begin.',
    };
  }

  const all = await findRecipes({ limit: 50 });
  if (all.length === 0) return null;

  const recentRegionSet = new Set(input.recentRegions);
  const recentShapeSet = new Set(input.recentShapes);

  // Pass 1: different region from recent cooks
  const fromUntriedRegion = all.find(
    (r) => r.region_id && !recentRegionSet.has(r.region_id),
  );
  if (fromUntriedRegion && input.recentRegions.length > 0) {
    const dominantRecent = input.recentRegions[0];
    const targetRegionName = await resolveRegionName(fromUntriedRegion.region_id);
    return {
      recipe: fromUntriedRegion,
      regionDisplayName: targetRegionName,
      bodyCopy: `You've been cooking ${capitalize(dominantRecent)} — try something from ${targetRegionName}.`,
    };
  }

  // Pass 2: different shape from recent cooks
  const fromUntriedShape = all.find((r) => !recentShapeSet.has(r.shape_id));
  if (fromUntriedShape) {
    return {
      recipe: fromUntriedShape,
      regionDisplayName: await resolveRegionName(fromUntriedShape.region_id),
      bodyCopy: 'A different shape from what you cooked recently.',
    };
  }

  // Pass 3: anything not in recent history
  const cookedIds = new Set(input.cookingHistoryIds.slice(0, 10));
  const fresh = all.find((r) => !cookedIds.has(r.recipe_id));
  if (fresh) {
    return {
      recipe: fresh,
      regionDisplayName: await resolveRegionName(fresh.region_id),
      bodyCopy: 'Worth cooking tonight.',
    };
  }

  // Last resort: just the first recipe
  const first = all[0];
  return {
    recipe: first,
    regionDisplayName: await resolveRegionName(first.region_id),
    bodyCopy: 'Worth cooking tonight.',
  };
}

// ── Regional spotlight ──────────────────────────────────────────────

async function buildRegionalSpotlight(): Promise<DiscoverSection> {
  const db = await openKb();
  const regions = await db.getAllAsync<{
    region_id: string;
    canonical_name: string;
    description: string;
  }>(
    `SELECT region_id, canonical_name, description FROM regions ORDER BY region_id`,
  );

  if (regions.length === 0) {
    return { id: 'regional_spotlight', title: 'Regional spotlight', recipes: [] };
  }

  const dayIndex = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const region = regions[dayIndex % regions.length];

  const recipes = await findRecipes({ limit: 50 }).then((all) =>
    all.filter((r) => r.region_id === region.region_id).slice(0, SECTION_LIMIT),
  );

  return {
    id: 'regional_spotlight',
    title: `Spotlight: ${region.canonical_name}`,
    subtitle: firstSentence(region.description),
    recipes,
  };
}

// ── Quick ───────────────────────────────────────────────────────────

async function buildQuick(): Promise<DiscoverSection> {
  const db = await openKb();
  const rows = await db.getAllAsync<any>(
    `SELECT recipe_id, title, shape_id, region_id, sauce_category_id,
            description, cook_time_minutes, serves, tags
     FROM recipes
     WHERE cook_time_minutes <= ?
     ORDER BY cook_time_minutes ASC
     LIMIT ?`,
    [QUICK_THRESHOLD_MIN, SECTION_LIMIT],
  );

  const recipes: RecipeSummary[] = rows.map((r) => ({
    recipe_id: r.recipe_id,
    title: r.title,
    shape_id: r.shape_id,
    region_id: r.region_id,
    sauce_category_id: r.sauce_category_id,
    description: r.description,
    cook_time_minutes: r.cook_time_minutes,
    serves: r.serves,
    tags: JSON.parse(r.tags) as string[],
  }));

  let subtitle: string | undefined;
  if (recipes.length === 0) {
    subtitle = `Nothing under ${QUICK_THRESHOLD_MIN} min in the cookbook yet.`;
  } else if (recipes.length === 1) {
    subtitle = `One quick option for now — more as the cookbook grows.`;
  } else {
    subtitle = `Under ${QUICK_THRESHOLD_MIN} min, hands-on.`;
  }

  return { id: 'quick', title: 'Quick', subtitle, recipes };
}

// ── You haven't tried ───────────────────────────────────────────────

async function buildYouHaventTried(
  input: DiscoverInput,
): Promise<DiscoverSection> {
  const cookedIds = new Set(input.cookingHistoryIds);
  const allRecipes = await findRecipes({ limit: 50 });
  const untried = allRecipes
    .filter((r) => !cookedIds.has(r.recipe_id))
    .slice(0, SECTION_LIMIT);

  let subtitle: string | undefined;
  if (input.cookingHistoryIds.length === 0) {
    subtitle = 'The whole cookbook is new — pick anything.';
  } else if (untried.length === 0) {
    subtitle = `You've cooked everything in the cookbook.`;
  } else {
    subtitle = undefined;
  }

  return {
    id: 'you_havent_tried',
    title: "You haven't tried",
    subtitle,
    recipes: untried,
  };
}

// ── Public helpers ──────────────────────────────────────────────────

/**
 * Resolve a region_id to its canonical display name from the regions table.
 * Returns the region_id capitalized as a fallback if not found.
 */
export async function resolveRegionName(region_id: string | null): Promise<string> {
  if (!region_id) return '';
  const db = await openKb();
  const row = await db.getFirstAsync<{ canonical_name: string }>(
    `SELECT canonical_name FROM regions WHERE region_id = ?`,
    [region_id],
  );
  return row?.canonical_name ?? capitalize(region_id);
}

/**
 * Derive recentRegions and recentShapes from cooking history recipe IDs.
 * Most-recent-first, deduped. Caller passes these into buildDiscover and
 * findTonightPick.
 */
export async function deriveRecentMetadata(
  cookingHistoryIds: string[],
): Promise<{ recentRegions: string[]; recentShapes: string[] }> {
  if (cookingHistoryIds.length === 0) {
    return { recentRegions: [], recentShapes: [] };
  }
  const summaries = await getRecipeSummariesByIds(
    cookingHistoryIds.slice(0, 10),
  );
  const seenRegion = new Set<string>();
  const seenShape = new Set<string>();
  const recentRegions: string[] = [];
  const recentShapes: string[] = [];
  for (const s of summaries) {
    if (s.region_id && !seenRegion.has(s.region_id)) {
      seenRegion.add(s.region_id);
      recentRegions.push(s.region_id);
    }
    if (!seenShape.has(s.shape_id)) {
      seenShape.add(s.shape_id);
      recentShapes.push(s.shape_id);
    }
  }
  return { recentRegions, recentShapes };
}

// ── Internal helpers ────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function firstSentence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : trimmed;
}
