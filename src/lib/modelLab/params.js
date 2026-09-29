// Best-effort model parameter counts (billions). Values are public estimates
// for flagship APIs / open-weight checkpoints — treat as approximate. Any id
// that carries a numeric "NNb" token falls back to that; otherwise "—".
const KNOWN = [
  ["gpt-4o-mini", "82B"],
  ["gpt-5-mini", "82B"],
  ["gpt-4-turbo", "1.8T"],
  ["gpt-4o", "1.8T"],
  ["gpt-4", "1.8T"],
  ["gpt-3.5-turbo", "20B"],
  ["claude-3-5-sonnet", "1T"],
  ["claude-3-7-sonnet", "1T"],
  ["claude-3-opus", "2T"],
  ["claude-3-sonnet", "70B"],
  ["claude-3-5-haiku", "20B"],
  ["claude-3-haiku", "20B"],
  ["deepseek-chat", "671B"],
  ["deepseek-reasoner", "671B"],
  ["deepseek-v3", "671B"],
  ["deepseek-r1", "671B"],
  ["deepseek-v2", "236B"],
  ["mistral-large", "123B"],
  ["mistral-small", "24B"],
  ["mistral-medium", "14B"],
  ["mistral-nemo", "12B"],
  ["mistral-tiny", "7B"],
  ["codestral", "22B"],
  ["mixtral-8x22b", "8×22B"],
  ["mixtral-8x7b", "8×7B"],
  ["command-r-plus", "104B"],
  ["command-r", "35B"],
  ["grok-1", "314B"],
  ["phi-4", "14B"],
  ["phi-3-medium", "14B"],
  ["phi-3-small", "7B"],
  ["phi-3-mini", "3.8B"],
];

export function lookupParams(id, name) {
  const hay = `${id || ""} ${name || ""}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const [key, value] of KNOWN) {
    if (hay.includes(key)) return value;
  }
  const match = hay.match(/\b(\d{1,4}(?:\.\d+)?)\s?b(?:illion)?\b/);
  if (match) return `${Number(match[1])}B`;
  return null;
}