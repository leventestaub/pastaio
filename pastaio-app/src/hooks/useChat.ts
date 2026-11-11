/**
 * useChat — ephemeral agent conversation.
 *
 * One /chat request per user message: the backend runs the agent loop
 * (data tools, validation, repair) and returns the reply text plus the
 * action tools for the app to carry out.
 *
 * Logging: each .send() logs the request boundary, the user message,
 * the backend call, and the final outcome. Tool dispatches log
 * themselves from inside dispatchToolCall.
 */
import { useState, useCallback } from 'react';
import { backend, BackendError } from '@/services/backend';
import { buildChatContext } from '@/services/buildChatContext';
import { dispatchToolCall } from '@/services/toolDispatcher';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useCookingStore } from '@/stores/cookingStore';
import type { ChatMessage, ToolCall } from '@/services/backendTypes';
import {
  logRequestStart,
  logUserInput,
  logBackendCall,
  logBackendResponse,
  logError,
  logDone,
} from '@/services/devLog';

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

    const context = buildChatContext(
      useSessionStore.getState(),
      useMemoryStore.getState(),
      useCookingStore.getState()
    );

    logRequestStart('user message');
    logUserInput(message, context);

    const history: ChatMessage[] = turns
      .filter((t) => t.role === 'user' || t.role === 'assistant')
      .map((t) => ({
        role: t.role as 'user' | 'assistant',
        content: t.content,
      }));

    setTurns((prev) => [...prev, { role: 'user', content: message }]);

    try {
      const t0 = Date.now();
      logBackendCall('/chat', `history=${history.length} msg=${message.slice(0, 60)}`);
      const response = await backend.chat({ message, history, context });
      logBackendResponse(
        '/chat',
        `text=${response.text.length}ch actions=${response.tool_calls.length} steps=${response.trace?.length ?? 1}`,
        Date.now() - t0
      );

      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: response.text,
          toolCalls: response.tool_calls.length > 0 ? response.tool_calls : undefined,
        },
      ]);

      for (const call of response.tool_calls) {
        const { summary } = await dispatchToolCall(call);
        setTurns((prev) => [...prev, { role: 'tool', content: summary }]);
      }
      logDone(`${response.tool_calls.length} action(s)`);
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