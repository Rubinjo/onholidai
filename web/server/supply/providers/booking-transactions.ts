import "server-only";
import {
  createProviderTransactionAdapter,
  type ProviderTransactionClient,
  type ProviderTransactionAdapter,
} from "@/server/supply/transactions";

export function createBookingTransactionAdapter(
  client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return createProviderTransactionAdapter("booking", client);
}
