import { z } from "zod";

import { internalActor, planningUser, planningContext } from "@/server/api";

import type { Application } from "@/server/application";
import type { ResearchActor } from "./planning-research";

export function internalResearchActor(
  application: Application,
  request: Request,
  tripId: string,
): ResearchActor {
  const version = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.headers.get("x-base-trip-version"));
  return internalActor(application, request, tripId, version, "trip:read");
}
export async function browserResearchActor(
  application: Application,
  request: Request,
  tripId: string,
): Promise<ResearchActor> {
  const user = await planningUser(application, request);
  const baseTripVersion = z.coerce
    .number()
    .int()
    .positive()
    .parse(new URL(request.url).searchParams.get("version"));
  return {
    userId: user.id,
    tripId,
    baseTripVersion,
    identity: (await planningContext(application, request)).identity,
  };
}
export function requestedOffer(request: Request, offerRef: string) {
  return {
    offerRef,
    revision: z.coerce
      .number()
      .int()
      .positive()
      .parse(new URL(request.url).searchParams.get("revision")),
  };
}
