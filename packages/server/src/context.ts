import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { RateLimiter } from "./ratelimit.js";
import type { ArtifactStorage } from "./services/storage.js";
import type { Identity } from "./auth/identity.js";
import type { EntryWithNames } from "./types.js";

export interface Services {
  config: Config;
  db: Db;
  storage: ArtifactStorage;
  limiter: RateLimiter;
}

export type Env = {
  Variables: {
    identity: Identity | null;
    entry: EntryWithNames;
  };
};

export function createServices(config: Config, db: Db, storage: ArtifactStorage): Services {
  return { config, db, storage, limiter: new RateLimiter(config.limits.requestsPerMinute) };
}
