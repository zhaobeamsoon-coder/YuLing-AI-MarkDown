export type AiProvider = "openai" | "ollama" | "claude-cli" | "codex-cli";

export interface AiSettings {
  version: 2;
  provider: AiProvider;
  endpoint: string;
  model: string;
  credentialName: string;
  claudeCliPath: string;
  codexCliPath: string;
}

export const aiSettingsKey = "yuling-ai-settings";

export const defaultAiSettings: AiSettings = {
  version: 2,
  provider: "ollama",
  endpoint: "http://localhost:11434",
  model: "qwen3:8b",
  credentialName: "openai.default",
  claudeCliPath: "",
  codexCliPath: "",
};

function provider(value: unknown, allowCli: boolean): AiProvider {
  if (!allowCli && value !== "openai" && value !== "ollama") return defaultAiSettings.provider;
  return value === "openai" || value === "ollama" || value === "claude-cli" || value === "codex-cli"
    ? value : defaultAiSettings.provider;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function parseAiSettings(value: unknown): AiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultAiSettings;
  const source = value as Record<string, unknown>;
  if (source.version !== undefined && source.version !== 1 && source.version !== 2) return defaultAiSettings;
  return {
    version: 2,
    provider: provider(source.provider, source.version === 2),
    endpoint: text(source.endpoint, defaultAiSettings.endpoint),
    model: text(source.model, defaultAiSettings.model),
    credentialName: text(source.credentialName, defaultAiSettings.credentialName),
    claudeCliPath: text(source.claudeCliPath, ""),
    codexCliPath: text(source.codexCliPath, ""),
  };
}

export function loadAiSettings(storage: Storage = localStorage): AiSettings {
  try {
    return parseAiSettings(JSON.parse(storage.getItem(aiSettingsKey) ?? "null"));
  } catch {
    return defaultAiSettings;
  }
}

export function saveAiSettings(settings: AiSettings, storage: Storage = localStorage): void {
  storage.setItem(aiSettingsKey, JSON.stringify(settings));
}

export function cliPathFor(settings: AiSettings): string {
  return settings.provider === "claude-cli" ? settings.claudeCliPath
    : settings.provider === "codex-cli" ? settings.codexCliPath : "";
}
