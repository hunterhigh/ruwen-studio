import { deploymentCanary } from "@ruwen/agents";
import { handoff, LeakDetector } from "@ruwen/core";
import { IncrementalOutput } from "../../../agents/src/security/incremental-output.ts";
import { ideationFail } from "./sessions.ts";

/** Raw wording lives only in this private scanner and coordinator DB reads, never a role input/snapshot. */
export function assertNoOriginalWording(
  value: unknown,
  sources: readonly string[],
) {
  for (const source of sources)
    if (handoff.sourceOverlapErrors({ value: value as never }, source).length)
      ideationFail("OUTPUT_BLOCKED");
}
export class OriginalWordingStream {
  private stream: IncrementalOutput;
  private blocked = false;
  constructor(
    sources: readonly string[],
    privatePublish: (text: string) => void,
  ) {
    // Deliberately conservative for public events; quoted wording can still be read via messages.
    this.stream = new IncrementalOutput(
      new LeakDetector(sources.join("\n"), deploymentCanary(), [], 12),
      privatePublish,
    );
  }
  push(text: string) {
    if (this.blocked) return false;
    if (this.stream.push(text)) {
      this.blocked = true;
      return false;
    }
    return true;
  }
  reset() {
    this.stream.discard();
    this.blocked = false;
  }
  finish() {
    if (!this.blocked) this.stream.finish();
  }
}
