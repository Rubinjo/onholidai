import { createReadAdapter, type ReadOfferClient } from "./adapter";
export { createDuffelFlightsHttpClient, createDuffelHttpClient, type DuffelFlightsHttpOptions } from "./duffel-http";
export function createDuffelReadProvider(client: ReadOfferClient) { return createReadAdapter("duffel", "flight", client); }
