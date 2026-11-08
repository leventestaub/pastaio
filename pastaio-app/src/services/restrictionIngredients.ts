/**
 * Hard-restriction → ingredient name mapping.
 *
 * Used to detect when an active recipe contains ingredients that
 * conflict with the user's stored dietary restrictions. Hardcoded for
 * v1 because the KB doesn't yet model "this ingredient violates X."
 * When the KB grows, move this to a restriction_ingredients table.
 *
 * Match strategy: case-insensitive substring containment. The ingredient
 * "Genovese basil if possible, leaves only" matches the substring "basil"
 * in a basil-flagged restriction, just as the substitution overrides do.
 *
 * Tradeoff: substring matching has false-positive risk (e.g., "milk"
 * matching "milkfish"). For pasta cooking the risk is low — these
 * ingredient lists don't include unrelated words. Revisit if it bites.
 */
import type { DietaryRestriction } from '@/types';

// The strings here should appear as substrings of ingredient.name in
// the KB. Lowercase by convention. Add to these as the KB grows.
const RESTRICTION_INGREDIENTS: Record<DietaryRestriction, string[]> = {
  vegetarian: ['anchovy', 'guanciale', 'pancetta', 'bacon', 'sausage', 'meat'],
  vegan: [
    'anchovy', 'guanciale', 'pancetta', 'bacon', 'sausage', 'meat',
    'parmigiano', 'pecorino', 'grana padano', 'cheese', 'butter', 'milk',
    'cream', 'egg', 'ricotta',
  ],
  gluten_free: [
    'pasta', 'flour', 'wheat', 'semolina', 'orecchiette', 'penne',
    'spaghetti', 'bucatini', 'trofie',
  ],
  dairy_free: [
    'parmigiano', 'pecorino', 'grana padano', 'cheese', 'butter', 'milk',
    'cream', 'ricotta',
  ],
  pescatarian: ['guanciale', 'pancetta', 'bacon', 'sausage', 'beef', 'pork', 'lamb', 'chicken'],
  no_pork: ['guanciale', 'pancetta', 'bacon', 'pork', 'prosciutto'],
  no_shellfish: ['shrimp', 'prawn', 'clam', 'mussel', 'lobster', 'crab', 'oyster'],
  custom: [],  // custom uses customText, which we don't auto-match
};

/**
 * Find ingredients in the recipe that conflict with active restrictions.
 *
 * Returns conflicts grouped by restriction so the UI can render
 * "Contains parmigiano (dairy-free)" with the right framing.
 *
 * Empty list means no conflicts — UI suppresses the surface entirely.
 */
export function detectIngredientConflicts(args: {
  ingredientNames: string[];
  restrictions: { restriction: DietaryRestriction; customText?: string }[];
}): Array<{
  restriction: DietaryRestriction;
  customText?: string;
  matchedIngredient: string;
}> {
  const conflicts: Array<{
    restriction: DietaryRestriction;
    customText?: string;
    matchedIngredient: string;
  }> = [];

  for (const r of args.restrictions) {
    const triggers = RESTRICTION_INGREDIENTS[r.restriction] ?? [];
    // For custom restrictions, treat customText itself as the trigger.
    const allTriggers = r.customText
      ? [...triggers, r.customText.toLowerCase().trim()]
      : triggers;

    for (const ing of args.ingredientNames) {
      const lower = ing.toLowerCase();
      const matched = allTriggers.find((t) => t && lower.includes(t));
      if (matched) {
        conflicts.push({
          restriction: r.restriction,
          customText: r.customText,
          matchedIngredient: ing,
        });
        break; // one conflict per restriction is enough for the UI
      }
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
