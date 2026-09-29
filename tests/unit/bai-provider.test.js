import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getDefaultModel } from "../../open-sse/config/providerModels.js";

const bai = REGISTRY.find((entry) => entry.id === "bai");

describe("B.AI provider", () => {
  it("is registered as an OpenAI-compatible API-key provider", () => {
    expect(bai).toBeDefined();
    expect(bai.category).toBe("apikey");
    expect(bai.alias).toBe("bai");
    expect(bai.aliases).toEqual(expect.arrayContaining(["b-ai", "b.ai"]));
    expect(bai.transport).toMatchObject({
      baseUrl: "https://api.b.ai/v1/chat/completions",
      validateUrl: "https://api.b.ai/v1/models",
      usage: { url: "https://api.b.ai/v1/balance" },
    });
    expect(bai.features).toMatchObject({ usage: true, usageApikey: true });
  });

  it("uses the verified static catalog with live passthrough", () => {
    expect(bai.models[0]).toMatchObject({ id: "claude-opus-5.5", name: "Claude Opus 5.5" });
    expect(getDefaultModel("bai")).toBe("claude-opus-5.5");
    expect(bai.passthroughModels).toBe(true);
  });

  it("builds into the runtime provider map", () => {
    expect(PROVIDERS.bai).toMatchObject({
      baseUrl: "https://api.b.ai/v1/chat/completions",
      format: "openai",
      thinkingFormat: "openai",
    });
  });
});
