import { SoundKitEncoding, type SoundKitFrameHeader } from "./soundkit-frame-header.js";
import type { SoundKitAudioFrame } from "./soundkit-frame-stream.js";

export type LibOpusRsDecodeResult = {
  readonly decodedSize: number;
  readonly output: Int16Array;
  free?: () => void;
};

export type LibOpusRsDecoder = {
  dec_frame(packet: Uint8Array): LibOpusRsDecodeResult;
  destroy?: () => void;
  free?: () => void;
};

export type LibOpusRsModule = {
  Decoder: new (channels: number, sampleRate: number, frameSize: number) => LibOpusRsDecoder;
};

export type RustOpusWasmDecoderOptions = {
  channels: number;
  sampleRate?: 48_000;
  frameSize?: number;
};

export type DecodedAudioFrame = {
  sampleRate: number;
  channels: number;
  frameCount: number;
  channelData: Float32Array[];
  pts?: bigint;
  id?: bigint;
  startFrame?: number;
};

const I16_TO_F32 = 1 / 32768;

const assertHeaderMatchesDecoder = (header: SoundKitFrameHeader, channels: number, sampleRate: number) => {
  if (header.encoding !== SoundKitEncoding.Opus) {
    throw new Error("SoundKit frame is not Opus encoded audio");
  }
  if (header.sampleRate !== sampleRate) {
    throw new Error(`Opus sample-rate mismatch: frame=${header.sampleRate} decoder=${sampleRate}`);
  }
  if (header.channels !== channels) {
    throw new Error(`Opus channel-count mismatch: frame=${header.channels} decoder=${channels}`);
  }
};

const safeStartFrame = (pts: bigint | undefined) => {
  if (pts === undefined) return undefined;
  if (pts > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("frame PTS exceeds JavaScript safe integer range");
  }
  return Number(pts);
};

const deinterleaveI16ToFloat32 = (input: Int16Array, channels: number, frameCount: number) => {
  const expectedSamples = channels * frameCount;
  if (input.length < expectedSamples) {
    throw new Error(`Opus decode returned ${input.length} samples, expected ${expectedSamples}`);
  }

  const channelData = Array.from({ length: channels }, () => new Float32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const inputBase = frame * channels;
    for (let channel = 0; channel < channels; channel += 1) {
      channelData[channel]![frame] = input[inputBase + channel]! * I16_TO_F32;
    }
  }
  return channelData;
};

export class RustOpusWasmFrameDecoder {
  readonly channels: number;
  readonly sampleRate: 48_000;
  readonly frameSize: number;
  private readonly decoder: LibOpusRsDecoder;
  private closed = false;

  constructor(module: LibOpusRsModule, options: RustOpusWasmDecoderOptions) {
    if (!Number.isInteger(options.channels) || options.channels < 1 || options.channels > 16) {
      throw new RangeError("channels must be between 1 and 16");
    }

    this.channels = options.channels;
    this.sampleRate = options.sampleRate ?? 48_000;
    this.frameSize = options.frameSize ?? 960;
    this.decoder = new module.Decoder(this.channels, this.sampleRate, this.frameSize);
  }

  decodePacket(packet: Uint8Array): DecodedAudioFrame {
    if (this.closed) throw new Error("Opus decoder is closed");

    const result = this.decoder.dec_frame(packet);
    try {
      const frameCount = result.decodedSize;
      return {
        sampleRate: this.sampleRate,
        channels: this.channels,
        frameCount,
        channelData: deinterleaveI16ToFloat32(result.output, this.channels, frameCount)
      };
    } finally {
      result.free?.();
    }
  }

  decodeSoundKitFrame(frame: SoundKitAudioFrame): DecodedAudioFrame {
    assertHeaderMatchesDecoder(frame.header, this.channels, this.sampleRate);
    const decoded = this.decodePacket(frame.payload);
    if (frame.header.frameCount !== 0 && decoded.frameCount !== frame.header.frameCount) {
      throw new Error(`Opus decoded ${decoded.frameCount} frames, header declared ${frame.header.frameCount}`);
    }

    return {
      ...decoded,
      id: frame.header.id,
      pts: frame.header.pts,
      startFrame: safeStartFrame(frame.header.pts)
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.decoder.destroy) this.decoder.destroy();
    else this.decoder.free?.();
  }
}
