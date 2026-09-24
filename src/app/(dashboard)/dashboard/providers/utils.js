export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "none", label: "No connection" },
];

// noAuth providers (e.g. free proxies) are always usable even though they
// never have a stored connection record, so they never fall into "none".
export function getConnectionStatus(stats, isNoAuth = false) {
  if (isNoAuth) return "active";
  if (!stats || stats.total === 0) return "none";
  return stats.allDisabled ? "inactive" : "active";
}

export function matchesStatusFilter(statusFilter, stats, isNoAuth = false) {
  if (statusFilter === "all") return true;
  return getConnectionStatus(stats, isNoAuth) === statusFilter;
}

/**
 * A provider is configured when it has at least one stored connection.
 * No-auth providers are usable without a connection and always count as configured.
 */
export function isProviderConfigured(providerId, connections = [], provider = null) {
  if (provider?.noAuth === true) return true;
  return Array.isArray(connections)
    ? connections.some((connection) => connection?.provider === providerId)
    : false;
}
