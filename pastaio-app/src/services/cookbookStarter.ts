// =============================================================================
// src/services/cookbookStarter.ts (NEW FILE)
// =============================================================================
//
// Spec proactive trigger #5: when cookbook is empty AND cooking history is
// non-empty, replace the cold empty state with templated copy + 2-3
// recipe suggestions.
//
// Logic:
//   1. Look up summaries for each cooked recipe (one IN query).
//   2. Group cooked recipes by region; pick the dominant one.
//   3. Pull all recipes (capped at 50, well above v1 KB target).
//   4. Filter to dominant region, exclude already-cooked + saved.
//   5. If dominant region has fewer than 3 unseen, pad with other regions.
//   6. Cap at 3.
//
// Pure async function — no React, no stores. Components call it inside
// a useEffect with a mounted-flag guard.
// =============================================================================

import { findRecipes, getRecipeSummariesByIds, type RecipeSummary } from './kb';
import { resolveRegionName } from './discover';

export type CookbookStarter = {
  dominantRegionId: string;
  dominantRegionName: string;
  suggestions: RecipeSummary[];
};

export async function buildCookbookStarter(args: {
  cookingHistoryIds: string[];
  savedRecipeIds: string[];
}): Promise<CookbookStarter | null> {
  if (args.cookingHistoryIds.length === 0) return null;

  // 1. Look up cooked recipe summaries to read regions off them.
  // Dedup ids first — recordCooking can append the same recipe multiple
  // times, and getRecipeSummariesByIds preserves dups in its output.
  const uniqueCookedIds = Array.from(new Set(args.cookingHistoryIds));
  const cookedSummaries = await getRecipeSummariesByIds(uniqueCookedIds);

  // 2. Tally regions (skipping nullable region_id — some shapes/recipes
  // may not have one as the KB grows).
  const regionCounts = new Map<string, number>();
  for (const summary of cookedSummaries) {
    if (!summary.region_id) continue;
    regionCounts.set(
      summary.region_id,
      (regionCounts.get(summary.region_id) ?? 0) + 1,
    );
  }
  if (regionCounts.size === 0) return null;

  // 3. Pick dominant region (ties broken alphabetically for stability —
  // doesn't matter visually but makes tests deterministic).
  const [dominantRegionId] = [...regionCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];

  // 4. Pull all recipes. v1 KB target is ~25-30 recipes; limit 50 is
  // safe headroom. Bump if KB grows past that.
  const allRecipes = await findRecipes({ limit: 50 });

  const cookedSet = new Set(args.cookingHistoryIds);
  const savedSet = new Set(args.savedRecipeIds);

  const isUnseen = (r: RecipeSummary) =>
    !cookedSet.has(r.recipe_id) && !savedSet.has(r.recipe_id);

  // 5. Dominant-region candidates first.
  const dominantCandidates = allRecipes.filter(
    (r) => r.region_id === dominantRegionId && isUnseen(r),
  );

  let suggestions = dominantCandidates.slice(0, 3);

  // 6. Pad from other regions if dominant is sparse.
  if (suggestions.length < 3) {
    const otherCandidates = allRecipes.filter(
      (r) => r.region_id !== dominantRegionId && isUnseen(r),
    );
    suggestions = [
      ...suggestions,
      ...otherCandidates.slice(0, 3 - suggestions.length),
    ];
  }

  if (suggestions.length === 0) return null;

  // 7. Resolve display name for the dominant region.
  const dominantRegionName = await resolveRegionName(dominantRegionId);

  return {
    dominantRegionId,
    dominantRegionName,
    suggestions,
  };
}