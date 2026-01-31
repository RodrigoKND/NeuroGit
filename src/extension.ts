import * as vscode from "vscode";
import { NeuroGitPanel } from "./git/panel";
import { GIT } from "./git/GIT";

let refreshTimeout: NodeJS.Timeout | undefined;
let pollInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const git = new GIT();
  await git.init();

  const panel = new NeuroGitPanel(context, git);

  const provider = vscode.window.registerWebviewViewProvider(
    NeuroGitPanel.viewType,
    panel,
  );

  context.subscriptions.push(provider);

  // Actualización inicial
  await updateChangesBadge(git, panel);

  const repo = git.getCurrentRepository();
  if (repo) {
    // Listener principal de Git
    repo.state.onDidChange(() => {
      updateChangesBadge(git, panel);
    });
  }

  // ⭐ SOLUCIÓN: Polling cada 500ms cuando la ventana tiene foco
  // Esto es lo que hacen otras extensiones populares
  pollInterval = setInterval(async () => {
    if (vscode.window.state.focused) {
      await forceGitUpdate(git, panel);
    }
  }, 500);

  // Cuando cambia el documento
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme === "file") {
        scheduleGitRefresh(git, panel);
      }
    }),
  );

  // Cuando se guarda
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      scheduleGitRefresh(git, panel);
    }),
  );

  // Cuando cambia el foco de la ventana
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        forceGitUpdate(git, panel);
      }
    }),
  );

  // Cuando cambia el editor activo
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      scheduleGitRefresh(git, panel);
    }),
  );

  // Cleanup del polling
  context.subscriptions.push({
    dispose: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    },
  });
}

async function forceGitUpdate(git: GIT, panel: NeuroGitPanel) {
  const repo = git.getCurrentRepository();
  if (!repo) {
    panel.updateBadge(0);
    return;
  }

  try {
    // Forzar actualización del estado
    await repo.status();
    await updateChangesBadge(git, panel);
  } catch (error) {
    console.error("Error updating git status:", error);
  }
}

function scheduleGitRefresh(git: GIT, panel: NeuroGitPanel) {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }

  refreshTimeout = setTimeout(async () => {
    await forceGitUpdate(git, panel);
  }, 200);
}

async function updateChangesBadge(git: GIT, panel: NeuroGitPanel) {
  const repo = git.getCurrentRepository();
  if (!repo) {
    panel.updateBadge(0);
    return;
  }

  const workingChanges = repo.state.workingTreeChanges?.length || 0;
  const indexChanges = repo.state.indexChanges?.length || 0;
  const totalChanges = workingChanges + indexChanges;

  console.log(`[NeuroGit] Working: ${workingChanges}, Index: ${indexChanges}, Total: ${totalChanges}`);

  panel.updateBadge(totalChanges);
}

export function deactivate() {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }
}