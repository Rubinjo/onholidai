import "server-only";
import {
  createProviderTransactionAdapter,
  type ProviderTransactionClient,
  type ProviderTransactionAdapter,
} from "@/server/supply/transactions";

export function createTrainlineTransactionAdapter(
  client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return createProviderTransactionAdapter("trainline", client);
}
