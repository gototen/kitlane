export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "frozen"
  | "retired"
  | "quota_exceeded"
  | "rate_limited"
  | "payload_too_large"
  | "capability_unavailable"
  | "invalid_name"
  | "name_taken"
  | "name_reserved"
  | "upload_rejected"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  frozen: 423,
  retired: 410,
  quota_exceeded: 413,
  rate_limited: 429,
  payload_too_large: 413,
  capability_unavailable: 501,
  invalid_name: 400,
  name_taken: 409,
  name_reserved: 409,
  upload_rejected: 422,
  internal: 500,
};

export class KitlaneError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "KitlaneError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
  toJSON() {
    return { error: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) };
  }
}

export function badRequest(message: string, details?: unknown): KitlaneError {
  return new KitlaneError("bad_request", message, details);
}
export function forbidden(message = "You do not have permission to do that"): KitlaneError {
  return new KitlaneError("forbidden", message);
}
export function notFound(message = "Not found"): KitlaneError {
  return new KitlaneError("not_found", message);
}
export function unauthenticated(message = "Sign in required"): KitlaneError {
  return new KitlaneError("unauthenticated", message);
}
