import { describe, expect, it } from "vitest";
import { AlreadyExists, type ProjectFS } from "../src/fs/project-fs.ts";

export function projectFSContract(
  name: string,
  create: () => Promise<ProjectFS>,
) {
  describe(`${name} ProjectFS contract`, () => {
    it("rolls back nested failures even when the caller catches them", async () => {
      const fs = await create();
      await fs.write("a", "old");
      let leaked: ProjectFS | undefined;
      await fs.transaction(async (tx) => {
        leaked = tx;
        await expect(
          tx.transaction(async (inner) => {
            await inner.write("a", "bad");
            await inner.write("marker", "bad");
            throw new Error("nested failure");
          }),
        ).rejects.toThrow("nested failure");
        expect(await tx.readText("a")).toBe("old");
        expect(await tx.exists("marker")).toBe(false);
        await tx.write("b", "outer commits");
      });
      expect(await fs.list()).toEqual(["a", "b"]);
      if (leaked)
        await expect(leaked.write("late", "invalid")).rejects.toThrow("closed");
    });
    it("preserves UTF-8 and raw bytes, hashes original bytes", async () => {
      const fs = await create();
      await fs.write("人物/声.txt", "汉字😀\r\n");
      expect(await fs.readText("人物/声.txt")).toBe("汉字😀\r\n");
      expect(await fs.read("人物/声.txt")).toEqual(
        new TextEncoder().encode("汉字😀\r\n"),
      );
      await fs.write("binary", new Uint8Array([0, 255, 128]));
      expect(await fs.read("binary")).toEqual(new Uint8Array([0, 255, 128]));
      await expect(fs.readText("binary")).rejects.toThrow();
      await fs.write("人物/声.txt", "汉字😀\n");
      expect(await fs.sha256("人物/声.txt")).toMatch(/^[a-f0-9]{64}$/);
    });
    it("rejects escaping paths on every operation", async () => {
      const fs = await create();
      for (const p of ["../outside", "../../escape", "..\\escape", "x\0y"]) {
        await expect(fs.write(p, "bad")).rejects.toThrow();
        await expect(fs.read(p)).rejects.toThrow();
        await expect(fs.remove(p)).rejects.toThrow();
        await expect(fs.exists(p)).rejects.toThrow();
        await expect(fs.list(p)).rejects.toThrow();
      }
    });
    it("exclusively creates exactly one winner under contention", async () => {
      const fs = await create();
      const result = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          fs.createExclusive("marker", `${i}`),
        ),
      );
      expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      for (const item of result)
        if (item.status === "rejected")
          expect(item.reason).toBeInstanceOf(AlreadyExists);
    });
    it("lists recursively by Unicode code points and removes only files", async () => {
      const fs = await create();
      for (const p of ["d/😀", "d/\uE000", "d/z", "other"])
        await fs.write(p, "");
      expect(await fs.list("d")).toEqual(["d/z", "d/\uE000", "d/😀"]);
      await fs.remove("d/z");
      await fs.remove("absent");
      expect(await fs.exists("d/z")).toBe(false);
    });
    it("commits the complete transaction and rolls back all changes on failure", async () => {
      const fs = await create();
      await fs.write("a", "old");
      await expect(
        fs.transaction(async (tx) => {
          await tx.write("a", "new");
          await tx.write("b", "added");
          await tx.createExclusive("marker", "reserved");
          throw new Error("fail");
        }),
      ).rejects.toThrow("fail");
      expect(await fs.readText("a")).toBe("old");
      expect(await fs.list()).toEqual(["a"]);
      const result = await fs.transaction(async (tx) => {
        await tx.write("a", "committed");
        await tx.write("b", "new");
        return 7;
      });
      expect(result).toBe(7);
      expect(await fs.readText("a")).toBe("committed");
      expect(await fs.exists("b")).toBe(true);
    });
    it("serializes concurrent transactions without lost writes", async () => {
      const fs = await create();
      await fs.write("count", "0");
      await Promise.all(
        Array.from({ length: 8 }, () =>
          fs.transaction(async (tx) => {
            const n = Number(await tx.readText("count"));
            await tx.write("count", String(n + 1));
          }),
        ),
      );
      expect(await fs.readText("count")).toBe("8");
    });
  });
}
