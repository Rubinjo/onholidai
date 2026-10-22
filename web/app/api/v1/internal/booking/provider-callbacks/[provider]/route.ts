import { z } from "zod";

import { apiResponse } from "@/server/api";
import { ProblemError } from "@/server/errors";
import { processProviderCallback } from "@/server/supply/callbacks";

const providerSchema = z.enum(["duffel", "booking", "getyourguide", "trainline"]);
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  return apiResponse(
    request,
    async (application) => {
      const provider = providerSchema.parse((await context.params).provider);
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 262_144) {
        throw new ProblemError({
          title: "Callback payload is too large",
          status: 413,
          code: "body_too_large",
        });
      }
      return processProviderCallback(
        application.database,
        provider,
        rawBody,
        request.headers.get("x-provider-signature"),
      );
    },
    { status: 202 },
  );
}
