import { createReadAdapter, type ReadOfferClient } from "./adapter";
export function createBookingReadProvider(client: ReadOfferClient) { return createReadAdapter("booking.com", "accommodation", client); }
