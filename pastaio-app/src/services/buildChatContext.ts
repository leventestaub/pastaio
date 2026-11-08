/**
 * Build ChatContext from current store state.
 *
 * Pure function — takes store snapshots in, produces wire-format ChatContext
 * out. Centralizing this here means there's exactly one place that knows
 * how to translate app state into agent context. Hooks call this; tests
 * can call it without a React tree.
 */
import type { ChatContext } from '@/services/backendTypes';
import type { ScreenName } from '@/types';
import type { useMemoryStore } from '@/stores/memoryStore';
import type { useSessionStore } from '@/stores/sessionStore';

type MemorySnapshot = ReturnType<typeof useMemoryStore.getState>;
type SessionSnapshot = ReturnType<typeof useSessionStore.getState>;

export function buildChatContext(
  session: SessionSnapshot,
  memory: MemorySnapshot
): ChatContext {
  return {
    active_recipe_id: session.activeRecipeId ?? null,
    active_shape: session.activeShape ?? null,
    current_screen: session.currentScreen,
    pantry_items: memory.pantryItems,
    dietary_restrictions: memory.dietaryRestrictions.map((r) => ({
      restriction: r.restriction,
      custom_text: r.customText,
    })),
    // The agent only needs recent IDs; cap matches what the prompt template
    // truncates to anyway, but cap here too to keep the wire payload small.
    recent_cooking_history: memory.cookingHistory.slice(0, 5).map((h) => h.recipeId),
    user_observations: memory.observations,
  };
}
