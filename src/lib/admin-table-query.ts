import type { AdminTableQuery } from "../types/admin.ts";

type SearchParams = Record<string, string | string[] | undefined>;
const preservedKeys = ["tab", "sort", "pageSize", "from", "to", "provider", "currency", "season", "promptKey"];
const read = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export function parseAdminTableQuery(params: SearchParams, options: { pageSize?: number; maxPageSize?: number } = {}): AdminTableQuery {
  const max = options.maxPageSize ?? 100;
  const requested = read(params.pageSize);
  const size = Number(requested);
  const pageSize = requested && Number.isInteger(size) && size > 0
    ? Math.max(10, Math.min(size, max)) : options.pageSize ?? 25;
  const page = Number(read(params.page));
  const clean = (value: string) => value.replace(/[^a-z0-9_.-]/gi, "").slice(0, 80) || undefined;
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : undefined;
  return {
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 2_147_483_647) : 1,
    pageSize,
    search: read(params.search).trim().replace(/\s+/g, " ").slice(0, 80),
    status: clean(read(params.status)),
    sort: clean(read(params.sort)),
    from: date(read(params.from)),
    to: date(read(params.to)),
    params: Object.fromEntries(preservedKeys.flatMap((key) => read(params[key]) ? [[key, read(params[key]).slice(0, 120)]] : [])),
  };
}

export function adminSearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

export function adminSearchOperator(search: string) {
  // PostgREST treats every '*' in ILIKE as '%', even inside quoted values.
  return search.includes("*") ? "imatch" : "ilike";
}

export function adminSearchValue(search: string) {
  return search.includes("*")
    ? search.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
    : adminSearchPattern(search);
}

export function adminSearchFilter(columns: string[], search: string) {
  const value = JSON.stringify(adminSearchValue(search));
  return columns.map((column) => `${column}.${adminSearchOperator(search)}.${value}`).join(",");
}

export function makeAdminPageHref(pathname: string, page: number, query: Partial<AdminTableQuery> = {}) {
  const params = new URLSearchParams(query.params);
  params.set("page", String(page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.status && query.status !== "all") params.set("status", query.status);
  return `${pathname}?${params.toString()}`;
}

export async function readAdminPage<T>(request: { range: (from: number, to: number) => PromiseLike<T> }, query: AdminTableQuery): Promise<T> {
  const countResult = await request.range(0, 0) as T & { count: number | null; error: { message: string } | null };
  if (countResult.error) return countResult;
  const pages = Math.max(1, Math.ceil((countResult.count ?? 0) / query.pageSize));
  query.page = Math.min(query.page, pages);
  return await request.range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
}

export async function readAllAdminRows<Row>(request: { range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }> }) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const result = await request.range(offset, offset + 999);
    if (result.error) return { data: rows, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1_000) return { data: rows, error: null };
  }
}
