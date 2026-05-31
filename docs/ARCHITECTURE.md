# Architecture

`av-llhls` owns browser ingress for low-latency audio streams. It does not mix, schedule, or render PCM; those concerns stay in `@wavey-ai/web-audio-mixer`.

## Responsibilities

- Build LL-HLS tail URLs for audio parts.
- Fetch edge parts with `no-store` semantics and `x-sequence` tracking.
- Parse SoundKit audio frames from arbitrary network chunks.
- Preserve exact per-track timing through `id` and `pts`.
- Adapt pure Rust `libopus-rs` WASM decode output into planar `Float32Array` channel data.

## Packet Boundaries

The browser ingress path uses `FrameHeaderV2`, which carries exact `payloadSize` and decoded `frameCount`. A compressed byte stream can therefore be parsed without MPEG-TS packet alignment or scanning inside arbitrary compressed bytes.

The stream packet is:

```txt
FrameHeaderV2 | payload
```

The common v2 header is 8 bytes. With a compact track id and PTS it is 20 bytes, matching the old timed v1 header size while adding payload length and decoded frame count. Optional CRC32 adds 4 bytes.

## Timing

`pts` is a sample-frame timestamp in the stream time base. For the current Opus path that time base should be 48 kHz. The mixer converts those timestamps onto the active `AudioContext` timeline once at ingress.

## Threading

The efficient path is:

```txt
network worker -> SoundKit parser -> Opus WASM decode -> SAB PCM ring -> AudioWorklet -> Web Audio graph
```

Decoded PCM should cross thread boundaries through `SharedArrayBuffer`. Encoded network bytes may stay as ordinary `Uint8Array` chunks because they are consumed before the audio render thread.
