// Shared in-memory Set of API keys. Empty on daemon start; no persistence.
export const callers = new Set<string>();
