import * as vscode from "vscode";
import { RemarksRepository, type RemarksStorageLike } from "./core/remarksRepository";

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

  const remarkedTreeProvider = new RemarkedTreeProvider(repository);
  const remarkedTreeView = vscode.window.createTreeView("traeFolderRemarksRemarkedTree", {
    treeDataProvider: remarkedTreeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(remarkedTreeView);

  const storageWatcher = createStorageWatcher(storage, repository);
  if (storageWatcher) context.subscriptions.push(storageWatcher);

  const decorationProvider = new RemarksDecorationProvider(repository);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (e.affectsConfiguration("traeFolderRemarks.language")) decorationProvider.refresh();
    })
  );

  let lastRevealedActiveEditorUri = "";
  const revealActiveEditorInRemarkTree = async (focus: boolean): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const uri = editor?.document.uri;
    if (!uri) return;
    if (isStorageUri(uri)) return;
    const key = resourceKeyFromAnyUri(uri);
    if (!key) return;
    if (key === STORAGE_DIR_NAME || key.startsWith(`${STORAGE_DIR_NAME}/`)) return;
    if (!remarkedTreeView.visible && !focus) return;
    if (!focus && uri.toString() === lastRevealedActiveEditorUri) return;
    lastRevealedActiveEditorUri = uri.toString();

    let isDir = false;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      isDir = (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
      isDir = false;
    }

    const name = key === "." ? (vscode.workspace.workspaceFolders?.[0]?.name ?? ".") : key.split("/").pop() ?? key;
    const element: RemarkedTreeNode = {
      id: uri.toString(),
      name,
      uri,
      key,
      isDir,
      remarkName: repository.get(key)?.remarkName
    };

    try {
      await remarkedTreeView.reveal(element, { select: true, focus, expand: true });
    } catch {
      // ignore
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.revealActiveFile", async () => {
      await revealActiveEditorInRemarkTree(true);
    })
  );

  let autoRevealTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      const enabled = vscode.workspace.getConfiguration("traeFolderRemarks").get<boolean>("autoRevealActiveFile", true);
      if (!enabled) return;
      if (autoRevealTimer) clearTimeout(autoRevealTimer);
      autoRevealTimer = setTimeout(() => {
        void revealActiveEditorInRemarkTree(false);
      }, 80);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.checkBadges", async () => {
      const explorerCfg = vscode.workspace.getConfiguration("explorer");
      const badges = explorerCfg.get<boolean>("decorations.badges", true);
      const colors = explorerCfg.get<boolean>("decorations.colors", true);
      const msg = `explorer.decorations.badges=${String(badges)}, explorer.decorations.colors=${String(colors)}`;
      const openSettings = "打开设置";
      const openSettingsJson = "打开 settings.json";
      const pick = await vscode.window.showInformationMessage(msg, openSettings, openSettingsJson);
      if (pick === openSettings) {
        await vscode.commands.executeCommand("workbench.action.openSettings", "explorer.decorations.badges");
      }
      if (pick === openSettingsJson) {
        await vscode.commands.executeCommand("workbench.action.openSettingsJson");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "traeFolderRemarks.setRemark",
      async (resourceArg?: unknown, remarkName?: string) => {
        output.appendLine(`[setRemark] invoked, argType=${typeof resourceArg}`);
        const targetUri =
          uriFromArg(resourceArg) ?? guessActiveResourceUri() ?? (await resolveResourceUri());
        if (!targetUri) return;
        output.appendLine(`[setRemark] targetUri=${targetUri.toString()}`);

        if (resourceArg && typeof remarkName !== "string") {
          setTimeout(() => {
            void vscode.commands.executeCommand("traeFolderRemarks._setRemarkDeferred", targetUri);
          }, 0);
          return;
        }

        await setRemarkCore({
          repository,
          output,
          targetUri,
          remarkName
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks._setRemarkDeferred", async (resourceUri?: vscode.Uri) => {
      if (!resourceUri) return;
      try {
        await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      await setRemarkCore({ repository, output, targetUri: resourceUri });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.addRemark", async (resourceArg?: unknown, remarkName?: string) =>
      vscode.commands.executeCommand("traeFolderRemarks.setRemark", resourceArg, remarkName)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "traeFolderRemarks.editRemark",
      async (resourceArg?: unknown, remarkName?: string) => {
        const key = resourceKeyFromArg(resourceArg) ?? (await pickRemarkKey(repository));
        if (!key) return;
        const uri = uriFromResourceKey(key);
        if (!uri) return;
        await vscode.commands.executeCommand("traeFolderRemarks.setRemark", uri, remarkName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("traeFolderRemarks.deleteRemark", async (resourceArg?: unknown, force?: boolean) => {
      try {
        const ui = getUiStrings(resolveUiLanguage());
        const key = resourceKeyFromArg(resourceArg) ?? (await pickRemarkKey(repository));
        if (!key) return;
        const existing = repository.get(key);
        if (!existing) return;
        if (!force) {
          const ok = await vscode.window.showWarningMessage(
            ui.deleteConfirm(existing.remarkName),
            { modal: true },
            ui.deleteAction
          );
          if (ok !== ui.deleteAction) return;
        }
        await repository.remove(key);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[deleteRemark] error: ${message}`);
        const ui = getUiStrings(resolveUiLanguage());
        void vscode.window.showErrorMessage(`${ui.deleteFailedPrefix}${message}`);
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
        const ui = getUiStrings(resolveUiLanguage());
        void vscode.window.showErrorMessage(`${ui.openFailedPrefix}${message}`);
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
      const ui = getUiStrings(resolveUiLanguage());
      const pick = vscode.window.createQuickPick<RemarkQuickPickItem>();
      pick.matchOnDescription = true;
      pick.matchOnDetail = true;
      pick.canSelectMany = false;
      pick.placeholder = ui.managePlaceholder;

      const refreshItems = () => {
        const items = repository.list().map<RemarkQuickPickItem>((r) => ({
          label: formatRemarkDisplay(r.remarkName),
          detail: r.folderUri,
          resourceKey: r.folderUri,
          buttons: [
            { iconPath: new vscode.ThemeIcon("edit"), tooltip: ui.setActionTooltip },
            { iconPath: new vscode.ThemeIcon("trash"), tooltip: ui.deleteActionTooltip }
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
        if (e.button.tooltip === ui.setActionTooltip) {
          await vscode.commands.executeCommand("traeFolderRemarks.setRemark", e.item.resourceKey);
          return;
        }
        if (e.button.tooltip === ui.deleteActionTooltip) {
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

function guessActiveResourceUri(): vscode.Uri | undefined {
  const ed = vscode.window.activeTextEditor;
  const uri = ed?.document?.uri;
  if (uri && uri.scheme === "file" && isUriInWorkspace(uri) && !isStorageUri(uri)) return uri;
  return undefined;
}

async function resolveResourceUri(): Promise<vscode.Uri | undefined> {
  const ui = getUiStrings(resolveUiLanguage());
  const pick = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: ui.selectResourceLabel
  });
  const uri = pick?.[0];
  if (uri && isStorageUri(uri)) return undefined;
  return uri;
}

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
  if (Array.isArray(arg)) return toUri(arg[0]);
  if (arg instanceof vscode.Uri) return arg;

  if (typeof arg === "string") {
    if (arg.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(arg)) return vscode.Uri.file(arg);
    if (!arg.includes("://")) return undefined;
    try {
      return vscode.Uri.parse(arg);
    } catch {
      return undefined;
    }
  }

  if (typeof arg === "object") {
    const anyArg = arg as {
      resourceUri?: unknown;
      uri?: unknown;
      targetUri?: unknown;
      fsPath?: unknown;
      path?: unknown;
      scheme?: unknown;
      authority?: unknown;
      query?: unknown;
      fragment?: unknown;
    };
    const uri1 = toUri(anyArg.resourceUri);
    if (uri1) return uri1;
    const uri2 = toUri(anyArg.uri);
    if (uri2) return uri2;
    const uri3 = toUri(anyArg.targetUri);
    if (uri3) return uri3;
    if (typeof anyArg.scheme === "string" && typeof anyArg.path === "string") {
      return vscode.Uri.from({
        scheme: anyArg.scheme,
        authority: typeof anyArg.authority === "string" ? anyArg.authority : "",
        path: anyArg.path,
        query: typeof anyArg.query === "string" ? anyArg.query : "",
        fragment: typeof anyArg.fragment === "string" ? anyArg.fragment : ""
      });
    }
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

function isStorageUri(uri: vscode.Uri): boolean {
  if (!uri || uri.scheme !== "file") return false;
  return uri.path.includes(`/${STORAGE_DIR_NAME}/`) || uri.path.endsWith(`/${STORAGE_DIR_NAME}`);
}

type UiLang = "en" | "zh-cn";

type UiStrings = {
  setRemarkTitle: string;
  notInWorkspace: string;
  setRemarkFailedPrefix: string;
  saved: string;
  cleared: string;
  tooLong: string;
  editorGiving: string;
  editorPlaceholderPrefix: string;
  editorPlaceholderSuffix: string;
  editorHint: string;
  deleteConfirm: (remarkName: string) => string;
  deleteAction: string;
  deleteFailedPrefix: string;
  openFailedPrefix: string;
  managePlaceholder: string;
  setActionTooltip: string;
  deleteActionTooltip: string;
  decorationTooltipPrefix: string;
  selectResourceLabel: string;
};

function resolveUiLanguage(): UiLang {
  const cfg = vscode.workspace.getConfiguration();
  const raw = cfg.get<string>("traeFolderRemarks.language", "auto");
  if (raw === "en" || raw === "zh-cn") return raw;
  const envLang = vscode.env.language.toLowerCase();
  return envLang.startsWith("zh") ? "zh-cn" : "en";
}

function getUiStrings(lang: UiLang): UiStrings {
  if (lang === "zh-cn") {
    return {
      setRemarkTitle: "设置备注",
      notInWorkspace: "所选文件/文件夹不在当前工作区中。",
      setRemarkFailedPrefix: "设置备注失败：",
      saved: "备注已保存",
      cleared: "备注已清除",
      tooLong: "备注内容过长（最多 500 字符）。",
      editorGiving: "给",
      editorPlaceholderPrefix: "输入备注…",
      editorPlaceholderSuffix: "",
      editorHint: "请输入：（按 \"Enter\" 以确认或按 \"Esc\" 以取消）",
      deleteConfirm: (remarkName) => `删除备注 "${remarkName}"？`,
      deleteAction: "删除",
      deleteFailedPrefix: "删除备注失败：",
      openFailedPrefix: "打开失败：",
      managePlaceholder: "搜索、设置、删除或打开备注",
      setActionTooltip: "设置",
      deleteActionTooltip: "删除",
      decorationTooltipPrefix: "备注 ",
      selectResourceLabel: "选择文件或文件夹"
    };
  }
  return {
    setRemarkTitle: "Set Remark",
    notInWorkspace: "Selected file/folder is not in the current workspace.",
    setRemarkFailedPrefix: "Set remark failed: ",
    saved: "Remark saved",
    cleared: "Remark cleared",
    tooLong: "Remark is too long (max 500 characters).",
    editorGiving: "To",
    editorPlaceholderPrefix: "Enter remark...",
    editorPlaceholderSuffix: "",
    editorHint: 'Type to input: (Press "Enter" to confirm or "Esc" to cancel)',
    deleteConfirm: (remarkName) => `Delete remark "${remarkName}"?`,
    deleteAction: "Delete",
    deleteFailedPrefix: "Delete remark failed: ",
    openFailedPrefix: "Open failed: ",
    managePlaceholder: "Search, set, delete, or open remarks",
    setActionTooltip: "Set",
    deleteActionTooltip: "Delete",
    decorationTooltipPrefix: "Remark ",
    selectResourceLabel: "Select File or Folder"
  };
}

async function promptRemarkName(args: {
  title: string;
  value: string;
  placeholder: string;
  prompt: string;
}): Promise<string | undefined> {
  await new Promise<void>((resolve) => setTimeout(resolve, 150));

  const start = Date.now();
  const picked = await vscode.window.showInputBox({
    title: args.title,
    value: args.value,
    prompt: args.prompt,
    placeHolder: args.placeholder,
    ignoreFocusOut: true,
    validateInput: (v) => (v.length > 500 ? getUiStrings(resolveUiLanguage()).tooLong : undefined)
  });
  if (typeof picked === "string") return picked;
  if (Date.now() - start > 250) return picked;

  return new Promise<string | undefined>((resolve) => {
    const input = vscode.window.createInputBox();
    input.title = args.title;
    input.value = args.value;
    input.prompt = args.prompt;
    input.placeholder = args.placeholder;
    input.ignoreFocusOut = true;
    input.validationMessage = undefined;

    const disposeAll: vscode.Disposable[] = [];
    let settled = false;

    const settle = (v: string | undefined) => {
      if (settled) return;
      settled = true;
      resolve(v);
      input.hide();
      for (const d of disposeAll) d.dispose();
      input.dispose();
    };

    disposeAll.push(
      input.onDidAccept(() => settle(input.value)),
      input.onDidHide(() => settle(undefined)),
      input.onDidChangeValue((v) => {
        input.validationMessage = v.length > 500 ? getUiStrings(resolveUiLanguage()).tooLong : undefined;
      })
    );

    input.show();
  });
}

async function setRemarkCore(args: {
  repository: RemarksRepository;
  output: vscode.OutputChannel;
  targetUri: vscode.Uri;
  remarkName?: string;
}): Promise<void> {
  try {
    const ui = getUiStrings(resolveUiLanguage());
    const resourceKey = resourceKeyFromUri(args.targetUri);
    if (!resourceKey) {
      void vscode.window.showErrorMessage(ui.notInWorkspace);
      return;
    }
    if (resourceKey === STORAGE_DIR_NAME || resourceKey.startsWith(`${STORAGE_DIR_NAME}/`)) return;

    const existing = args.repository.get(resourceKey);
    const input =
      args.remarkName ??
      (await promptRemarkName({
        title: ui.setRemarkTitle,
        value: existing?.remarkName ?? "",
        placeholder: `${ui.editorPlaceholderPrefix}【${resourceKey}】${ui.editorPlaceholderSuffix}`,
        prompt: ui.editorHint
      }));
    if (typeof input !== "string") return;
    if (input.length > 500) {
      void vscode.window.showErrorMessage(ui.tooLong);
      return;
    }
    const nextCore = normalizeRemarkCore(input);
    if (!nextCore) {
      if (existing) {
        await args.repository.remove(resourceKey);
        vscode.window.setStatusBarMessage(ui.cleared, 1500);
        args.output.appendLine(`[setRemark] cleared: ${resourceKey}`);
      }
      return;
    }

    await args.repository.upsert({ folderUri: resourceKey, remarkName: nextCore });
    vscode.window.setStatusBarMessage(ui.saved, 1500);
    args.output.appendLine(`[setRemark] saved: ${resourceKey}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    args.output.appendLine(`[setRemark] error: ${message}`);
    const ui = getUiStrings(resolveUiLanguage());
    void vscode.window.showErrorMessage(`${ui.setRemarkFailedPrefix}${message}`);
  }
}

class RemarksDecorationProvider implements vscode.FileDecorationProvider {
  readonly #repo: RemarksRepository;
  readonly #emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.#emitter.event;

  constructor(repo: RemarksRepository) {
    this.#repo = repo;
    this.#repo.onDidChange(() => this.#emitter.fire(undefined));
  }

  refresh(): void {
    this.#emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.path.includes(`/${STORAGE_DIR_NAME}/`) || uri.path.endsWith(`/${STORAGE_DIR_NAME}`)) {
      return undefined;
    }

    const key = resourceKeyFromAnyUri(uri);
    if (!key) return undefined;
    if (key === STORAGE_DIR_NAME || key.startsWith(`${STORAGE_DIR_NAME}/`)) return undefined;
    const entry = this.#repo.get(key);
    if (!entry?.remarkName) return undefined;
    const ui = getUiStrings(resolveUiLanguage());
    const badge = formatDecorationBadge(entry.remarkName);
    const tooltip = `${key}\n${ui.decorationTooltipPrefix}${formatRemarkDisplay(entry.remarkName)}`;
    return { badge, tooltip };
  }
}

function formatDecorationBadge(remarkName: string): string {
  const core = normalizeRemarkCore(remarkName) ?? DEFAULT_REMARK_CORE;
  const chars = Array.from(core);
  const clipped = chars.slice(0, 2).join("");
  return clipped || "R";
}

function resourceKeyFromAnyUri(uri: vscode.Uri): string | undefined {
  const rel = vscode.workspace.asRelativePath(uri, false);
  if (rel && !rel.startsWith("..")) return normalizeResourceKey(rel);
  const fsPath = uri.fsPath;
  if (fsPath) {
    const rel2 = vscode.workspace.asRelativePath(vscode.Uri.file(fsPath), false);
    if (rel2 && !rel2.startsWith("..")) return normalizeResourceKey(rel2);
  }
  return undefined;
}

type RemarkedTreeNode = {
  id: string;
  name: string;
  uri: vscode.Uri;
  key: string;
  isDir: boolean;
  remarkName?: string;
};

class RemarkedTreeProvider implements vscode.TreeDataProvider<RemarkedTreeNode> {
  readonly #repo: RemarksRepository;
  readonly #emitter = new vscode.EventEmitter<RemarkedTreeNode | undefined>();
  readonly onDidChangeTreeData = this.#emitter.event;

  constructor(repo: RemarksRepository) {
    this.#repo = repo;
    this.#repo.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.#emitter.fire(undefined);
  }

  getTreeItem(element: RemarkedTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.name,
      element.isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.description = element.remarkName ? formatRemarkDisplay(element.remarkName) : undefined;
    const ui = getUiStrings(resolveUiLanguage());
    item.tooltip = `${element.key}${element.remarkName ? `\n${ui.decorationTooltipPrefix}${formatRemarkDisplay(element.remarkName)}` : ""}`;
    item.resourceUri = element.uri;
    item.contextValue = element.remarkName ? "remarkedNode" : "resourceNode";
    item.iconPath = element.isDir ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    if (!element.isDir) {
      item.command = {
        command: "traeFolderRemarks.openResource",
        title: "",
        arguments: [element.uri]
      };
    }
    return item;
  }

  getParent(element: RemarkedTreeNode): RemarkedTreeNode | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length !== 1) return undefined;
    const key = element.key;
    if (!key || key === ".") return undefined;
    const parentKey = key.includes("/") ? key.split("/").slice(0, -1).join("/") : ".";
    if (parentKey === ".") return undefined;
    const parentUri = uriFromResourceKey(parentKey);
    if (!parentUri) return undefined;
    const name = parentKey.split("/").pop() ?? parentKey;
    return {
      id: parentUri.toString(),
      name,
      uri: parentUri,
      key: parentKey,
      isDir: true,
      remarkName: this.#repo.get(parentKey)?.remarkName
    };
  }

  async getChildren(element?: RemarkedTreeNode): Promise<RemarkedTreeNode[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!element) {
      if (folders.length === 1) {
        const rootUri = folders[0].uri;
        let entries: [string, vscode.FileType][];
        try {
          entries = await vscode.workspace.fs.readDirectory(rootUri);
        } catch {
          return [];
        }

        const nodes: RemarkedTreeNode[] = [];
        for (const [name, type] of entries) {
          if (name === STORAGE_DIR_NAME) continue;
          const uri = vscode.Uri.joinPath(rootUri, name);
          const key = resourceKeyFromAnyUri(uri);
          if (!key) continue;
          if (key === STORAGE_DIR_NAME || key.startsWith(`${STORAGE_DIR_NAME}/`)) continue;
          const isDir = (type & vscode.FileType.Directory) !== 0;
          const remarkName = this.#repo.get(key)?.remarkName;
          nodes.push({
            id: uri.toString(),
            name,
            uri,
            key,
            isDir,
            remarkName
          });
        }

        nodes.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return nodes;
      }

      return folders.map((f, idx) => ({
        id: `root:${idx}`,
        name: f.name,
        uri: f.uri,
        key: ".",
        isDir: true,
        remarkName: this.#repo.get(".")?.remarkName
      }));
    }

    if (!element.isDir) return [];

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(element.uri);
    } catch {
      return [];
    }

    const nodes: RemarkedTreeNode[] = [];
    for (const [name, type] of entries) {
      if (name === STORAGE_DIR_NAME) continue;
      const uri = vscode.Uri.joinPath(element.uri, name);
      const key = resourceKeyFromAnyUri(uri);
      if (!key) continue;
      if (key === STORAGE_DIR_NAME || key.startsWith(`${STORAGE_DIR_NAME}/`)) continue;
      const isDir = (type & vscode.FileType.Directory) !== 0;
      const remarkName = this.#repo.get(key)?.remarkName;
      nodes.push({
        id: uri.toString(),
        name,
        uri,
        key,
        isDir,
        remarkName
      });
    }

    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return nodes;
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
