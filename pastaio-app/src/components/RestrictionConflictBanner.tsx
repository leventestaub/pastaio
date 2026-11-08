/**
 * Inline banner shown on the recipe screen when an ingredient conflicts
 * with the user's dietary restrictions.
 *
 * Spec §7 trigger 1. App-defined trigger (recipe screen mount + conflict
 * detection in store), templated copy. Tap to summon the agent input
 * pre-seeded with a substitution query.
 *
 * This component is a thin wrapper around <Banner> — detection logic
 * lives here, presentation lives in the primitive. If we add more
 * banner-using surfaces (cooking idle, cookbook starter, etc.) they
 * follow the same pattern: domain wrapper → Banner primitive.
 */
import React from 'react';
import { Banner } from '@/components/primitives/Banner';
import { useSessionStore } from '@/stores/sessionStore';
import { useMemoryStore } from '@/stores/memoryStore';
import {
  detectIngredientConflicts,
  formatRestriction,
} from '@/services/restrictionIngredients';
import type { Ingredient } from '@/services/kb';

export function RestrictionConflictBanner({
  ingredients,
}: {
  ingredients: Ingredient[];
}) {
  const restrictions = useMemoryStore((s) => s.dietaryRestrictions);
  const openAgentInput = useSessionStore((s) => s.openAgentInput);

  if (restrictions.length === 0) return null;

  const conflicts = detectIngredientConflicts({
    ingredientNames: ingredients.map((i) => i.name),
    restrictions,
  });

  if (conflicts.length === 0) return null;

  // Render one banner even if multiple restrictions conflict. Stacking
  // banners is overwhelming; the agent surfaces details when engaged.
  const primary = conflicts[0];
  const restrictionLabel = formatRestriction(
    primary.restriction,
    primary.customText,
  );

  const moreCount = conflicts.length - 1;
  const moreText =
    moreCount > 0
      ? ` (and ${moreCount} other${moreCount === 1 ? '' : 's'})`
      : '';

  return (
    <Banner
      tint="warning"
      title={`Contains ${primary.matchedIngredient.toLowerCase()}, which conflicts with your ${restrictionLabel} preference${moreText}.`}
      sub="Tap to ask Pastaio for a substitute"
      onPress={openAgentInput}
    />
  );
}
