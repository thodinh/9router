// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it("treats insufficient balance reported as HTTP 400 as account-scoped", () => {
    for (const errorText of [
      "credit insufficient balance: balance=3411 required=5918",
      "insufficient_user_quota",
      "insufficient balance",
      "insufficient credit",
    ]) {
      const result = checkFallbackError(400, errorText);

      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBe(2 * 60 * 1000);
    }
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("falls through to the next combo model when a provider returns HTTP 400 for insufficient balance", async () => {
    const attemptedModels = [];
    const handleSingleModel = async (_body, modelStr) => {
      attemptedModels.push(modelStr);

      if (modelStr === "provider/primary") {
        return new Response(JSON.stringify({
          error: {
            message: "credit insufficient balance: balance=3411 required=5918",
            code: "insufficient_user_quota",
          },
        }), { status: 400 });
      }

      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hello" }] },
      models: ["provider/primary", "provider/backup"],
      handleSingleModel,
      log: { info() {}, warn() {} },
      comboName: "insufficient-balance-test",
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(result.status).toBe(200);
    expect(attemptedModels).toEqual(["provider/primary", "provider/backup"]);
  });
});
