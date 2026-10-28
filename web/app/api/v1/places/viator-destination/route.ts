import { z } from "zod";

import { apiResponse } from "@/server/api";
import { resolveViatorDestinationId } from "@/server/supply/viator-destinations";

export async function GET(request: Request) {
  return apiResponse(request, async (application) => {
    const name = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(new URL(request.url).searchParams.get("name"));
    if (!application.viatorDestinations) return { destinationId: null };
    const matches = await application.viatorDestinations.candidates(name);
    return { destinationId: resolveViatorDestinationId(name, matches) };
  });
}
