export type AudioPartFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type LlHlsAudioPart = {
  streamId: string;
  sequence: number | null;
  bytes: Uint8Array;
  url: string;
  status: number;
  contentType: string | null;
  requestStartedAtMs: number;
  receivedAtMs: number;
};

export type LlHlsAudioTailOptions = {
  baseUrl: string | URL;
  streamId: string;
  afterSequence?: number;
  fetch?: AudioPartFetch;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  emptyDelayMs?: number;
  reconnectDelayMs?: number;
};

const DEFAULT_EMPTY_DELAY_MS = 15;
const DEFAULT_RECONNECT_DELAY_MS = 250;

const nowMs = () => globalThis.performance?.now() ?? Date.now();

const abortError = (signal?: AbortSignal) => {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error("operation aborted");
};

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError(signal));
    return;
  }

  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(abortError(signal));
  }, { once: true });
});

const parseSequence = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
};

const encodePath = (streamId: string) => streamId
  .split("/")
  .filter((part) => part.length > 0)
  .map(encodeURIComponent)
  .join("/");

export const buildAudioTailUrl = (
  baseUrl: string | URL,
  streamId: string,
  afterSequence?: number | null
) => {
  const normalizedBase = String(baseUrl).endsWith("/") ? String(baseUrl) : `${String(baseUrl)}/`;
  const url = new URL(`${encodePath(streamId)}/tail`, normalizedBase);
  url.searchParams.set("mode", "part");
  if (afterSequence !== undefined && afterSequence !== null) {
    url.searchParams.set("after", String(afterSequence));
  }
  return url;
};

export async function* tailAudioParts(options: LlHlsAudioTailOptions): AsyncGenerator<LlHlsAudioPart> {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error("fetch is unavailable");

  let afterSequence: number | undefined = options.afterSequence;
  const emptyDelayMs = options.emptyDelayMs ?? DEFAULT_EMPTY_DELAY_MS;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;

  while (!options.signal?.aborted) {
    const url = buildAudioTailUrl(options.baseUrl, options.streamId, afterSequence);
    const requestStartedAtMs = nowMs();
    let response: Response;

    try {
      response = await fetchImpl(url, {
        cache: "no-store",
        credentials: options.credentials,
        headers: options.headers,
        signal: options.signal
      });
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      await wait(reconnectDelayMs, options.signal);
      continue;
    }

    const receivedAtMs = nowMs();
    if (response.status === 204) {
      await wait(emptyDelayMs, options.signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(`audio tail fetch failed with HTTP ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const sequence = parseSequence(response.headers.get("x-sequence"));

    yield {
      streamId: options.streamId,
      sequence,
      bytes,
      url: url.href,
      status: response.status,
      contentType: response.headers.get("content-type"),
      requestStartedAtMs,
      receivedAtMs
    };

    if (sequence !== null) {
      afterSequence = sequence;
    } else if (afterSequence !== undefined) {
      afterSequence += 1;
    }
  }
}

export class LlHlsAudioTailClient {
  constructor(private readonly options: LlHlsAudioTailOptions) {}

  parts() {
    return tailAudioParts(this.options);
  }
}

