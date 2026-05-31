import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAudioTailUrl,
  tailAudioParts
} from "../dist/index.js";

test("builds audio tail URLs with encoded stream segments", () => {
  const url = buildAudioTailUrl("https://edge.example/live", "artist/main mix", 41);
  assert.equal(url.href, "https://edge.example/live/artist/main%20mix/tail?mode=part&after=41");
});

test("tails one LL-HLS audio part and reports sequence metadata", async () => {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(new Uint8Array([7, 8, 9]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "x-sequence": "42"
      }
    });
  };

  const iterator = tailAudioParts({
    baseUrl: "https://edge.example/live",
    streamId: "artist/main",
    afterSequence: 41,
    fetch
  });

  const next = await iterator.next();
  await iterator.return?.();

  assert.equal(next.done, false);
  assert.equal(next.value.sequence, 42);
  assert.deepEqual(Array.from(next.value.bytes), [7, 8, 9]);
  assert.equal(calls[0].input, "https://edge.example/live/artist/main/tail?mode=part&after=41");
  assert.equal(calls[0].init.cache, "no-store");
});

