import "server-only";
import {
  createProviderTransactionAdapter,
  type ProviderTransactionClient,
  type ProviderTransactionAdapter,
} from "@/server/supply/transactions";

export function createGetYourGuideTransactionAdapter(
  client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return createProviderTransactionAdapter("getyourguide", client);
}
