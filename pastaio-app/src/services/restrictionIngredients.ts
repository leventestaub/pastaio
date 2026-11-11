/**
 * Dietary restriction conflicts for the recipe screen banner.
 *
 * Canonical restrictions use the KB's ingredient classes (the same tables
 * the backend filters recipe search with; source
 * pastaio-kb/source/ingredient_classes.yaml). Custom restrictions match
 * their free text as a substring of the ingredient name.
 */
import type { DietaryRestriction } from '@/types';
import type { DietRules } from '@/services/kb';

export interface IngredientConflict {
  restriction: DietaryRestriction;
  customText?: string;
  matchedIngredient: string;
}

/** One conflict per restriction is enough for the UI. Empty = no banner. */
export function detectIngredientConflicts(args: {
  ingredientNames: string[];
  restrictions: { restriction: DietaryRestriction; customText?: string }[];
  rules: DietRules;
}): IngredientConflict[] {
  const conflicts: IngredientConflict[] = [];
  for (const r of args.restrictions) {
    const banned = args.rules.excludes[r.restriction] ?? [];
    const custom = r.restriction === 'custom' ? r.customText?.toLowerCase().trim() : undefined;
    const matched = args.ingredientNames.find((name) =>
      custom
        ? name.toLowerCase().replace(/_/g, ' ').includes(custom)
        : (args.rules.classes[name] ?? []).some((c) => banned.includes(c)),
    );
    if (matched) {
      conflicts.push({ restriction: r.restriction, customText: r.customText, matchedIngredient: matched });
    }
  }
  return conflicts;
}

/** Pretty-print a restriction for the UI. */
export function formatRestriction(
  restriction: DietaryRestriction,
  customText?: string,
): string {
  if (restriction === 'custom' && customText) return customText;
  return restriction.replace(/_/g, '-');
}
