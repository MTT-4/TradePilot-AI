export class TenantContextError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TenantContextError";
    this.status = status;
    this.code = code;
  }
}

export function isTenantContextError(
  error: unknown,
): error is TenantContextError {
  return error instanceof TenantContextError;
}
