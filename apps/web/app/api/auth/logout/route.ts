import { auth } from "@/auth";
import { errorJson, routeErrorToResponse } from "@/server/api/errors";
import { destroyUserSession } from "@/server/auth/session";

export const POST = auth(async (request) => {
  try {
    if (!request.auth?.user?.id) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    await destroyUserSession();

    return new Response(null, { status: 204 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
