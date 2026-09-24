import { describe, expect, it } from "vitest";

import {
  getConnectionStatus,
  isProviderConfigured,
  matchesStatusFilter,
} from "@/app/(dashboard)/dashboard/providers/utils.js";

describe("provider dashboard visibility helpers", () => {
  it("treats a provider with any connection as configured", () => {
    const connections = [
      { provider: "bai", authType: "apikey" },
      { provider: "other", authType: "oauth" },
    ];

    expect(isProviderConfigured("bai", connections)).toBe(true);
    expect(isProviderConfigured("missing", connections)).toBe(false);
  });

  it("keeps no-auth providers configured without a connection", () => {
    expect(isProviderConfigured("free-provider", [], { noAuth: true })).toBe(true);
  });

  it("does not count a different provider as configuration", () => {
    expect(
      isProviderConfigured("bai", [{ provider: "bai-dev", authType: "apikey" }]),
    ).toBe(false);
  });

  it("keeps the existing no-connection status behavior", () => {
    const stats = { total: 0, allDisabled: false };
    expect(getConnectionStatus(stats)).toBe("none");
    expect(matchesStatusFilter("none", stats)).toBe(true);
    expect(matchesStatusFilter("none", stats, true)).toBe(false);
  });
});
