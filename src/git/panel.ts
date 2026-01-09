import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GIT } from './GIT';
import { GitController } from '../controllers/git-controller';

export class NeuroGitPanel implements vscode.WebviewViewProvider {
    static readonly viewType = 'neurogit.panel';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly git: GIT
    ) {}

    resolveWebviewView(view: vscode.WebviewView) {
        view.webview.options = { 
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'src/static'))
            ]
        };
        view.webview.html = this.getHtml(view.webview);

        new GitController(view.webview, this.git, this.context);
    }

    private getHtml(webview: vscode.Webview): string {
        const base = this.context.extensionPath;

        const html = fs.readFileSync(
            path.join(base, 'src/static/panel.html'),
            'utf8'
        );

        const nonce = this.getNonce();

        const jsUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(base, 'src/static/app.js'))
        );

        const cssUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(base, 'src/static/style.css'))
        );

        return html
            .replace('{{nonce}}', nonce)
            .replace('{{pathJS}}', jsUri.toString())
            .replace('{{pathCSS}}', cssUri.toString());
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}