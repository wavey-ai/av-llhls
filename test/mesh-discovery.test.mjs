import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAudioTailUrl,
  buildMeshApiUrl,
  discoverMeshAudioEdge,
  resolveMeshAudioTailOptions,
  selectMeshAudioEdge
} from "../dist/index.js";

const snowflakeStreamId = "9007199254741993";

const snapshot = {
  updated_unix_ms: 1_780_000_000_000,
  nodes: [
    {
      node_id: "uk-1",
      region: "uk",
      continent: "eu",
      egress_capacity_bps: 10_000_000_000,
      active_streams: 8,
      draining: false
    },
    {
      node_id: "jp-1",
      region: "jp",
      continent: "apac",
      egress_capacity_bps: 20_000_000_000,
      active_streams: 3,
      draining: false
    },
    {
      node_id: "draining-1",
      region: "uk",
      continent: "eu",
      draining: true
    }
  ],
  edge_services: [
    {
      node_id: "uk-1",
      region: "uk",
      continent: "eu",
      playback_base_url: "https://uk.example/live",
      active_readers: 20,
      llhls_tail_requests: 100
    },
    {
      node_id: "jp-1",
      region: "jp",
      continent: "apac",
      playback_base_url: "https://jp.example/live",
      active_readers: 2,
      llhls_tail_requests: 10
    },
    {
      node_id: "draining-1",
      region: "uk",
      continent: "eu",
      playback_base_url: "https://draining.example/live",
      active_readers: 0
    }
  ],
  streams: [
    {
      node_id: "jp-1",
      stream_id_text: snowflakeStreamId,
      latest_mesh_part: 42,
      bytes_received: 1024,
      datagrams_received: 1
    }
  ]
};

test("builds mesh API URLs from node and playback seeds", () => {
  assert.equal(buildMeshApiUrl("https://edge.example/live").href, "https://edge.example/api/mesh");
  assert.equal(buildMeshApiUrl("https://edge.example/api/mesh").href, "https://edge.example/api/mesh");
});

test("selects an edge with the requested stream and ignores draining nodes", () => {
  const selection = selectMeshAudioEdge(snapshot, {
    streamId: snowflakeStreamId,
    preferredRegion: "uk"
  });

  assert.equal(selection.edge.nodeId, "jp-1");
  assert.equal(selection.edge.baseUrl, "https://jp.example/live");
  assert.equal(selection.edge.streamId, snowflakeStreamId);
  assert.equal(selection.edge.hasStream, true);
  assert.equal(selection.edge.latestPart, 42);
  assert.equal(selection.candidates.some((candidate) => candidate.nodeId === "draining-1"), false);
});

test("can choose a healthy edge even before the stream is local", () => {
  const selection = selectMeshAudioEdge({
    ...snapshot,
    streams: []
  }, {
    streamId: snowflakeStreamId,
    preferredRegion: "uk"
  });

  assert.equal(selection.edge.nodeId, "uk-1");
  assert.equal(selection.edge.hasStream, false);
});

test("discovers an edge from mesh seeds and resolves tail options", async () => {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json(snapshot);
  };

  const resolved = await resolveMeshAudioTailOptions({
    seeds: ["https://seed.example/live"],
    streamId: BigInt(snowflakeStreamId),
    preferredContinent: "apac",
    fetch
  });

  assert.equal(calls[0].input, "https://seed.example/api/mesh");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(resolved.selectedEdge.nodeId, "jp-1");
  assert.equal(resolved.baseUrl, "https://jp.example/live");
  assert.equal(resolved.streamId, snowflakeStreamId);
  assert.equal(
    buildAudioTailUrl(resolved.baseUrl, resolved.streamId, 42).href,
    `https://jp.example/live/${snowflakeStreamId}/tail?mode=part&after=42`
  );
});

test("discovers candidates from multiple seeds and chooses the highest score", async () => {
  const fetch = async (input) => Response.json(
    String(input).startsWith("https://seed-a")
      ? { ...snapshot, streams: [] }
      : snapshot
  );

  const selection = await discoverMeshAudioEdge({
    seeds: ["https://seed-a.example", "https://seed-b.example"],
    streamId: snowflakeStreamId,
    fetch
  });

  assert.equal(selection.edge.nodeId, "jp-1");
  assert.equal(selection.edge.seedUrl, "https://seed-b.example/api/mesh");
  assert.equal(selection.candidates.length, 4);
});
