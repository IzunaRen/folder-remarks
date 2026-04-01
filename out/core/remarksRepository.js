"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemarksRepository = void 0;
const events_1 = require("events");
class RemarksRepository {
    #storage;
    #events = new events_1.EventEmitter();
    #state;
    constructor(args) {
        this.#storage = args.storage;
        this.#state = { version: 1, remarksByFolderUri: {} };
    }
    onDidChange(listener) {
        this.#events.on("change", listener);
        return () => this.#events.off("change", listener);
    }
    async load() {
        const raw = await this.#storage.read();
        this.#state = parseRemarksStateV1(raw);
        this.#events.emit("change");
    }
    list() {
        return Object.values(this.#state.remarksByFolderUri).sort((a, b) => {
            if (b.updatedAt !== a.updatedAt)
                return b.updatedAt - a.updatedAt;
            return a.folderUri.localeCompare(b.folderUri);
        });
    }
    get(folderUri) {
        return this.#state.remarksByFolderUri[folderUri];
    }
    async upsert(args) {
        const now = args.now ?? Date.now();
        const existing = this.#state.remarksByFolderUri[args.folderUri];
        const next = existing
            ? { ...existing, remarkName: args.remarkName, updatedAt: now }
            : { folderUri: args.folderUri, remarkName: args.remarkName, createdAt: now, updatedAt: now };
        const nextState = {
            version: 1,
            remarksByFolderUri: { ...this.#state.remarksByFolderUri, [args.folderUri]: next }
        };
        await this.#storage.write(nextState);
        this.#state = nextState;
        this.#events.emit("change");
    }
    async remove(folderUri) {
        if (!this.#state.remarksByFolderUri[folderUri])
            return;
        const next = { ...this.#state.remarksByFolderUri };
        delete next[folderUri];
        const nextState = { version: 1, remarksByFolderUri: next };
        await this.#storage.write(nextState);
        this.#state = nextState;
        this.#events.emit("change");
    }
    async clear() {
        const nextState = { version: 1, remarksByFolderUri: {} };
        await this.#storage.write(nextState);
        this.#state = nextState;
        this.#events.emit("change");
    }
}
exports.RemarksRepository = RemarksRepository;
function parseRemarksStateV1(raw) {
    if (!raw || typeof raw !== "object")
        return { version: 1, remarksByFolderUri: {} };
    const anyRaw = raw;
    if (anyRaw.version !== 1)
        return { version: 1, remarksByFolderUri: {} };
    const remarksByFolderUri = {};
    const rawMap = (anyRaw.remarksByFolderUri ?? {});
    for (const [folderUri, value] of Object.entries(rawMap)) {
        if (typeof folderUri !== "string")
            continue;
        if (!value || typeof value !== "object")
            continue;
        const v = value;
        if (typeof v.remarkName !== "string")
            continue;
        const createdAt = typeof v.createdAt === "number" ? v.createdAt : Date.now();
        const updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : createdAt;
        remarksByFolderUri[folderUri] = {
            folderUri,
            remarkName: v.remarkName,
            createdAt,
            updatedAt
        };
    }
    return { version: 1, remarksByFolderUri };
}
//# sourceMappingURL=remarksRepository.js.map