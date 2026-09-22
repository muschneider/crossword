import "server-only";

import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { words, type Word } from "@/db/schema";
import { MAX_GRID_LENGTH, MIN_GRID_LENGTH } from "@/lib/words";

export type WordSort = "recent" | "alpha" | "least-used" | "most-used";

export type ListWordsOptions = {
  userId: string;
  search?: string;
  sort?: WordSort;
  page?: number;
  pageSize?: number;
};

export type ListWordsResult = {
  items: Word[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function orderBy(sort: WordSort): SQL[] {
  switch (sort) {
    case "alpha":
      return [asc(words.normalized)];
    case "least-used":
      return [asc(words.usageCount), sql`${words.lastUsedAt} asc nulls first`];
    case "most-used":
      return [desc(words.usageCount), sql`${words.lastUsedAt} desc nulls last`];
    case "recent":
    default:
      return [desc(words.createdAt)];
  }
}

export async function listWords(options: ListWordsOptions): Promise<ListWordsResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 5), 200);
  const search = options.search?.trim();

  const filters = [eq(words.userId, options.userId)];
  if (search) {
    const pattern = `%${search}%`;
    filters.push(or(ilike(words.term, pattern), ilike(words.translation, pattern))!);
  }
  const where = and(...filters);

  const [{ total }] = await db.select({ total: count() }).from(words).where(where);

  const items = await db
    .select()
    .from(words)
    .where(where)
    .orderBy(...orderBy(options.sort ?? "recent"))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type VocabularyStats = {
  total: number;
  usable: number;
  neverUsed: number;
  totalUses: number;
};

/** Aggregated in Postgres so a 10k-word vocabulary never lands in memory. */
export async function getVocabularyStats(userId: string): Promise<VocabularyStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      usable: sql<number>`count(*) filter (
        where length(${words.answer}) between ${MIN_GRID_LENGTH} and ${MAX_GRID_LENGTH}
      )::int`,
      neverUsed: sql<number>`count(*) filter (where ${words.usageCount} = 0)::int`,
      totalUses: sql<number>`coalesce(sum(${words.usageCount}), 0)::int`,
    })
    .from(words)
    .where(eq(words.userId, userId));

  return {
    total: row?.total ?? 0,
    usable: row?.usable ?? 0,
    neverUsed: row?.neverUsed ?? 0,
    totalUses: row?.totalUses ?? 0,
  };
}

