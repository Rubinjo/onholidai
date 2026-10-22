import "server-only";
import {
  createProviderTransactionAdapter,
  type ProviderTransactionClient,
  type ProviderTransactionAdapter,
} from "@/server/supply/transactions";

export function createDuffelTransactionAdapter(
  client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return createProviderTransactionAdapter("duffel", client);
}
