# av-llhls

Audio-only LL-HLS transport pieces for Wavey browser monitoring.

The intended browser path is:

1. Fetch low-latency audio parts from an edge tail endpoint.
2. Parse compact SoundKit v2 audio frames.
3. Decode raw Opus packets through pure Rust `libopus-rs` WASM.
4. Write decoded PCM blocks into `SharedArrayBuffer` rings for `@wavey-ai/web-audio-mixer`.

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

## Development

```sh
npm install
npm test
```
