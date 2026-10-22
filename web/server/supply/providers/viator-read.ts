import { createReadAdapter, type ReadOfferClient } from "./adapter";

export { createViatorHttpClient, type ViatorHttpOptions } from "./viator-http";

export function createViatorReadProvider(client: ReadOfferClient) {
  return createReadAdapter("viator", "activity", client);
}
