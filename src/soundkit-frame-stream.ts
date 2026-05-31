import {
  computeSoundKitPacketCrc32,
  decodeSoundKitFrameHeader,
  encodeSoundKitFrameHeader,
  IncompleteSoundKitFrameHeaderError,
  verifySoundKitPacketCrc32,
  type SoundKitFrameHeader,
  type SoundKitFrameHeaderInit
} from "./soundkit-frame-header.js";

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 32 * 1024 * 1024;

export type SoundKitAudioFrame = {
  header: SoundKitFrameHeader;
  payload: Uint8Array;
  payloadLength: number;
  byteLength: number;
};

export type SoundKitAudioFrameStreamOptions = {
  maxPayloadBytes?: number;
  maxBufferedBytes?: number;
  copyPayload?: boolean;
  verifyPacketCrc32?: boolean;
};

export type EncodeSoundKitAudioFrameOptions = {
  packetCrc32?: boolean;
};

export type SoundKitAudioFrameHeaderInit = Omit<SoundKitFrameHeaderInit, "payloadSize"> & {
  payloadSize?: number;
};

const concatBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
};

export class SoundKitAudioFrameStream {
  private pending = new Uint8Array(0);
  private readonly maxPayloadBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly copyPayload: boolean;
  private readonly verifyPacketCrc32: boolean;

  constructor(options: SoundKitAudioFrameStreamOptions = {}) {
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.copyPayload = options.copyPayload ?? false;
    this.verifyPacketCrc32 = options.verifyPacketCrc32 ?? true;
  }

  get bufferedBytes() {
    return this.pending.length;
  }

  reset() {
    this.pending = new Uint8Array(0);
  }

  push(chunk: Uint8Array): SoundKitAudioFrame[] {
    if (this.pending.length + chunk.length > this.maxBufferedBytes) {
      throw new RangeError("SoundKit audio frame buffer exceeded maxBufferedBytes");
    }

    const bytes = concatBytes(this.pending, chunk);
    const frames: SoundKitAudioFrame[] = [];
    let offset = 0;

    while (offset < bytes.length) {
      let header: SoundKitFrameHeader;
      try {
        header = decodeSoundKitFrameHeader(bytes, offset);
      } catch (error) {
        if (error instanceof IncompleteSoundKitFrameHeaderError) break;
        throw error;
      }

      if (header.payloadSize > this.maxPayloadBytes) {
        throw new RangeError("SoundKit audio frame payload exceeded maxPayloadBytes");
      }

      const payloadOffset = offset + header.headerBytes;
      const nextOffset = payloadOffset + header.payloadSize;
      if (nextOffset > bytes.length) break;

      const encodedHeader = bytes.subarray(offset, payloadOffset);
      const payloadView = bytes.subarray(payloadOffset, nextOffset);
      if (this.verifyPacketCrc32 && header.packetCrc32 !== undefined && !verifySoundKitPacketCrc32(header, encodedHeader, payloadView)) {
        throw new Error("SoundKit audio frame CRC32 mismatch");
      }

      frames.push({
        header,
        payload: this.copyPayload ? payloadView.slice() : payloadView,
        payloadLength: header.payloadSize,
        byteLength: nextOffset - offset
      });
      offset = nextOffset;
    }

    this.pending = offset === bytes.length ? new Uint8Array(0) : bytes.slice(offset);
    return frames;
  }

  flush() {
    if (this.pending.length > 0) {
      throw new Error(`SoundKit audio frame stream ended with ${this.pending.length} buffered bytes`);
    }
  }
}

export const encodeSoundKitAudioFrame = (
  header: SoundKitAudioFrameHeaderInit,
  payload: Uint8Array,
  options: EncodeSoundKitAudioFrameOptions = {}
) => {
  const payloadSize = header.payloadSize ?? payload.length;
  if (payloadSize !== payload.length) {
    throw new RangeError("payloadSize must match payload.length");
  }

  let fullHeader: SoundKitFrameHeaderInit = { ...header, payloadSize };
  if (options.packetCrc32) {
    const packetCrc32 = computeSoundKitPacketCrc32(fullHeader, payload);
    fullHeader = { ...fullHeader, packetCrc32 };
  }

  const headerBytes = encodeSoundKitFrameHeader(fullHeader);
  const output = new Uint8Array(headerBytes.length + payload.length);
  output.set(headerBytes);
  output.set(payload, headerBytes.length);
  return output;
};

