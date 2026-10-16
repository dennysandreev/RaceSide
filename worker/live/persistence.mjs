import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { eventKey, number } from "./state.mjs";

export function historyRow(topic, row) {
  const common = {
    session_key: Number(row.session_key),
    driver_number: number(row.driver_number),
    timestamp: row.date ?? row.date_start,
  };
  if (!common.timestamp) return null;
  if (topic === "location")
    return {
      table: "live_location",
      row: { ...common, x: number(row.x), y: number(row.y), z: number(row.z) },
    };
  if (topic === "car_data")
    return {
      table: "live_car_data",
      row: {
        ...common,
        speed: number(row.speed),
        throttle: number(row.throttle),
        brake: number(row.brake),
        rpm: number(row.rpm),
        gear: number(row.n_gear),
        drs: number(row.drs),
      },
    };
  // URLs and all audio are deliberately excluded from both DB and durable spool.
  if (topic === "team_radio") return null;
  return {
    table: "live_events",
    row: { ...common, id: eventKey(topic, row), topic, payload: row },
  };
}
function liveUsageRecord(payload, model, purpose) {
  const usage = payload?.usage ?? {};
  return {
    table: "ai_usage_logs",
    row: {
      id: randomUUID(),
      purpose,
      provider: "openrouter",
      model,
      input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      output_tokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      estimated_cost_usd: usage.cost ?? null,
    },
  };
}

export class LiveWriter {
  constructor(db, directory) {
    this.db = db;
    this.directory = directory;
    this.pending = [];
    this.healthy = false;
    this.lastWriteAt = null;
  }
  enqueue(topic, row) {
    const record = historyRow(topic, row);
    if (record) this.pending.push(record);
  }
  enqueueUsage(payload, model, purpose) {
    this.pending.push(liveUsageRecord(payload, model, purpose));
  }
  async recordUsage(payload, model, purpose) {
    const record = liveUsageRecord(payload, model, purpose);
    try {
      if (!this.db) throw new Error("Radio accounting unavailable");
      const { error } = await this.db.from(record.table).insert(record.row).abortSignal(AbortSignal.timeout(8_000));
      if (error) throw error;
    } catch (error) {
      // Preserve the same ID for the durable spool, but stop the next paid request.
      this.pending.push(record);
      throw error;
    }
  }
  enqueueRadio(session, radio, cost = 0) {
    this.pending.push({
      table: "live_radio_text",
      row: {
        id: radio.id,
        session_key: session.session_key,
        meeting_key: session.meeting_key,
        driver_number: radio.driverNumber,
        timestamp: radio.timestamp,
        lap: radio.lap,
        original: radio.original,
        ru: radio.ru,
        status: radio.status,
        cost_usd: cost,
      },
    });
  }
  async flush(state) {
    if (this.flight) return this.flight;
    this.flight = this.write(state).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  async drain(state) {
    if (this.flight) await this.flight;
    // Capture records received while an earlier database write was in flight.
    await this.flush(state);
    while (this.db && !this.healthy) await this.flush(state);
  }
  async write(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (this.pending.length && state.session) {
      const records = this.pending.splice(0);
      const filename = `${Date.now()}-${randomUUID()}.json`;
      const safe = structuredClone(state);
      for (const radio of safe.radio) radio.playable = false;
      const packet = {
        session: {
          session_key: state.session.session_key,
          meeting_key: state.session.meeting_key,
          race_id: state.session.race_id ?? null,
          metadata: state.session,
          snapshot: safe,
          updated_at: new Date().toISOString(),
        },
        records,
      };
      try {
        await writeFile(
          join(this.directory, `${filename}.tmp`),
          JSON.stringify(packet),
          { mode: 0o600, flush: true },
        );
        await rename(
          join(this.directory, `${filename}.tmp`),
          join(this.directory, filename),
        );
      } catch (error) {
        this.pending.unshift(...records);
        throw error;
      }
    }
    if (!this.db) return;
    const files = (await readdir(this.directory))
      .filter((x) => x.endsWith(".json"))
      .sort();
    for (const file of files.slice(0, 10)) {
      const packet = JSON.parse(
        await readFile(join(this.directory, file), "utf8"),
      );
      const { error } = await this.db
        .from("live_sessions")
        .upsert(packet.session);
      if (error) throw new Error(`live_sessions ${error.code}`);
      const groups = new Map();
      for (const record of packet.records) {
        if (!groups.has(record.table)) groups.set(record.table, []);
        groups.get(record.table).push(record.row);
      }
      for (const [table, rows] of groups) {
        const key = (r) =>
          r.id ?? `${r.session_key}:${r.driver_number}:${r.timestamp}`;
        const unique = [...new Map(rows.map((r) => [key(r), r])).values()];
        for (let i = 0; i < unique.length; i += 500) {
          const { error: err } = await this.db
            .from(table)
            .upsert(unique.slice(i, i + 500), {
              onConflict: ["live_location", "live_car_data"].includes(table)
                ? "session_key,driver_number,timestamp"
                : "id",
            });
          if (err) throw new Error(`${table} ${err.code}`);
        }
      }
      await unlink(join(this.directory, file));
      this.lastWriteAt = new Date().toISOString();
    }
    this.healthy = files.length <= 10;
  }
}
