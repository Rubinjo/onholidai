import "server-only";

import {
  createProviderTransactionAdapter,
  type ProviderTransactionAdapter,
  type ProviderTransactionClient,
} from "@/server/supply/transactions";

export function createNuiteeTransactionAdapter(
  client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return createProviderTransactionAdapter("nuitee", client);
}
