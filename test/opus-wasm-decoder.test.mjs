import test from "node:test";
import assert from "node:assert/strict";
import {
  RustOpusWasmFrameDecoder,
  SoundKitAudioFrameStream,
  SoundKitEncoding,
  encodeSoundKitAudioFrame
} from "../dist/index.js";

class FakeDecodeResult {
  constructor(output, decodedSize) {
    this.output = output;
    this.decodedSize = decodedSize;
    this.freed = false;
  }

  free() {
    this.freed = true;
  }
}

class FakeDecoder {
  constructor(channels, sampleRate, frameSize) {
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.frameSize = frameSize;
    this.destroyed = false;
  }

  dec_frame(packet) {
    this.packet = packet;
    return new FakeDecodeResult(new Int16Array([0, 32767, -32768, 16384]), 2);
  }

  destroy() {
    this.destroyed = true;
  }
}

test("adapts libopus-rs i16 output into planar float PCM", () => {
  const decoder = new RustOpusWasmFrameDecoder({ Decoder: FakeDecoder }, {
    channels: 2,
    sampleRate: 48_000,
    frameSize: 960
  });

  const decoded = decoder.decodePacket(new Uint8Array([1, 2, 3]));
  assert.equal(decoded.frameCount, 2);
  assert.equal(decoded.channelData.length, 2);
  assert.deepEqual(Array.from(decoded.channelData[0]), [0, -1]);
  assert.ok(Math.abs(decoded.channelData[1][0] - 0.999969482421875) < 1e-12);
  assert.equal(decoded.channelData[1][1], 0.5);
  decoder.close();
});

test("decodes a SoundKit Opus frame and preserves exact timing metadata", () => {
  const packet = encodeSoundKitAudioFrame({
    encoding: SoundKitEncoding.Opus,
    frameCount: 2,
    sampleRate: 48_000,
    channels: 2,
    id: 9n,
    pts: 1234n
  }, new Uint8Array([0x11, 0x22]));
  const [frame] = new SoundKitAudioFrameStream().push(packet);

  const decoder = new RustOpusWasmFrameDecoder({ Decoder: FakeDecoder }, {
    channels: 2,
    sampleRate: 48_000,
    frameSize: 960
  });

  const decoded = decoder.decodeSoundKitFrame(frame);
  assert.equal(decoded.id, 9n);
  assert.equal(decoded.pts, 1234n);
  assert.equal(decoded.startFrame, 1234);
  assert.equal(decoded.frameCount, 2);
  decoder.close();
});
