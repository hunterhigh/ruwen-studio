import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const plugin = new URL(
  "../../../vendor/ruwen/01-完整插件/ruwen-xiezuo-xitong/",
  import.meta.url,
);

describe("pinned upstream baseline", () => {
  it("passes the 36 original Python tests on canonical committed bytes", () => {
    const result = spawnSync(
      process.env.PYTHON_BIN ?? "python",
      ["-I", "-B", "scripts/verify-upstream.py"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.error, output).toBeUndefined();
    expect(result.status, output).toBe(0);
    expect(output).toMatch(/Ran 36 tests/);
    expect(output.trim()).toMatch(/OK$/);
  }, 65_000);

  it("inventories every business script, role document, and original test", () => {
    const inventory = readFileSync(
      new URL("../../../docs/upstream-inventory.md", import.meta.url),
      "utf8",
    );
    const scripts = readdirSync(new URL("scripts/", plugin)).filter(
      (name) => name.endsWith(".py") && name !== "test_ruwen_v5.py",
    );
    expect(scripts).toHaveLength(12);
    for (const script of scripts) expect(inventory).toContain(script);
    const roles = ["ruwen-gushi-gousi", "ruwen-zhangjie-xiezuo"].flatMap(
      (skill) =>
        readdirSync(
          new URL(`skills/${skill}/references/roles/`, plugin),
        ).filter((name) => name.endsWith(".md")),
    );
    expect(roles).toHaveLength(12);
    for (const role of roles)
      expect(inventory).toContain(role.replace(/\.md$/, ""));
    const suite = readFileSync(
      new URL("scripts/test_ruwen_v5.py", plugin),
      "utf8",
    );
    const methods = [...suite.matchAll(/def (test_\w+)\(/g)].map(
      (match) => match[1],
    );
    expect(methods).toHaveLength(36);
    for (const method of methods) expect(inventory).toContain(method);
  });
});
