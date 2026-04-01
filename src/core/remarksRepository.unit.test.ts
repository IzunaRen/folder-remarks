import { describe, expect, test } from "vitest";
import { RemarksRepository } from "./remarksRepository";

class InMemoryStorage {
  #data: unknown = undefined;
  read(): Promise<unknown> {
    return Promise.resolve(this.#data);
  }
  write(value: unknown): Promise<void> {
    this.#data = value;
    return Promise.resolve();
  }
}

class FailingStorage extends InMemoryStorage {
  override write(): Promise<void> {
    return Promise.reject(new Error("write failed"));
  }
}

describe("RemarksRepository", () => {
  test("CRUD: upsert/get/list/remove/clear", async () => {
    const storage = new InMemoryStorage();
    const repo = new RemarksRepository({ storage });
    await repo.load();

    await repo.upsert({ folderUri: "file:///a", remarkName: "A", now: 1 });
    await repo.upsert({ folderUri: "file:///b", remarkName: "B", now: 2 });

    expect(repo.get("file:///a")?.remarkName).toBe("A");
    expect(repo.list().map((r) => r.folderUri)).toEqual(["file:///b", "file:///a"]);

    await repo.upsert({ folderUri: "file:///a", remarkName: "A2", now: 3 });
    expect(repo.get("file:///a")?.remarkName).toBe("A2");
    expect(repo.get("file:///a")?.createdAt).toBe(1);
    expect(repo.get("file:///a")?.updatedAt).toBe(3);

    await repo.remove("file:///b");
    expect(repo.get("file:///b")).toBeUndefined();
    expect(repo.list().length).toBe(1);

    await repo.clear();
    expect(repo.list().length).toBe(0);
  });

  test("load: ignores invalid persisted payloads", async () => {
    const storage = new InMemoryStorage();
    await storage.write({ version: 999, remarksByFolderUri: { "file:///x": { a: 1 } } });
    const repo = new RemarksRepository({ storage });
    await repo.load();
    expect(repo.list()).toEqual([]);
  });

  test("error: write failure does not mutate in-memory state", async () => {
    const storage = new FailingStorage();
    const repo = new RemarksRepository({ storage });
    await repo.load();

    await expect(repo.upsert({ folderUri: "file:///a", remarkName: "A", now: 1 })).rejects.toThrow("write failed");
    expect(repo.get("file:///a")).toBeUndefined();
    expect(repo.list()).toEqual([]);
  });

  test(
    "performance: load/list works with many items",
    async () => {
      const storage = new InMemoryStorage();
      const repo = new RemarksRepository({ storage });
      const total = 50_000;
      const remarksByFolderUri: Record<string, unknown> = {};
      for (let i = 0; i < total; i += 1) {
        remarksByFolderUri[`file:///f${i}`] = {
          folderUri: `file:///f${i}`,
          remarkName: `Remark ${i}`,
          createdAt: i,
          updatedAt: i
        };
      }
      await storage.write({ version: 1, remarksByFolderUri });
      await repo.load();

      const list = repo.list();
      expect(list.length).toBe(total);
      expect(list[0]?.updatedAt).toBe(total - 1);
    }
  );
});
