"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode4 = __toESM(require("vscode"));

// src/git/panel.ts
var vscode2 = __toESM(require("vscode"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));

// src/controllers/git-controller.ts
var vscode = __toESM(require("vscode"));

// src/ai/ai-service.ts
var https = __toESM(require("https"));
var AIService = class {
  constructor(context) {
    this.context = context;
    this.config = this.context.globalState.get("aiConfig", {
      provider: "gemini",
      model: "",
      apiKey: ""
    });
  }
  config;
  getConfig() {
    return this.config;
  }
  async saveConfig(cfg) {
    this.config = cfg;
    await this.context.globalState.update("aiConfig", cfg);
  }
  async run(prompt) {
    if (!this.config.apiKey || !this.config.model) {
      throw new Error("Configura primero tu API Key y modelo");
    }
    if (this.config.provider === "huggingface") {
      return this.runHuggingFace(prompt);
    }
    if (this.config.provider === "gemini") {
      return this.runGemini(prompt);
    }
    throw new Error("Proveedor no soportado");
  }
  httpsRequest(url, options, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on("error", reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
  async runHuggingFace(prompt) {
    const { apiKey, model } = this.config;
    try {
      const body = JSON.stringify({ inputs: prompt });
      const data = await this.httpsRequest(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body)
          }
        },
        body
      );
      const json = JSON.parse(data);
      if (json.error) {
        throw new Error(json.error);
      }
      return Array.isArray(json) ? json[0].generated_text : json.generated_text;
    } catch (err) {
      throw new Error(`HuggingFace: ${err.message}`);
    }
  }
  async runGemini(prompt) {
    const { apiKey, model } = this.config;
    try {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      });
      const data = await this.httpsRequest(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body)
          }
        },
        body
      );
      const json = JSON.parse(data);
      if (json.error) {
        throw new Error(json.error.message);
      }
      if (!json.candidates || !json.candidates[0]) {
        throw new Error("Respuesta inv\xE1lida de Gemini");
      }
      return json.candidates[0].content.parts[0].text;
    } catch (err) {
      throw new Error(`Gemini: ${err.message}`);
    }
  }
};

// src/controllers/git-controller.ts
var GitController = class {
  constructor(view, git, context) {
    this.view = view;
    this.git = git;
    this.context = context;
    this.ai = new AIService(this.context);
    this.repo = this.git.getCurrentRepository();
    this.loadCache();
    this.loadBranchPattern();
    this.bindRepo();
    this.git.gitApi.onDidOpenRepository((repo) => {
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
  repo;
  ai;
  analysisCache = null;
  branchPattern = "{type}/{name}";
  async loadCache() {
    this.analysisCache = this.context.workspaceState.get(
      "neurogit.lastAnalysis",
      null
    );
  }
  async saveCache() {
    if (this.analysisCache) {
      await this.context.workspaceState.update(
        "neurogit.lastAnalysis",
        this.analysisCache
      );
    }
  }
  async loadBranchPattern() {
    this.branchPattern = this.context.workspaceState.get(
      "neurogit.branchPattern",
      "{type}/{name}"
    );
  }
  async saveBranchPattern() {
    await this.context.workspaceState.update(
      "neurogit.branchPattern",
      this.branchPattern
    );
  }
  sendInitialData() {
    this.sendAIConfig();
    this.sendBranchPattern();
    this.sendCachedAnalysis();
    setTimeout(() => {
      this.sendCurrentBranchName();
    }, 500);
  }
  sendCachedAnalysis() {
    if (this.analysisCache) {
      this.view.postMessage({
        type: "branchCreationSuggestion",
        payload: {
          show: !!this.analysisCache.branch,
          name: this.analysisCache.branch
        }
      });
      this.view.postMessage({
        type: "commitsByFile",
        payload: this.analysisCache.commits
      });
    }
  }
  sendAIConfig() {
    const config = this.ai.getConfig();
    this.view.postMessage({
      type: "loadAIConfig",
      payload: config
    });
  }
  sendBranchPattern() {
    this.view.postMessage({
      type: "loadBranchPattern",
      payload: this.branchPattern
    });
  }
  async handleSaveConfig(cfg) {
    try {
      await this.ai.saveConfig(cfg);
      vscode.window.showInformationMessage(
        "\u2713 Configuraci\xF3n de IA guardada correctamente"
      );
      this.view.postMessage({
        type: "configSaved",
        payload: { message: "\u2713 Configuraci\xF3n guardada" }
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Error al guardar: ${err.message}`);
    }
  }
  async handleSaveBranchPattern(payload) {
    try {
      this.branchPattern = payload.pattern;
      await this.saveBranchPattern();
      vscode.window.showInformationMessage("\u2713 Patr\xF3n de rama guardado");
      this.view.postMessage({
        type: "patternSaved",
        payload: { message: "\u2713 Patr\xF3n guardado" }
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
  }
  async handleConfirmCommit(payload) {
    if (!this.repo) {
      vscode.window.showErrorMessage("No hay repositorio abierto");
      return;
    }
    try {
      const { action, branch, commits } = payload;
      const currentBranch = this.git.getCurrentBranchName();
      if (this.git.isOnMain(currentBranch)) {
        try {
          await this.repo.createBranch(branch, true);
          await this.repo.checkout(branch);
          vscode.window.showInformationMessage(
            `\u2713 Rama ${branch} creada y cambiada`
          );
        } catch (err) {
          vscode.window.showErrorMessage(`Error al crear rama: ${err.message}`);
          return;
        }
      }
      for (const file in commits) {
        try {
          const { type, message } = commits[file];
          const commitMessage = `${type}: ${message}`;
          const allChanges = [
            ...this.repo.state.workingTreeChanges || [],
            ...this.repo.state.indexChanges || []
          ];
          const fileChange = allChanges.find((c) => {
            const relativePath = vscode.workspace.asRelativePath(c.uri);
            return relativePath === file;
          });
          if (!fileChange) {
            console.warn(`Archivo ${file} no encontrado en cambios`);
            continue;
          }
          await this.repo.add([fileChange.uri.fsPath]);
          await this.repo.commit(commitMessage);
        } catch (err) {
          vscode.window.showErrorMessage(`Error en ${file}: ${err.message}`);
        }
      }
      if (action === "commit-publish") {
        try {
          await this.repo.push();
          const successMsg = "se ha completado exitosamente la publicaci\xF3n del commit";
          vscode.window.showInformationMessage(`\u2713 ${successMsg}`);
          this.view.postMessage({
            type: "commitSuccess",
            payload: { message: `\u2713 ${successMsg}` }
          });
        } catch (err) {
          vscode.window.showWarningMessage(
            `Commits realizados pero no se pudo publicar: ${err.message}`
          );
          this.view.postMessage({
            type: "commitSuccess",
            payload: { message: "\u2713 Commits realizados localmente (fall\xF3 el push)" }
          });
        }
      } else {
        const successMsg = "se ha completado exitosamente el commit local";
        vscode.window.showInformationMessage(`\u2713 ${successMsg}`);
        this.view.postMessage({
          type: "commitSuccess",
          payload: { message: `\u2713 ${successMsg}` }
        });
      }
      this.analysisCache = null;
      await this.saveCache();
    } catch (err) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
      this.view.postMessage({
        type: "error",
        payload: { message: err.message }
      });
    }
  }
  handleCancel() {
    this.view.postMessage({
      type: "error",
      payload: { message: "Operaci\xF3n cancelada" }
    });
  }
  bindRepo() {
    if (!this.repo) {
      return;
    }
    this.repo.state.onDidChange(() => {
      this.sendCurrentBranchName();
    });
    this.sendCurrentBranchName();
  }
  sendCurrentBranchName() {
    const branchName = this.git.getCurrentBranchName() || "Sin rama";
    const isOnMain = this.git.isOnMain(branchName);
    this.view.postMessage({
      type: "currentBranchName",
      payload: { branchName, main: isOnMain }
    });
  }
  async handleAskAI() {
    if (!this.repo) {
      this.view.postMessage({
        type: "error",
        payload: { message: "No hay repositorio Git abierto" }
      });
      return;
    }
    try {
      this.view.postMessage({ type: "showLoader" });
      const changes = [
        ...this.repo.state.workingTreeChanges || [],
        ...this.repo.state.indexChanges || []
      ];
      if (!changes.length) {
        this.view.postMessage({
          type: "error",
          payload: { message: "No hay archivos modificados" }
        });
        this.view.postMessage({ type: "hideLoader" });
        return;
      }
      const filesWithDiff = await Promise.all(
        changes.map(async (change) => {
          const relativePath = vscode.workspace.asRelativePath(change.uri);
          try {
            const diff = await this.repo.diffWithHEAD(change.uri.fsPath);
            return {
              path: relativePath,
              status: change.status,
              diff: diff || "Archivo nuevo o eliminado"
            };
          } catch {
            return {
              path: relativePath,
              status: change.status,
              diff: "No se pudo obtener diff"
            };
          }
        })
      );
      const prompt = `Analiza estos cambios de Git y devuelve SOLO un JSON v\xE1lido:

${filesWithDiff.map(
        (f) => `
Archivo: ${f.path}
Estado: ${f.status}
Cambios:
${f.diff}
---`
      ).join("\n")}

IMPORTANTE: El usuario usa este patr\xF3n para nombrar ramas: "${this.branchPattern}"

Variables disponibles:
- {type} = Carpeta por tipo (features, fixes, docs, etc.) - s\xE9 muy espec\xEDfico y breve.
- {name} = Nombre descriptivo de la rama seg\xFAn a los cambios que se realizaron, s\xE9 muy especifico y breve, no repitas el tipo del commit en la rama por ejemplo: refactor/refactor, no debe existir doble tipo solo uno: refactor/nombre-rama, esto es solo un ejemplo
- {ticket} = N\xFAmero de ticket (ej: JIRA-123, si el usuario menciona un ticket en sus cambios)

Analiza el diff real de cada archivo y crea mensajes de commit MUY espec\xEDficos que describan exactamente qu\xE9 se agreg\xF3, modific\xF3 o elimin\xF3.

Responde SOLO con este formato JSON (sin texto adicional):
{
  "branch": "nombre-descriptivo-de-rama-ticket (si detectas un n\xFAmero de ticket en los cambios, sino d\xE9jalo vac\xEDo "")",
  "ticket": "TICKET-123" (solo si detectas un n\xFAmero de ticket en los cambios, sino d\xE9jalo vac\xEDo ""),
  "commits": {
    "archivo.js": {
      "message": "descripci\xF3n MUY espec\xEDfica del cambio real (ej: 'remove unused imports', 'add validation for email field', 'fix null pointer in user service')",
      "type": "tipo-de-commit que ves conveniente seg\xFAn los cambios, solo usa los tipos v\xE1lidos como valores"
    }
  }
}

Tipos v\xE1lidos: "feat", "fix", "docs", "style", "test", "refactor", "perf", "build", "ci", "chore", "revert"
NOTA: NO incluyas el tipo (feat, fix, etc) en el nombre de la rama, solo un nombre descriptivo. Todo el contenido en ingl\xE9s.
IMPORTANTE: Analiza el diff l\xEDnea por l\xEDnea para ser preciso en el mensaje de commit.`;
      const resultText = await this.ai.run(prompt);
      let jsonText = resultText.trim();
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
      const data = JSON.parse(jsonText);
      if (!data.branch || !data.commits) {
        throw new Error("Respuesta inv\xE1lida de la IA");
      }
      const branchName = this.applyBranchPattern(
        data.branch,
        data.commits,
        data.ticket || ""
      );
      this.analysisCache = {
        branch: branchName,
        commits: data.commits
      };
      await this.saveCache();
      this.view.postMessage({
        type: "branchCreationSuggestion",
        payload: {
          show: true,
          name: branchName,
          ticket: data.ticket || ""
        }
      });
      this.view.postMessage({
        type: "commitsByFile",
        payload: data.commits
      });
    } catch (err) {
      this.view.postMessage({
        type: "error",
        payload: { message: err.message }
      });
    } finally {
      this.view.postMessage({ type: "hideLoader" });
    }
  }
  applyBranchPattern(suggestedName, commits, ticket = "") {
    if (!this.branchPattern.includes("{")) {
      return suggestedName;
    }
    const types = Object.values(commits).map((c) => c.type);
    const type = types[0] || "feat";
    const typeMapping = {
      feat: "features",
      fix: "fixes",
      docs: "docs",
      style: "style",
      refactor: "refactor",
      test: "tests",
      chore: "chore"
    };
    const folderName = typeMapping[type] || type;
    let result = this.branchPattern.replace("{type}", folderName).replace("{name}", suggestedName).replace("{ticket}", ticket);
    result = result.replace(/\/\//g, "/").replace(/\/$/, "");
    return result;
  }
};

// src/git/panel.ts
var NeuroGitPanel = class {
  constructor(context, git) {
    this.context = context;
    this.git = git;
  }
  static viewType = "neurogit.panel";
  view;
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode2.Uri.file(path.join(this.context.extensionPath, "src/static")),
        vscode2.Uri.file(path.join(this.context.extensionPath, "media"))
      ]
    };
    view.webview.html = this.getHtml(view.webview);
    new GitController(view.webview, this.git, this.context);
    vscode2.window.onDidChangeActiveColorTheme(() => {
      view.webview.html = this.getHtml(view.webview);
    });
  }
  updateBadge(count) {
    if (this.view) {
      this.view.badge = count > 0 ? { value: count, tooltip: `${count} cambios pendientes` } : void 0;
    }
  }
  getHtml(webview) {
    const base = this.context.extensionPath;
    const html = fs.readFileSync(
      path.join(base, "src/static/panel.html"),
      "utf8"
    );
    const nonce = this.getNonce();
    const jsUri = webview.asWebviewUri(
      vscode2.Uri.file(path.join(base, "src/static/app.js"))
    );
    const cssUri = webview.asWebviewUri(
      vscode2.Uri.file(path.join(base, "src/static/style.css"))
    );
    const themeKind = vscode2.window.activeColorTheme.kind;
    const isDark = themeKind === vscode2.ColorThemeKind.Dark || themeKind === vscode2.ColorThemeKind.HighContrast;
    const logoName = isDark ? "neurogit-dark.png" : "neurogit-light.png";
    const logoUri = webview.asWebviewUri(
      vscode2.Uri.file(path.join(base, "media", logoName))
    );
    return html.replace("{{nonce}}", nonce).replace("{{pathJS}}", jsUri.toString()).replace("{{pathCSS}}", cssUri.toString()).replaceAll("{{logoUri}}", logoUri.toString());
  }
  getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
};

// src/git/GIT.ts
var vscode3 = __toESM(require("vscode"));
var GIT = class {
  gitApi;
  async init() {
    const ext = vscode3.extensions.getExtension("vscode.git");
    if (!ext) {
      throw new Error("Git extension not found");
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
  getCurrentBranchName() {
    const repo = this.getCurrentRepository();
    if (!repo || !repo.state || !repo.state.HEAD) {
      return "";
    }
    return repo.state.HEAD.name ?? "";
  }
  isOnMain(branch) {
    return ["main", "master"].includes(branch.toLowerCase());
  }
};

// src/extension.ts
async function activate(context) {
  const git = new GIT();
  await git.init();
  const panel = new NeuroGitPanel(context, git);
  const provider = vscode4.window.registerWebviewViewProvider(
    NeuroGitPanel.viewType,
    panel
  );
  context.subscriptions.push(provider);
  updateChangesBadge(git, panel);
  const repo = git.getCurrentRepository();
  if (repo) {
    repo.state.onDidChange(() => {
      updateChangesBadge(git, panel);
    });
  }
  git.gitApi.onDidOpenRepository((newRepo) => {
    newRepo.state.onDidChange(() => {
      updateChangesBadge(git, panel);
    });
    updateChangesBadge(git, panel);
  });
}
function updateChangesBadge(git, panel) {
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
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
