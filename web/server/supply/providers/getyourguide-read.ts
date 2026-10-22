import { createReadAdapter, type ReadOfferClient } from "./adapter";

export function createGetYourGuideReadProvider(client: ReadOfferClient) {
  return createReadAdapter("getyourguide", "activity", client);
}
