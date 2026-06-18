import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { isTenantContextError } from "@/server/db/errors";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorJson(
  status: number,
  code: string,
  message: string,
  details: unknown = {},
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );
}

export async function parseJsonBody<TSchema extends ZodType>(
  request: Request,
  schema: TSchema,
): Promise<TSchema["_output"]> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "VALIDATION", "Request body must be valid JSON.");
  }

  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(
        400,
        "VALIDATION",
        "Request body validation failed.",
        error.flatten(),
      );
    }

    throw error;
  }
}

export function routeErrorToResponse(error: unknown) {
  if (error instanceof ApiError) {
    return errorJson(error.status, error.code, error.message, error.details);
  }

  if (isTenantContextError(error)) {
    return errorJson(error.status, error.code, error.message);
  }

  console.error(error);

  return errorJson(500, "INTERNAL", "Unexpected server error.");
}
