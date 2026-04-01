import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");
  const workspacePath = path.resolve(extensionDevelopmentPath, ".test-workspace");
  const userDataDir = path.resolve(extensionDevelopmentPath, ".vscode-test/user-data");
  const extensionsDir = path.resolve(extensionDevelopmentPath, ".vscode-test/extensions");

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      "--user-data-dir",
      userDataDir,
      "--extensions-dir",
      extensionsDir,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      workspacePath
    ]
  });
}

void main();
