import * as vscode from 'vscode';

export class GIT {
    public gitApi: any;

    async init() {
        const ext = vscode.extensions.getExtension('vscode.git');
        if (!ext) {
            throw new Error('Git extension not found');
        }

        if (!ext.isActive) {
            await ext.activate();
        }
        
        this.gitApi = ext.exports.getAPI(1);
    }

    getCurrentRepository() {
        if (!this.gitApi || !this.gitApi.repositories || this.gitApi.repositories.length === 0) {
            return null;
        }
        return this.gitApi.repositories[0];
    }

    getCurrentBranchName(): string {
        const repo = this.getCurrentRepository();
        if (!repo || !repo.state || !repo.state.HEAD) {
            return '';
        }
        return repo.state.HEAD.name ?? '';
    }

    isOnMain(branch: string): boolean {
        return ['main', 'master'].includes(branch.toLowerCase());
    }
}// Cambio pequeño para prueba de IA
