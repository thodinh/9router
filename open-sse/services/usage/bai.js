/**
 * B.AI balance/quota usage handler.
 *
 * B.AI exposes account credits and optional team-member quota at
 * GET /v1/balance. Values are integer Credits (1 USD = 1,000,000 Credits).
 * The API key is used only server-side by proxyAwareFetch.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { BAI_CREDITS_PER_USD } from "../../config/bai.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

const BALANCE_URL = U("bai").url;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function numberOrNull(value) {
  const parsed = toFiniteNumber(value, null);
  return parsed === null ? null : Math.max(0, parsed);
}

function errorMessage(payload, fallback) {
  const candidate =
    payload?.error?.message ||
    payload?.error ||
    payload?.message ||
    "";
  if (typeof candidate !== "string") return fallback;
  const trimmed = candidate.trim();
  return trimmed ? trimmed.slice(0, 200) : fallback;
}

function planFor(data) {
  const keyType = String(data?.api_key_type || "").toLowerCase();
  if (keyType === "personal") return "Personal";
  if (keyType === "team") {
    return String(data?.team?.team_role || "member").toLowerCase() === "admin"
      ? "Team Admin"
      : "Team Member";
  }
  return "B.AI";
}

function makeBalanceQuota(credits) {
  const total = numberOrNull(credits) ?? 0;
  return {
    used: 0,
    total,
    remainingPercentage: 100,
    resetAt: null,
    unlimited: false,
    isCreditBalance: true,
    currency: "Credits",
    usdEquivalent: total / BAI_CREDITS_PER_USD,
  };
}

function makeMemberQuota(team) {
  const quotaType = String(team?.quota_limit_type || "").toLowerCase();
  const used = numberOrNull(team?.member_quota_used) ?? 0;
  const resetAt = parseResetTime(team?.quota_reset_at);

  // The API explicitly uses quota_limit_type to distinguish an unlimited quota
  // from a configured limit of zero. Never infer "unlimited" from a numeric 0.
  if (quotaType !== "limited") {
    return {
      used,
      total: 0,
      remainingPercentage: 100,
      resetAt,
      unlimited: true,
      quotaLimitType: quotaType || "unlimited",
    };
  }

  const total = numberOrNull(team?.member_quota_limit) ?? 0;
  const remaining = Math.max(0, total - used);
  return {
    used,
    total,
    remainingPercentage: total > 0 ? (remaining / total) * 100 : 0,
    resetAt,
    unlimited: false,
    quotaLimitType: "limited",
    isZeroLimit: total === 0,
  };
}

function hasMemberQuota(team) {
  if (!team || typeof team !== "object") return false;
  return (
    hasOwn(team, "member_quota_used") ||
    hasOwn(team, "member_quota_limit") ||
    hasOwn(team, "quota_limit_type") ||
    hasOwn(team, "quota_reset_at")
  );
}

/** Map the documented /v1/balance response into dashboard quota rows. */
export function parseBaiBalance(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    return {
      plan: "B.AI",
      account: {},
      quotas: {},
    };
  }

  const team = data.team && typeof data.team === "object" ? data.team : null;
  const quotas = {};

  if (hasOwn(data, "personal_balance")) {
    quotas.Balance = makeBalanceQuota(data.personal_balance);
  }

  if (team && hasOwn(team, "team_balance")) {
    quotas["Team Balance"] = makeBalanceQuota(team.team_balance);
  }

  if (hasMemberQuota(team)) {
    quotas["Member Quota"] = {
      ...makeMemberQuota(team),
      // Keep the stable display name separate from the value helper's object.
      name: "Member Quota",
    };
  }

  const account = {
    userId: data.user_id || null,
    apiKeyType: data.api_key_type || null,
    activeStatus: data.active_status || null,
    timestamp: hasOwn(data, "timestamp") ? data.timestamp : null,
  };

  return { plan: planFor(data), account, quotas };
}

export async function getBaiUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "B.AI API key not available. Add a key to view balance." };
  }

  if (!BALANCE_URL) {
    return { message: "B.AI balance endpoint is not configured." };
  }

  try {
    const response = await proxyAwareFetch(
      BALANCE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return {
        plan: "B.AI",
        message: "B.AI authentication failed. Check the API key.",
      };
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      let body = null;
      try {
        body = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        // Keep the status-based message when the upstream body is not JSON.
      }
      return {
        plan: "B.AI",
        message: errorMessage(
          body,
          `B.AI balance API error (${response.status}).`,
        ),
      };
    }

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return {
        plan: "B.AI",
        message: "B.AI balance response was not JSON.",
      };
    }

    if (payload.success === false) {
      return {
        plan: "B.AI",
        message: errorMessage(payload, "B.AI balance lookup failed."),
      };
    }

    const parsed = parseBaiBalance(payload);
    if (Object.keys(parsed.quotas).length === 0) {
      return {
        ...parsed,
        message: "B.AI connected. No balance or quota data was returned.",
      };
    }

    return parsed;
  } catch (error) {
    return { message: `B.AI balance error: ${error.message}` };
  }
}
