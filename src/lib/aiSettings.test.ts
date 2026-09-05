// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { aiSettingsKey, cliPathFor, defaultAiSettings, loadAiSettings, saveAiSettings } from "./aiSettings";

beforeEach(() => localStorage.clear());

describe("AI settings v2", () => {
  it("migrates the unversioned network settings without changing the provider", () => {
    localStorage.setItem(aiSettingsKey, JSON.stringify({
      provider: "openai", endpoint: "https://example.test/v1", model: "test-model", credentialName: "openai.work",
    }));
    expect(loadAiSettings()).toEqual({
      version: 2, provider: "openai", endpoint: "https://example.test/v1", model: "test-model",
      credentialName: "openai.work", claudeCliPath: "", codexCliPath: "",
    });
  });

  it("defaults new and corrupt settings to Ollama", () => {
    expect(loadAiSettings()).toEqual(defaultAiSettings);
    localStorage.setItem(aiSettingsKey, "not-json");
    expect(loadAiSettings()).toEqual(defaultAiSettings);
    localStorage.setItem(aiSettingsKey, JSON.stringify({ version: 99, provider: "codex-cli" }));
    expect(loadAiSettings()).toEqual(defaultAiSettings);
  });

  it("persists independent Claude and Codex paths", () => {
    const settings = { ...defaultAiSettings, provider: "claude-cli" as const,
      claudeCliPath: "/opt/homebrew/bin/claude", codexCliPath: "/opt/homebrew/bin/codex" };
    saveAiSettings(settings);
    expect(loadAiSettings()).toEqual(settings);
    expect(cliPathFor(settings)).toBe("/opt/homebrew/bin/claude");
    expect(cliPathFor({ ...settings, provider: "codex-cli" })).toBe("/opt/homebrew/bin/codex");
  });
});
