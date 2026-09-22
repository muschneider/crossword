import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Neon's HTTP driver: no connection pool to leak, works on both the Node.js and
 * the Edge runtime, and is the cheapest option for Vercel's free tier
 * (one round-trip per query, no idle connections).
 *
 * Multi-statement atomicity is available through `db.batch([...])`.
 */
const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export { schema };
