import {
  Agent,
  type AgentOptions,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  calculateCost,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type RegisterFauxProviderOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import { compile, obj, type Static, str } from "@earendil-works/pi-schema";
import { describe, expect, it, vi } from "vitest";

const submissionSchema = obj({ text: str({ minLength: 1, maxLength: 100 }) });
type Submission = Static<typeof submissionSchema>;

function harness(options: RegisterFauxProviderOptions = {}) {
  const faux = fauxProvider(options);
  const models = createModels();
  models.setProvider(faux.provider);
  function agent(extra: Partial<ConstructorParameters<typeof Agent>[0]> = {}) {
    return new Agent({
      streamFn: models.streamSimple.bind(models),
      initialState: {
        model: faux.getModel(),
        systemPrompt: "P0 isolated API verification.",
        tools: [],
        messages: [],
      },
      ...extra,
    });
  }
  return { faux, agent };
}

function submissionTool(
  execute: (value: Submission) => void,
): AgentTool<typeof submissionSchema> {
  return {
    name: "submit_x",
    label: "Submit",
    description: "Submit the final structured result.",
    parameters: submissionSchema,
    async execute(_id, value) {
      execute(value);
      return {
        content: [{ type: "text", text: "accepted" }],
        details: value,
        terminate: true,
      };
    },
  };
}

describe("pi 1.5.0 API spike (faux only)", () => {
  it("returns typed submission arguments and terminates without another model request", async () => {
    const { faux, agent } = harness();
    const submitted = vi.fn<(value: Submission) => void>();
    const runtime = agent();
    runtime.state.tools = [submissionTool(submitted)];
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_x", { text: "候选" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("must remain unused"),
    ]);

    await runtime.prompt("Submit a result.");

    expect(submitted).toHaveBeenCalledExactlyOnceWith({ text: "候选" });
    expect(faux.state.callCount).toBe(1);
    expect(faux.getPendingResponseCount()).toBe(1);
    expect(
      runtime.state.messages.filter((message) => message.role === "toolResult"),
    ).toHaveLength(1);
    expect(runtime.state.isStreaming).toBe(false);
  });

  it("blocks a write before execute and emits an error tool result", async () => {
    const { faux, agent } = harness();
    const write = vi.fn<(value: Submission) => void>();
    const beforeToolCall = vi.fn(async () => ({
      block: true,
      terminate: true,
      reason: "approval_required",
    }));
    const runtime = agent({ beforeToolCall });
    runtime.state.tools = [{ ...submissionTool(write), name: "write_project" }];
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_project", { text: "unapproved" }),
        {
          stopReason: "toolUse",
        },
      ),
    ]);

    await runtime.prompt("Try an unapproved write.");

    expect(beforeToolCall).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    const result = runtime.state.messages.find(
      (message) => message.role === "toolResult",
    );
    expect(result).toMatchObject({
      isError: true,
      content: [{ text: "approval_required" }],
    });
    expect(faux.state.callCount).toBe(1);
  });

  it("rejects invalid schema arguments before hooks and execution", async () => {
    const { faux, agent } = harness();
    const execute = vi.fn<(value: Submission) => void>();
    const beforeToolCall = vi.fn(async () => undefined);
    const runtime = agent({
      beforeToolCall,
      finishTurn: () => ({ action: "end" }),
    });
    runtime.state.tools = [submissionTool(execute)];
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_x", {}), {
        stopReason: "toolUse",
      }),
    ]);

    await runtime.prompt("Invalid parameters.");

    expect(execute).not.toHaveBeenCalled();
    expect(beforeToolCall).not.toHaveBeenCalled();
    expect(
      runtime.state.messages.find((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: true,
    });
  });

  it("captures final usage once and forwards text deltas", async () => {
    const { faux, agent } = harness({
      models: [
        {
          id: "priced-faux",
          cost: { input: 2, output: 4, cacheRead: 1, cacheWrite: 2 },
        },
      ],
    });
    const runtime = agent();
    const usage: Usage[] = [];
    const deltas: string[] = [];
    runtime.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        usage.push(event.message.usage);
      }
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        deltas.push(event.assistantMessageEvent.delta);
      }
    });
    faux.setResponses([fauxAssistantMessage("Streaming candidate text.")]);

    await runtime.prompt("Write a short passage.");

    expect(deltas.join("")).toBe("Streaming candidate text.");
    expect(usage).toHaveLength(1);
    const measured = usage[0];
    expect(measured).toBeDefined();
    if (!measured) throw new Error("Missing usage");
    expect(measured.input).toBeGreaterThan(0);
    expect(measured.output).toBeGreaterThan(0);
    // faux estimates tokens but deliberately emits zero cost, even for priced faux models.
    expect(measured.cost.total).toBe(0);
    const cost = calculateCost(faux.getModel(), structuredClone(measured));
    expect(cost.total).toBeGreaterThan(0);
    expect(cost.total).toBeCloseTo(
      (measured.input * 2 + measured.output * 4) / 1_000_000,
      10,
    );
  });

  it("documents runtime argument coercion so platform guards can inspect raw arguments", async () => {
    const { faux, agent } = harness();
    const execute = vi.fn<(value: Submission) => void>();
    const beforeToolCall = vi.fn<NonNullable<AgentOptions["beforeToolCall"]>>(
      async () => undefined,
    );
    const runtime = agent({ beforeToolCall });
    runtime.state.tools = [submissionTool(execute)];
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_x", { text: 42 }), {
        stopReason: "toolUse",
      }),
    ]);

    await runtime.prompt("Exercise the library's coercion.");

    expect(execute).toHaveBeenCalledExactlyOnceWith({ text: "42" });
    expect(beforeToolCall.mock.calls[0]?.[0]).toMatchObject({
      args: { text: "42" },
      toolCall: { arguments: { text: 42 } },
    });
  });

  it("can strictly reject coercible raw arguments before a tool causes effects", async () => {
    const { faux, agent } = harness();
    const execute = vi.fn<(value: Submission) => void>();
    const validator = compile(submissionSchema);
    const runtime = agent({
      beforeToolCall: async ({ toolCall }) =>
        validator.check(toolCall.arguments)
          ? undefined
          : { block: true, terminate: true, reason: "strict_schema_required" },
    });
    runtime.state.tools = [submissionTool(execute)];
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("submit_x", { text: 42 }), {
        stopReason: "toolUse",
      }),
    ]);

    await runtime.prompt("Reject coercible but invalid raw input.");

    expect(execute).not.toHaveBeenCalled();
    expect(
      runtime.state.messages.find((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: true,
      content: [{ text: "strict_schema_required" }],
    });
  });

  it("abort cancels an active stream and settles the agent", async () => {
    const { faux, agent } = harness({
      tokensPerSecond: 1_000,
      tokenSize: { min: 4, max: 4 },
    });
    const runtime = agent();
    const deltas: string[] = [];
    runtime.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        deltas.push(event.assistantMessageEvent.delta);
        runtime.abort();
      }
    });
    faux.setResponses([
      fauxAssistantMessage("long streaming content ".repeat(100)),
    ]);

    await runtime.prompt("Keep streaming until cancelled.");
    await runtime.waitForIdle();

    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.join("").length).toBeLessThan(2_300);
    expect(
      runtime.state.messages
        .filter((message) => message.role === "assistant")
        .at(-1),
    ).toMatchObject({
      stopReason: "aborted",
    });
    expect(runtime.state.isStreaming).toBe(false);
    expect(runtime.state.pendingToolCalls.size).toBe(0);
  });

  it("uses finishTurn to impose a finite turn budget", async () => {
    const { faux, agent } = harness();
    let turns = 0;
    const runtime = agent({
      finishTurn: () => ({ action: ++turns >= 2 ? "end" : "continue" }),
    });
    faux.setResponses([
      fauxAssistantMessage("first"),
      fauxAssistantMessage("second"),
      fauxAssistantMessage("must remain unused"),
    ]);

    await runtime.prompt("Exercise a bounded loop.");

    expect(turns).toBe(2);
    expect(faux.state.callCount).toBe(2);
    expect(faux.getPendingResponseCount()).toBe(1);
  });

  it("does not treat a submit tool as cancellation of sibling tools in the same batch", async () => {
    const { faux, agent } = harness();
    const sibling = vi.fn<(value: Submission) => void>();
    const runtime = agent();
    const siblingTool = submissionTool(sibling);
    runtime.state.tools = [
      submissionTool(() => undefined),
      {
        ...siblingTool,
        name: "read_resource",
        async execute(id, value, signal, update) {
          return {
            ...(await siblingTool.execute(id, value, signal, update)),
            terminate: false,
          };
        },
      },
    ];
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("submit_x", { text: "done" }),
          fauxToolCall("read_resource", { text: "read" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("batch continued"),
    ]);

    await runtime.prompt("Exercise mixed termination hints.");

    expect(sibling).toHaveBeenCalledOnce();
    expect(faux.state.callCount).toBe(2);
  });

  it("prepareRequest sees the first request and fresh agents keep histories separate", async () => {
    const { faux, agent } = harness();
    const contexts: string[] = [];
    const prepareRequest = vi.fn((request) => {
      contexts.push(JSON.stringify(request.context.messages));
    });
    const first = agent({ prepareRequest });
    const second = agent({ prepareRequest });
    faux.setResponses([
      fauxAssistantMessage("first result"),
      fauxAssistantMessage("second result"),
    ]);

    await first.prompt("FIRST_SECRET_SENTINEL");
    await second.prompt("SECOND_INPUT");

    expect(prepareRequest).toHaveBeenCalledTimes(2);
    expect(contexts[0]).toContain("FIRST_SECRET_SENTINEL");
    expect(contexts[1]).not.toContain("FIRST_SECRET_SENTINEL");
    expect(contexts[1]).toContain("SECOND_INPUT");
  });
});
