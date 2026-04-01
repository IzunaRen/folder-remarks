import * as vscode from "vscode";
import { RemarksRepository, type RemarksStorageLike } from "./core/remarksRepository";
import { RemarksViewProvider } from "./ui/remarksViewProvider";

const STORAGE_DIR_NAME = ".FolderRemarks";
const STORAGE_FILE_NAME = "folder-remarks.json";
const LEGACY_VSCODE_FILE_NAME = "trae-folder-remarks.json";
const DEFAULT_REMARK_CORE = "无";

export type ExtensionApi = {
  repository: RemarksRepository;
};

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const output = vscode.window.createOutputChannel("Workspace Remarks");
  context.subscriptions.push(output);
  const pkg = context.extension.packageJSON as { publisher?: unknown; name?: unknown };
  const publisher = typeof pkg.publisher === "string" ? pkg.publisher : "";
  const name = typeof pkg.name === "string" ? pkg.name : "";
  output.appendLine(
    `[activate] publisher/name: ${publisher}.${name}`
  );
  output.appendLine(`[activate] at: ${new Date().toISOString()}`);

  const storage = await createRemarksStorage({ output });
  const repository = new RemarksRepository({ storage });
  await repository.load();

  const viewProvider = new RemarksViewProvider({ context, repo: repository });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RemarksViewProvider.viewType, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const storageWatcher = createStorageWatcher(storage, repository);
  if (storageWatcher) context.subscriptions.push(storageWatcher);

  const decorationProvider = new RemarksDecorationProvider(repository);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "traeFolderRemarks.addRemark",
      async (resourceArg?: unknown, remarkName?: string) => {
        try {
          output.show(true);
          output.appendLine(`[addRemark] invoked, argType=${typeof resourceArg}`);
          const targetUri = await resolveResourceUri(toUri(resourceArg));
          if (!targetUri) return;
          output.appendLine(`[addRemark] targetUri=${targetUri.toString()}`);
          const resourceKey = resourceKeyFromUri(targetUri);
          if (!resourceKey) {
            void vscode.window.showErrorMessage("Selected file/folder is not in the current workspace.");
            return;
          }

          const existing = repository.get(resourceKey);
          const input =
            remarkName ??
            (await promptRemarkName({
              title: "Add Remark",
              value: existing?.remarkName ?? ""
            }));
          if (typeof input !== "string") return;
          const nextName = normalizeRemarkCore(input) ?? DEFAULT_REMARK_CORE;

          await repository.upsert({ folderUri: resourceKey, remarkName: nextName });
          output.appendLine(`[addRemark] saved: ${resourceKey}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          output.appendLine(`[addRemark] error: ${message}`);
          void vscode.window.showErrorMessage(`Add remark failed: ${message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "traeFolderRemarks.editRemark",
      async (resourceArg?: unknown, remarkName?: string) => {
        try {
          const key = resourceKeyFromArg(resourceArg) ?? (await pickRemarkKey(repository));
          if (!key) return;
          const existing = repository.get(key);
          if (!existing) {
            void vscode.window.showWarningMessage("No remark found for the selected file/folder.");
            return;
          }
          const input = remarkName ?? (await promptRemarkName({ title: "Edit Remark", value: existing.remarkName }));
          if (typeof input !== "string") return;
          const nextName = normalizeRemarkCore(input) ?? DEFAULT_REMARK_CORE;
          await repository.upsert({ folderUri: key, remarkName: nextName });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          output.appendLine(`[editRemark] error: ${message}`);
          void vscode.window.showErrorMessage(`Edit remark failed: ${message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.deleteRemark", async (resourceArg?: unknown, force?: boolean) => {
      try {
        const key = resourceKeyFromArg(resourceArg) ?? (await pickRemarkKey(repository));
        if (!key) return;
        const existing = repository.get(key);
        if (!existing) return;
        if (!force) {
          const ok = await vscode.window.showWarningMessage(
            `Delete remark "${existing.remarkName}"?`,
            { modal: true },
            "Delete"
          );
          if (ok !== "Delete") return;
        }
        await repository.remove(key);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[deleteRemark] error: ${message}`);
        void vscode.window.showErrorMessage(`Delete remark failed: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.openResource", async (resourceArg?: unknown) => {
      try {
        const uri = uriFromArg(resourceArg) ?? uriFromResourceKey(await pickRemarkKey(repository));
        if (!uri) return;
        await openResource(uri);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[openResource] error: ${message}`);
        void vscode.window.showErrorMessage(`Open failed: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.openFolder", async (resourceUri?: vscode.Uri) => {
      await vscode.commands.executeCommand("traeFolderRemarks.openResource", resourceUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.manageRemarks", () => {
      const pick = vscode.window.createQuickPick<RemarkQuickPickItem>();
      pick.matchOnDescription = true;
      pick.matchOnDetail = true;
      pick.canSelectMany = false;
      pick.placeholder = "Search, edit, delete, or open remarks";

      const refreshItems = () => {
        const items = repository.list().map<RemarkQuickPickItem>((r) => ({
          label: formatRemarkDisplay(r.remarkName),
          detail: r.folderUri,
          resourceKey: r.folderUri,
          buttons: [
            { iconPath: new vscode.ThemeIcon("edit"), tooltip: "Edit" },
            { iconPath: new vscode.ThemeIcon("trash"), tooltip: "Delete" }
          ]
        }));
        pick.items = items;
      };

      const disposeRepoListener = repository.onDidChange(refreshItems);
      pick.onDidHide(() => disposeRepoListener());
      refreshItems();

      pick.onDidAccept(async () => {
        const selected = pick.selectedItems[0];
        if (!selected) return;
        await vscode.commands.executeCommand("traeFolderRemarks.openResource", selected.resourceKey);
        pick.hide();
      });

      pick.onDidTriggerItemButton(async (e: vscode.QuickPickItemButtonEvent<RemarkQuickPickItem>) => {
        if (e.button.tooltip === "Edit") {
          await vscode.commands.executeCommand("traeFolderRemarks.editRemark", e.item.resourceKey);
          return;
        }
        if (e.button.tooltip === "Delete") {
          await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", e.item.resourceKey);
        }
      });

      pick.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.debugPing", () => {
      output.show(true);
      output.appendLine(`[debugPing] at: ${new Date().toISOString()}`);
      void vscode.window.showInformationMessage("Workspace Remarks: debug ping");
    })
  );

  return { repository };
}

export function deactivate(): void {}

type RemarkQuickPickItem = vscode.QuickPickItem & {
  resourceKey: string;
  buttons?: vscode.QuickInputButton[];
};

async function createRemarksStorage(args: {
  output: vscode.OutputChannel;
}): Promise<RemarksStorageLike> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fallback = createInMemoryStorage();
  if (!root) return fallback;

  try {
    await vscode.workspace.fs.stat(root);
  } catch {
    return fallback;
  }

  const storageDirUri = vscode.Uri.joinPath(root, STORAGE_DIR_NAME);
  const storageFileUri = vscode.Uri.joinPath(storageDirUri, STORAGE_FILE_NAME);
  const legacyVsCodeFileUri = vscode.Uri.joinPath(root, ".vscode", LEGACY_VSCODE_FILE_NAME);

  const fileStorage: RemarksStorageLike = {
    read: async () => {
      try {
        if (!(await uriExists(storageFileUri))) {
          if (await uriExists(legacyVsCodeFileUri)) {
            const legacyBytes = await vscode.workspace.fs.readFile(legacyVsCodeFileUri);
            const legacyText = new TextDecoder("utf-8").decode(legacyBytes);
            const legacyParsed = JSON.parse(legacyText) as unknown;
            const migrated = migrateRemarksToRelativeKeys(legacyParsed);
            await writeJsonFile({ fileUri: storageFileUri, dirUri: storageDirUri, value: migrated ?? legacyParsed });
            return migrated ?? legacyParsed;
          }
          return undefined;
        }
        const bytes = await vscode.workspace.fs.readFile(storageFileUri);
        const text = new TextDecoder("utf-8").decode(bytes);
        const parsed = JSON.parse(text) as unknown;
        const migrated = migrateRemarksToRelativeKeys(parsed);
        if (migrated) {
          await writeJsonFile({ fileUri: storageFileUri, dirUri: storageDirUri, value: migrated });
          return migrated;
        }
        return parsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        args.output.appendLine(`[storage] read failed: ${message}`);
        return undefined;
      }
    },
    write: async (value) => {
      try {
        await writeJsonFile({ fileUri: storageFileUri, dirUri: storageDirUri, value });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        args.output.appendLine(`[storage] write failed: ${message}`);
      }
    }
  };

  return fileStorage;
}

function createInMemoryStorage(): RemarksStorageLike {
  let data: unknown = undefined;
  return {
    read: () => Promise.resolve(data),
    write: (value) => {
      data = value;
      return Promise.resolve();
    }
  };
}

function createStorageWatcher(storage: RemarksStorageLike, repo: RemarksRepository): vscode.Disposable | undefined {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return undefined;

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, `${STORAGE_DIR_NAME}/${STORAGE_FILE_NAME}`)
  );

  const reload = () => void repo.load();

  watcher.onDidChange(reload);
  watcher.onDidCreate(reload);
  watcher.onDidDelete(reload);

  void storage.read().then((raw) => {
    if (raw) return;
    void repo.load();
  });

  return watcher;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonFile(args: { fileUri: vscode.Uri; dirUri: vscode.Uri; value: unknown }): Promise<void> {
  await vscode.workspace.fs.createDirectory(args.dirUri);
  const content = `${JSON.stringify(args.value, null, 2)}\n`;
  const bytes = new TextEncoder().encode(content);
  await vscode.workspace.fs.writeFile(args.fileUri, bytes);
}

async function resolveResourceUri(resourceUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (resourceUri) return resourceUri;
  const pick = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select File or Folder"
  });
  return pick?.[0];
}

async function pickRemarkKey(repo: RemarksRepository): Promise<string | undefined> {
  const items = repo.list().map((r) => ({
    label: formatRemarkDisplay(r.remarkName),
    description: r.folderUri,
    resourceKey: r.folderUri
  }));
  const picked = await vscode.window.showQuickPick(items, { matchOnDescription: true, matchOnDetail: true });
  return picked?.resourceKey;
}

function isUriInWorkspace(uri: vscode.Uri): boolean {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  return Boolean(workspaceFolder);
}

function toUri(arg: unknown): vscode.Uri | undefined {
  if (!arg) return undefined;
  if (arg instanceof vscode.Uri) return arg;

  if (typeof arg === "string") {
    if (!arg.includes("://")) return undefined;
    try {
      return vscode.Uri.parse(arg);
    } catch {
      return undefined;
    }
  }

  if (typeof arg === "object") {
    const anyArg = arg as { resourceUri?: unknown; uri?: unknown; fsPath?: unknown; path?: unknown };
    if (anyArg.resourceUri instanceof vscode.Uri) return anyArg.resourceUri;
    if (anyArg.uri instanceof vscode.Uri) return anyArg.uri;
    if (typeof anyArg.fsPath === "string") return vscode.Uri.file(anyArg.fsPath);
    if (typeof anyArg.path === "string") return vscode.Uri.file(anyArg.path);
  }

  return undefined;
}

function formatRemarkDisplay(remarkName: string | undefined): string {
  const core = normalizeRemarkCore(remarkName ?? "") ?? DEFAULT_REMARK_CORE;
  return `【${core}】`;
}

function normalizeRemarkCore(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const m = s.match(/^【(.+)】$/u);
  const core = (m?.[1] ?? s).trim();
  return core || undefined;
}

function promptRemarkName(args: { title: string; value: string }): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = vscode.window.createInputBox();
    let done = false;
    const finish = (value: string | undefined) => {
      if (done) return;
      done = true;
      resolve(value);
      input.dispose();
    };
    input.title = args.title;
    input.value = args.value;
    input.ignoreFocusOut = true;
    input.onDidAccept(() => {
      finish(input.value);
    });
    input.onDidHide(() => {
      finish(undefined);
    });
    input.show();
  });
}

class RemarksDecorationProvider implements vscode.FileDecorationProvider {
  readonly #repo: RemarksRepository;
  readonly #emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.#emitter.event;

  constructor(repo: RemarksRepository) {
    this.#repo = repo;
    this.#repo.onDidChange(() => this.#emitter.fire(undefined));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (!isUriInWorkspace(uri)) return undefined;
    if (uri.scheme !== "file") return undefined;
    if (uri.path.includes(`/${STORAGE_DIR_NAME}/`) || uri.path.endsWith(`/${STORAGE_DIR_NAME}`)) {
      return undefined;
    }

    const key = resourceKeyFromUri(uri);
    if (!key) return undefined;
    const remark = this.#repo.get(key)?.remarkName;
    const badge = formatRemarkDisplay(remark);
    return { badge, tooltip: badge };
  }
}

function resourceKeyFromArg(arg: unknown): string | undefined {
  if (!arg) return undefined;
  if (typeof arg === "string") return normalizeResourceKey(arg);
  const uri = toUri(arg);
  if (uri) return resourceKeyFromUri(uri);
  return undefined;
}

function uriFromArg(arg: unknown): vscode.Uri | undefined {
  const uri = toUri(arg);
  if (uri) return uri;
  if (typeof arg === "string") return uriFromResourceKey(normalizeResourceKey(arg));
  return undefined;
}

function resourceKeyFromUri(uri: vscode.Uri): string | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) return undefined;

  if (uri.toString() === workspaceFolder.uri.toString()) return ".";

  const rel = vscode.workspace.asRelativePath(uri, false);
  if (!rel || rel.startsWith("..")) return undefined;
  return normalizeResourceKey(rel);
}

function normalizeResourceKey(key: string): string {
  const k = key.trim();
  if (!k) return ".";
  const cleaned = k.replace(/^[.][/\\]/u, "").replace(/\\/gu, "/");
  return cleaned === "" ? "." : cleaned;
}

function uriFromResourceKey(key: string | undefined): vscode.Uri | undefined {
  if (!key) return undefined;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return undefined;
  const normalized = normalizeResourceKey(key);
  if (normalized === ".") return root;
  const segments = normalized.split("/").filter(Boolean);
  return vscode.Uri.joinPath(root, ...segments);
}

function migrateRemarksToRelativeKeys(raw: unknown): unknown {
  if (!vscode.workspace.workspaceFolders?.length) return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const anyRaw = raw as { version?: unknown; remarksByFolderUri?: unknown };
  if (anyRaw.version !== 1) return undefined;
  const rawMap = (anyRaw.remarksByFolderUri ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  let changed = false;

  for (const [k, v] of Object.entries(rawMap)) {
    let nextKey = k;
    if (k.includes("://")) {
      try {
        const uri = vscode.Uri.parse(k);
        const relKey = resourceKeyFromUri(uri);
        if (relKey) {
          nextKey = relKey;
          changed = true;
        }
      } catch {
        continue;
      }
    } else {
      nextKey = normalizeResourceKey(k);
      if (nextKey !== k) changed = true;
    }

    if (!v || typeof v !== "object") continue;
    const anyV = v as { folderUri?: unknown; remarkName?: unknown; createdAt?: unknown; updatedAt?: unknown };
    if (typeof anyV.remarkName !== "string") continue;
    const createdAt = typeof anyV.createdAt === "number" ? anyV.createdAt : Date.now();
    const updatedAt = typeof anyV.updatedAt === "number" ? anyV.updatedAt : createdAt;
    const normalizedRemark = normalizeRemarkCore(anyV.remarkName) ?? DEFAULT_REMARK_CORE;
    if (normalizedRemark !== anyV.remarkName) changed = true;

    next[nextKey] = {
      folderUri: nextKey,
      remarkName: normalizedRemark,
      createdAt,
      updatedAt
    };

    if (anyV.folderUri !== nextKey) changed = true;
  }

  if (!changed) return undefined;
  return { version: 1, remarksByFolderUri: next };
}

async function openResource(uri: vscode.Uri): Promise<void> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand("revealInExplorer", uri);
      return;
    }
  } catch {
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch {
    await vscode.commands.executeCommand("revealInExplorer", uri);
  }
}
