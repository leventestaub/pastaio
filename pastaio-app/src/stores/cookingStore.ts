/**
 * Cooking store — state specific to an active cooking session.
 *
 * Separated from sessionStore because cooking has enough state of its own
 * (timers, step index, applied substitutions) that mixing it in would bloat
 * sessionStore and force every screen to import cooking concerns.
 *
 * Active only while the user is in cooking mode for a specific recipe.
 * `startCooking` clears any prior session; `endCooking` wipes it.
 */
import { create } from 'zustand';
import type { ActiveTimer } from '@/types';

interface IngredientOverride {
  // The ingredient name as it appears in the recipe.
  original: string;
  // What the user (or agent) substituted it with.
  replacement: string;
}

interface CookingState {
  // The recipe currently being cooked. Null when not in cooking mode.
  cookingRecipeId: string | null;

  // Index of the current step the user is on. Zero-based.
  currentStepIndex: number;

  // Active timers. Multiple timers can run concurrently (e.g. pasta water +
  // sauce simmer). Each is independent.
  timers: ActiveTimer[];

  // Substitutions applied to the active recipe during this session. The
  // recipe display reads these and renders the replacement instead of the
  // original ingredient. Cleared on endCooking.
  ingredientOverrides: IngredientOverride[];

  // ── actions ──────────────────────────────────────────────────────────

  startCooking: (recipeId: string) => void;
  endCooking: () => void;

  setStepIndex: (index: number) => void;
  nextStep: () => void;
  previousStep: () => void;

  startTimer: (timer: Omit<ActiveTimer, 'startedAt' | 'id'> & { id?: string }) => void;
  cancelTimer: (id: string) => void;

  applySubstitution: (override: IngredientOverride) => void;
  clearSubstitutions: () => void;
}

export const useCookingStore = create<CookingState>((set) => ({
  cookingRecipeId: null,
  currentStepIndex: 0,
  timers: [],
  ingredientOverrides: [],

  startCooking: (recipeId) =>
    set({
      cookingRecipeId: recipeId,
      currentStepIndex: 0,
      timers: [],
      ingredientOverrides: [],
    }),

  endCooking: () =>
    set({
      cookingRecipeId: null,
      currentStepIndex: 0,
      timers: [],
      ingredientOverrides: [],
    }),

  setStepIndex: (index) => set({ currentStepIndex: Math.max(0, index) }),
  nextStep: () =>
    set((state) => ({ currentStepIndex: state.currentStepIndex + 1 })),
  previousStep: () =>
    set((state) => ({
      currentStepIndex: Math.max(0, state.currentStepIndex - 1),
    })),

  startTimer: (timer) =>
    set((state) => ({
      timers: [
        ...state.timers,
        {
          ...timer,
          id: timer.id ?? `timer-${Date.now()}`,
          startedAt: Date.now(),
        },
      ],
    })),

  cancelTimer: (id) =>
    set((state) => ({ timers: state.timers.filter((t) => t.id !== id) })),

  applySubstitution: (override) =>
    set((state) => {
      // Replace if already overridden, else append.
      const existing = state.ingredientOverrides.findIndex(
        (o) => o.original === override.original
      );
      if (existing >= 0) {
        const next = [...state.ingredientOverrides];
        next[existing] = override;
        return { ingredientOverrides: next };
      }
      return { ingredientOverrides: [...state.ingredientOverrides, override] };
    }),

  clearSubstitutions: () => set({ ingredientOverrides: [] }),
}));
