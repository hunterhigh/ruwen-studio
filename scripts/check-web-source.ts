import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Occurrence = { file: string; text: string; lines: number[] };
type Exception = { file: string; text: string; count: number; reason: string };

const sourceDir = fileURLToPath(new URL("../apps/web/src/", import.meta.url));
const whitelist = new URL("./web-source-exceptions.json", import.meta.url);
const han = /\p{Script=Han}/u;
const prohibited =
  /\b(?:window\s*(?:(?:\?\.|\.)\s*(?:confirm|alert|prompt)\b|\[\s*["'](?:confirm|alert|prompt)["']\s*\])|dangerouslySetInnerHTML\b)/u;
const keyOf = (file: string, text: string) => JSON.stringify([file, text]);

const occurrences = new Map<string, Occurrence>();
const prohibitedUses: string[] = [];
for (const entry of readdirSync(sourceDir, {
  recursive: true,
  encoding: "utf8",
}).sort()) {
  const file = entry.replaceAll("\\", "/");
  if (
    !/\.tsx?$/.test(file) ||
    /\.(?:test|spec)\.tsx?$/.test(file) ||
    file.startsWith("copy/") ||
    /(?:^|\/)__tests__\//.test(file)
  )
    continue;
  const content = readFileSync(join(sourceDir, entry), "utf8");
  const parsed = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateLiteralToken(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.trim();
      if (han.test(text)) {
        const key = keyOf(file, text);
        const found: Occurrence = occurrences.get(key) ?? {
          file,
          text,
          lines: [],
        };
        found.lines.push(
          parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
        );
        occurrences.set(key, found);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (/^(?:components|ui)\//.test(file)) {
    content.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(prohibited);
      if (match) prohibitedUses.push(`${file}:${index + 1} ${match[0]}`);
    });
  }
}

if (process.argv.includes("--inventory")) {
  console.log(JSON.stringify([...occurrences.values()], null, 2));
} else {
  const allowed = JSON.parse(readFileSync(whitelist, "utf8")) as Exception[];
  const exceptions = new Map<string, Exception>();
  const failures = [...prohibitedUses];
  for (const rule of allowed) {
    const key = keyOf(rule.file, rule.text);
    if (
      exceptions.has(key) ||
      !rule.reason.trim() ||
      !Number.isSafeInteger(rule.count) ||
      rule.count <= 0
    )
      throw new Error(`Invalid source exception ${key}`);
    exceptions.set(key, rule);
  }
  for (const [key, finding] of occurrences) {
    const rule = exceptions.get(key);
    if (rule?.count !== finding.lines.length) {
      failures.push(
        finding.file +
          ":" +
          finding.lines.join(",") +
          " " +
          JSON.stringify(finding.text),
      );
    }
    exceptions.delete(key);
  }
  for (const rule of exceptions.values())
    failures.push(`Unused exception ${rule.file} ${JSON.stringify(rule.text)}`);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log(
      "0 unlisted Han literals, " +
        allowed.reduce((sum, rule) => sum + rule.count, 0) +
        " approved occurrences across " +
        allowed.length +
        " entries, 0 prohibited component APIs.",
    );
  }
}
