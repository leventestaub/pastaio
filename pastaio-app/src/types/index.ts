/**
 * Type definitions shared across the app.
 *
 * These mirror the backend's Pydantic models in app/schemas/. Keeping them in
 * sync is currently manual — when a backend model changes, update here too.
 *
 * Future improvement: generate these from the FastAPI OpenAPI spec via
 * openapi-typescript. Not worth the toolchain setup until the schemas
 * stabilize further.
 */

// Mirrors app/schemas/tools.py :: DietaryRestriction
export type DietaryRestriction =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'dairy_free'
  | 'pescatarian'
  | 'no_pork'
  | 'no_shellfish'
  | 'custom';

// Mirrors app/schemas/tools.py :: ObservationCategory
export type ObservationCategory =
  | 'food'
  | 'interaction'
  | 'dietary'
  | 'regional'
  | 'cooking_style'
  | 'other';

// Mirrors app/schemas/chat.py :: StoredDietaryRestriction
export interface StoredDietaryRestriction {
  restriction: DietaryRestriction;
  customText?: string; // required when restriction === 'custom'
}

// Mirrors app/schemas/chat.py :: StoredObservation
export interface StoredObservation {
  observation: string;
  category: ObservationCategory;
  context: string;
}

// Local-only for now — recipes will be loaded from bundled SQLite KB later.
// This shape is provisional; the KB schema work in week 3 will likely refine it.
export interface Recipe {
  id: string;
  name: string;
  shape: string;
  region: string;
  cookTimeMinutes: number;
  briefDescription: string;
}

// A single past cooking session. Used for recent_cooking_history in ChatContext.
export interface CookingHistoryEntry {
  recipeId: string;
  cookedAt: number; // unix ms
  rating?: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

// Active timer in cooking mode.
export interface ActiveTimer {
  id: string;
  durationMinutes: number;
  label?: string;
  startedAt: number; // unix ms; remaining computed from this + duration
}

// The screens the agent can be told the user is on, via ChatContext.current_screen.
// Mirrors the values listed in the backend's ChatContext docstring.
export type ScreenName =
  | 'home'
  | 'cookbook'
  | 'memory'
  | 'identify'
  | 'recipe'
  | 'cooking';
