export default {
  id: "bai",
  alias: "bai",
  aliases: ["b-ai", "b.ai"],
  uiAlias: "bai",
  display: {
    name: "B.AI",
    icon: "hub",
    color: "#111827",
    textIcon: "BAI",
    website: "https://b.ai",
    notice: {
      text: "Unified OpenAI-compatible LLM API with multiple model families.",
      apiKeyUrl: "https://chat.b.ai/key",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.b.ai/v1/chat/completions",
    validateUrl: "https://api.b.ai/v1/models",
    thinkingFormat: "openai",
    usage: {
      url: "https://api.b.ai/v1/balance",
    },
  },
  // B.AI rotates its model catalog per API key. Fetch it after the key is
  // connected; pass-through keeps newer model IDs usable before the cache updates.
  models: [
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
  ],
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
