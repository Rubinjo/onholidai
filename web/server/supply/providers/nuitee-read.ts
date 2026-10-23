import { createReadAdapter, type ReadOfferClient } from "./adapter";

export { createNuiteeHttpClient, type NuiteeHttpOptions } from "./nuitee-http";

export function createNuiteeReadProvider(client: ReadOfferClient) {
  return createReadAdapter("nuitee", "accommodation", client);
}
