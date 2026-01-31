import * as vscode from "vscode";
import { GIT } from "../git/GIT";
import { AIService } from "../ai/ai-service";

interface AnalysisCache {
  branch: string;
  commits: Record<string, { message: string; type: string }>;
}

export class GitController {
  private repo: any;
  private ai: AIService;
  private analysisCache: AnalysisCache | null = null;
  private branchPattern: string = "{type}/{name}";

  constructor(
    private readonly view: vscode.Webview,
    private readonly git: GIT,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.ai = new AIService(this.context);
    this.repo = this.git.getCurrentRepository();

    // Cargar configuraciones
    this.loadCache();
    this.loadBranchPattern();
    this.bindRepo();

    this.git.gitApi.onDidOpenRepository((repo: any) => {
      this.repo = repo;
      this.bindRepo();
    });

    this.git.gitApi.onDidCloseRepository(() => {
      this.repo = null;
    });

    this.view.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "askAI":
          await this.handleAskAI();
          break;
        case "saveAIConfig":
          await this.handleSaveConfig(msg.payload);
          break;
        case "saveBranchPattern":
          await this.handleSaveBranchPattern(msg.payload);
          break;
        case "confirmCommit":
          await this.handleConfirmCommit(msg.payload);
          break;
        case "cancel":
          this.handleCancel();
          break;
        case "ready":
          this.sendInitialData();
          break;
      }
    });
  }

  private async loadCache() {
    this.analysisCache = this.context.workspaceState.get(
      "neurogit.lastAnalysis",
      null,
    );
  }

  private async saveCache() {
    if (this.analysisCache) {
      await this.context.workspaceState.update(
        "neurogit.lastAnalysis",
        this.analysisCache,
      );
    }
  }

  private async loadBranchPattern() {
    this.branchPattern = this.context.workspaceState.get(
      "neurogit.branchPattern",
      "{type}/{name}",
    );
  }

  private async saveBranchPattern() {
    await this.context.workspaceState.update(
      "neurogit.branchPattern",
      this.branchPattern,
    );
  }

  private sendInitialData() {
    this.sendAIConfig();
    this.sendBranchPattern();
    this.sendCachedAnalysis();

    // Enviar rama actual con un pequeño delay para asegurar que git esté listo
    setTimeout(() => {
      this.sendCurrentBranchName();
    }, 500);
  }

  private sendCachedAnalysis() {
    if (this.analysisCache) {
      this.view.postMessage({
        type: "branchCreationSuggestion",
        payload: {
          show: !!this.analysisCache.branch,
          name: this.analysisCache.branch,
        },
      });

      this.view.postMessage({
        type: "commitsByFile",
        payload: this.analysisCache.commits,
      });
    }
  }

  private sendAIConfig() {
    const config = this.ai.getConfig();
    this.view.postMessage({
      type: "loadAIConfig",
      payload: config,
    });
  }

  private sendBranchPattern() {
    this.view.postMessage({
      type: "loadBranchPattern",
      payload: this.branchPattern,
    });
  }

  private async handleSaveConfig(cfg: any) {
    try {
      await this.ai.saveConfig(cfg);
      vscode.window.showInformationMessage(
        "✓ Configuración de IA guardada correctamente",
      );
      this.view.postMessage({
        type: "configSaved",
        payload: { message: "✓ Configuración guardada" },
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error al guardar: ${err.message}`);
    }
  }

  private async handleSaveBranchPattern(payload: any) {
    try {
      this.branchPattern = payload.pattern;
      await this.saveBranchPattern();
      vscode.window.showInformationMessage("✓ Patrón de rama guardado");
      this.view.postMessage({
        type: "patternSaved",
        payload: { message: "✓ Patrón guardado" },
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
  }

  private async handleConfirmCommit(payload: any) {
    if (!this.repo) {
      vscode.window.showErrorMessage("No hay repositorio abierto");
      return;
    }

    try {
      const { action, branch, commits } = payload;

      // Crear y cambiar a la rama si estamos en main
      const currentBranch = this.git.getCurrentBranchName();
      if (this.git.isOnMain(currentBranch)) {
        try {
          await this.repo.createBranch(branch, true);
          await this.repo.checkout(branch);
          vscode.window.showInformationMessage(
            `✓ Rama ${branch} creada y cambiada`,
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error al crear rama: ${err.message}`);
          return;
        }
      }

      // Commits por archivo
      for (const file in commits) {
        try {
          const { type, message } = commits[file];
          const commitMessage = `${type}: ${message}`;

          const allChanges = [
            ...(this.repo.state.workingTreeChanges || []),
            ...(this.repo.state.indexChanges || []),
          ];

          const fileChange = allChanges.find((c: any) => {
            const relativePath = vscode.workspace.asRelativePath(c.uri);
            return relativePath === file;
          });

          if (!fileChange) {
            continue;
          }

          await this.repo.add([fileChange.uri.fsPath]);
          await this.repo.commit(commitMessage);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error en ${file}: ${err.message}`);
        }
      }

      // Commit local solamente
      if (action !== "commit-publish") {
        const successMsg = "Se completó exitosamente el commit local";
        vscode.window.showInformationMessage(`✓ ${successMsg}`);
        this.view.postMessage({
          type: "commitSuccess",
          payload: { message: `✓ ${successMsg}` },
        });
        return;
      }

      // Evitar push si no hay commits nuevos
      const ahead = this.repo.state.HEAD?.ahead ?? 0;
      if (ahead === 0) {
        vscode.window.showWarningMessage("No hay commits nuevos para publicar");
        return;
      }

      // Detectar si la rama existe en remoto
      const current = this.git.getCurrentBranchName();

      const remoteBranches = this.repo.state.refs
        ?.map((ref: { name?: string }) => ref.name)
        .filter((name: string) => !!name && name.startsWith("origin/"));

      const existsInRemote = remoteBranches?.some(
        (remoteName: string) => remoteName === `origin/${current}`,
      );

      // Push correcto
      if (existsInRemote) {
        await this.repo.push();
      } else {
        await this.repo.push(undefined, true);
      }

      const successMsg = "Commits publicados correctamente en remoto";
      vscode.window.showInformationMessage(`✓ ${successMsg}`);
      this.view.postMessage({
        type: "commitSuccess",
        payload: { message: `✓ ${successMsg}` },
      });

      // Limpiar cache
      this.analysisCache = null;
      await this.saveCache();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
      this.view.postMessage({
        type: "error",
        payload: { message: err.message },
      });
    }
  }

  private handleCancel() {
    this.view.postMessage({
      type: "error",
      payload: { message: "Operación cancelada" },
    });
  }

  private bindRepo() {
    if (!this.repo) {
      return;
    }

    this.repo.state.onDidChange(() => {
      this.sendCurrentBranchName();
    });

    this.sendCurrentBranchName();
  }

  public sendCurrentBranchName() {
    const branchName = this.git.getCurrentBranchName() || "Sin rama";
    const isOnMain = this.git.isOnMain(branchName);

    this.view.postMessage({
      type: "currentBranchName",
      payload: { branchName, main: isOnMain },
    });
  }

  private async handleAskAI() {
    if (!this.repo) {
      this.view.postMessage({
        type: "error",
        payload: { message: "No hay repositorio Git abierto" },
      });
      return;
    }

    try {
      this.view.postMessage({ type: "showLoader" });

      const changes = [
        ...(this.repo.state.workingTreeChanges || []),
        ...(this.repo.state.indexChanges || []),
      ];

      if (!changes.length) {
        this.view.postMessage({
          type: "error",
          payload: { message: "No hay archivos modificados" },
        });
        this.view.postMessage({ type: "hideLoader" });
        return;
      }

      // Obtener diff de cada archivo
      const filesWithDiff = await Promise.all(
        changes.map(async (change: any) => {
          const relativePath = vscode.workspace.asRelativePath(change.uri);
          try {
            const diff = await this.repo!.diffWithHEAD(change.uri.fsPath);
            return {
              path: relativePath,
              status: change.status,
              diff: diff || "Archivo nuevo o eliminado",
            };
          } catch {
            return {
              path: relativePath,
              status: change.status,
              diff: "No se pudo obtener diff",
            };
          }
        }),
      );

      const prompt = `Analiza estos cambios de Git y devuelve SOLO un JSON válido:
${filesWithDiff
  .map((f) => `Archivo: ${f.path} Estado: ${f.status} Cambios:${f.diff}---`)
  .join("\n")}

PATRÓN DE RAMA DEL USUARIO: "${this.branchPattern}"

🚨 REGLAS ESTRICTAS PARA GENERAR LA RAMA:

1. El campo "type" debe ser UNO de estos valores: feat, fix, docs, style, test, refactor, perf, build, ci, chore, revert

2. El campo "name" debe ser:
   - Un nombre descriptivo CORTO en kebab-case
   - SIN incluir el tipo de commit
   - SIN palabras como "feat", "fix", "chore", "refactor", etc.
   - SOLO el nombre puro de la funcionalidad o cambio
   
   ✅ CORRECTO: "remove-profile-page", "add-user-validation", "update-navbar-styles"
   ❌ INCORRECTO: "chore-remove-profile-page", "fix-bug-login", "refactor-code"

3. El campo "ticket" debe ser:
   - El número de ticket si se detecta en los cambios (ej: "JIRA-123")
   - Una cadena vacía "" si NO hay ticket

4. La rama final se construye como: {type}/{name} o {type}/{name}-{ticket}
   
   Ejemplos correctos:
   - { "type": "chore", "name": "remove-profile-page", "ticket": "" } → chore/remove-profile-page
   - { "type": "feat", "name": "user-authentication", "ticket": "JIRA-456" } → feat/user-authentication-JIRA-456
   - { "type": "fix", "name": "login-validation", "ticket": "" } → fix/login-validation

Responde SOLO con este JSON (sin markdown, sin explicaciones):
{
  "type": "tipo-de-commit",
  "name": "nombre-descriptivo-sin-tipo",
  "ticket": "ticket-o-vacio",
  "commits": {
    "ruta/archivo.js": {
      "message": "descripción específica del cambio",
      "type": "tipo-de-commit"
    }
  }
}

Tipos válidos: feat, fix, docs, style, test, refactor, perf, build, ci, chore, revert

TODO en inglés. Analiza el diff y sé específico.`;

      const resultText = await this.ai.run(prompt);

      let jsonText = resultText.trim();
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      const data = JSON.parse(jsonText);

      if (!data.branch || !data.commits) {
        throw new Error("Respuesta inválida de la IA");
      }

      // Aplicar patrón a la rama
      const branchName = this.applyBranchPattern(
        data.branch,
        data.commits,
        data.ticket || "",
      );

      // Guardar en cache
      this.analysisCache = {
        branch: branchName,
        commits: data.commits,
      };
      await this.saveCache();

      // Enviar resultados
      this.view.postMessage({
        type: "branchCreationSuggestion",
        payload: {
          show: true,
          name: branchName,
          ticket: data.ticket || "",
        },
      });

      this.view.postMessage({
        type: "commitsByFile",
        payload: data.commits,
      });
    } catch (err: any) {
      this.view.postMessage({
        type: "error",
        payload: { message: err.message },
      });
    } finally {
      this.view.postMessage({ type: "hideLoader" });
    }
  }

  private applyBranchPattern(
    suggestedName: string,
    commits: any,
    ticket: string = "",
  ): string {
    // Si el patrón no tiene variables, devolver el nombre sugerido directo
    if (!this.branchPattern.includes("{")) {
      return suggestedName;
    }

    // Detectar tipo predominante
    const types = Object.values(commits).map((c: any) => c.type);
    const type = types[0] || "feat";

    // Mapeo de tipos a nombres de carpeta
    const typeMapping: Record<string, string> = {
      feat: "features",
      fix: "fixes",
      docs: "docs",
      style: "style",
      refactor: "refactor",
      test: "tests",
      chore: "chore",
    };

    const folderName = typeMapping[type] || type;

    let result = this.branchPattern
      .replace("{type}", folderName)
      .replace("{name}", suggestedName)
      .replace("{ticket}", ticket);

    // Limpiar barras dobles o ticket vacío
    result = result.replace(/\/\//g, "/").replace(/\/$/, "");

    return result;
  }
}
