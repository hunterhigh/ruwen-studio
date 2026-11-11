import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { temporaryProject } from "../../core/test/helpers.ts";
import { createFauxRuntime, defaultFauxResponse } from "../src/faux.ts";
import { runRole } from "../src/run-role.ts";
import {
  coordinatorTape,
  replayCoordinatorTape,
} from "../src/runtime/coordinator-tape.ts";
import { createApplicationRuntime } from "../src/runtime/index.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
const source =
  "ORIGINAL_USER_WORDING_甲😀乙丙丁戊己庚辛壬癸_只留在数据库<&\n末行";

it("losslessly encodes quotations, partial repetitions, Unicode and generated keys without literal source characters", () => {
  const payload = {
    reply: `收到：${source}。${source.slice(3, 24)}`,
    arguments: {
      [source]: [source, null, true, 2.5, '{"source":0,"start":1}'],
    },
  };
  const tape = coordinatorTape("request-hash", [source], payload),
    serialized = JSON.stringify(tape);
  expect(serialized).not.toContain(source);
  expect(serialized).not.toContain(source.slice(0, 20));
  expect(
    replayCoordinatorTape(JSON.parse(serialized), "request-hash", [source]),
  ).toEqual(payload);
  const chars = new Set(Array.from(source));
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "literal")
        expect(Array.from(String(item)).some((c) => chars.has(c))).toBe(false);
      else if (Array.isArray(item)) for (const child of item) inspect(child);
      else inspect(item);
    }
  };
  inspect(tape.payload);
});

it("requires exact input bindings and rejects changed requests, missing sources and damaged tapes", () => {
  const tape = coordinatorTape("hash", [source], { text: source });
  expect(() => replayCoordinatorTape(tape, "other", [source])).toThrow(
    "invalid",
  );
  expect(() => replayCoordinatorTape(tape, "hash", [`${source}变更`])).toThrow(
    "invalid",
  );
  expect(() =>
    replayCoordinatorTape({ ...tape, version: 3 }, "hash", [source]),
  ).toThrow("invalid");
  expect(() =>
    replayCoordinatorTape({ ...tape, payloadSha256: "0".repeat(64) }, "hash", [
      source,
    ]),
  ).toThrow("invalid");
  expect(() => coordinatorTape("hash", [], {})).toThrow(
    "bound database sources",
  );
});

it("normalized and case-changed quotations remain database references rather than saved wording", () => {
  const raw = "ＰＲＩＶＡＴＥ＿ＷＯＲＤＩＮＧ＿１２３４５６e\u0301";
  const value = {
    lower: raw.normalize("NFKC").toLowerCase(),
    upper: raw.normalize("NFKC").toUpperCase(),
  };
  const tape = coordinatorTape("normalized", [raw], value),
    body = JSON.stringify(tape);
  expect(body).not.toContain(value.lower);
  expect(body).not.toContain(value.upper);
  expect(replayCoordinatorTape(tape, "normalized", [raw])).toEqual(value);
});

it("records and replays a multi-turn coordinator offline, preserving quoted replies and usage with no request body on disk", async () => {
  const project = await temporaryProject();
  cleanup.push(project.cleanup);
  const folder = await mkdtemp(path.join(tmpdir(), "ruwen-coordinator-tapes-"));
  cleanup.push(async () => {
    if (
      path.dirname(folder) !== path.resolve(tmpdir()) ||
      !path.basename(folder).startsWith("ruwen-coordinator-tapes-")
    )
      throw new Error("unsafe cleanup");
    await rm(folder, { recursive: true, force: true });
  });
  const upstream = createFauxRuntime([
    (context) => ({
      ...defaultFauxResponse(context),
      content: [
        {
          type: "toolCall",
          id: randomUUID(),
          name: "list_resources",
          arguments: {},
        },
      ],
      stopReason: "toolUse",
    }),
    (context) => ({
      ...defaultFauxResponse(context),
      content: [
        { type: "text", text: `你提到：${source}。我们可以先保留开放部分。` },
      ],
      stopReason: "stop",
    }),
  ]);
  const initial = {
    raw_user_text: source,
    conversation: [{ role: "user", content: source }],
    project_state: { project: "test-project" },
  };
  const runtime = createApplicationRuntime({
    mode: "record",
    workspaceRoot: folder,
    upstream,
  });
  let reloads = 0;
  const record = runtime.bindCoordinatorSources?.(() => [source]);
  if (!record) throw new Error("binding");
  const result = await runRole("chuangyi-xietiaoyuan", initial, {
    fs: project.fs,
    projectKey: "test-project",
    runtime: record,
    loadCoordinatorInput: async () => {
      reloads++;
      return initial;
    },
  });
  expect(result.output).toContain(source);
  expect(reloads).toBe(2);
  const directory = path.join(folder, ".local/model-recordings"),
    files = await readdir(directory);
  expect(files).toHaveLength(2);
  for (const file of files) {
    const body = await readFile(path.join(directory, file), "utf8"),
      frame = JSON.parse(body);
    expect(frame.version).toBe(4);
    expect(frame.request).toBeUndefined();
    expect(body).not.toContain(source);
    expect(body).not.toContain(source.slice(0, 20));
  }
  let liveCalls = 0;
  const offline = createFauxRuntime([]);
  offline.models.streamSimple = (() => {
    liveCalls++;
    throw new Error("live fallback");
  }) as typeof offline.models.streamSimple;
  const replay = createApplicationRuntime({
    mode: "replay",
    workspaceRoot: folder,
    upstream: offline,
  }).bindCoordinatorSources?.(() => [source]);
  if (!replay) throw new Error("binding");
  const second = await runRole("chuangyi-xietiaoyuan", initial, {
    fs: project.fs,
    projectKey: "test-project",
    runtime: replay,
    loadCoordinatorInput: async () => initial,
  });
  expect(second.output).toEqual(result.output);
  expect(second.usage).toEqual(result.usage);
  expect(liveCalls).toBe(0);
});

it("an unbound coordinator recording fails before any provider call or fixture write", async () => {
  const project = await temporaryProject();
  cleanup.push(project.cleanup);
  const folder = await mkdtemp(path.join(tmpdir(), "ruwen-coordinator-tapes-"));
  cleanup.push(async () => {
    if (
      path.dirname(folder) !== path.resolve(tmpdir()) ||
      !path.basename(folder).startsWith("ruwen-coordinator-tapes-")
    )
      throw new Error("unsafe cleanup");
    await rm(folder, { recursive: true, force: true });
  });
  let calls = 0;
  const upstream = createFauxRuntime();
  upstream.models.streamSimple = (() => {
    calls++;
    throw new Error("unexpected provider");
  }) as typeof upstream.models.streamSimple;
  const runtime = createApplicationRuntime({
    mode: "record",
    workspaceRoot: folder,
    upstream,
  });
  await expect(
    runRole(
      "chuangyi-xietiaoyuan",
      { raw_user_text: source },
      { fs: project.fs, projectKey: "test-project", runtime },
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  expect(await readdir(folder)).toEqual([]);
});
