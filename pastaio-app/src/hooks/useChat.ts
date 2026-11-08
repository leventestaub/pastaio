/**
 * useChat — ephemeral agent conversation.
 *
 * Logging: each .send() logs the request boundary, the user message,
 * each backend round-trip, and the final outcome. Tool dispatches log
 * themselves from inside dispatchToolCall.
 */
import { useState, useCallback } from 'react';
import { backend, BackendError } from '@/services/backend';
import { buildChatContext } from '@/services/buildChatContext';
import { dispatchToolCall } from '@/services/toolDispatcher';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { ChatMessage, ToolCall } from '@/services/backendTypes';
import {
  logRequestStart,
  logUserInput,
  logBackendCall,
  logBackendResponse,
  logError,
  logDone,
} from '@/services/devLog';

const READ_TOOLS = new Set([
  'find_recipes',
  'get_recipe_details',
  'get_substitution_options',
]);

const MAX_TOOL_ROUND_TRIPS = 6;

export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
}

export interface UseChatResult {
  turns: ChatTurn[];
  isLoading: boolean;
  error: string | null;
  send: (message: string) => Promise<void>;
  reset: () => void;
}

export function useChat(): UseChatResult {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (message: string) => {
    setError(null);
    setIsLoading(true);

    // Snapshot for logging only. The context used in each backend call
    // is rebuilt inside the loop below so it reflects state changes
    // made by tool dispatches in prior iterations.
    const initialContext = buildChatContext(
      useSessionStore.getState(),
      useMemoryStore.getState()
    );

    logRequestStart('user message');
    logUserInput(message, initialContext);

    const history: ChatMessage[] = turns
      .filter((t) => t.role === 'user' || t.role === 'assistant')
      .map((t) => ({
        role: t.role as 'user' | 'assistant',
        content: t.content,
      }));

    setTurns((prev) => [...prev, { role: 'user', content: message }]);

    let currentMessage = message;
    let currentHistory = history;

    try {
      for (let i = 0; i < MAX_TOOL_ROUND_TRIPS; i++) {
        // Rebuild ChatContext each iteration so the system prompt
        // reflects state mutations from prior tool dispatches in this
        // same .send() call. Cheap pure function on store snapshots.
        const context = buildChatContext(
          useSessionStore.getState(),
          useMemoryStore.getState()
        );

        const t0 = Date.now();
        logBackendCall(
          '/chat',
          `iter=${i} history=${currentHistory.length} msg=${currentMessage.slice(0, 60)}`
        );

        const response = await backend.chat({
          message: currentMessage,
          history: currentHistory,
          context,
        });

        const dt = Date.now() - t0;
        logBackendResponse(
          '/chat',
          `text=${response.text.length}ch tools=${response.tool_calls.length}`,
          dt
        );

        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: response.text,
            toolCalls: response.tool_calls.length > 0 ? response.tool_calls : undefined,
          },
        ]);

        if (response.tool_calls.length === 0) {
          logDone('text-only response, loop ends');
          return;
        }

        const readToolResults: Array<{ name: string; result: unknown }> = [];

        for (const call of response.tool_calls) {
          const dispatched = await dispatchToolCall(call);

          setTurns((prev) => [
            ...prev,
            { role: 'tool', content: dispatched.summary },
          ]);

          if (dispatched.toolResult !== null) {
            const isError =
              typeof dispatched.toolResult === 'object' &&
              dispatched.toolResult !== null &&
              'error' in (dispatched.toolResult as Record<string, unknown>);
            if (READ_TOOLS.has(call.name) || isError) {
              readToolResults.push({
                name: call.name,
                result: dispatched.toolResult,
              });
            }
          }
        }

        if (readToolResults.length === 0) {
          logDone(`${response.tool_calls.length} write/nav tool(s), loop ends`);
          return;
        }

        currentHistory = [
          ...currentHistory,
          { role: 'user', content: message },
          { role: 'assistant', content: response.text },
        ];
        currentMessage =
          'Tool results:\n' +
          readToolResults
            .map((r) => `${r.name}: ${JSON.stringify(r.result)}`)
            .join('\n');
      }

      logError('useChat', 'tool round-trip cap hit');
      setError('Conversation exceeded tool round-trip limit. Please try rephrasing.');
    } catch (err) {
      const msg = err instanceof BackendError ? err.message : String(err);
      logError('useChat', err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [turns]);

  const reset = useCallback(() => {
    setTurns([]);
    setError(null);
    setIsLoading(false);
  }, []);

  return { turns, isLoading, error, send, reset };
}