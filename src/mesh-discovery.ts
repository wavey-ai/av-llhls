import {
  tailAudioParts,
  type AudioPartFetch,
  type LlHlsAudioPart,
  type LlHlsAudioTailOptions
} from "./llhls-audio-client.js";

export type MeshStreamId = string | number | bigint;

export type MeshNodeSnapshot = {
  node_id: string;
  region?: string;
  continent?: string;
  egress_capacity_bps?: number;
  active_streams?: number;
  draining?: boolean;
};

export type MeshEdgeServiceSnapshot = {
  node_id: string;
  region?: string;
  continent?: string;
  playback_base_url?: string | null;
  active_readers?: number;
  requests_served?: number;
  bytes_served?: number;
  llhls_tail_requests?: number;
  draining?: boolean;
};

export type MeshStreamTelemetry = {
  node_id: string;
  stream_id?: number | string;
  stream_id_text?: string;
  stream_id_str?: string;
  latest_local_part?: number | null;
  latest_mesh_part?: number | null;
  latest_local_part_bytes?: number | null;
  bytes_received?: number;
  datagrams_received?: number;
};

export type MeshApiSnapshot = {
  updated_unix_ms?: number;
  node?: MeshNodeSnapshot;
  nodes?: MeshNodeSnapshot[];
  edge_services?: MeshEdgeServiceSnapshot[];
  streams?: MeshStreamTelemetry[];
};

export type MeshAudioEdgeCandidate = {
  nodeId: string;
  baseUrl: string;
  streamId: string;
  score: number;
  hasStream: boolean;
  latestPart: number | null;
  region?: string;
  continent?: string;
  activeReaders: number;
  egressCapacityBps: number;
  snapshotUpdatedUnixMs?: number;
  seedUrl?: string;
};

export type MeshAudioEdgeSelection = {
  edge: MeshAudioEdgeCandidate;
  candidates: MeshAudioEdgeCandidate[];
  snapshot: MeshApiSnapshot;
};

export type MeshAudioEdgeSelectionOptions = {
  streamId: MeshStreamId;
  preferredRegion?: string;
  preferredContinent?: string;
  preferredNodeId?: string;
  requireStreamPresent?: boolean;
};

export type MeshAudioEdgeDiscoveryOptions = MeshAudioEdgeSelectionOptions & {
  seeds: Array<string | URL>;
  fetch?: AudioPartFetch;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
};

export type MeshResolvedAudioTailOptions = LlHlsAudioTailOptions & {
  selectedEdge: MeshAudioEdgeCandidate;
  candidates: MeshAudioEdgeCandidate[];
  snapshot: MeshApiSnapshot;
};

export const normalizeMeshStreamId = (streamId: MeshStreamId) => {
  if (typeof streamId === "bigint") return streamId.toString();
  return String(streamId);
};

export const buildMeshApiUrl = (seed: string | URL) => {
  const url = new URL(String(seed));
  if (url.pathname !== "/api/mesh") {
    url.pathname = "/api/mesh";
    url.search = "";
    url.hash = "";
  }
  return url;
};

const finiteNumber = (value: unknown, fallback = 0) => (
  typeof value === "number" && Number.isFinite(value) ? value : fallback
);

const streamIdText = (stream: MeshStreamTelemetry) => {
  if (stream.stream_id_text) return stream.stream_id_text;
  if (stream.stream_id_str) return stream.stream_id_str;
  if (typeof stream.stream_id === "string") return stream.stream_id;
  if (Number.isSafeInteger(stream.stream_id)) return String(stream.stream_id);
  return null;
};

const streamLatestPart = (stream: MeshStreamTelemetry | undefined) => {
  if (!stream) return null;
  if (typeof stream.latest_mesh_part === "number") return stream.latest_mesh_part;
  if (typeof stream.latest_local_part === "number") return stream.latest_local_part;
  return null;
};

export const selectMeshAudioEdge = (
  snapshot: MeshApiSnapshot,
  options: MeshAudioEdgeSelectionOptions
): MeshAudioEdgeSelection => {
  const streamId = normalizeMeshStreamId(options.streamId);
  const nodes = new Map((snapshot.nodes ?? []).map((node) => [node.node_id, node]));
  if (snapshot.node?.node_id && !nodes.has(snapshot.node.node_id)) {
    nodes.set(snapshot.node.node_id, snapshot.node);
  }

  const streamByNode = new Map<string, MeshStreamTelemetry>();
  for (const stream of snapshot.streams ?? []) {
    if (streamIdText(stream) === streamId) {
      streamByNode.set(stream.node_id, stream);
    }
  }

  const candidates = (snapshot.edge_services ?? [])
    .map((service): MeshAudioEdgeCandidate | null => {
      const node = nodes.get(service.node_id);
      if (service.draining || node?.draining) return null;
      const baseUrl = service.playback_base_url?.trim();
      if (!baseUrl) return null;

      const stream = streamByNode.get(service.node_id);
      const latestPart = streamLatestPart(stream);
      const hasStream = latestPart !== null;
      if (options.requireStreamPresent && !hasStream) return null;

      const region = service.region ?? node?.region;
      const continent = service.continent ?? node?.continent;
      const activeReaders = finiteNumber(service.active_readers);
      const egressCapacityBps = finiteNumber(node?.egress_capacity_bps);
      const activeStreams = finiteNumber(node?.active_streams);
      const llhlsTailRequests = finiteNumber(service.llhls_tail_requests);

      let score = 0;
      if (hasStream) score += 1000;
      if (options.preferredNodeId && service.node_id === options.preferredNodeId) score += 500;
      if (options.preferredRegion && region === options.preferredRegion) score += 120;
      if (options.preferredContinent && continent === options.preferredContinent) score += 40;
      if (egressCapacityBps > 0) score += Math.min(80, Math.log10(egressCapacityBps));
      score -= activeReaders * 2;
      score -= activeStreams * 0.25;
      score -= llhlsTailRequests / 100_000;

      return {
        nodeId: service.node_id,
        baseUrl,
        streamId,
        score,
        hasStream,
        latestPart,
        region,
        continent,
        activeReaders,
        egressCapacityBps,
        snapshotUpdatedUnixMs: snapshot.updated_unix_ms
      };
    })
    .filter((candidate): candidate is MeshAudioEdgeCandidate => candidate !== null)
    .sort((left, right) => (
      right.score - left.score
      || left.activeReaders - right.activeReaders
      || left.nodeId.localeCompare(right.nodeId)
    ));

  const edge = candidates[0];
  if (!edge) {
    throw new Error("no mesh edge service is eligible for LL-HLS audio tailing");
  }

  return { edge, candidates, snapshot };
};

const fetchMeshSnapshot = async (
  seed: string | URL,
  options: Pick<MeshAudioEdgeDiscoveryOptions, "fetch" | "headers" | "credentials" | "signal">
) => {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error("fetch is unavailable");

  const url = buildMeshApiUrl(seed);
  const response = await fetchImpl(url, {
    cache: "no-store",
    credentials: options.credentials,
    headers: options.headers,
    signal: options.signal
  });
  if (!response.ok) {
    throw new Error(`mesh snapshot fetch failed from ${url.href} with HTTP ${response.status}`);
  }
  return {
    seedUrl: url.href,
    snapshot: await response.json() as MeshApiSnapshot
  };
};

export const discoverMeshAudioEdge = async (
  options: MeshAudioEdgeDiscoveryOptions
): Promise<MeshAudioEdgeSelection> => {
  if (options.seeds.length === 0) {
    throw new Error("at least one mesh seed URL is required");
  }

  const results = await Promise.allSettled(
    options.seeds.map((seed) => fetchMeshSnapshot(seed, options))
  );
  const errors: string[] = [];
  const candidates: MeshAudioEdgeCandidate[] = [];
  let selectedSnapshot: MeshApiSnapshot | null = null;

  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    try {
      const selection = selectMeshAudioEdge(result.value.snapshot, options);
      for (const candidate of selection.candidates) {
        candidates.push({ ...candidate, seedUrl: result.value.seedUrl });
      }
      selectedSnapshot ??= result.value.snapshot;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  candidates.sort((left, right) => (
    right.score - left.score
    || left.activeReaders - right.activeReaders
    || left.nodeId.localeCompare(right.nodeId)
  ));

  const edge = candidates[0];
  if (!edge || !selectedSnapshot) {
    throw new Error(`no mesh seed produced an eligible LL-HLS edge: ${errors.join("; ")}`);
  }
  return { edge, candidates, snapshot: selectedSnapshot };
};

export const resolveMeshAudioTailOptions = async (
  options: MeshAudioEdgeDiscoveryOptions
): Promise<MeshResolvedAudioTailOptions> => {
  const selection = await discoverMeshAudioEdge(options);
  return {
    baseUrl: selection.edge.baseUrl,
    streamId: selection.edge.streamId,
    fetch: options.fetch,
    headers: options.headers,
    credentials: options.credentials,
    signal: options.signal,
    selectedEdge: selection.edge,
    candidates: selection.candidates,
    snapshot: selection.snapshot
  };
};

export async function* tailAudioPartsFromMesh(
  options: MeshAudioEdgeDiscoveryOptions & Pick<LlHlsAudioTailOptions, "afterSequence" | "emptyDelayMs" | "reconnectDelayMs">
): AsyncGenerator<LlHlsAudioPart> {
  const resolved = await resolveMeshAudioTailOptions(options);
  yield* tailAudioParts({
    ...resolved,
    afterSequence: options.afterSequence,
    emptyDelayMs: options.emptyDelayMs,
    reconnectDelayMs: options.reconnectDelayMs
  });
}
