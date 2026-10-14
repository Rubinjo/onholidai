import { bookingApiResponse, browserUser } from "@/server/api";
import { ProblemError } from "@/server/errors";
import { bookingTermsSchema, projectBookingTerms } from "@/domain/booking/authorization";

export async function GET(request: Request, context: { params: Promise<{ workflowId: string }> }): Promise<Response> {
  return bookingApiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    const { workflowId } = await context.params;
    const record = await application.database.selectFrom("bookingRevalidations").selectAll()
      .where("workflowId", "=", workflowId).where("ownerUserId", "=", user.id).executeTakeFirst();
    if (!record) throw new ProblemError({ title: "Revalidation not found", status: 404, code: "booking_revalidation_not_found" });
    const terms = record.terms ? projectBookingTerms(bookingTermsSchema.parse(record.terms)) : null;
    return { workflowId, tripId: record.tripId, tripVersion: record.tripVersion, status: record.status,
      outcomes: record.outcomes, termsHash: record.termsHash, terms, expiresAt: record.expiresAt?.toISOString() ?? null };
  });
}
