import * as vscode from 'vscode';
import * as https from 'https';

interface AIConfig {
    provider: string;
    model: string;
    apiKey: string;
}

export class AIService {
    private config: AIConfig;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.config = this.context.globalState.get('aiConfig', {
            provider: 'gemini',
            model: '',
            apiKey: ''
        });
    }

    public getConfig(): AIConfig {
        return this.config;
    }

    public async saveConfig(cfg: AIConfig): Promise<void> {
        this.config = cfg;
        await this.context.globalState.update('aiConfig', cfg);
    }

    public async run(prompt: string): Promise<string> {
        if (!this.config.apiKey || !this.config.model) {
            throw new Error('Configura primero tu API Key y modelo');
        }

        if (this.config.provider === 'huggingface') {
            return this.runHuggingFace(prompt);
        }
        if (this.config.provider === 'gemini') {
            return this.runGemini(prompt);
        }
        throw new Error('Proveedor no soportado');
    }

    private httpsRequest(url: string, options: any, body?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    } else {
                        resolve(data);
                    }
                });
            });
            req.on('error', reject);
            if (body) { req.write(body); }
            req.end();
        });
    }

    private async runHuggingFace(prompt: string): Promise<string> {
        const { apiKey, model } = this.config;

        try {
            const body = JSON.stringify({ inputs: prompt });
            const data = await this.httpsRequest(
                `https://api-inference.huggingface.co/models/${model}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                body
            );

            const json: any = JSON.parse(data);

            if (json.error) {
                throw new Error(json.error);
            }

            return Array.isArray(json) ? json[0].generated_text : json.generated_text;
        } catch (err: any) {
            throw new Error(`HuggingFace: ${err.message}`);
        }
    }

    private async runGemini(prompt: string): Promise<string> {
        const { apiKey, model } = this.config;

        try {
            const body = JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            });

            const data = await this.httpsRequest(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                body
            );

            const json: any = JSON.parse(data);

            if (json.error) {
                throw new Error(json.error.message);
            }

            if (!json.candidates || !json.candidates[0]) {
                throw new Error('Respuesta inválida de Gemini');
            }

            return json.candidates[0].content.parts[0].text;
        } catch (err: any) {
            throw new Error(`Gemini: ${err.message}`);
        }
    }
}// Cambio grande 1
