/**
 * Session store — state that lives only while the app is open.
 *
 * Resets on app close (no persistence). This is the source of truth the
 * `current_screen` field in ChatContext is built from, and where the active
 * recipe / shape live so screens and the agent stay aligned.
 *
 * Also tracks whether the agent input field is currently open. That's
 * arguably ephemeral UI state, but it's needed across screens (any screen
 * can summon the input) so a store is the right place.
 */
import { create } from 'zustand';
import type { ScreenName } from '@/types';

export interface CookingStep {
  number: number; // 1-based, as shown on screen
  total: number;
  text: string;
}

interface SessionState {
  // The screen the user is currently viewing. Set via setCurrentScreen on
  // navigation events. Sent to the backend in ChatContext.current_screen.
  currentScreen: ScreenName;

  // The recipe the user is currently looking at, if any. Reference resolution
  // ("that recipe", "save it") resolves to this value on the app side before
  // sending to the LLM — see Spike 2 mitigation.
  activeRecipeId: string | null;

  // The pasta shape from the most recent /identify call, if any. Persists
  // across screen navigations until the user identifies again or it's cleared.
  activeShape: string | null;

  // The step on screen in cooking mode, so "this step" resolves without a
  // tool call. Set by the cooking screen; null everywhere else.
  cookingStep: CookingStep | null;

  // Whether the agent input field is currently summoned. Any screen with an
  // agent affordance flips this on; the input itself flips it off when dismissed.
  agentInputOpen: boolean;

  // ── actions ──────────────────────────────────────────────────────────

  setCurrentScreen: (screen: ScreenName) => void;
  setActiveRecipeId: (id: string | null) => void;
  setActiveShape: (shape: string | null) => void;
  setCookingStep: (step: CookingStep | null) => void;
  openAgentInput: () => void;
  closeAgentInput: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  currentScreen: 'home',
  activeRecipeId: null,
  activeShape: null,
  cookingStep: null,
  agentInputOpen: false,

  setCurrentScreen: (screen) => set({ currentScreen: screen }),
  setActiveRecipeId: (id) => set({ activeRecipeId: id }),
  setActiveShape: (shape) => set({ activeShape: shape }),
  setCookingStep: (step) => set({ cookingStep: step }),
  openAgentInput: () => set({ agentInputOpen: true }),
  closeAgentInput: () => set({ agentInputOpen: false }),
}));
