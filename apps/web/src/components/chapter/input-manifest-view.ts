import type { InputManifest } from "@ruwen/core";
import { inputManifestCopy as c, cleanupCopy } from "../../copy/zh-CN.ts";

const count = new Intl.NumberFormat("zh-CN");
const listing = new Intl.ListFormat("zh-CN");
const summarizeFirst = ["story_outline", "full_character_profiles", "research"];

function known<K extends string, V>(
  table: Readonly<Record<K, V>>,
  key: string,
) {
  return Object.hasOwn(table, key) ? table[key as K] : undefined;
}

function withheldGroups(withheld: InputManifest["withheld"]) {
  const groups = new Map<string, { labels: Set<string>; reason: string }>();
  for (const { category, ruleRef } of withheld) {
    const name = known(c.categories, category);
    const label = name ?? c.unknownCategory;
    const rule = name ? known(c.ruleReasons, ruleRef) : undefined;
    const reason =
      typeof rule === "function" ? rule(label) : (rule ?? c.unknownRule);
    const groupReason =
      ruleRef === "I4" && typeof rule === "function"
        ? cleanupCopy.authorWithheld
        : reason;
    const group = groups.get(groupReason);
    if (group) group.labels.add(label);
    else groups.set(groupReason, { labels: new Set([label]), reason });
  }
  return Array.from(groups, ([groupReason, { labels, reason }]) => ({
    labels: [...labels],
    reason: labels.size > 1 ? groupReason : reason,
  }));
}

export function roleInputsView(
  manifest: InputManifest | null | undefined,
  author: boolean,
) {
  if (!manifest) return { kind: "legacy" as const, notice: c.noRecord };
  const { packetChars, packetBudget } = manifest.totals;
  const budget =
    typeof packetBudget === "number" && packetBudget > 0
      ? packetBudget
      : undefined;
  const packet =
    author && typeof packetChars === "number"
      ? {
          text: budget
            ? c.packetBudget(count.format(packetChars), count.format(budget))
            : c.packetSize(count.format(packetChars)),
          percent: budget
            ? Math.min(100, Math.max(0, (packetChars / budget) * 100))
            : undefined,
        }
      : undefined;
  return {
    kind: "record" as const,
    seen: manifest.seen.map(({ label, chars, truncated, path, sha256 }) => ({
      label,
      size: c.chars(count.format(chars)) + (truncated ? c.truncated : ""),
      path,
      sha256,
    })),
    withheld: withheldGroups(manifest.withheld),
    rules: c.rulesSize(
      count.format(manifest.rules.upstreamFileCount),
      count.format(manifest.rules.chars),
    ),
    packet,
  };
}

export function authorInputsSummary(
  manifest: InputManifest | null | undefined,
) {
  if (!manifest) return undefined;
  const categories = new Set(manifest.withheld.map(({ category }) => category));
  const labels = new Set(
    [
      ...summarizeFirst.filter((category) => categories.has(category)),
      ...categories,
    ].map((category) => known(c.categories, category) ?? c.unknownCategory),
  );
  return c.summary(
    count.format(manifest.seen.length),
    count.format(manifest.totals.packetChars ?? manifest.totals.inputChars),
    listing.format([...labels].slice(0, 3)),
  );
}
