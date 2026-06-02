import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoPlaylistUrl,
  drawVideoElementToCanvas,
  startLlHlsVideoCanvas
} from "../dist/index.js";

test("builds video playlist URLs with encoded stream segments", () => {
  const url = buildVideoPlaylistUrl("https://edge.example/live", "artist/main mix");
  assert.equal(url.href, "https://edge.example/live/artist/main%20mix/stream.m3u8");
});

test("draws a decoded video element into a canvas", () => {
  const calls = [];
  const video = fakeVideo();
  const canvas = fakeCanvas(calls);

  const drawn = drawVideoElementToCanvas(video, canvas, {
    fit: "contain",
    background: "#000",
    devicePixelRatio: 1
  });

  assert.equal(drawn, true);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.deepEqual(calls[0], ["clearRect", 0, 0, 640, 360]);
  assert.deepEqual(calls[1], ["fillStyle", "#000"]);
  assert.deepEqual(calls[2], ["fillRect", 0, 0, 640, 360]);
  assert.equal(calls[3][0], "drawImage");
});

test("starts an hls.js-compatible video canvas controller", () => {
  const calls = [];
  const video = fakeVideo();
  const canvas = fakeCanvas([]);
  const Hls = fakeHlsConstructor(calls);

  const controller = startLlHlsVideoCanvas({
    baseUrl: "https://edge.example/live",
    streamId: "screen/0",
    canvas,
    videoElement: video,
    hlsConstructor: Hls,
    autoplay: false
  });

  assert.equal(controller.sourceUrl, "https://edge.example/live/screen/0/stream.m3u8");
  assert.deepEqual(calls.slice(1, 3), [
    ["attachMedia", video],
    ["loadSource", "https://edge.example/live/screen/0/stream.m3u8"]
  ]);
  assert.equal(video.requestVideoFrameCallbackCalls, 1);

  controller.destroy();
  assert.equal(calls.at(-1)[0], "destroy");
  assert.equal(video.cancelVideoFrameCallbackHandle, 101);
});

function fakeCanvas(calls) {
  return {
    width: 0,
    height: 0,
    clientWidth: 640,
    clientHeight: 360,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    getContext: () => ({
      clearRect: (...args) => calls.push(["clearRect", ...args]),
      fillRect: (...args) => calls.push(["fillRect", ...args]),
      drawImage: (...args) => calls.push(["drawImage", ...args]),
      set fillStyle(value) {
        calls.push(["fillStyle", value]);
      }
    })
  };
}

function fakeVideo() {
  return {
    HAVE_CURRENT_DATA: 2,
    readyState: 2,
    videoWidth: 1280,
    videoHeight: 720,
    currentTime: 0,
    muted: false,
    autoplay: false,
    playsInline: false,
    controls: true,
    requestVideoFrameCallbackCalls: 0,
    cancelVideoFrameCallbackHandle: null,
    canPlayType: () => "",
    play: async () => {},
    pause: () => {},
    removeAttribute: () => {},
    load: () => {},
    remove: () => {},
    requestVideoFrameCallback(callback) {
      this.requestVideoFrameCallbackCalls += 1;
      this.videoFrameCallback = callback;
      return 101;
    },
    cancelVideoFrameCallback(handle) {
      this.cancelVideoFrameCallbackHandle = handle;
    }
  };
}

function fakeHlsConstructor(calls) {
  return class FakeHls {
    static Events = {
      MANIFEST_PARSED: "manifest",
      FRAG_BUFFERED: "frag",
      ERROR: "error"
    };

    static ErrorDetails = {
      BUFFER_APPEND_ERROR: "append",
      BUFFER_APPENDING_ERROR: "appending",
      BUFFER_STALLED_ERROR: "stalled"
    };

    static ErrorTypes = {
      MEDIA_ERROR: "media",
      NETWORK_ERROR: "network"
    };

    static isSupported() {
      return true;
    }

    constructor(config) {
      calls.push(["construct", config]);
      this.liveSyncPosition = null;
    }

    attachMedia(media) {
      calls.push(["attachMedia", media]);
    }

    loadSource(url) {
      calls.push(["loadSource", url]);
    }

    startLoad(position) {
      calls.push(["startLoad", position]);
    }

    stopLoad() {
      calls.push(["stopLoad"]);
    }

    destroy() {
      calls.push(["destroy"]);
    }

    recoverMediaError() {
      calls.push(["recoverMediaError"]);
    }

    on(event, listener) {
      calls.push(["on", event, listener]);
    }
  };
}
