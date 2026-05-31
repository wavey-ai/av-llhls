import test from "node:test";
import assert from "node:assert/strict";
import {
  SOUNDKIT_FRAME_HEADER_BASE_BYTES,
  SOUNDKIT_FRAME_HEADER_EXTENDED_SIZE_BYTES,
  SoundKitAudioFrameStream,
  SoundKitEncoding,
  SoundKitEndianness,
  crc32Ieee,
  decodeSoundKitFrameHeader,
  encodeSoundKitAudioFrame,
  encodeSoundKitFrameHeader,
  soundKitPcmPayloadBytes
} from "../dist/index.js";

test("encodes compact SoundKit v2 headers with Rust-compatible field mapping", () => {
  const headerBytes = encodeSoundKitFrameHeader({
    encoding: SoundKitEncoding.Opus,
    payloadSize: 127,
    frameCount: 960,
    sampleRate: 48_000,
    channels: 2,
    endianness: SoundKitEndianness.LittleEndian,
    id: 17n,
    pts: 960n
  });

  const word = new DataView(headerBytes.buffer, headerBytes.byteOffset, 4).getUint32(0, false);
  assert.equal((word >>> 26) & 0x3f, 0x2b);
  assert.equal((word >>> 24) & 0x3, 2);
  assert.equal((word >>> 8) & 0xf, 6);

  const decoded = decodeSoundKitFrameHeader(headerBytes);
  assert.equal(decoded.encoding, SoundKitEncoding.Opus);
  assert.equal(decoded.payloadSize, 127);
  assert.equal(decoded.frameCount, 960);
  assert.equal(decoded.sampleRate, 48_000);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.bitsPerSample, 0);
  assert.equal(decoded.id, 17n);
  assert.equal(decoded.idIsU64, false);
  assert.equal(decoded.pts, 960n);
  assert.equal(decoded.headerBytes, 20);
});

test("derives PCM payload byte length from frame count", () => {
  const header = decodeSoundKitFrameHeader(encodeSoundKitFrameHeader({
    encoding: SoundKitEncoding.PcmSigned,
    payloadSize: 128 * 2 * 3,
    frameCount: 128,
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 24
  }));

  assert.equal(soundKitPcmPayloadBytes(header), 128 * 2 * 3);
});

test("parses a SoundKit audio frame split across network chunks", () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const packet = encodeSoundKitAudioFrame({
    encoding: SoundKitEncoding.PcmSigned,
    frameCount: 2,
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 16,
    pts: 10n
  }, payload);

  const stream = new SoundKitAudioFrameStream({ copyPayload: true });
  assert.deepEqual(stream.push(packet.subarray(0, 3)), []);
  const frames = stream.push(packet.subarray(3));

  assert.equal(frames.length, 1);
  assert.equal(frames[0].header.pts, 10n);
  assert.equal(frames[0].header.payloadSize, payload.length);
  assert.deepEqual(Array.from(frames[0].payload), Array.from(payload));
  assert.equal(stream.bufferedBytes, 0);
});

test("parses consecutive Opus frames from v2 payload sizes", () => {
  const payloadA = new Uint8Array([0xaa, 0xa8, 0x00, 0x00, 0x00, 0x2a]);
  const payloadB = new Uint8Array([0x01, 0x02, 0x03]);
  const packetA = encodeSoundKitAudioFrame({
    encoding: SoundKitEncoding.Opus,
    frameCount: 960,
    sampleRate: 48_000,
    channels: 2,
    id: 1n,
    pts: 0n
  }, payloadA);
  const packetB = encodeSoundKitAudioFrame({
    encoding: SoundKitEncoding.Opus,
    frameCount: 960,
    sampleRate: 48_000,
    channels: 2,
    id: 1n,
    pts: 960n
  }, payloadB);

  const combined = new Uint8Array(packetA.length + packetB.length);
  combined.set(packetA);
  combined.set(packetB, packetA.length);

  const frames = new SoundKitAudioFrameStream({ copyPayload: true }).push(combined);
  assert.equal(frames.length, 2);
  assert.deepEqual(Array.from(frames[0].payload), Array.from(payloadA));
  assert.deepEqual(Array.from(frames[1].payload), Array.from(payloadB));
  assert.equal(frames[1].header.pts, 960n);
});

test("verifies optional packet CRC32", () => {
  const payload = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
  const packet = encodeSoundKitAudioFrame({
    encoding: SoundKitEncoding.Opus,
    frameCount: 960,
    sampleRate: 48_000,
    channels: 2,
    id: 1n,
    pts: 0n
  }, payload, { packetCrc32: true });

  const stream = new SoundKitAudioFrameStream({ copyPayload: true });
  const frames = stream.push(packet);
  assert.equal(frames.length, 1);
  assert.equal(typeof frames[0].header.packetCrc32, "number");

  const corrupted = packet.slice();
  corrupted[corrupted.length - 1] ^= 0xff;
  assert.throws(() => new SoundKitAudioFrameStream().push(corrupted), /CRC32 mismatch/);
});

test("uses extended size fields only when needed", () => {
  const headerBytes = encodeSoundKitFrameHeader({
    encoding: SoundKitEncoding.Flac,
    payloadSize: 70_000,
    frameCount: 70_001,
    sampleRate: 96_000,
    channels: 2,
    bitsPerSample: 24,
    endianness: SoundKitEndianness.BigEndian
  });

  assert.equal(headerBytes.length, SOUNDKIT_FRAME_HEADER_BASE_BYTES + SOUNDKIT_FRAME_HEADER_EXTENDED_SIZE_BYTES);
  const decoded = decodeSoundKitFrameHeader(headerBytes);
  assert.equal(decoded.payloadSize, 70_000);
  assert.equal(decoded.frameCount, 70_001);
  assert.equal(decoded.endianness, SoundKitEndianness.BigEndian);
});

test("matches the IEEE CRC32 known vector", () => {
  assert.equal(crc32Ieee(new TextEncoder().encode("123456789")), 0xcbf4_3926);
});

