/**
 * Backend HTTP client.
 *
 * Thin wrapper around fetch for /chat and /identify. Timeout is enforced
 * because Qwen3.5:4b can occasionally hang on bad prompts and we don't want
 * the phone UI frozen indefinitely.
 *
 * Errors thrown here surface to the hook layer, which presents them to the
 * user. The client itself does NOT retry — retry logic, when added, belongs
 * in the hook so it can show "retrying..." feedback to the user.
 */
import { BACKEND_URL } from '@/constants/config';
import type {
  ChatRequest,
  ChatResponse,
  IdentifyResponse,
} from '@/services/backendTypes';

const DEFAULT_TIMEOUT_MS = 60_000;
// Identify can be slow on first call: cold-load of the VLM is 10-15s on
// most hardware. Subsequent calls hit the warm model and are sub-3s.
// 45s gives the cold path room without the UI looking truly frozen.
const IDENTIFY_TIMEOUT_MS = 45_000;

class BackendError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'BackendError';
  }
}

async function postJson<TReq, TRes>(
  path: string,
  body: TReq,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<TRes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BackendError(
        `${path} returned ${response.status}: ${text || 'no body'}`,
        response.status
      );
    }

    return (await response.json()) as TRes;
  } catch (err) {
    if (err instanceof BackendError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new BackendError(`${path} timed out after ${timeoutMs}ms`);
    }
    console.error(`[backend] ${path} failed:`, err);
    throw new BackendError(
      `Could not reach backend at ${BACKEND_URL}. Check that the server is running and the LAN IP in src/constants/config.ts is correct.`
    );
  } finally {
    clearTimeout(timer);
  }
}

export const backend = {
  chat: (req: ChatRequest) =>
    postJson<ChatRequest, ChatResponse>('/chat', req),

  identify: async (imageUri: string): Promise<IdentifyResponse> => {
    // Multipart form for /identify since FastAPI expects UploadFile.
    const form = new FormData();
    // React Native's FormData accepts this object shape for files.
    form.append('image', {
      uri: imageUri,
      name: 'pasta.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
    try {
      const response = await fetch(`${BACKEND_URL}/identify`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new BackendError(
          `/identify returned ${response.status}: ${text || 'no body'}`,
          response.status
        );
      }
      return (await response.json()) as IdentifyResponse;
    } catch (err) {
      if (err instanceof BackendError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BackendError(
          `/identify timed out after ${IDENTIFY_TIMEOUT_MS / 1000}s`
        );
      }
      console.error('[backend] /identify failed:', err);
      throw new BackendError(
        `Could not reach backend at ${BACKEND_URL}.`
      );
    } finally {
      clearTimeout(timer);
    }
  },
};

export { BackendError };
