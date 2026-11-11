import { createHash } from "node:crypto";

export const COORDINATOR_RECORDING_FORMAT = "source-references-v1" as const;
type Piece =
  | { literal: string }
  | { source: number; start: number; end: number };
type Encoded =
  | { scalar: null | boolean | number }
  | { text: Piece[] }
  | { array: Encoded[] }
  | { object: [Encoded, Encoded][] };
interface SourceFingerprint {
  sha256: string;
  codepoints: number;
}
export interface CoordinatorTape {
  version: 4;
  format: typeof COORDINATOR_RECORDING_FORMAT;
  requestHash: string;
  sources: SourceFingerprint[];
  payload: Encoded;
  payloadSha256: string;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fingerprints = (sources: readonly string[]) =>
  sources.map((value) => ({
    sha256: hash(value),
    codepoints: Array.from(value).length,
  }));
function checked(sources: readonly string[]): string[][] {
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.some((source) => typeof source !== "string" || !source.length)
  )
    throw new Error("Coordinator recording requires bound database sources");
  // Transform dictionaries are derived at replay time too; none are stored in the fixture.
  return sources.flatMap((source: string) => {
    const normalized = source.normalize("NFKC");
    return [
      source,
      normalized,
      normalized.toLowerCase(),
      normalized.toUpperCase(),
    ].map((text) => Array.from(text));
  });
}
/** No source character is written as a data literal, even for partial/escaped/repeated quotations. */
export function coordinatorTape(
  requestHash: string,
  sources: readonly string[],
  value: unknown,
): CoordinatorTape {
  const points = checked(sources),
    locations = new Map<string, { source: number; start: number }>();
  for (let source = 0; source < points.length; source++)
    for (const [start, char] of (points[source] ?? []).entries())
      if (!locations.has(char)) locations.set(char, { source, start });
  const encode = (value: unknown, depth = 0): Encoded => {
    if (depth > 100)
      throw new Error("Coordinator recording is too deeply nested");
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return { scalar: value };
    if (typeof value === "string") {
      const chars = Array.from(value),
        pieces: Piece[] = [];
      let literal = "";
      const flush = () => {
        if (literal) {
          pieces.push({ literal });
          literal = "";
        }
      };
      for (let i = 0; i < chars.length; ) {
        const char = chars[i] ?? "",
          location = locations.get(char);
        if (!location) {
          literal += char;
          i++;
          continue;
        }
        flush();
        let count = 1;
        while (
          i + count < chars.length &&
          points[location.source]?.[location.start + count] === chars[i + count]
        )
          count++;
        pieces.push({
          source: location.source,
          start: location.start,
          end: location.start + count,
        });
        i += count;
      }
      flush();
      return { text: pieces };
    }
    if (Array.isArray(value))
      return { array: value.map((item) => encode(item, depth + 1)) };
    if (value && typeof value === "object")
      return {
        object: Object.entries(value).map(([key, item]) => [
          encode(key, depth + 1),
          encode(item, depth + 1),
        ]),
      };
    throw new Error("Unsupported coordinator recording value");
  };
  const payload = encode(JSON.parse(JSON.stringify(value)));
  return {
    version: 4,
    format: COORDINATOR_RECORDING_FORMAT,
    requestHash,
    sources: fingerprints(sources),
    payload,
    payloadSha256: hash(JSON.stringify(payload)),
  };
}

export function replayCoordinatorTape(
  value: unknown,
  requestHash: string,
  sources: readonly string[],
): unknown {
  const points = checked(sources),
    alphabet = new Set(points.flat());
  const fail = (): never => {
    throw new Error("Coordinator replay fixture or source binding is invalid");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const tape = value as CoordinatorTape;
  if (
    Object.keys(tape).sort().join(",") !==
      "format,payload,payloadSha256,requestHash,sources,version" ||
    tape.version !== 4 ||
    tape.format !== COORDINATOR_RECORDING_FORMAT ||
    tape.requestHash !== requestHash ||
    JSON.stringify(tape.sources) !== JSON.stringify(fingerprints(sources)) ||
    !tape.payload ||
    typeof tape.payload !== "object" ||
    tape.payloadSha256 !== hash(JSON.stringify(tape.payload))
  )
    fail();
  let nodes = 0;
  const decode = (node: Encoded, depth = 0): unknown => {
    if (
      ++nodes > 200000 ||
      depth > 100 ||
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      Object.keys(node).length !== 1
    )
      fail();
    if ("scalar" in node) {
      if (
        node.scalar === null ||
        typeof node.scalar === "boolean" ||
        (typeof node.scalar === "number" && Number.isFinite(node.scalar))
      )
        return node.scalar;
      return fail();
    }
    if ("text" in node) {
      if (!Array.isArray(node.text)) fail();
      return node.text
        .map((piece) => {
          if (!piece || typeof piece !== "object" || Array.isArray(piece))
            return fail();
          if ("literal" in piece) {
            if (
              Object.keys(piece).length !== 1 ||
              typeof piece.literal !== "string" ||
              Array.from(piece.literal).some((char) => alphabet.has(char))
            )
              return fail();
            return piece.literal;
          }
          if (
            Object.keys(piece).sort().join(",") !== "end,source,start" ||
            !Number.isSafeInteger(piece.source) ||
            !Number.isSafeInteger(piece.start) ||
            !Number.isSafeInteger(piece.end)
          )
            return fail();
          const source = points[piece.source];
          if (
            !source ||
            piece.start < 0 ||
            piece.end <= piece.start ||
            piece.end > source.length
          )
            return fail();
          return source.slice(piece.start, piece.end).join("");
        })
        .join("");
    }
    if ("array" in node) {
      if (!Array.isArray(node.array)) return fail();
      return node.array.map((item) => decode(item, depth + 1));
    }
    if ("object" in node) {
      if (!Array.isArray(node.object)) return fail();
      const entries: [string, unknown][] = [],
        keys = new Set<string>();
      for (const entry of node.object) {
        if (!Array.isArray(entry) || entry.length !== 2) return fail();
        const key = decode(entry[0], depth + 1);
        if (typeof key !== "string" || keys.has(key)) return fail();
        keys.add(key);
        entries.push([key, decode(entry[1], depth + 1)]);
      }
      return Object.fromEntries(entries);
    }
    return fail();
  };
  return decode(tape.payload);
}
