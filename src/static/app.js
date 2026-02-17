const vscode = acquireVsCodeApi();
const $ = node => document.querySelector(node);
const $$ = node => document.querySelectorAll(node);

let currentAction = 'commit-local';
let commitsData = {};
let hasAIConfig = false;
let currentPattern = '{type}/{name}';
let currentTicket = '';

const handlers = {
    currentBranchName: ({ branchName, main }) => {
        const el = $('#currentBranch');
        if (el) {
            el.textContent = branchName;
            // Linear style: just change text color or icon, don't break layout
            el.className = main ? 'branch-name warning' : 'branch-name';
        }
        const warn = $('#warningText');
        if (warn) { warn.style.display = main ? 'flex' : 'none'; }
    },

    branchCreationSuggestion: ({ show, name, ticket }) => {
        const input = $('#branchSuggestion');
        if (input && show) {
            input.value = name.replace(/(\b[^/]+)\/\1/g, "$1");
            currentTicket = ticket || '';
            showResults();
        }
    },

    commitsByFile: (commits) => {
        commitsData = commits;
        const container = $('#commitsList');
        if (!container) { return; }

        container.textContent = '';

        if (Object.keys(commits).length === 0) {
            container.innerHTML = '<div class="empty-state">No hay cambios sugeridos para confirmar</div>';
            return;
        }

        for (const file in commits) {
            const commit = commits[file];
            const div = document.createElement('div');
            div.className = 'commit-card';
            div.innerHTML = `
                <div class="commit-header">
                    <div class="file-icon">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8z"/></svg>
                    </div>
                    <span class="commit-filename">${file}</span>
                </div>
                <div class="commit-body">
                    <div class="commit-row">
                        <select class="commit-type-select" data-file="${file}">
                            <option value="feat" ${commit.type === 'feat' ? 'selected' : ''}>FEAT</option>
                            <option value="fix" ${commit.type === 'fix' ? 'selected' : ''}>FIX</option>
                            <option value="docs" ${commit.type === 'docs' ? 'selected' : ''}>DOCS</option>
                            <option value="style" ${commit.type === 'style' ? 'selected' : ''}>STYLE</option>
                            <option value="refactor" ${commit.type === 'refactor' ? 'selected' : ''}>REFACTOR</option>
                            <option value="test" ${commit.type === 'test' ? 'selected' : ''}>TEST</option>
                            <option value="chore" ${commit.type === 'chore' ? 'selected' : ''}>CHORE</option>
                            <option value="perf" ${commit.type === 'perf' ? 'selected' : ''}>PERF</option>
                            <option value="build" ${commit.type === 'build' ? 'selected' : ''}>BUILD</option>
                            <option value="ci" ${commit.type === 'ci' ? 'selected' : ''}>CI</option>
                            <option value="revert" ${commit.type === 'revert' ? 'selected' : ''}>REVERT</option>
                        </select>
                        <input 
                            type="text" 
                            class="commit-message-input" 
                            value="${commit.message}"
                            data-file="${file}"
                            placeholder="Descripción del cambio..."
                        />
                    </div>
                </div>
            `;
            container.appendChild(div);
        }

        // Event listeners para cambios
        $$('.commit-type-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const file = e.target.dataset.file;
                commitsData[file].type = e.target.value;
                updateSuggestedBranch();
            });
        });

        $$('.commit-message-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const file = e.target.dataset.file;
                commitsData[file].message = e.target.value;
                updateSuggestedBranch();
            });
        });

        showResults();
    },

    loadAIConfig: (config) => {
        const provider = $('#aiProvider');
        const model = $('#aiModel');
        const apiKey = $('#aiKey');

        if (provider) { provider.value = config.provider || 'gemini'; }
        if (model) { model.value = config.model || ''; }
        if (apiKey) { apiKey.value = config.apiKey || ''; }

        hasAIConfig = !!(config.apiKey && config.model);

        if (hasAIConfig) {
            const welcome = $('#welcomeScreen');
            if (welcome) { welcome.classList.add('hidden'); }

            if (Object.keys(commitsData).length > 0) {
                showResults();
            }
        }
    },

    loadBranchPattern: (pattern) => {
        const input = $('#branchPattern');
        currentPattern = pattern || '{type}/{name}';
        if (input) {
            input.value = currentPattern;
            updatePatternExample();
        }
        updateSuggestedBranch();
    },

    configSaved: ({ message }) => {
        showNotification(message, 'success');
        hasAIConfig = true;
        // Solo ocultar welcome, no saltar a resultados aún si no hay datos
        const welcome = $('#welcomeScreen');
        if (welcome) { welcome.classList.add('hidden'); }
    },

    patternSaved: ({ message }) => {
        showNotification(message, 'success');
        closePatternModal();
    },

    showLoader: () => {
        const loader = $('#loader');
        const results = $('#resultsView');
        const welcome = $('#welcomeScreen');
        const footer = $('#footerActions');

        if (loader) { loader.style.display = 'flex'; }
        if (results) { results.classList.remove('show'); }
        if (welcome) { welcome.classList.add('hidden'); }
        if (footer) { footer.style.display = 'none'; }
    },

    hideLoader: () => {
        const loader = $('#loader');
        if (loader) {
            loader.style.display = 'none';
            // Restaurar vista según datos o config
            if (Object.keys(commitsData).length > 0) {
                switchView('results');
            } else if (!hasAIConfig) {
                switchView('welcome');
            }
            // Si hasAIConfig es true y no hay commitsData, se queda en blanco (o estado actual)
            // pero NO vuelve a welcome automáticamente.
        }
    },

    updateViews: (hasConfig) => {
        if (!hasConfig) {
            switchView('welcome');
        } else if (Object.keys(commitsData).length > 0) {
            switchView('results');
        } else {
            // Keep current view or default to welcome if nothing is happening
        }
    },

    error: ({ message }) => {
        showNotification(message, 'error');
    },

    commitSuccess: ({ message }) => {
        showNotification(message, 'success');
        // Limpiar vista después de commit exitoso
        setTimeout(() => {
            const branchInput = $('#branchSuggestion');
            const commitsList = $('#commitsList');
            const footer = $('#footerActions');

            if (branchInput) { branchInput.value = ''; }
            if (commitsList) { commitsList.textContent = ''; }
            if (footer) { footer.style.display = 'none'; }

            commitsData = {};
            // Opcional: switchView('welcome') si no hay config, 
            // pero si hay config simplemente dejamos el panel listo para el siguiente "Ask AI"
            const results = $('#resultsView');
            if (results) { results.classList.remove('show'); }
        }, 2000);
    }
};

function showNotification(message, type = 'info') {
    const errorEl = $('#errorMessage');
    if (!errorEl) { return; }

    errorEl.textContent = message;
    errorEl.className = `error-message ${type}`;
    errorEl.style.display = 'block';

    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 3000);
}

function switchView(view) {
    const welcome = $('#welcomeScreen');
    const results = $('#resultsView');
    const footer = $('#footerActions');

    if (view === 'welcome') {
        if (welcome) { welcome.classList.remove('hidden'); }
        if (results) { results.classList.remove('show'); }
        if (footer) { footer.style.display = 'none'; }
    } else if (view === 'results') {
        if (welcome) { welcome.classList.add('hidden'); }
        if (results) { results.classList.add('show'); }
        if (footer) { footer.style.display = 'flex'; }
    }
}

function showResults() {
    switchView('results');

    // Asegurar que el botón tenga el texto correcto según la acción actual
    const confirmBtn = $('#confirmBtn');
    if (confirmBtn) {
        confirmBtn.textContent = currentAction === 'commit-local'
            ? 'Confirmar Local'
            : 'Confirmar y Publicar';
    }
}

function closePatternModal() {
    const modal = $('#patternModal');
    if (modal) { modal.classList.remove('show'); }
}

function updatePatternExample() {
    const input = $('#branchPattern');
    const example = $('#patternExample');
    if (!input || !example) { return; }

    const pattern = input.value || '{type}/{name}';
    example.textContent = pattern
        .replace('{type}', 'features')
        .replace('{name}', 'nueva-feature')
        .replace('{ticket}', 'JIRA-123');
}

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

function updateSuggestedBranch() {
    const branchInput = $('#branchSuggestion');
    if (!branchInput || Object.keys(commitsData).length === 0) {
        return;
    }

    // Tomamos el primer commit como referencia para la rama
    const firstFile = Object.keys(commitsData)[0];
    const commit = commitsData[firstFile];

    const typeMapping = {
        feat: 'features',
        fix: 'fixes',
        docs: 'docs',
        style: 'style',
        refactor: 'refactor',
        test: 'tests',
        chore: 'chore'
    };

    const folderName = typeMapping[commit.type] || commit.type;
    const slugName = slugify(commit.message);

    let result = currentPattern
        .replace('{type}', folderName)
        .replace('{name}', slugName)
        .replace('{ticket}', currentTicket);

    // Limpiar barras dobles o ticket vacío
    result = result.replace(/\/\//g, '/').replace(/\/$/, '');

    branchInput.value = result;
}

window.addEventListener('message', e => {
    const { type, payload } = e.data;
    if (handlers[type]) {
        handlers[type](payload);
    } 
});

window.addEventListener('load', () => {
    vscode.postMessage({ type: 'ready' });
});

// Magic button - Analizar con IA
const magicBtn = $('#magicBtn');
if (magicBtn) {
    magicBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'askAI' });
    });
}

// Settings button - Abrir modal de patrones
const settingsBtn = $('#settingsBtn');
const patternModal = $('#patternModal');
if (settingsBtn && patternModal) {
    settingsBtn.addEventListener('click', () => {
        patternModal.classList.add('show');
    });
}
const settingsAIBtn = $('#settingsAIBtn');
if (settingsAIBtn) {
    settingsAIBtn.addEventListener('click', () => {
        const welcome = $('#welcomeScreen');
        if (welcome) {
            if (welcome.classList.contains('hidden')) {
                // Show config
                switchView('welcome');
            } else {
                // Hide config
                if (hasAIConfig) {
                    welcome.classList.add('hidden');
                    // Show results if we have data
                    if (Object.keys(commitsData).length > 0) {
                        showResults();
                    }
                } else {
                    // If no config, we can't hide it unless we have some other view
                    showNotification('Configura primero la IA', 'info');
                }
            }
        }
    });
}


// Cerrar modal
const closeModalBtn = $('#closePatternModal');
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closePatternModal);
}

// Click fuera del modal para cerrar
if (patternModal) {
    patternModal.addEventListener('click', (e) => {
        if (e.target === patternModal) {
            closePatternModal();
        }
    });
}

// Guardar patrón
const savePatternBtn = $('#savePatternBtn');
if (savePatternBtn) {
    savePatternBtn.addEventListener('click', () => {
        const input = $('#branchPattern');
        if (input) {
            vscode.postMessage({
                type: 'saveBranchPattern',
                payload: { pattern: input.value }
            });
        }
    });
}

// Pattern example
const branchPattern = $('#branchPattern');
if (branchPattern) {
    branchPattern.addEventListener('input', updatePatternExample);
    updatePatternExample();
}

// Guardar config AI
const saveAIConfig = $('#saveAIConfig');
if (saveAIConfig) {
    saveAIConfig.addEventListener('click', () => {
        const provider = $('#aiProvider');
        const model = $('#aiModel');
        const apiKey = $('#aiKey');

        if (!provider || !model || !apiKey) { return; }

        if (!model.value || !apiKey.value) {
            showNotification('Completa modelo y API Key', 'error');
            return;
        }

        vscode.postMessage({
            type: 'saveAIConfig',
            payload: {
                provider: provider.value,
                model: model.value,
                apiKey: apiKey.value
            }
        });
    });
}

// Dropdown actions
const dropdownBtn = $('#dropdownBtn');
const dropdownMenu = $('#dropdownMenu');
if (dropdownBtn && dropdownMenu) {
    dropdownBtn.addEventListener('click', e => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        dropdownMenu.classList.remove('show');
    });
}

// Dropdown items
$$('.dropdown-option').forEach(item => {
    item.addEventListener('click', () => {
        currentAction = item.dataset.action;

        // Actualizar UI del menú
        $$('.dropdown-option').forEach(opt => opt.classList.remove('active'));
        item.classList.add('active');

        // Actualizar botón principal
        const confirmBtn = $('#confirmBtn');
        if (confirmBtn) {
            confirmBtn.textContent = currentAction === 'commit-local'
                ? 'Confirmar Local'
                : 'Confirmar y Publicar';
        }

        if (dropdownMenu) {
            dropdownMenu.classList.remove('show');
        }
    });
});

// Confirm button
const confirmBtn = $('#confirmBtn');
if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
        const branchName = $('#branchSuggestion')?.value;

        if (!branchName) {
            showNotification('Debes tener una rama sugerida', 'error');
            return;
        }

        if (Object.keys(commitsData).length === 0) {
            showNotification('No hay commits para confirmar', 'error');
            return;
        }

        vscode.postMessage({
            type: 'confirmCommit',
            payload: {
                action: currentAction,
                branch: branchName,
                commits: commitsData
            }
        });
    });
}

// Cancel button
const cancelBtn = $('#cancelBtn');
if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
    });
}
