const vscode = acquireVsCodeApi();
const $ = node => document.querySelector(node);
const $$ = node => document.querySelectorAll(node);

let currentAction = 'commit-local';
let commitsData = {};

const handlers = {
    currentBranchName: ({ branchName, main }) => {
        const el = $('#currentBranch');
        if (el) {
            el.textContent = branchName;
            el.className = main ? 'branch-badge warning' : 'branch-badge';
        }
        const warn = $('#warningText');
        if (warn) warn.style.display = main ? 'block' : 'none';
    },
    
    branchCreationSuggestion: ({ show, name }) => {
        const input = $('#branchSuggestion');
        if (input && show) {
            input.value = name;
            showResults();
        }
    },

    commitsByFile: (commits) => {
        commitsData = commits;
        const container = $('#commitsList');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (Object.keys(commits).length === 0) {
            container.innerHTML = '<div class="empty-state">No hay commits sugeridos</div>';
            return;
        }
        
        for (const file in commits) {
            const commit = commits[file];
            const div = document.createElement('div');
            div.className = 'commit-item';
            div.innerHTML = `
                <div class="commit-file">${file}</div>
                <div class="commit-input-group">
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
                        placeholder="Mensaje del commit"
                    />
                </div>
            `;
            container.appendChild(div);
        }
        
        // Event listeners para cambios
        $$('.commit-type-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const file = e.target.dataset.file;
                commitsData[file].type = e.target.value;
            });
        });
        
        $$('.commit-message-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const file = e.target.dataset.file;
                commitsData[file].message = e.target.value;
            });
        });
        
        showResults();
    },

    loadAIConfig: (config) => {
        const provider = $('#aiProvider');
        const model = $('#aiModel');
        const apiKey = $('#aiKey');
        
        if (provider) provider.value = config.provider || 'gemini';
        if (model) model.value = config.model || '';
        if (apiKey) apiKey.value = config.apiKey || '';
        
        // Si ya tiene config, mostrar resultados si hay cache
        if (config.apiKey && config.model) {
            const welcome = $('#welcomeScreen');
            if (welcome && !welcome.classList.contains('hidden')) {
                // No ocultar aún, esperar a que haya datos
            }
        }
    },

    loadBranchPattern: (pattern) => {
        const input = $('#branchPattern');
        if (input) {
            input.value = pattern || '{type}/{name}';
            updatePatternExample();
        }
    },

    configSaved: ({ message }) => {
        showNotification(message, 'success');
        const welcome = $('#welcomeScreen');
        if (welcome) welcome.classList.add('hidden');
    },

    patternSaved: ({ message }) => {
        showNotification(message, 'success');
        closePatternModal();
    },

    showLoader: () => {
        const loader = $('#loader');
        if (loader) loader.style.display = 'flex';
    },

    hideLoader: () => {
        const loader = $('#loader');
        if (loader) loader.style.display = 'none';
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
            if (branchInput) branchInput.value = '';
            if (commitsList) commitsList.innerHTML = '';
            commitsData = {};
        }, 2000);
    }
};

function showNotification(message, type = 'info') {
    const errorEl = $('#errorMessage');
    if (!errorEl) return;
    
    errorEl.textContent = message;
    errorEl.className = `error-message ${type}`;
    errorEl.style.display = 'block';
    
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 3000);
}

function showResults() {
    const welcome = $('#welcomeScreen');
    const results = $('#resultsView');
    if (welcome) welcome.classList.add('hidden');
    if (results) results.classList.add('show');
}

function closePatternModal() {
    const modal = $('#patternModal');
    if (modal) modal.classList.remove('show');
}

function updatePatternExample() {
    const input = $('#branchPattern');
    const example = $('#patternExample');
    if (!input || !example) return;
    
    const pattern = input.value || '{type}/{name}';
    example.textContent = pattern
        .replace('{type}', 'features')
        .replace('{name}', 'nueva-feature')
        .replace('{ticket}', 'JIRA-123');
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
        
        if (!provider || !model || !apiKey) return;

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
$$('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
        currentAction = item.dataset.action;
        const confirmBtn = $('#confirmBtn');
        if (confirmBtn) {
            confirmBtn.textContent = currentAction === 'commit-local' 
                ? '✓ Commit Local' 
                : '✓ Commit y Publicar';
        }
        dropdownMenu.classList.remove('show');
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
