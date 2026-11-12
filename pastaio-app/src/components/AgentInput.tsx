/**
 * AgentInput — ephemeral bottom sheet, four phases.
 *
 * Two response modalities, switching on whether tool calls fired:
 *
 *   IDLE     → input + suggestion chips
 *   THINKING → animated dots
 *
 *   CONFIRM  → action response (write/nav tool fired). Short warm copy
 *              + auto-dismiss + "Follow up" link. The action visibly
 *              happened on the screen behind, so the sheet stays
 *              minimal — Mode B per FUNCTIONALITY_MAP §5.
 *
 *   ANSWER   → text-only response (no write/nav tool fired). Full text,
 *              scrolls internally if long, manual dismiss only,
 *              follow-up input always visible. Used when the agent
 *              answers a question directly — recipe descriptions,
 *              "how do I know it's done", regional context, etc.
 *
 * Read tools (find_recipes, get_recipe_details, get_substitution_options)
 * don't change visible screen state, so they don't gate CONFIRM. Their
 * results feed into the assistant's text response which surfaces in
 * ANSWER mode.
 *
 * No persistent chat history (the sheet resets on close) and no transcript:
 * each exchange shows the question, the latest response and, under it, how
 * Pastaio got there (the backend's per-call trace summaries and guards).
 *
 * Wiring: useChat() runs the multi-turn loop unchanged. We subscribe to
 * its turns/isLoading state. `turnsAtSubmitRef` scopes derivation to
 * the latest exchange — without it, a follow-up would surface stale
 * tool calls from the previous exchange.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { Chip } from '@/components/primitives/Chip';
import { useSessionStore } from '@/stores/sessionStore';
import { useChat } from '@/hooks/useChat';
import { colors, fonts, motion, radii } from '@/constants/theme';
import type { ToolCall, TraceStep } from '@/services/backendTypes';

// CONFIRM auto-dismiss timing. Length-scaled because canned 2.2s was
// unreadable for anything past 6 words.
const DISMISS_BASE_MS = 1500;
const DISMISS_PER_CHAR_MS = 50;
const DISMISS_CAP_MS = 10000;

function dismissTimeFor(text: string): number {
  return Math.min(
    DISMISS_CAP_MS,
    DISMISS_BASE_MS + DISMISS_PER_CHAR_MS * text.length,
  );
}

type Phase = 'idle' | 'thinking' | 'confirm' | 'answer';

interface ExchangeResult {
  phase: 'confirm' | 'answer';
  copy: string;
  steps: TraceLine[];
}

interface TraceLine {
  text: string;
  guard: boolean;
}

export function AgentInput() {
  const isOpen = useSessionStore((s) => s.agentInputOpen);
  const close = useSessionStore((s) => s.closeAgentInput);
  const currentScreen = useSessionStore((s) => s.currentScreen);

  const { turns, isLoading, error, send, reset } = useChat();
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ExchangeResult | null>(null);
  const [autoDismissPaused, setAutoDismissPaused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const followUpInputRef = useRef<TextInput>(null);

  // Tracks turns count at the moment of latest submission. Confirmation/
  // answer derivation considers only turns AFTER this index, so a
  // follow-up doesn't surface stale copy from the previous exchange.
  const turnsAtSubmitRef = useRef<number>(0);

  // Reset on fresh open. Follow-up re-entry doesn't flip isOpen, so
  // this effect doesn't fire then.
  useEffect(() => {
    if (isOpen) {
      reset();
      setDraft('');
      setQuestion('');
      setPhase('idle');
      setResult(null);
      setAutoDismissPaused(false);
      turnsAtSubmitRef.current = 0;
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isOpen, reset]);

  // Translate useChat state → phase + result. Scoped to the latest
  // exchange via turnsAtSubmitRef.
  useEffect(() => {
    if (!isOpen) return;

    if (error) {
      setResult({ phase: 'confirm', copy: error, steps: [] });
      setPhase('confirm');
      return;
    }

    if (isLoading) {
      if (phase === 'idle' && turns.length > turnsAtSubmitRef.current) {
        setPhase('thinking');
      }
      return;
    }

    if (turns.length <= turnsAtSubmitRef.current) {
      return;
    }

    const newTurns = turns.slice(turnsAtSubmitRef.current);
    const lastAssistantInExchange = [...newTurns]
      .reverse()
      .find((t) => t.role === 'assistant');
    const exchangeToolCalls = newTurns.flatMap((t) => t.toolCalls ?? []);

    // Modality decision:
    //   - Any write/nav tool call fired (priority ≥80) → CONFIRM mode.
    //     The action visibly happened on the screen behind.
    //   - Otherwise → ANSWER mode. Show the assistant text. Includes
    //     the read-tools-only case (find_recipes, get_recipe_details,
    //     get_substitution_options) — these don't change visible state,
    //     so the model's text summarizing them IS the response.
    const fullText = lastAssistantInExchange?.content?.trim() ?? '';
    const steps = traceLines(newTurns.flatMap((t) => t.trace ?? []));
    const hasActionTool = exchangeToolCalls.some(
      (tc) => (TOOL_PRIORITY[tc.name] ?? 0) >= 80,
    );

    if (hasActionTool) {
      const copy = buildConfirmationCopy({
        assistantText: fullText,
        toolCalls: exchangeToolCalls,
      });
      setResult({ phase: 'confirm', copy, steps });
      setPhase('confirm');
    } else {
      setResult({ phase: 'answer', copy: fullText || 'Done.', steps });
      setPhase('answer');
    }
  }, [isOpen, isLoading, error, turns, phase]);

  // Auto-dismiss only in CONFIRM. ANSWER stays open.
  useEffect(() => {
    if (phase !== 'confirm') return;
    if (autoDismissPaused) return;
    if (!result) return;
    const ms = dismissTimeFor(result.copy);
    const t = setTimeout(() => close(), ms);
    return () => clearTimeout(t);
  }, [phase, autoDismissPaused, result, close]);

  const handleSubmit = (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || isLoading) return;
    setDraft('');
    setQuestion(message);
    setPhase('thinking');
    setAutoDismissPaused(false);
    setResult(null);
    turnsAtSubmitRef.current = turns.length;
    send(message);
  };

  // CONFIRM → IDLE, preserving useChat state for true multi-turn.
  const handleFollowUp = () => {
    setPhase('idle');
    setAutoDismissPaused(false);
    setResult(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ANSWER's inline input — submits without going through idle.
  const handleAnswerSubmit = () => {
    const message = draft.trim();
    if (!message || isLoading) return;
    handleSubmit(message);
  };

  if (!isOpen) return null;

  const contextLabel = labelForScreen(currentScreen);
  const suggestions = suggestionsForScreen(currentScreen);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={styles.scrim}
        onPress={() => {
          if (phase === 'thinking') return;
          close();
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}
        pointerEvents="box-none"
      >
        <SlideUp visible={isOpen}>
          <Pressable
            onPress={() => setAutoDismissPaused(true)}
            style={styles.sheet}
          >
            <View style={styles.handle} />

            {contextLabel && (
              <Text variant="mono" style={{ marginBottom: 10 }}>
                {contextLabel}
              </Text>
            )}

            {phase === 'idle' && (
              <View>
                <View style={styles.inputCard}>
                  <SparkIcon size={16} color={colors.passata} />
                  <TextInput
                    ref={inputRef}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Ask Pastaio…"
                    placeholderTextColor={colors.ink50}
                    onSubmitEditing={() => handleSubmit()}
                    returnKeyType="send"
                    style={styles.input}
                    blurOnSubmit={false}
                  />
                  <Pressable
                    onPress={() => handleSubmit()}
                    disabled={!draft.trim()}
                    style={({ pressed }) => [
                      styles.sendButton,
                      !draft.trim() && { opacity: 0.4 },
                      pressed && { opacity: 0.7 },
                    ]}
                    hitSlop={6}
                  >
                    <ArrowRightIcon size={14} color={colors.bone} />
                  </Pressable>
                </View>

                <View style={{ marginTop: 16 }}>
                  <Text variant="mono" style={{ marginBottom: 8 }}>
                    Try
                  </Text>
                  <View style={styles.chipRow}>
                    {suggestions.map((s) => (
                      <Chip
                        key={s}
                        label={s}
                        onPress={() => {
                          setDraft(s);
                          setTimeout(() => handleSubmit(s), 0);
                        }}
                      />
                    ))}
                  </View>
                </View>
              </View>
            )}

            {phase !== 'idle' && question !== '' && (
              <Text variant="body" style={styles.question}>
                {question}
              </Text>
            )}

            {phase === 'thinking' && (
              <View style={styles.thinkingRow}>
                <ThinkingDots />
                <Text
                  variant="body"
                  muted
                  style={{ fontStyle: 'italic', marginLeft: 12 }}
                >
                  Pastaio is thinking…
                </Text>
              </View>
            )}

            {phase === 'confirm' && result && (
              <View>
                <View style={styles.confirmRow}>
                  <View style={styles.confirmIcon}>
                    <SparkIcon size={13} color={colors.ink70} />
                  </View>
                  <Text variant="body" style={styles.confirmText}>
                    {result.copy}
                  </Text>
                </View>
                <TraceList steps={result.steps} />

                <View style={styles.confirmActions}>
                  <Pressable onPress={handleFollowUp} hitSlop={6}>
                    <Text
                      style={{
                        fontFamily: fonts.sansMedium,
                        fontSize: 13,
                        color: colors.passata,
                      }}
                    >
                      Follow up →
                    </Text>
                  </Pressable>
                  <Pressable onPress={close} hitSlop={6}>
                    <Text variant="mono" muted>
                      Done
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {phase === 'answer' && result && (
              <View>
                {/* Internal scroll — caps at 320 so input stays reachable
                    above the keyboard on shorter devices. */}
                <ScrollView
                  style={{ maxHeight: 320 }}
                  contentContainerStyle={{ paddingBottom: 4 }}
                  showsVerticalScrollIndicator
                >
                  <View style={styles.confirmRow}>
                    <View style={styles.confirmIcon}>
                      <SparkIcon size={13} color={colors.ink70} />
                    </View>
                    <Text variant="body" style={styles.confirmText}>
                      {result.copy}
                    </Text>
                  </View>
                  <TraceList steps={result.steps} />
                </ScrollView>

                {/* Persistent follow-up input. Submitting kicks the
                    same flow as initial submit — turnsAtSubmitRef
                    snapshots before send so derivation only sees the
                    new exchange. */}
                <View style={[styles.inputCard, { marginTop: 12 }]}>
                  <SparkIcon size={16} color={colors.passata} />
                  <TextInput
                    ref={followUpInputRef}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Ask a follow-up…"
                    placeholderTextColor={colors.ink50}
                    onSubmitEditing={handleAnswerSubmit}
                    returnKeyType="send"
                    style={styles.input}
                    blurOnSubmit={false}
                  />
                  <Pressable
                    onPress={handleAnswerSubmit}
                    disabled={!draft.trim() || isLoading}
                    style={({ pressed }) => [
                      styles.sendButton,
                      (!draft.trim() || isLoading) && { opacity: 0.4 },
                      pressed && { opacity: 0.7 },
                    ]}
                    hitSlop={6}
                  >
                    <ArrowRightIcon size={14} color={colors.bone} />
                  </Pressable>
                </View>

                <View style={[styles.confirmActions, { borderTopWidth: 0, paddingTop: 10 }]}>
                  <View />
                  <Pressable onPress={close} hitSlop={6}>
                    <Text variant="mono" muted>
                      Done
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Pressable>
        </SlideUp>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Confirmation copy (CONFIRM mode only) ──────────────────────────

const TOOL_PRIORITY: Record<string, number> = {
  open_recipe: 100,
  start_cooking: 100,
  end_cooking: 100,
  open_cookbook: 100,
  start_identification: 100,
  apply_substitution: 80,
  set_timer: 80,
  save_to_cookbook: 80,
  rate_recipe: 80,
  set_dietary_restriction: 80,
  note_user_observation: 80,
  // Read tools — don't change visible state, don't gate CONFIRM.
  find_recipes: 30,
  get_recipe_details: 30,
  get_substitution_options: 30,
};

function buildConfirmationCopy(args: {
  assistantText: string;
  toolCalls: ToolCall[];
}): string {
  if (args.toolCalls.length > 0) {
    const sorted = [...args.toolCalls].sort(
      (a, b) => (TOOL_PRIORITY[b.name] ?? 0) - (TOOL_PRIORITY[a.name] ?? 0),
    );
    const primary = sorted[0];
    const copy = copyForTool(primary);
    if (copy) return copy;
  }
  if (args.assistantText.trim()) {
    return args.assistantText.trim();
  }
  return 'Done.';
}

function copyForTool(call: ToolCall): string | null {
  const args = call.arguments;
  switch (call.name) {
    case 'open_recipe':
      return 'Opening the recipe.';
    case 'start_cooking':
      return 'Starting the cooking flow.';
    case 'end_cooking':
      return 'Ending the cooking session.';
    case 'open_cookbook':
      return 'Opening your cookbook.';
    case 'start_identification':
      return "Open the camera when you're ready.";
    case 'apply_substitution': {
      const orig = strArg(args, 'original_ingredient') ?? strArg(args, 'missing_ingredient');
      const repl = strArg(args, 'replacement') ?? strArg(args, 'replacement_ingredient');
      if (orig && repl) return `Substituted ${orig.toLowerCase()} → ${repl.toLowerCase()}.`;
      if (repl) return `Substituted with ${repl.toLowerCase()}.`;
      return 'Substitution applied.';
    }
    case 'set_timer': {
      const mins = numArg(args, 'duration_minutes') ?? numArg(args, 'minutes');
      if (mins) return `Set a ${mins}-minute timer.`;
      return 'Timer started.';
    }
    case 'save_to_cookbook':
      return 'Saved to your cookbook.';
    case 'rate_recipe': {
      const r = numArg(args, 'rating');
      return r ? `Rated ${r} star${r === 1 ? '' : 's'}.` : 'Rating saved.';
    }
    case 'set_dietary_restriction': {
      const r = strArg(args, 'restriction');
      return r ? `Noted: ${r.replace(/_/g, '-')}.` : 'Dietary preference saved.';
    }
    case 'note_user_observation':
      return 'Noted.';
    case 'find_recipes':
    case 'get_recipe_details':
    case 'get_substitution_options':
      return null;
    default:
      return null;
  }
}

function strArg(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function numArg(args: Record<string, unknown>, key: string): number | null {
  const v = args[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ─── How Pastaio answered ───────────────────────────────────────────

function traceLines(trace: TraceStep[]): TraceLine[] {
  return trace.flatMap((step) => [
    ...step.calls.flatMap((c) => (c.summary ? [{ text: c.summary, guard: false }] : [])),
    ...(step.guard ? [{ text: step.guard, guard: true }] : []),
  ]);
}

function TraceList({ steps }: { steps: TraceLine[] }) {
  if (steps.length === 0) return null;
  return (
    <View style={styles.trace}>
      <Text variant="mono" muted style={{ marginBottom: 6 }}>
        How Pastaio answered
      </Text>
      {steps.map((s, i) => (
        <Text key={i} variant="meta" style={[styles.traceLine, s.guard && { color: colors.passata }]}>
          {s.guard ? `Guard: ${s.text}` : s.text}
        </Text>
      ))}
    </View>
  );
}

// ─── Per-screen suggestions and labels ──────────────────────────────

function labelForScreen(screen: string | null | undefined): string | null {
  switch (screen) {
    case 'recipe':   return 'On this recipe';
    case 'cooking':  return 'While cooking';
    case 'identify': return 'After identifying';
    case 'cookbook': return 'In your cookbook';
    case 'discover': return 'Browsing';
    case 'home':
    default:         return null;
  }
}

function suggestionsForScreen(screen: string | null | undefined): string[] {
  switch (screen) {
    case 'recipe':
      return ['Scale this for 2 people', 'How long does this take?', 'What pairs with this?'];
    case 'cooking':
      return ['Help with this step', 'Set a 10-min timer', "How do I know it's done?"];
    case 'identify':
      return ['Find recipes with this', 'What region is this from?'];
    case 'cookbook':
      return ['What should I cook tonight?', 'Anything quick?'];
    case 'discover':
    case 'home':
    default:
      return ['What should I cook tonight?', 'Anything vegetarian?', 'Set a 10-min timer'];
  }
}

// ─── Animation primitives ───────────────────────────────────────────

function SlideUp({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const translate = useRef(new Animated.Value(visible ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(translate, {
      toValue: visible ? 0 : 1,
      duration: motion.base,
      easing: Easing.bezier(...motion.easing),
      useNativeDriver: true,
    }).start();
  }, [visible, translate]);

  return (
    <Animated.View
      style={{
        transform: [
          {
            translateY: translate.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 600],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function ThinkingDots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x + 1) % 4), 360);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.passata,
            opacity: n === i ? 1 : 0.25,
          }}
        />
      ))}
    </View>
  );
}

function SparkIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L13.8 8.4 L19 10 L13.8 11.6 L12 17 L10.2 11.6 L5 10 L10.2 8.4 Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ArrowRightIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12 H 18 M 13 6 L 19 12 L 13 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20, 14, 8, 0.32)',
  },
  keyboardWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 14,
    paddingHorizontal: 18,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ink15,
    alignSelf: 'center',
    marginBottom: 14,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.paperHi,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: radii.md,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sansRegular,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: 0,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.passata,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  thinkingRow: {
    paddingVertical: 20,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmRow: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  confirmIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.paperHi,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  confirmText: {
    flex: 1,
    color: colors.ink,
    lineHeight: 22,
  },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.paperHi,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
    color: colors.ink70,
  },
  trace: {
    marginLeft: 38,
    marginBottom: 6,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: colors.ink15,
  },
  traceLine: {
    color: colors.ink50,
    lineHeight: 18,
    marginBottom: 2,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    marginTop: 4,
  },
});
