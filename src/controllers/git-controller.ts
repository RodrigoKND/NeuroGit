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
    private readonly context: vscode.ExtensionContext
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
      null
    );
  }

  private async saveCache() {
    if (this.analysisCache) {
      await this.context.workspaceState.update(
        "neurogit.lastAnalysis",
        this.analysisCache
      );
    }
  }

  private async loadBranchPattern() {
    this.branchPattern = this.context.workspaceState.get(
      "neurogit.branchPattern",
      "{type}/{name}"
    );
  }

  private async saveBranchPattern() {
    await this.context.workspaceState.update(
      "neurogit.branchPattern",
      this.branchPattern
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
        "✓ Configuración de IA guardada correctamente"
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

      // Crear rama si es necesario
      const currentBranch = this.git.getCurrentBranchName();
      if (this.git.isOnMain(currentBranch)) {
        try {
          await this.repo.createBranch(branch, true);
          await this.repo.checkout(branch);
          vscode.window.showInformationMessage(
            `✓ Rama ${branch} creada y cambiada`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error al crear rama: ${err.message}`);
          return;
        }
      }

      // Hacer commits por archivo
      for (const file in commits) {
        try {
          const { type, message } = commits[file];
          const commitMessage = `${type}: ${message}`;

          // Buscar el archivo en los cambios
          const allChanges = [
            ...(this.repo.state.workingTreeChanges || []),
            ...(this.repo.state.indexChanges || []),
          ];

          const fileChange = allChanges.find((c: any) => {
            const relativePath = vscode.workspace.asRelativePath(c.uri);
            return relativePath === file;
          });

          if (!fileChange) {
            console.warn(`Archivo ${file} no encontrado en cambios`);
            continue;
          }

          // Stage el archivo
          await this.repo.add([fileChange.uri.fsPath]);
          // Commit
          await this.repo.commit(commitMessage);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error en ${file}: ${err.message}`);
        }
      }

      // Publicar si se seleccionó esa opción
      if (action === "commit-publish") {
        try {
          await this.repo.push();
          const successMsg = "se ha completado exitosamente la publicación del commit";
          vscode.window.showInformationMessage(`✓ ${successMsg}`);
          this.view.postMessage({
            type: "commitSuccess",
            payload: { message: `✓ ${successMsg}` },
          });
        } catch (err: any) {
          vscode.window.showWarningMessage(
            `Commits realizados pero no se pudo publicar: ${err.message}`
          );
          this.view.postMessage({
            type: "commitSuccess",
            payload: { message: "✓ Commits realizados localmente (falló el push)" },
          });
        }
      } else {
        const successMsg = "se ha completado exitosamente el commit local";
        vscode.window.showInformationMessage(`✓ ${successMsg}`);
        this.view.postMessage({
          type: "commitSuccess",
          payload: { message: `✓ ${successMsg}` },
        });
      }

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
    if (!this.repo) { return; }

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
        })
      );

      const prompt = `Analiza estos cambios de Git y devuelve SOLO un JSON válido:

${filesWithDiff
          .map(
            (f) => `
Archivo: ${f.path}
Estado: ${f.status}
Cambios:
${f.diff}
---`
          )
          .join("\n")}

IMPORTANTE: El usuario usa este patrón para nombrar ramas: "${this.branchPattern
        }"

Variables disponibles:
- {type} = Carpeta por tipo (features, fixes, docs, etc.) - sé muy específico y breve.
- {name} = Nombre descriptivo de la rama según a los cambios que se realizaron, sé muy especifico y breve, no repitas el tipo del commit en la rama por ejemplo: refactor/refactor, no debe existir doble tipo solo uno: refactor/nombre-rama, esto es solo un ejemplo
- {ticket} = Número de ticket (ej: JIRA-123, si el usuario menciona un ticket en sus cambios)

Analiza el diff real de cada archivo y crea mensajes de commit MUY específicos que describan exactamente qué se agregó, modificó o eliminó.

Responde SOLO con este formato JSON (sin texto adicional):
{
  "branch": "nombre-descriptivo-de-rama-ticket (si detectas un número de ticket en los cambios, sino déjalo vacío "")",
  "ticket": "TICKET-123" (solo si detectas un número de ticket en los cambios, sino déjalo vacío ""),
  "commits": {
    "archivo.js": {
      "message": "descripción MUY específica del cambio real (ej: 'remove unused imports', 'add validation for email field', 'fix null pointer in user service')",
      "type": "tipo-de-commit que ves conveniente según los cambios, solo usa los tipos válidos como valores"
    }
  }
}

Tipos válidos: "feat", "fix", "docs", "style", "test", "refactor", "perf", "build", "ci", "chore", "revert"
NOTA: NO incluyas el tipo (feat, fix, etc) en el nombre de la rama, solo un nombre descriptivo. Todo el contenido en inglés.
IMPORTANTE: Analiza el diff línea por línea para ser preciso en el mensaje de commit.`;

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
        data.ticket || ""
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
    ticket: string = ""
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
