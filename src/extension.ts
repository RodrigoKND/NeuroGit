import * as vscode from "vscode";
import { NeuroGitPanel } from "./git/panel";
import { GIT } from "./git/GIT";

let statusBarItem: vscode.StatusBarItem;

// Sistema de notificaciones inteligente
const notificationState = {
  lastModifiedFiles: new Set<string>(),
  lastNotificationTime: 0,
  COOLDOWN_MS: 5000,
};

export async function activate(context: vscode.ExtensionContext) {
  const git = new GIT();
  await git.init();

  const panel = new NeuroGitPanel(context, git);

  const provider = vscode.window.registerWebviewViewProvider(
    NeuroGitPanel.viewType,
    panel,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  context.subscriptions.push(provider);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = "Neuro Git";
  statusBarItem.command = "neuro-git.openView";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("neuro-git.openView", () => {
      vscode.commands.executeCommand("neuro-git.view.focus");
    }),
  );

  async function updateStatusBar() {
    const repo = git.getCurrentRepository();
    if (!repo) {
      statusBarItem.hide();
      return;
    }

    try {
      await repo.status();

      const workingChanges = repo.state.workingTreeChanges?.length || 0;
      const indexChanges = repo.state.indexChanges?.length || 0;
      const totalChanges = workingChanges + indexChanges;

      if (totalChanges > 0) {
        statusBarItem.text = `$(git-branch) ${totalChanges} cambio${totalChanges > 1 ? "s" : ""}`;
        statusBarItem.tooltip = `${totalChanges} cambio${totalChanges > 1 ? "s" : ""} pendiente${totalChanges > 1 ? "s" : ""}`;
        statusBarItem.show();
      } else {
        statusBarItem.hide();
      }

      panel.updateChanges();
    } catch (error) {
      console.error("[NeuroGit] Error:", error);
      statusBarItem.hide();
    }
  }

  // Función para mostrar notificación inteligente
  function maybeNotify(fileName: string, totalChanges: number) {
    const now = Date.now();
    const timeSinceLastNotification = now - notificationState.lastNotificationTime;

    // Solo notificar si:
    // 1. Es un archivo nuevo (no estaba en el set)
    // 2. Han pasado al menos COOLDOWN_MS desde la última notificación
    const isNewFile = !notificationState.lastModifiedFiles.has(fileName);
    const cooldownExpired = timeSinceLastNotification > notificationState.COOLDOWN_MS;

    if (isNewFile && cooldownExpired) {
      vscode.window.showInformationMessage(
        `[NeuroGit] ${totalChanges} archivo${totalChanges > 1 ? "s" : ""} modificado${totalChanges > 1 ? "s" : ""}`
      );
      notificationState.lastNotificationTime = now;
    }

    // Agregar el archivo al set
    notificationState.lastModifiedFiles.add(fileName);

    // Limpiar archivos antiguos después de 30 segundos
    setTimeout(() => {
      notificationState.lastModifiedFiles.delete(fileName);
    }, 30000);
  }

  await updateStatusBar();

  const repo = git.getCurrentRepository();
  if (repo) {
    repo.state.onDidChange(() => {
      updateStatusBar();
    });
  }

  let updateTimeout: NodeJS.Timeout | undefined;

  function scheduleUpdate() {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(updateStatusBar, 300);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.document.uri.scheme === "file") {
        if (event.document.isDirty) {
          await event.document.save();
        }

        scheduleUpdate();

        // Obtener el nombre del archivo
        const fileName = event.document.fileName;
        
        // Calcular cambios totales
        const repo = git.getCurrentRepository();
        if (repo) {
          const totalChanges = 
            (repo.state.workingTreeChanges?.length || 0) + 
            (repo.state.indexChanges?.length || 0);
          
          maybeNotify(fileName, totalChanges);
        }
      }
    }),
  );
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}