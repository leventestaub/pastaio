/**
 * Tool dispatcher.
 *
 * Bridges agent tool calls and app state. Read tools return data fed
 * back to the LLM; write/nav tools mutate state and terminate the loop.
 *
 * Recipe ID handling has three layers:
 *   1. isPlausibleRecipeId — cheap syntactic check; rejects placeholder
 *      strings ("active_recipe_id") and obvious garbage.
 *   2. resolveOrReject — runs the syntactic check, then tries the KB
 *      directly, then falls back to fuzzy resolution. Returns the
 *      resolved real ID or null. This is what callers should use.
 *   3. resolveFuzzyRecipeId in kb.ts — token-overlap match against real
 *      IDs. Catches LLM hallucinations like "trofie-pesto-genovese" →
 *      "trofie-al-pesto". Conservative: only resolves when the match
 *      is unambiguous (≥2 shared tokens, exactly one match).
 */
import { router } from 'expo-router';
import type { ToolCall } from '@/services/backendTypes';
import {
  findRecipes as kbFindRecipes,
  getRecipeDetails as kbGetRecipeDetails,
  getSubstitutionOptions as kbGetSubstitutionOptions,
  recipeExists as kbRecipeExists,
  resolveFuzzyRecipeId,
} from '@/services/kb';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useCookingStore } from '@/stores/cookingStore';
import type { DietaryRestriction, ObservationCategory } from '@/types';
import { logToolDispatch, logToolResult, logError } from '@/services/devLog';

export interface DispatchResult {
  toolResult: unknown | null;
  summary: string;
}

const PLACEHOLDER_RECIPE_IDS = new Set([
  'active_recipe_id',
  'current_recipe',
  'current_recipe_id',
  'recipe_id',
  'the_recipe',
  'this_recipe',
]);

function isPlausibleRecipeId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_RECIPE_IDS.has(trimmed.toLowerCase())) return false;
  return /^[a-z0-9-]{3,80}$/.test(trimmed);
}

/**
 * Resolve a candidate recipe_id to a real one in the KB, or return null.
 *
 * Three steps:
 *   1. Syntactic check (placeholder strings, obvious garbage)
 *   2. Direct KB existence check
 *   3. Fuzzy match against real IDs (catches hallucinations)
 *
 * Logs the fuzzy resolution when it fires so we can spot the LLM's
 * confabulation patterns without digging through traces.
 */
async function resolveRecipeId(candidate: unknown): Promise<string | null> {
  if (!isPlausibleRecipeId(candidate)) return null;
  if (await kbRecipeExists(candidate)) return candidate;

  const fuzzy = await resolveFuzzyRecipeId(candidate);
  if (fuzzy) {
    console.log(
      `[dispatcher] fuzzy-resolved '${candidate}' -> '${fuzzy}'`,
    );
    return fuzzy;
  }
  return null;
}

export async function dispatchToolCall(
  call: ToolCall,
): Promise<DispatchResult> {
  const args = call.arguments;
  logToolDispatch(call.name, args);

  let result: DispatchResult;
  try {
    result = await dispatch(call, args);
  } catch (err) {
    logError(`dispatch ${call.name}`, err);
    throw err;
  }

  logToolResult(call.name, result.toolResult, result.summary);
  return result;
}

async function dispatch(
  call: ToolCall,
  args: Record<string, any>,
): Promise<DispatchResult> {
  switch (call.name) {
    // ── read tools ─────────────────────────────────────────────
    case 'find_recipes': {
      const shape = args.shape ? String(args.shape).toLowerCase() : undefined;
      const query = args.query ? String(args.query) : undefined;
      const recipes = await kbFindRecipes({ shape_id: shape, query, limit: 10 });
      const trimmed = recipes.map((r) => ({
        recipe_id: r.recipe_id,
        title: r.title,
        region_id: r.region_id,
        cook_time_minutes: r.cook_time_minutes,
      }));
      return {
        toolResult: { recipes: trimmed },
        summary:
          recipes.length === 0
            ? 'No recipes match'
            : `Found ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`,
      };
    }

    case 'get_recipe_details': {
      const resolved = await resolveRecipeId(args.recipe_id);
      if (!resolved) {
        return {
          toolResult: {
            error: `recipe_id '${String(args.recipe_id)}' is not a valid ID. Call find_recipes to discover real IDs.`,
          },
          summary: `Rejected invalid recipe_id ${String(args.recipe_id)}`,
        };
      }
      const recipe = await kbGetRecipeDetails(resolved);
      if (!recipe) {
        // Should be unreachable since resolveRecipeId already confirmed
        // existence, but defensive in case of races.
        return {
          toolResult: { error: `Recipe '${resolved}' not found.` },
          summary: `Recipe ${resolved} not found`,
        };
      }
      return {
        toolResult: { recipe },
        summary:
          resolved !== args.recipe_id
            ? `Fetched ${resolved} (fuzzy-matched from ${args.recipe_id})`
            : `Fetched recipe ${resolved}`,
      };
    }

    case 'get_substitution_options': {
      const missing = args.missing_ingredient
        ? String(args.missing_ingredient)
        : '';
      if (!missing.trim()) {
        return {
          toolResult: { error: 'missing_ingredient is required' },
          summary: 'get_substitution_options: missing arg',
        };
      }
      // recipe_id here is optional refinement, so fuzzy-resolution is
      // safe — bogus ID just falls back to universal scope.
      const resolvedRecipeId =
        args.recipe_id ? await resolveRecipeId(args.recipe_id) : null;
      const options = await kbGetSubstitutionOptions({
        missing_ingredient: missing,
        recipe_id: resolvedRecipeId ?? undefined,
      });
      const wireOptions = options.map((o) => ({
        replacement: o.replacement_ingredient,
        reasoning: o.reasoning,
        score: o.score,
        scope: o.scope,
      }));
      return {
        toolResult: { options: wireOptions, missing_ingredient: missing },
        summary:
          wireOptions.length === 0
            ? `No substitution rules for ${missing}`
            : `Found ${wireOptions.length} substitution${wireOptions.length === 1 ? '' : 's'} for ${missing}`,
      };
    }

    // ── write tools ────────────────────────────────────────────
    case 'open_recipe': {
      const resolved = await resolveRecipeId(args.recipe_id);
      if (!resolved) {
        return {
          toolResult: null,
          summary: `open_recipe: ${String(args.recipe_id)} not found`,
        };
      }
      router.push(`/recipe/${resolved}`);
      return {
        toolResult: null,
        summary:
          resolved !== args.recipe_id
            ? `Opened ${resolved} (fuzzy-matched from ${args.recipe_id})`
            : `Opened recipe ${resolved}`,
      };
    }

    case 'apply_substitution': {
      const original = String(args.original ?? '');
      const replacement = String(args.replacement ?? '');
      if (!original || !replacement) {
        return { toolResult: null, summary: 'apply_substitution: missing fields' };
      }
      useCookingStore.getState().applySubstitution({ original, replacement });
      return {
        toolResult: null,
        summary: `Substituted ${original} → ${replacement}`,
      };
    }

    case 'set_timer': {
      const duration = Number(args.duration_minutes);
      if (!Number.isFinite(duration) || duration <= 0) {
        return { toolResult: null, summary: 'set_timer: invalid duration' };
      }
      useCookingStore.getState().startTimer({
        durationMinutes: duration,
        label: args.label ? String(args.label) : undefined,
      });
      return { toolResult: null, summary: `Started ${duration}m timer` };
    }

    case 'save_to_cookbook': {
      const resolved = await resolveRecipeId(args.recipe_id);
      if (!resolved) {
        return {
          toolResult: null,
          summary: `save_to_cookbook: ${String(args.recipe_id)} not found`,
        };
      }
      useMemoryStore.getState().saveToCookbook(resolved);
      return {
        toolResult: null,
        summary:
          resolved !== args.recipe_id
            ? `Saved ${resolved} (fuzzy-matched from ${args.recipe_id})`
            : `Saved ${resolved}`,
      };
    }

    case 'rate_recipe': {
      const rating = Number(args.rating);
      if (![1, 2, 3, 4, 5].includes(rating)) {
        return { toolResult: null, summary: 'rate_recipe: invalid rating' };
      }
      const resolved = await resolveRecipeId(args.recipe_id);
      if (!resolved) {
        return {
          toolResult: null,
          summary: `rate_recipe: ${String(args.recipe_id)} not found`,
        };
      }
      useMemoryStore
        .getState()
        .rateCooking(
          resolved,
          rating as 1 | 2 | 3 | 4 | 5,
          args.note ? String(args.note) : undefined,
        );
      return { toolResult: null, summary: `Rated ${resolved} ★${rating}` };
    }

    case 'set_dietary_restriction': {
      const restriction = args.restriction as DietaryRestriction;
      useMemoryStore.getState().addRestriction({
        restriction,
        customText: args.custom_text ? String(args.custom_text) : undefined,
      });
      return { toolResult: null, summary: `Added restriction: ${restriction}` };
    }

    case 'note_user_observation': {
      useMemoryStore.getState().addObservation({
        observation: String(args.observation ?? ''),
        category: (args.category as ObservationCategory) ?? 'other',
        context: String(args.context ?? ''),
      });
      return { toolResult: null, summary: 'Noted observation' };
    }

    // ── navigation tools ───────────────────────────────────────
    case 'start_identification':
      router.push('/identify');
      return { toolResult: null, summary: 'Opened identify' };

    case 'open_cookbook':
      router.push('/(tabs)/cookbook');
      return { toolResult: null, summary: 'Opened cookbook' };

    case 'start_cooking': {
      const resolved = await resolveRecipeId(args.recipe_id);
      if (!resolved) {
        return {
          toolResult: null,
          summary: `start_cooking: ${String(args.recipe_id)} not found`,
        };
      }
      useCookingStore.getState().startCooking(resolved);
      router.push(`/cooking/${resolved}`);
      return {
        toolResult: null,
        summary:
          resolved !== args.recipe_id
            ? `Started cooking ${resolved} (fuzzy-matched from ${args.recipe_id})`
            : `Started cooking ${resolved}`,
      };
    }

    case 'end_cooking': {
      const cookingRecipeId = useCookingStore.getState().cookingRecipeId;
      if (cookingRecipeId) {
        useMemoryStore.getState().recordCooking({
          recipeId: cookingRecipeId,
          cookedAt: Date.now(),
        });
      }
      useCookingStore.getState().endCooking();
      router.dismissAll();
      return { toolResult: null, summary: 'Ended cooking session' };
    }

    default:
      console.warn('[dispatcher] unknown tool:', call.name);
      return { toolResult: null, summary: `Unknown tool: ${call.name}` };
  }
}