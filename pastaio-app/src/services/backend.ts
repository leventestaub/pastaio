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
import { Platform } from 'react-native';
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

const UNREACHABLE =
  "Couldn't reach the Pastaio server. Check that the backend is running and try again.";

function httpError(path: string, status: number, text: string): BackendError {
  // The backend's 429/502/503 bodies carry a message written for the user.
  if ([429, 502, 503].includes(status)) {
    try {
      const { detail } = JSON.parse(text);
      if (typeof detail === 'string') return new BackendError(detail, status);
    } catch {}
  }
  if (status === 429) return new BackendError('Too many requests. Wait a minute and try again.', status);
  return new BackendError(`${path} returned ${status}: ${text || 'no body'}`, status);
}

// Web only: the picker hands back the original file, which can exceed the
// host's 4.5 MB body limit. 1280 px is plenty for shape identification.
async function downscaleForUpload(uri: string, maxSide = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image encode failed'))), 'image/jpeg', 0.85)
  );
}

// Fire-and-forget on app start so a sleeping hosted backend starts waking
// before the first real request.
export function wakeBackend(): void {
  fetch(`${BACKEND_URL}/health`).catch(() => {});
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
      throw httpError(path, response.status, text);
    }

    return (await response.json()) as TRes;
  } catch (err) {
    if (err instanceof BackendError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new BackendError(`${path} timed out after ${timeoutMs}ms`);
    }
    console.error(`[backend] ${path} failed:`, err);
    throw new BackendError(UNREACHABLE);
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
    if (Platform.OS === 'web') {
      // Browser FormData needs a real Blob; the picker returns a blob:/data: URI.
      form.append('image', await downscaleForUpload(imageUri), 'pasta.jpg');
    } else {
      // React Native's FormData accepts this object shape for files.
      form.append('image', {
        uri: imageUri,
        name: 'pasta.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
    }

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
        throw httpError('/identify', response.status, text);
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
      throw new BackendError(UNREACHABLE);
    } finally {
      clearTimeout(timer);
    }
  },
};

export { BackendError };
