import * as vscode from 'vscode';
import { NeuroGitPanel } from './git/panel';
import { GIT } from './git/GIT';

export async function activate(context: vscode.ExtensionContext) {
    const git = new GIT();
    await git.init();

    const panel = new NeuroGitPanel(context, git);

    // Registrar el webview provider
    const provider = vscode.window.registerWebviewViewProvider(
        NeuroGitPanel.viewType,
        panel
    );

    context.subscriptions.push(provider);

    // Actualizar badge de cambios
    updateChangesBadge(git, panel);

    // Escuchar cambios en el repositorio
    const repo = git.getCurrentRepository();
    if (repo) {
        repo.state.onDidChange(() => {
            updateChangesBadge(git, panel);
        });
    }

    // Escuchar cuando se abre un nuevo repositorio
    git.gitApi.onDidOpenRepository((newRepo: any) => {
        newRepo.state.onDidChange(() => {
            updateChangesBadge(git, panel);
        });
        updateChangesBadge(git, panel);
    });
}

function updateChangesBadge(git: GIT, panel: NeuroGitPanel) {
    const repo = git.getCurrentRepository();
    if (!repo) {
        panel.updateBadge(0);
        return;
    }

    const workingChanges = repo.state.workingTreeChanges?.length || 0;
    const indexChanges = repo.state.indexChanges?.length || 0;
    const totalChanges = workingChanges + indexChanges;

    panel.updateBadge(totalChanges);
}

export function deactivate() { }