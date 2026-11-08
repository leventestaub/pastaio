/**
 * Memory store — persisted user data.
 *
 * Storage: pastaio-memory.db via zustand's persist middleware. Data
 * survives app reload, app update, and store hot-reload. Wiped only by
 * resetAll (user-initiated) or app uninstall.
 *
 * Cap on observations is enforced here, not in the UI — the LLM expects
 * ≤ 20 recent observations in ChatContext, and unbounded growth would
 * push prompt rules out of attention.
 *
 * Hydration:
 * - persist middleware loads from disk on store creation.
 * - First reads after app start may briefly return defaults before
 *   hydration completes. Use `useMemoryHydrated()` to gate UI on it.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  StoredDietaryRestriction,
  StoredObservation,
  CookingHistoryEntry,
} from '@/types';
import { sqliteStorage, clearAllPersistedData } from '@/services/sqliteStorage';

const OBSERVATION_CAP = 20;
const HISTORY_CAP = 50;

interface MemoryState {
  dietaryRestrictions: StoredDietaryRestriction[];
  observations: StoredObservation[];
  cookingHistory: CookingHistoryEntry[];
  cookbook: string[];
  pantryItems: string[];
  proactivityEnabled: boolean;

  /**
   * Recipe id of the most recently dismissed rating prompt. When the user
   * skips rating a cook on Home, we set this so the prompt doesn't
   * immediately reappear. Null means "no dismissal active."
   *
   * Cleared when:
   *   - user rates that recipe via rateCooking (defensive, in case they
   *     dismissed then later rated via Memory tab manually)
   *   - the entry passes out of the 1-hour rating window (no explicit
   *     clear; the trigger condition just stops matching)
   *   - resetAll
   *
   * Only one id is tracked at a time — there's only ever one
   * most-recent unrated cook to dismiss.
   */
  lastRatingPromptDismissedFor: string | null;

  addRestriction: (restriction: StoredDietaryRestriction) => void;
  removeRestriction: (restriction: StoredDietaryRestriction['restriction']) => void;

  addObservation: (observation: StoredObservation) => void;
  removeObservation: (index: number) => void;

  recordCooking: (entry: CookingHistoryEntry) => void;
  rateCooking: (recipeId: string, rating: 1 | 2 | 3 | 4 | 5, note?: string) => void;
  dismissRatingPromptFor: (recipeId: string) => void;

  saveToCookbook: (recipeId: string) => void;
  removeFromCookbook: (recipeId: string) => void;

  setPantryItems: (items: string[]) => void;
  setProactivityEnabled: (enabled: boolean) => void;

  resetAll: () => Promise<void>;
}

const initialState = {
  dietaryRestrictions: [] as StoredDietaryRestriction[],
  observations: [] as StoredObservation[],
  cookingHistory: [] as CookingHistoryEntry[],
  cookbook: [] as string[],
  pantryItems: [] as string[],
  proactivityEnabled: true,
  lastRatingPromptDismissedFor: null as string | null,
};

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set) => ({
      ...initialState,

      addRestriction: (restriction) =>
        set((state) => {
          // De-dupe by restriction kind.
          const filtered = state.dietaryRestrictions.filter(
            (r) => r.restriction !== restriction.restriction
          );
          return { dietaryRestrictions: [...filtered, restriction] };
        }),

      removeRestriction: (kind) =>
        set((state) => ({
          dietaryRestrictions: state.dietaryRestrictions.filter(
            (r) => r.restriction !== kind
          ),
        })),

      addObservation: (observation) =>
        set((state) => ({
          observations: [observation, ...state.observations].slice(0, OBSERVATION_CAP),
        })),

      removeObservation: (index) =>
        set((state) => ({
          observations: state.observations.filter((_, i) => i !== index),
        })),

      // Contract: prepends so cookingHistory[0] is always the most recent
      // entry. The Home rate-prompt trigger relies on this. If we ever
      // change the ordering here, update Home's heroState memo too.
      recordCooking: (entry) =>
        set((state) => ({
          cookingHistory: [entry, ...state.cookingHistory].slice(0, HISTORY_CAP),
        })),

      rateCooking: (recipeId, rating, note) =>
        set((state) => ({
          cookingHistory: state.cookingHistory.map((entry) =>
            entry.recipeId === recipeId && entry.rating === undefined
              ? { ...entry, rating, note }
              : entry
          ),
          // Defensive: clear the dismissal flag if we're rating the same
          // recipe that was previously skipped. Without this, a stale id
          // can sit in state forever after a skip-then-rate-via-Memory.
          lastRatingPromptDismissedFor:
            state.lastRatingPromptDismissedFor === recipeId
              ? null
              : state.lastRatingPromptDismissedFor,
        })),

      dismissRatingPromptFor: (recipeId) =>
        set({ lastRatingPromptDismissedFor: recipeId }),

      saveToCookbook: (recipeId) =>
        set((state) =>
          state.cookbook.includes(recipeId)
            ? state
            : { cookbook: [recipeId, ...state.cookbook] }
        ),

      removeFromCookbook: (recipeId) =>
        set((state) => ({
          cookbook: state.cookbook.filter((id) => id !== recipeId),
        })),

      setPantryItems: (items) => set({ pantryItems: items }),
      setProactivityEnabled: (enabled) => set({ proactivityEnabled: enabled }),

      resetAll: async () => {
        // Wipe disk first, then memory. Order matters: if disk wipe fails,
        // we don't want to clear in-memory state and leave the user thinking
        // their data is gone when it'll come back on next reload.
        await clearAllPersistedData();
        set({ ...initialState });
      },
    }),
    {
      name: 'pastaio-memory',
      storage: createJSONStorage(() => sqliteStorage),
      // Only persist user data, not the actions. Zustand handles this
      // automatically (functions aren't serializable) but being explicit
      // keeps the persisted shape predictable for future migrations.
      partialize: (state) => ({
        dietaryRestrictions: state.dietaryRestrictions,
        observations: state.observations,
        cookingHistory: state.cookingHistory,
        cookbook: state.cookbook,
        pantryItems: state.pantryItems,
        proactivityEnabled: state.proactivityEnabled,
        lastRatingPromptDismissedFor: state.lastRatingPromptDismissedFor,
      }),
      // Bump on schema changes (e.g., adding/removing fields). When this
      // changes, persist middleware will run migrate() below.
      version: 2,
      migrate: (persistedState: any, version: number) => {
        // v1 → v2: added lastRatingPromptDismissedFor.
        // Existing users won't have it; default to null (no dismissal).
        if (version < 2) {
          return {
            ...persistedState,
            lastRatingPromptDismissedFor: null,
          };
        }
        return persistedState;
      },
    }
  )
);

/**
 * True after the persist middleware has finished loading from disk.
 * Components that need to render based on persisted data (e.g. Memory
 * tab showing the user's history) should check this to avoid showing
 * empty defaults during the brief hydration window.
 */
export function useMemoryHydrated(): boolean {
  // Cast through unknown because zustand's persist API attaches this as
  // a non-typed property on the store. It's stable across versions.
  return (useMemoryStore as unknown as {
    persist: { hasHydrated: () => boolean };
  }).persist.hasHydrated();
}