import {
  computeSoundKitPacketCrc32,
  decodeSoundKitFrameHeader,
  encodeSoundKitFrameHeader,
  IncompleteSoundKitFrameHeaderError,
  SOUNDKIT_FRAME_HEADER_BASE_BYTES,
  soundKitFrameHeaderByteLength,
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

export class SoundKitAudioFrameStream {
  private chunks: Uint8Array[] = [];
  private headOffset = 0;
  private bufferedByteLength = 0;
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
    return this.bufferedByteLength;
  }

  reset() {
    this.chunks = [];
    this.headOffset = 0;
    this.bufferedByteLength = 0;
  }

  push(chunk: Uint8Array): SoundKitAudioFrame[] {
    if (this.bufferedByteLength + chunk.length > this.maxBufferedBytes) {
      throw new RangeError("SoundKit audio frame buffer exceeded maxBufferedBytes");
    }

    if (chunk.length > 0) this.enqueue(chunk);
    const frames: SoundKitAudioFrame[] = [];

    while (this.bufferedByteLength >= SOUNDKIT_FRAME_HEADER_BASE_BYTES) {
      let header: SoundKitFrameHeader;
      let headerByteLength: number;
      try {
        const base = this.peekBytes(SOUNDKIT_FRAME_HEADER_BASE_BYTES);
        if (base === null) break;
        headerByteLength = soundKitFrameHeaderByteLength(base);
        const encodedHeader = this.peekBytes(headerByteLength);
        if (encodedHeader === null) break;
        header = decodeSoundKitFrameHeader(encodedHeader);
      } catch (error) {
        if (error instanceof IncompleteSoundKitFrameHeaderError) break;
        throw error;
      }

      if (header.payloadSize > this.maxPayloadBytes) {
        throw new RangeError("SoundKit audio frame payload exceeded maxPayloadBytes");
      }

      const frameByteLength = headerByteLength + header.payloadSize;
      if (this.bufferedByteLength < frameByteLength) break;

      const encodedHeader = this.takeBytes(headerByteLength, false);
      const payloadView = this.takeBytes(header.payloadSize, this.copyPayload);
      if (this.verifyPacketCrc32 && header.packetCrc32 !== undefined && !verifySoundKitPacketCrc32(header, encodedHeader, payloadView)) {
        throw new Error("SoundKit audio frame CRC32 mismatch");
      }

      frames.push({
        header,
        payload: payloadView,
        payloadLength: header.payloadSize,
        byteLength: frameByteLength
      });
    }

    return frames;
  }

  flush() {
    if (this.bufferedByteLength > 0) {
      throw new Error(`SoundKit audio frame stream ended with ${this.bufferedByteLength} buffered bytes`);
    }
  }

  private enqueue(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.bufferedByteLength += chunk.length;
  }

  private peekBytes(byteLength: number) {
    if (this.bufferedByteLength < byteLength) return null;
    if (byteLength === 0) return new Uint8Array(0);

    const head = this.chunks[0]!;
    const headAvailable = head.length - this.headOffset;
    if (headAvailable >= byteLength) {
      return head.subarray(this.headOffset, this.headOffset + byteLength);
    }

    const output = new Uint8Array(byteLength);
    this.copyFromQueue(output);
    return output;
  }

  private takeBytes(byteLength: number, copy: boolean) {
    if (this.bufferedByteLength < byteLength) {
      throw new RangeError("not enough queued bytes");
    }
    if (byteLength === 0) return new Uint8Array(0);

    const head = this.chunks[0]!;
    const headAvailable = head.length - this.headOffset;
    let output: Uint8Array;

    if (headAvailable >= byteLength) {
      const view = head.subarray(this.headOffset, this.headOffset + byteLength);
      output = copy ? view.slice() : view;
    } else {
      output = new Uint8Array(byteLength);
      this.copyFromQueue(output);
    }

    this.consumeBytes(byteLength);
    return output;
  }

  private copyFromQueue(target: Uint8Array) {
    let targetOffset = 0;
    let remaining = target.length;
    let chunkIndex = 0;
    let chunkOffset = this.headOffset;

    while (remaining > 0) {
      const chunk = this.chunks[chunkIndex]!;
      const copyLength = Math.min(remaining, chunk.length - chunkOffset);
      target.set(chunk.subarray(chunkOffset, chunkOffset + copyLength), targetOffset);
      targetOffset += copyLength;
      remaining -= copyLength;
      chunkIndex += 1;
      chunkOffset = 0;
    }
  }

  private consumeBytes(byteLength: number) {
    let remaining = byteLength;
    this.bufferedByteLength -= byteLength;

    while (remaining > 0) {
      const head = this.chunks[0]!;
      const headAvailable = head.length - this.headOffset;
      if (remaining < headAvailable) {
        this.headOffset += remaining;
        return;
      }

      remaining -= headAvailable;
      this.chunks.shift();
      this.headOffset = 0;
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
