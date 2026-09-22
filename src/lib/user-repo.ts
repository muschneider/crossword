import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { crosswords, users, words, type UserRole, type UserStatus } from "@/db/schema";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  approvedAt: Date | null;
  lastLoginAt: Date | null;
  wordCount: number;
  crosswordCount: number;
};

export async function listAllUsers(): Promise<AdminUserRow[]> {
  /*
   * Counts come from LEFT JOINs + COUNT(DISTINCT …) rather than correlated
   * subqueries: inside a projection Drizzle renders column references
   * unqualified, so `where words.user_id = users.id` would collapse into
   * `where "user_id" = "id"` and resolve `"id"` to `words.id` (uuid).
   */
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      approvedAt: users.approvedAt,
      lastLoginAt: users.lastLoginAt,
      wordCount: sql<number>`count(distinct ${words.id})::int`,
      crosswordCount: sql<number>`count(distinct ${crosswords.id})::int`,
    })
    .from(users)
    .leftJoin(words, eq(words.userId, users.id))
    .leftJoin(crosswords, eq(crosswords.userId, users.id))
    .groupBy(users.id)
    // Pending accounts float to the top: that is the admin's actual to-do list.
    .orderBy(
      asc(sql`case ${users.status} when 'pending' then 0 when 'approved' then 1 else 2 end`),
      desc(users.createdAt),
    );
}

