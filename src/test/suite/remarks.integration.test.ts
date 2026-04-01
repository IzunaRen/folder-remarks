import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

suite("Workspace Remarks Extension", () => {
  test("CRUD via commands (folder + file) and repository reload", async () => {
    await ensureWorkspaceFolder();

    const ext = vscode.extensions.getExtension("folder-remarks.trae-folder-remarks");
    assert.ok(ext, "extension should exist");
    const api = (await ext.activate()) as { repository: { load(): Promise<void>; get(k: string): unknown } };

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, "workspace folder should exist");
    const one = vscode.Uri.joinPath(root, "one");
    const file = vscode.Uri.joinPath(root, "one", ".keep");
    const oneKey = "one";
    const fileKey = "one/.keep";

    await vscode.commands.executeCommand("traeFolderRemarks.addRemark", one, "One");
    assert.ok(api.repository.get(oneKey), "remark should be created");

    await vscode.commands.executeCommand("traeFolderRemarks.editRemark", one, "One2");
    const afterEdit = api.repository.get(oneKey) as { remarkName?: string } | undefined;
    assert.strictEqual(afterEdit?.remarkName, "One2");

    await vscode.commands.executeCommand("traeFolderRemarks.addRemark", file, "Keep");
    const fileRemark = api.repository.get(fileKey) as { remarkName?: string } | undefined;
    assert.strictEqual(fileRemark?.remarkName, "Keep");

    await vscode.commands.executeCommand("traeFolderRemarks.setRemark", file, "");
    assert.strictEqual(api.repository.get(fileKey), undefined);

    await api.repository.load();
    const afterReload = api.repository.get(oneKey) as { remarkName?: string } | undefined;
    assert.strictEqual(afterReload?.remarkName, "One2");
    assert.strictEqual(api.repository.get(fileKey), undefined);

    await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", one, true);
    assert.strictEqual(api.repository.get(oneKey), undefined);
    await vscode.commands.executeCommand("traeFolderRemarks.deleteRemark", file, true);
    assert.strictEqual(api.repository.get(fileKey), undefined);
  });
});

async function ensureWorkspaceFolder(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (vscode.workspace.workspaceFolders?.length) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  const workspacePath = path.resolve(__dirname, "../../../.test-workspace");
  const uri = vscode.Uri.file(workspacePath);

  const ok = vscode.workspace.updateWorkspaceFolders(0, null, { uri });
  if (!ok) throw new Error("Failed to attach test workspace folder.");

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for workspace folders.")), 10_000);
    const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      clearTimeout(timer);
      disposable.dispose();
      resolve();
    });
  });
}
