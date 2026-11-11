/**
 * Tool dispatcher.
 *
 * Runs the action tools the backend's agent loop hands back: navigation,
 * timers and memory writes, i.e. state the app owns. The data tools
 * (find_recipes, get_recipe_details, get_substitution_options) run on the
 * server, which also validates every call and resolves recipe IDs against
 * the KB, so the IDs that arrive here are real.
 */
import { router } from 'expo-router';
import type { ToolCall } from '@/services/backendTypes';
import { useMemoryStore } from '@/stores/memoryStore';
import { useCookingStore } from '@/stores/cookingStore';
import type { DietaryRestriction, ObservationCategory } from '@/types';
import { logToolDispatch, logToolResult, logError } from '@/services/devLog';

export interface DispatchResult {
  summary: string;
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

  logToolResult(call.name, null, result.summary);
  return result;
}

async function dispatch(
  call: ToolCall,
  args: Record<string, any>,
): Promise<DispatchResult> {
  switch (call.name) {
    // ── write tools ────────────────────────────────────────────
    case 'open_recipe':
      router.push(`/recipe/${args.recipe_id}`);
      return { summary: `Opened recipe ${args.recipe_id}` };

    case 'apply_substitution': {
      const original = String(args.original ?? '');
      const replacement = String(args.replacement ?? '');
      if (!original || !replacement) {
        return { summary: 'apply_substitution: missing fields' };
      }
      useCookingStore.getState().applySubstitution({ original, replacement });
      return { summary: `Substituted ${original} → ${replacement}` };
    }

    case 'set_timer': {
      const duration = Number(args.duration_minutes);
      if (!Number.isFinite(duration) || duration <= 0) {
        return { summary: 'set_timer: invalid duration' };
      }
      useCookingStore.getState().startTimer({
        durationMinutes: duration,
        label: args.label ? String(args.label) : undefined,
      });
      return { summary: `Started ${duration}m timer` };
    }

    case 'save_to_cookbook':
      useMemoryStore.getState().saveToCookbook(args.recipe_id);
      return { summary: `Saved ${args.recipe_id}` };

    case 'rate_recipe': {
      const rating = Number(args.rating);
      if (![1, 2, 3, 4, 5].includes(rating)) {
        return { summary: 'rate_recipe: invalid rating' };
      }
      useMemoryStore
        .getState()
        .rateCooking(
          args.recipe_id,
          rating as 1 | 2 | 3 | 4 | 5,
          args.note ? String(args.note) : undefined,
        );
      return { summary: `Rated ${args.recipe_id} ★${rating}` };
    }

    case 'set_dietary_restriction': {
      const restriction = args.restriction as DietaryRestriction;
      useMemoryStore.getState().addRestriction({
        restriction,
        customText: args.custom_text ? String(args.custom_text) : undefined,
      });
      return { summary: `Added restriction: ${restriction}` };
    }

    case 'note_user_observation': {
      useMemoryStore.getState().addObservation({
        observation: String(args.observation ?? ''),
        category: (args.category as ObservationCategory) ?? 'other',
        context: String(args.context ?? ''),
      });
      return { summary: 'Noted observation' };
    }

    // ── navigation tools ───────────────────────────────────────
    case 'start_identification':
      router.push('/identify');
      return { summary: 'Opened identify' };

    case 'open_cookbook':
      router.push('/(tabs)/cookbook');
      return { summary: 'Opened cookbook' };

    case 'start_cooking':
      useCookingStore.getState().startCooking(args.recipe_id);
      router.push(`/cooking/${args.recipe_id}`);
      return { summary: `Started cooking ${args.recipe_id}` };

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
      return { summary: 'Ended cooking session' };
    }

    default:
      console.warn('[dispatcher] unknown tool:', call.name);
      return { summary: `Unknown tool: ${call.name}` };
  }
}