import type { AdminTableQuery } from "@/types/admin";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function AdminFilters({
  query,
  search,
  status,
  statuses = [],
  dateRange = false,
  filters = [],
  hideSearch = false,
}: {
  query?: AdminTableQuery;
  search?: string;
  status?: string;
  statuses?: Array<{ value: string; label: string }>;
  dateRange?: boolean;
  hideSearch?: boolean;
  filters?: Array<{ name: string; label: string; value?: string; allowAll?: boolean; options: Array<{ value: string; label: string }> }>;
}) {
  return (
    <form className={`grid gap-3 border-b border-border p-4 ${hideSearch ? "md:grid-cols-[minmax(0,1fr)_auto]" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]"}`} method="get">
      {Object.entries(query?.params ?? {}).filter(([key]) => key !== "page" && !filters.some(filter => filter.name === key) && !(dateRange && ["from", "to"].includes(key))).map(([key, value]) => <input key={key} name={key} type="hidden" value={value} />)}
      <FieldGroup className="contents">
        {!hideSearch ? <Field>
          <FieldLabel htmlFor="admin-search">Поиск</FieldLabel>
          <Input defaultValue={search} id="admin-search" name="search" placeholder="Заголовок, имя или задача" />
        </Field> : null}
        {statuses.length ? (
          <Field>
            <FieldLabel htmlFor="admin-status">Состояние</FieldLabel>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={status ?? "all"}
              id="admin-status"
              name="status"
            >
              <option value="all">Все</option>
              {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
        ) : hideSearch ? null : <span />}
        {dateRange ? <>
          <Field><FieldLabel htmlFor="admin-from">С даты (UTC)</FieldLabel><Input defaultValue={query?.from} id="admin-from" name="from" type="date" /></Field>
          <Field><FieldLabel htmlFor="admin-to">По дату (UTC)</FieldLabel><Input defaultValue={query?.to} id="admin-to" name="to" type="date" /></Field>
        </> : null}
        {filters.map(filter => <Field key={filter.name}>
          <FieldLabel htmlFor={`admin-${filter.name}`}>{filter.label}</FieldLabel>
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={filter.value ?? ""} id={`admin-${filter.name}`} name={filter.name}>
            {filter.allowAll !== false ? <option value="">Все</option> : null}{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>)}
      </FieldGroup>
      <Button className="self-end" type="submit" variant="secondary">
        <Search aria-hidden="true" data-icon="inline-start" />
        {hideSearch ? "Показать" : "Найти"}
      </Button>
    </form>
  );
}
