import { createReadAdapter, type ReadOfferClient } from "./adapter";
export function createDuffelReadProvider(client: ReadOfferClient) { return createReadAdapter("duffel", "flight", client); }
