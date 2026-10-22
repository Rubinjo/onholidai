import { createReadAdapter, type ReadOfferClient } from "./adapter";

export { createDuffelStaysHttpClient, type DuffelStaysHttpOptions } from "./duffel-stays-http";

export function createDuffelStaysReadProvider(client: ReadOfferClient) {
  return createReadAdapter("duffel", "accommodation", client);
}
