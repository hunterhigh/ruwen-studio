export interface InputManifestItem {
  kind:
    | "packet_section"
    | "resource"
    | "prose"
    | "reader_reactions"
    | "edits"
    | "locked_events"
    | "hard_rules"
    | "diagnostic"
    | "chapter_tail"
    | "delegation"
    | "user_messages";
  label: string;
  resourceId?: string;
  path?: string;
  sha256?: string;
  chars: number;
  truncated: boolean;
  includedBecause:
    | "packet"
    | "registry_reader"
    | "pipeline_input"
    | "tool_call";
}

export interface InputManifest {
  version: 1;
  seen: InputManifestItem[];
  withheld: { category: string; ruleRef: string }[];
  rules: { upstreamFileCount: number; chars: number };
  totals: { inputChars: number; packetChars?: number; packetBudget?: number };
}

export interface PacketInputManifest {
  sha256: string;
  seen: InputManifestItem[];
  packetChars: number;
  packetBudget: number;
}

export function resourceInputLabel(path: string, title: unknown): string {
  return typeof title === "string" && title.trim()
    ? title.trim()
    : (path.split("/").at(-1) ?? path);
}
