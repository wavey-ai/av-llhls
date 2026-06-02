export type HlsLikeErrorData = {
  type?: string;
  details?: string;
  fatal?: boolean;
  [key: string]: unknown;
};

export type HlsLikeInstance = {
  attachMedia(media: HTMLMediaElement): void;
  loadSource(url: string): void;
  startLoad(startPosition?: number): void;
  stopLoad(): void;
  destroy(): void;
  recoverMediaError(): void;
  on(event: string, listener: (event: string, data: HlsLikeErrorData) => void): void;
  liveSyncPosition?: number | null;
};

export type HlsLikeConstructor = {
  new(config?: Record<string, unknown>): HlsLikeInstance;
  isSupported?: () => boolean;
  Events?: Record<string, string>;
  ErrorDetails?: Record<string, string>;
  ErrorTypes?: Record<string, string>;
};

export type LlHlsVideoFit = "contain" | "cover" | "fill";

export type LlHlsVideoFrameStats = {
  currentTime: number;
  mediaTime: number | null;
  expectedDisplayTime: number | null;
  presentedFrames: number | null;
  processingDuration: number | null;
  videoWidth: number;
  videoHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  droppedVideoFrames: number | null;
  totalVideoFrames: number | null;
  liveSyncPosition: number | null;
};

export type LlHlsVideoCanvasOptions = {
  baseUrl: string | URL;
  streamId: string;
  canvas?: HTMLCanvasElement;
  videoElement?: HTMLVideoElement;
  hlsConstructor?: HlsLikeConstructor;
  hlsConfig?: Record<string, unknown>;
  muted?: boolean;
  autoplay?: boolean;
  playsInline?: boolean;
  crossOrigin?: "" | "anonymous" | "use-credentials";
  fit?: LlHlsVideoFit;
  background?: string;
  devicePixelRatio?: number;
  debug?: boolean;
  signal?: AbortSignal;
  onFrame?: (stats: LlHlsVideoFrameStats) => void;
  onError?: (error: Error, data?: HlsLikeErrorData) => void;
};

export type LlHlsVideoCanvasController = {
  canvas: HTMLCanvasElement;
  videoElement: HTMLVideoElement;
  sourceUrl: string;
  play: () => Promise<void>;
  drawOnce: () => boolean;
  destroy: () => void;
};

type VideoFrameCallbackMetadataLike = {
  mediaTime?: number;
  expectedDisplayTime?: number;
  presentedFrames?: number;
  processingDuration?: number;
};

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadataLike) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const DEFAULT_HLS_CONFIG = {
  backBufferLength: 10,
  enableWorker: true,
  liveBackBufferLength: 10,
  liveDurationInfinity: true,
  liveMaxLatencyDurationCount: 5,
  liveSyncDurationCount: 2,
  lowLatencyMode: true,
  maxBufferLength: 12,
  maxMaxBufferLength: 20,
  maxLiveSyncPlaybackRate: 1.5
};

const encodeStreamPath = (streamId: string) => streamId
  .split("/")
  .filter((part) => part.length > 0)
  .map(encodeURIComponent)
  .join("/");

const normalizeBaseUrl = (baseUrl: string | URL) => {
  const value = String(baseUrl);
  return value.endsWith("/") ? value : `${value}/`;
};

export const buildVideoPlaylistUrl = (baseUrl: string | URL, streamId: string) => {
  return new URL(`${encodeStreamPath(streamId)}/stream.m3u8`, normalizeBaseUrl(baseUrl));
};

export const buildLlHlsPlaylistUrl = buildVideoPlaylistUrl;

const getGlobalHlsConstructor = () => {
  const candidate = (globalThis as unknown as { Hls?: HlsLikeConstructor }).Hls;
  return candidate;
};

const createVideoElement = () => {
  if (!globalThis.document) {
    throw new Error("document is unavailable; provide a videoElement");
  }
  const video = document.createElement("video");
  video.style.cssText = [
    "position:fixed",
    "left:-1px",
    "top:-1px",
    "width:1px",
    "height:1px",
    "opacity:0",
    "pointer-events:none"
  ].join(";");
  document.body.appendChild(video);
  return video;
};

const createCanvas = () => {
  if (!globalThis.document) {
    throw new Error("document is unavailable; provide a canvas");
  }
  return document.createElement("canvas");
};

const resolveDimension = (value: number, fallback: number) => {
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const resizeCanvas = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  devicePixelRatio: number
) => {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = resolveDimension(rect.width, resolveDimension(canvas.clientWidth, video.videoWidth || 1));
  const cssHeight = resolveDimension(rect.height, resolveDimension(canvas.clientHeight, video.videoHeight || 1));
  const width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
};

export const drawVideoElementToCanvas = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  {
    fit = "contain",
    background = "transparent",
    devicePixelRatio = globalThis.devicePixelRatio || 1
  }: Pick<LlHlsVideoCanvasOptions, "fit" | "background" | "devicePixelRatio"> = {}
) => {
  if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return false;
  }

  resizeCanvas(canvas, video, devicePixelRatio);
  const context = canvas.getContext("2d");
  if (!context) return false;

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  if (background !== "transparent") {
    context.fillStyle = background;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  if (fit === "fill") {
    context.drawImage(video, 0, 0, canvasWidth, canvasHeight);
    return true;
  }

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const scale = fit === "cover"
    ? Math.max(canvasWidth / videoWidth, canvasHeight / videoHeight)
    : Math.min(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const width = Math.round(videoWidth * scale);
  const height = Math.round(videoHeight * scale);
  const x = Math.floor((canvasWidth - width) / 2);
  const y = Math.floor((canvasHeight - height) / 2);
  context.drawImage(video, x, y, width, height);
  return true;
};

const playbackQuality = (video: HTMLVideoElement) => {
  const quality = (video as unknown as {
    getVideoPlaybackQuality?: () => {
      droppedVideoFrames?: number;
      totalVideoFrames?: number;
    };
  }).getVideoPlaybackQuality?.();
  return {
    droppedVideoFrames: quality?.droppedVideoFrames ?? null,
    totalVideoFrames: quality?.totalVideoFrames ?? null
  };
};

const videoStats = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  metadata: VideoFrameCallbackMetadataLike | null,
  liveSyncPosition: number | null
): LlHlsVideoFrameStats => {
  const quality = playbackQuality(video);
  return {
    currentTime: video.currentTime,
    mediaTime: metadata?.mediaTime ?? null,
    expectedDisplayTime: metadata?.expectedDisplayTime ?? null,
    presentedFrames: metadata?.presentedFrames ?? null,
    processingDuration: metadata?.processingDuration ?? null,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    droppedVideoFrames: quality.droppedVideoFrames,
    totalVideoFrames: quality.totalVideoFrames,
    liveSyncPosition
  };
};

const reportError = (
  error: Error,
  options: LlHlsVideoCanvasOptions,
  data?: HlsLikeErrorData
) => {
  if (options.debug) {
    console.warn("[av-llhls] video error", error, data);
  }
  options.onError?.(error, data);
};

const playWhenReady = async (video: HTMLVideoElement, options: LlHlsVideoCanvasOptions) => {
  try {
    await video.play();
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)), options);
  }
};

export const startLlHlsVideoCanvas = (
  options: LlHlsVideoCanvasOptions
): LlHlsVideoCanvasController => {
  const canvas = options.canvas ?? createCanvas();
  const video = options.videoElement ?? createVideoElement();
  const sourceUrl = buildVideoPlaylistUrl(options.baseUrl, options.streamId).href;
  const hlsConstructor = options.hlsConstructor ?? getGlobalHlsConstructor();
  const videoWithFrameCallback = video as VideoWithFrameCallback;
  let destroyed = false;
  let hls: HlsLikeInstance | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelayMs = 1_000;
  let appendErrorCount = 0;
  let lastMediaRecoveryMs = 0;
  let frameCallbackHandle: number | null = null;
  let animationFrameHandle: number | null = null;

  video.muted = options.muted ?? true;
  video.autoplay = options.autoplay ?? true;
  video.playsInline = options.playsInline ?? true;
  video.controls = false;
  if (options.crossOrigin !== undefined) {
    video.crossOrigin = options.crossOrigin;
  }

  const drawOnce = (metadata: VideoFrameCallbackMetadataLike | null = null) => {
    const drawn = drawVideoElementToCanvas(video, canvas, options);
    if (drawn) {
      options.onFrame?.(videoStats(video, canvas, metadata, hls?.liveSyncPosition ?? null));
    }
    return drawn;
  };

  const scheduleFrame = () => {
    if (destroyed) return;
    if (videoWithFrameCallback.requestVideoFrameCallback) {
      frameCallbackHandle = videoWithFrameCallback.requestVideoFrameCallback((_now, metadata) => {
        frameCallbackHandle = null;
        drawOnce(metadata);
        scheduleFrame();
      });
      return;
    }
    animationFrameHandle = requestAnimationFrame(() => {
      animationFrameHandle = null;
      drawOnce(null);
      scheduleFrame();
    });
  };

  const clearRetry = () => {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleNetworkRetry = () => {
    if (destroyed || retryTimer !== null || !hls) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (destroyed || !hls) return;
      hls.loadSource(sourceUrl);
      hls.startLoad(-1);
    }, retryDelayMs);
    retryDelayMs = Math.min(5_000, retryDelayMs * 2);
  };

  const recoverMediaPipeline = (reason: string) => {
    if (!hls) return;
    const now = globalThis.performance?.now() ?? Date.now();
    if (now - lastMediaRecoveryMs < 1_500) return;
    lastMediaRecoveryMs = now;
    appendErrorCount = 0;
    if (options.debug) {
      console.info("[av-llhls] recovering video pipeline", { streamId: options.streamId, reason });
    }
    hls.recoverMediaError();
    hls.startLoad(-1);
    if (options.autoplay ?? true) {
      void playWhenReady(video, options);
    }
  };

  const nudgeToLiveEdge = () => {
    const liveSyncPosition = hls?.liveSyncPosition;
    if (!Number.isFinite(liveSyncPosition)) return;
    if (video.currentTime + 2 < Number(liveSyncPosition)) {
      video.currentTime = Number(liveSyncPosition);
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearRetry();
    if (frameCallbackHandle !== null && videoWithFrameCallback.cancelVideoFrameCallback) {
      videoWithFrameCallback.cancelVideoFrameCallback(frameCallbackHandle);
    }
    if (animationFrameHandle !== null) {
      cancelAnimationFrame(animationFrameHandle);
    }
    hls?.destroy();
    hls = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (!options.videoElement) {
      video.remove();
    }
  };

  if (options.signal) {
    options.signal.addEventListener("abort", destroy, { once: true });
  }

  const hlsSupported = hlsConstructor && (
    hlsConstructor.isSupported ? hlsConstructor.isSupported() : true
  );
  if (hlsSupported && hlsConstructor) {
    const events = hlsConstructor.Events ?? {};
    const details = hlsConstructor.ErrorDetails ?? {};
    const types = hlsConstructor.ErrorTypes ?? {};
    hls = new hlsConstructor({ ...DEFAULT_HLS_CONFIG, ...options.hlsConfig });
    hls.attachMedia(video);
    hls.loadSource(sourceUrl);
    hls.on(events.MANIFEST_PARSED ?? "hlsManifestParsed", () => {
      retryDelayMs = 1_000;
      appendErrorCount = 0;
      clearRetry();
      if (options.autoplay ?? true) {
        void playWhenReady(video, options);
      }
    });
    hls.on(events.FRAG_BUFFERED ?? "hlsFragBuffered", () => {
      appendErrorCount = 0;
    });
    hls.on(events.ERROR ?? "hlsError", (_event, data) => {
      if (
        data.details === (details.BUFFER_APPEND_ERROR ?? "bufferAppendError") ||
        data.details === (details.BUFFER_APPENDING_ERROR ?? "bufferAppendingError")
      ) {
        appendErrorCount += 1;
        if (data.fatal || appendErrorCount >= 2) {
          recoverMediaPipeline(data.details ?? "buffer append error");
        }
        return;
      }
      if (data.details === (details.BUFFER_STALLED_ERROR ?? "bufferStalledError")) {
        nudgeToLiveEdge();
      }
      if (!data.fatal) return;
      if (data.type === (types.MEDIA_ERROR ?? "mediaError")) {
        recoverMediaPipeline(data.details ?? data.type ?? "media error");
      } else if (data.type === (types.NETWORK_ERROR ?? "networkError")) {
        hls?.stopLoad();
        scheduleNetworkRetry();
      } else {
        reportError(new Error(`fatal LL-HLS video error: ${data.details ?? data.type ?? "unknown"}`), options, data);
        destroy();
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = sourceUrl;
    video.addEventListener("loadedmetadata", () => {
      if (options.autoplay ?? true) {
        void playWhenReady(video, options);
      }
    }, { once: true });
  } else {
    throw new Error("LL-HLS video needs native HLS support or an hls.js-compatible constructor");
  }

  scheduleFrame();

  const controller: LlHlsVideoCanvasController = {
    canvas,
    videoElement: video,
    sourceUrl,
    play: () => video.play(),
    drawOnce: () => drawOnce(null),
    destroy
  };

  return controller;
};
