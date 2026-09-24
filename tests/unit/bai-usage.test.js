import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseBaiBalance } from "../../open-sse/services/usage/bai.js";
import {
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const BALANCE_URL = "https://api.b.ai/v1/balance";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PERSONAL_BALANCE = {
  success: true,
  message: "",
  data: {
    user_id: "user_123",
    api_key_type: "personal",
    timestamp: 1789550088169,
    personal_balance: 1250000,
    active_status: "active",
  },
};

describe("B.AI registry usage flags", () => {
  it("is listed for the API-key quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("bai");
    expect(USAGE_APIKEY_PROVIDERS).toContain("bai");
  });
});

describe("getUsageForProvider(bai)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /v1/balance with a Bearer API key", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(PERSONAL_BALANCE));

    const usage = await getUsageForProvider({
      provider: "bai",
      apiKey: "sk-bai-test",
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options, proxyOptions] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(BALANCE_URL);
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bearer sk-bai-test");
    expect(proxyOptions).toBeNull();

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Personal");
    expect(usage.account).toMatchObject({
      userId: "user_123",
      apiKeyType: "personal",
      activeStatus: "active",
    });
    expect(usage.quotas.Balance).toMatchObject({
      used: 0,
      total: 1250000,
      remainingPercentage: 100,
      isCreditBalance: true,
      currency: "Credits",
      usdEquivalent: 1.25,
    });
    expect(usage.quotas.Balance.remaining).toBeUndefined();
  });

  it("maps team admin balance and limited member quota", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          user_id: "user_123",
          api_key_type: "team",
          team: {
            team_role: "admin",
            quota_limit_type: "limited",
            team_balance: 8000000,
            member_quota_limit: 3000000,
            member_quota_used: 450000,
            member_reset_interval: 2592000,
            quota_reset_at: "2026-09-30T16:00:00Z",
          },
        },
      }),
    );

    const usage = await getUsageForProvider({
      provider: "bai",
      apiKey: "sk-bai-team",
    });

    expect(usage.plan).toBe("Team Admin");
    expect(usage.quotas["Team Balance"]).toMatchObject({
      total: 8000000,
      isCreditBalance: true,
      currency: "Credits",
    });
    expect(usage.quotas["Member Quota"]).toMatchObject({
      used: 450000,
      total: 3000000,
      remainingPercentage: 85,
      unlimited: false,
      resetAt: "2026-09-30T16:00:00.000Z",
    });
  });

  it("preserves an explicitly unlimited team member quota", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          api_key_type: "team",
          team: {
            team_role: "member",
            quota_limit_type: "unlimited",
            member_quota_used: 450000,
          },
        },
      }),
    );

    const usage = await getUsageForProvider({
      provider: "bai",
      apiKey: "sk-bai-member",
    });

    expect(usage.plan).toBe("Team Member");
    expect(usage.quotas["Member Quota"]).toMatchObject({
      used: 450000,
      total: 0,
      remainingPercentage: 100,
      unlimited: true,
    });
  });

  it("keeps a zero personal balance visible", () => {
    const parsed = parseBaiBalance({
      success: true,
      data: {
        api_key_type: "personal",
        personal_balance: 0,
      },
    });

    expect(parsed.quotas.Balance).toMatchObject({
      total: 0,
      isCreditBalance: true,
    });
  });

  it("returns useful messages for missing keys, auth errors, and lookup failures", async () => {
    const missing = await getUsageForProvider({ provider: "bai" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "bad key" }, 401));
    const auth = await getUsageForProvider({ provider: "bai", apiKey: "bad" });
    expect(auth.message).toMatch(/authentication|key|401/i);

    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ success: false, message: "balance backend unavailable" }),
    );
    const failed = await getUsageForProvider({ provider: "bai", apiKey: "sk-bai-test" });
    expect(failed.message).toMatch(/balance backend unavailable/i);
  });
});

describe("parseQuotaData(bai)", () => {
  it("forwards credit metadata without converting absolute remaining", () => {
    const rows = parseQuotaData("bai", {
      plan: "Personal",
      quotas: {
        Balance: {
          used: 0,
          total: 1250000,
          remainingPercentage: 100,
          isCreditBalance: true,
          currency: "Credits",
          usdEquivalent: 1.25,
        },
      },
    });

    expect(rows[0]).toMatchObject({
      name: "Balance",
      total: 1250000,
      remainingPercentage: 100,
      isCreditBalance: true,
      currency: "Credits",
      usdEquivalent: 1.25,
    });
    expect(rows[0].remaining).toBeUndefined();
  });
});
