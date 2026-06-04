# av-llhls

LL-HLS transport pieces for Wavey browser monitoring.

The intended browser audio path is:

1. Fetch low-latency audio parts from an edge tail endpoint.
2. Parse compact SoundKit v2 audio frames.
3. Decode raw Opus packets through pure Rust `libopus-rs` WASM.
4. Write decoded PCM blocks into `SharedArrayBuffer` rings for `@wavey-ai/web-audio-mixer`.

The intended browser video path is:

1. Load the edge `/<stream_id>/stream.m3u8` playlist with native HLS or an
   `hls.js`-compatible constructor.
2. Attach the stream to an internal `HTMLVideoElement` so the browser owns
   fMP4 demux, H.264 decode, AAC decode, buffering, and A/V sync.
3. Paint decoded video frames into a supplied `HTMLCanvasElement` with
   `requestVideoFrameCallback`, falling back to `requestAnimationFrame`.

```ts
import Hls from "hls.js";
import { startLlHlsVideoCanvas } from "@wavey-ai/av-llhls";

const controller = startLlHlsVideoCanvas({
  baseUrl: "https://edge.example/live",
  streamId: "0",
  canvas: document.querySelector("canvas")!,
  hlsConstructor: Hls,
  fit: "contain"
});
```

For H.264 + AAC in the same CMAF/fMP4 LL-HLS rendition, browser playback is the
right sync primitive: the media element uses the muxed timestamps and its audio
clock. Canvas is only the video presentation surface, so drawing frames to
canvas does not break A/V sync. If audio is delivered through this package's
separate SoundKit/Opus path while video is delivered through HLS, sync becomes a
separate application-level clocking problem and should be treated as approximate
monitoring unless the edge also provides a common timestamp/latency discipline.

## Frame Format

Each packet is:

```txt
SoundKitFrameHeaderV2 | payloadBytes
```

`FrameHeaderV2` carries both `payloadSize` and `frameCount`, so compressed streams are self-delimiting without MPEG-TS packet overhead or next-header scanning. Optional CRC32 can protect the encoded header prefix and payload when the edge wants per-packet integrity checks.

Recommended header semantics:

- `encoding`: `Opus` for compressed audio frames
- `sampleRate`: `48000` for the current pure Rust `libopus-rs` browser decoder
- `channels`: decoded channel count
- `payloadSize`: exact compressed packet byte count
- `frameCount`: decoded samples per channel, usually 960 at 48 kHz for 20 ms Opus frames
- `id`: optional track or stem id
- `pts`: exact audio sample-frame timestamp
- `packetCrc32`: optional packet checksum

## Opus WASM

This package does not bundle a codec. It provides a typed adapter for the generated `libopus-rs/pkg/libopus_rs.js` module:

```ts
import init, { Decoder } from "../libopus-rs/pkg/libopus_rs.js";
import { RustOpusWasmFrameDecoder } from "@wavey-ai/av-llhls";

await init(new URL("../libopus-rs/pkg/libopus_rs_bg.wasm", import.meta.url));

const decoder = new RustOpusWasmFrameDecoder(
  { Decoder },
  { channels: 2, sampleRate: 48000, frameSize: 960 }
);
```

The current `libopus-rs` WASM surface is a pure Rust, 48 kHz CELT-only raw Opus packet decoder. The LL-HLS edge should feed raw Opus packets, not Ogg pages.

## Mesh Edge Discovery

`av-mesh` nodes expose `/api/mesh` and advertise `edge_services` with public
`playback_base_url` values. `av-llhls` can use one or more mesh nodes as seeds,
score the advertised edges locally, then tail the selected node directly:

```ts
import { resolveMeshAudioTailOptions, tailAudioParts } from "@wavey-ai/av-llhls";

const tailOptions = await resolveMeshAudioTailOptions({
  seeds: ["https://uk-edge.example/live", "https://jp-edge.example/live"],
  streamId: "9007199254741993",
  preferredRegion: "uk"
});

for await (const part of tailAudioParts(tailOptions)) {
  // Decode SoundKit/Opus bytes from part.bytes.
}
```

Stream ids should be passed as strings or `bigint` values so Snowflake/u64 ids
do not lose precision in JavaScript. The selector prefers nodes that already
report the stream, but a healthy node without the stream is still eligible
because `/live/<stream_id>/tail` creates mesh demand and returns `204` until
replicated bytes arrive.

## Development

```sh
npm install
npm test
```
