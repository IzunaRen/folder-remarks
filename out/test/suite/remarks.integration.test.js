"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
suite("Workspace Remarks Extension", () => {
    test("CRUD via commands (folder + file) and repository reload", async () => {
        await ensureWorkspaceFolder();
        const ext = vscode.extensions.getExtension("folder-remarks.trae-folder-remarks");
        assert.ok(ext, "extension should exist");
        const api = (await ext.activate());
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        assert.ok(root, "workspace folder should exist");
        const one = vscode.Uri.joinPath(root, "one");
        const file = vscode.Uri.joinPath(root, "one", ".keep");
        const oneKey = "one";
        const fileKey = "one/.keep";
        await vscode.commands.executeCommand("traeFolderRemarks.addRemark", one, "One");
        assert.ok(api.repository.get(oneKey), "remark should be created");
        await vscode.commands.executeCommand("traeFolderRemarks.editRemark", one, "One2");
        const afterEdit = api.repository.get(oneKey);
        assert.strictEqual(afterEdit?.remarkName, "One2");
        await vscode.commands.executeCommand("traeFolderRemarks.addRemark", file, "Keep");
        const fileRemark = api.repository.get(fileKey);
        assert.strictEqual(fileRemark?.remarkName, "Keep");
        await api.repository.load();
        const afterReload = api.repository.get(oneKey);
        assert.strictEqual(afterReload?.remarkName, "One2");
        const afterReloadFile = api.repository.get(fileKey);
        assert.strictEqual(afterReloadFile?.remarkName, "Keep");
        await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", one, true);
        assert.strictEqual(api.repository.get(oneKey), undefined);
        await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", file, true);
        assert.strictEqual(api.repository.get(fileKey), undefined);
    });
});
async function ensureWorkspaceFolder() {
    for (let i = 0; i < 100; i += 1) {
        if (vscode.workspace.workspaceFolders?.length)
            return;
        await new Promise((r) => setTimeout(r, 100));
    }
    const workspacePath = path.resolve(__dirname, "../../../.test-workspace");
    const uri = vscode.Uri.file(workspacePath);
    const ok = vscode.workspace.updateWorkspaceFolders(0, null, { uri });
    if (!ok)
        throw new Error("Failed to attach test workspace folder.");
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for workspace folders.")), 10_000);
        const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            clearTimeout(timer);
            disposable.dispose();
            resolve();
        });
    });
}
//# sourceMappingURL=remarks.integration.test.js.map