import { KitlaneError } from "./errors.js";

export const NAME_MIN = 2;
export const NAME_MAX = 63;

/** Platform routes and prefixes that can never be claimed as names. */
export const RESERVED_NAMES = new Set([
  "new", "me", "search", "tool", "h", "api", "admin", "auth", "dev", "static", "export", "collection",
  "healthz", "oauth2", "kitlane", "www", "app", "sites", "assets", "login", "logout", "signin", "signout",
  "_releases", "well-known",
]);

/** Normalizes case only. Hyphens are meaningful and preserved. */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

export function validateName(input: string): string {
  const name = normalizeName(input);
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new KitlaneError("invalid_name", `Names must be between ${NAME_MIN} and ${NAME_MAX} characters`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new KitlaneError(
      "invalid_name",
      "Names use lowercase letters, digits, and single internal hyphens (for example: prep, team-docs)",
    );
  }
  if (RESERVED_NAMES.has(name)) {
    throw new KitlaneError("name_reserved", `"${name}" is reserved by the platform`);
  }
  return name;
}

export function isValidName(input: string): boolean {
  try {
    validateName(input);
    return true;
  } catch {
    return false;
  }
}

export const COLLECTION_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DOC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
export const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function validateCollectionName(name: string): string {
  if (!COLLECTION_NAME_RE.test(name)) {
    throw new KitlaneError("bad_request", "Collection names use lowercase letters, digits, hyphens, and underscores (max 64 characters)");
  }
  return name;
}

export function validateDocId(id: string): string {
  if (!DOC_ID_RE.test(id)) {
    throw new KitlaneError("bad_request", "Document IDs use letters, digits, and . _ : @ - (max 128 characters)");
  }
  return id;
}
