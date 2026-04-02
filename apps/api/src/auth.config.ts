import { createAuthRuntime } from "./auth";
import { createApiDatabase } from "./db/index";
import { readApiEnv } from "./lib/env";

const env = readApiEnv(process.env, { strict: true });
const db = createApiDatabase(env);

export const auth = createAuthRuntime(env, db).auth;
