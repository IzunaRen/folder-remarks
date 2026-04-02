"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const remarksRepository_1 = require("./remarksRepository");
class InMemoryStorage {
    #data = undefined;
    read() {
        return Promise.resolve(this.#data);
    }
    write(value) {
        this.#data = value;
        return Promise.resolve();
    }
}
class FailingStorage extends InMemoryStorage {
    write(value) {
        void value;
        return Promise.reject(new Error("write failed"));
    }
}
class SeededFailingStorage extends InMemoryStorage {
    seed(value) {
        return super.write(value);
    }
    write(value) {
        void value;
        return Promise.reject(new Error("write failed"));
    }
}
(0, vitest_1.describe)("RemarksRepository", () => {
    (0, vitest_1.test)("CRUD: upsert/get/list/remove/clear", async () => {
        const storage = new InMemoryStorage();
        const repo = new remarksRepository_1.RemarksRepository({ storage });
        await repo.load();
        await repo.upsert({ folderUri: "file:///a", remarkName: "A", now: 1 });
        await repo.upsert({ folderUri: "file:///b", remarkName: "B", now: 2 });
        (0, vitest_1.expect)(repo.get("file:///a")?.remarkName).toBe("A");
        (0, vitest_1.expect)(repo.list().map((r) => r.folderUri)).toEqual(["file:///b", "file:///a"]);
        await repo.upsert({ folderUri: "file:///a", remarkName: "A2", now: 3 });
        (0, vitest_1.expect)(repo.get("file:///a")?.remarkName).toBe("A2");
        (0, vitest_1.expect)(repo.get("file:///a")?.createdAt).toBe(1);
        (0, vitest_1.expect)(repo.get("file:///a")?.updatedAt).toBe(3);
        await repo.remove("file:///b");
        (0, vitest_1.expect)(repo.get("file:///b")).toBeUndefined();
        (0, vitest_1.expect)(repo.list().length).toBe(1);
        await repo.clear();
        (0, vitest_1.expect)(repo.list().length).toBe(0);
    });
    (0, vitest_1.test)("renameKey/movePrefix/removePrefix", async () => {
        const storage = new InMemoryStorage();
        const repo = new remarksRepository_1.RemarksRepository({ storage });
        await repo.load();
        await repo.upsert({ folderUri: "a", remarkName: "A", now: 1 });
        await repo.upsert({ folderUri: "a/b", remarkName: "B", now: 2 });
        await repo.upsert({ folderUri: "a/b/c", remarkName: "C", now: 3 });
        await repo.upsert({ folderUri: "x", remarkName: "X", now: 4 });
        await repo.renameKey({ fromKey: "x", toKey: "y", now: 10 });
        (0, vitest_1.expect)(repo.get("x")).toBeUndefined();
        (0, vitest_1.expect)(repo.get("y")?.remarkName).toBe("X");
        (0, vitest_1.expect)(repo.get("y")?.updatedAt).toBe(10);
        await repo.movePrefix({ fromPrefix: "a/b", toPrefix: "a/d", now: 11 });
        (0, vitest_1.expect)(repo.get("a/b")).toBeUndefined();
        (0, vitest_1.expect)(repo.get("a/b/c")).toBeUndefined();
        (0, vitest_1.expect)(repo.get("a")?.remarkName).toBe("A");
        (0, vitest_1.expect)(repo.get("a/d")?.remarkName).toBe("B");
        (0, vitest_1.expect)(repo.get("a/d/c")?.remarkName).toBe("C");
        (0, vitest_1.expect)(repo.get("a/d")?.updatedAt).toBe(11);
        (0, vitest_1.expect)(repo.get("a/d/c")?.updatedAt).toBe(11);
        await repo.removePrefix("a/d");
        (0, vitest_1.expect)(repo.get("a/d")).toBeUndefined();
        (0, vitest_1.expect)(repo.get("a/d/c")).toBeUndefined();
        (0, vitest_1.expect)(repo.get("a")?.remarkName).toBe("A");
    });
    (0, vitest_1.test)("error: write failure does not mutate in-memory state for rename/move/removePrefix", async () => {
        const storage = new FailingStorage();
        const repo = new remarksRepository_1.RemarksRepository({ storage });
        await repo.load();
        await (0, vitest_1.expect)(repo.upsert({ folderUri: "a", remarkName: "A", now: 1 })).rejects.toThrow("write failed");
        (0, vitest_1.expect)(repo.list()).toEqual([]);
        const okStorage = new InMemoryStorage();
        const okRepo = new remarksRepository_1.RemarksRepository({ storage: okStorage });
        await okRepo.load();
        await okRepo.upsert({ folderUri: "a", remarkName: "A", now: 1 });
        await okRepo.upsert({ folderUri: "a/b", remarkName: "B", now: 2 });
        const failing2 = new SeededFailingStorage();
        await failing2.seed(await okStorage.read());
        const repo2 = new remarksRepository_1.RemarksRepository({ storage: failing2 });
        await repo2.load();
        await (0, vitest_1.expect)(repo2.renameKey({ fromKey: "a", toKey: "x", now: 3 })).rejects.toThrow("write failed");
        (0, vitest_1.expect)(repo2.get("a")?.remarkName).toBe("A");
        (0, vitest_1.expect)(repo2.get("x")).toBeUndefined();
        await (0, vitest_1.expect)(repo2.movePrefix({ fromPrefix: "a", toPrefix: "x", now: 4 })).rejects.toThrow("write failed");
        (0, vitest_1.expect)(repo2.get("a")?.remarkName).toBe("A");
        (0, vitest_1.expect)(repo2.get("a/b")?.remarkName).toBe("B");
        (0, vitest_1.expect)(repo2.get("x")).toBeUndefined();
        await (0, vitest_1.expect)(repo2.removePrefix("a")).rejects.toThrow("write failed");
        (0, vitest_1.expect)(repo2.get("a")?.remarkName).toBe("A");
        (0, vitest_1.expect)(repo2.get("a/b")?.remarkName).toBe("B");
    });
    (0, vitest_1.test)("load: ignores invalid persisted payloads", async () => {
        const storage = new InMemoryStorage();
        await storage.write({ version: 999, remarksByFolderUri: { "file:///x": { a: 1 } } });
        const repo = new remarksRepository_1.RemarksRepository({ storage });
        await repo.load();
        (0, vitest_1.expect)(repo.list()).toEqual([]);
    });
    (0, vitest_1.test)("error: write failure does not mutate in-memory state", async () => {
        const storage = new FailingStorage();
        const repo = new remarksRepository_1.RemarksRepository({ storage });
        await repo.load();
        await (0, vitest_1.expect)(repo.upsert({ folderUri: "file:///a", remarkName: "A", now: 1 })).rejects.toThrow("write failed");
        (0, vitest_1.expect)(repo.get("file:///a")).toBeUndefined();
        (0, vitest_1.expect)(repo.list()).toEqual([]);
    });
    (0, vitest_1.test)("performance: load/list works with many items", async () => {
        const storage = new InMemoryStorage();
        const repo = new remarksRepository_1.RemarksRepository({ storage });
        const total = 50_000;
        const remarksByFolderUri = {};
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
        (0, vitest_1.expect)(list.length).toBe(total);
        (0, vitest_1.expect)(list[0]?.updatedAt).toBe(total - 1);
    });
});
//# sourceMappingURL=remarksRepository.unit.test.js.map