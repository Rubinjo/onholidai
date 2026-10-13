import { createReadAdapter, type ReadOfferClient } from "./adapter";
export function createTrainlineReadProvider(client: ReadOfferClient) { return createReadAdapter("trainline", "rail", client); }
