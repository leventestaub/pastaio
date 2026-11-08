/**
 * Backend wire types.
 *
 * Mirror app/schemas/chat.py and app/schemas/tools.py from the FastAPI
 * backend. Keeping in sync is manual for now — when backend models change,
 * update here. (Future: codegen from OpenAPI.)
 */
import type {
  StoredDietaryRestriction,
  StoredObservation,
  ScreenName,
} from '@/types';

// Mirrors app/schemas/tools.py :: ToolName
export type ToolName =
  | 'find_recipes'
  | 'get_recipe_details'
  | 'get_substitution_options'
  | 'open_recipe'
  | 'apply_substitution'
  | 'set_timer'
  | 'save_to_cookbook'
  | 'rate_recipe'
  | 'set_dietary_restriction'
  | 'note_user_observation'
  | 'start_identification'
  | 'open_cookbook'
  | 'start_cooking'
  | 'end_cooking';

export interface ToolCall {
  name: ToolName;
  // Argument shape varies per tool; the dispatcher narrows by `name`.
  arguments: Record<string, unknown>;
}

// Mirrors app/schemas/chat.py :: ChatMessage
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Mirrors app/schemas/chat.py :: ChatContext
export interface ChatContext {
  active_recipe_id?: string | null;
  active_shape?: string | null;
  current_screen?: ScreenName | null;
  pantry_items?: string[];
  dietary_restrictions?: Array<{
    restriction: StoredDietaryRestriction['restriction'];
    custom_text?: string;
  }>;
  recent_cooking_history?: string[];
  user_observations?: StoredObservation[];
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  context?: ChatContext;
}

export interface ChatResponse {
  text: string;
  tool_calls: ToolCall[];
  latency_ms: number;
}

export interface IdentifyResponse {
  shape: string;
  confidence: number;
  alternatives: Array<[string, number]>;
  latency_ms: number;
}
