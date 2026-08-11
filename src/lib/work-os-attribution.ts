export interface ProviderAttributionAccount {
  personId?: string | null;
  verified?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderAttributionDecision {
  personId: string | null;
  method: "verified_provider_account" | "unattributed";
  confidence: number;
}

function isAmbiguous(account: ProviderAttributionAccount) {
  const metadata = account.metadata ?? {};
  return metadata.shared === true ||
    metadata.shared_account === true ||
    metadata.ambiguous === true ||
    metadata.identity_status === "ambiguous";
}

export function resolveProviderAttribution(account: ProviderAttributionAccount | null | undefined): ProviderAttributionDecision {
  if (!account?.verified || !account.personId || isAmbiguous(account)) {
    return { personId: null, method: "unattributed", confidence: 0 };
  }
  return { personId: account.personId, method: "verified_provider_account", confidence: 1 };
}
