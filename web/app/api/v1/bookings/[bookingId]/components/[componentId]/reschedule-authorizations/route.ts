import { apiResponse, browserUser, requestJson } from "@/server/api";
import { authorizeBooking } from "@/domain/booking/authorize";
import { ProblemError } from "@/server/errors";
import { z } from "zod";

const schema = z.object({ requestId: z.uuid(), revalidationId: z.string().min(1).max(256), tripVersion: z.number().int().positive(),
  termsHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgedNonReversibleActions: z.array(z.uuid()).max(32) }).strict();
export async function POST(request: Request, context: { params: Promise<{ bookingId: string; componentId: string }> }): Promise<Response> {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request), { bookingId, componentId } = await context.params;
    const input = schema.parse(await requestJson(request));
    const booking = await application.database.selectFrom("bookingTransactions").select(["tripId", "ownerUserId"])
      .where("id", "=", bookingId).where("ownerUserId", "=", user.id).executeTakeFirst();
    const revalidation = await application.database.selectFrom("bookingRevalidations").selectAll()
      .where("workflowId", "=", input.revalidationId).where("ownerUserId", "=", user.id)
      .where("tripVersion", "=", input.tripVersion).where("termsHash", "=", input.termsHash)
      .where("status", "=", "completed").executeTakeFirst();
    if (!booking || !revalidation || booking.tripId !== revalidation.tripId) {
      throw new ProblemError({ title: "Reschedule terms are unavailable", status: 409, code: "reschedule_terms_stale" });
    }
    const terms = revalidation.terms as { components?: Array<{ componentId?: string }> } | null;
    if (!terms?.components?.some((component) => component.componentId === componentId)) {
      throw new ProblemError({ title: "Reschedule terms do not include this component", status: 409, code: "reschedule_component_mismatch" });
    }
    return authorizeBooking(application.database, user.id, booking.tripId, { requestId: input.requestId,
      tripVersion: input.tripVersion, termsHash: input.termsHash, operation: "reschedule_component", componentId,
      acknowledgedNonReversibleActions: input.acknowledgedNonReversibleActions });
  });
}
