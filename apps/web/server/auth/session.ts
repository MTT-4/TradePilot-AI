import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { ApiError } from "@/server/api/errors";
import { issueSessionGrant } from "@/server/auth/challenge";

export async function establishUserSession(userId: string, email: string) {
  try {
    const redirectUrl = await signIn("credentials", {
      sessionGrant: issueSessionGrant(userId, email),
      redirect: false,
      redirectTo: "/",
    });

    if (typeof redirectUrl === "string" && redirectUrl.includes("error=")) {
      throw new ApiError(500, "INTERNAL", "Failed to establish session.");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof AuthError) {
      throw new ApiError(500, "INTERNAL", "Failed to establish session.");
    }

    throw error;
  }
}

export async function destroyUserSession() {
  try {
    await signOut({
      redirect: false,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      throw new ApiError(500, "INTERNAL", "Failed to clear session.");
    }

    throw error;
  }
}
