import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient as MongoClient } from "../generated/mongodb-migration-client/index.js";

type ModelName =
  | "Campaign"
  | "Session"
  | "Level"
  | "CustomerProgress"
  | "PointTransaction"
  | "Submission"
  | "Referral"
  | "Reward"
  | "Winner"
  | "PurchaseVerification"
  | "Notification"
  | "AuditEvent";
type Row = Record<string, unknown> & { id: string };
type RuntimeField = { name: string; type: string };
type MigratableDelegate = {
  count(): Promise<number>;
  findMany(): Promise<Row[]>;
  upsert(args: { where: { id: string }; create: Row; update: Record<string, unknown> }): Promise<unknown>;
};

const MODELS: ModelName[] = [
  "Campaign",
  "Session",
  "Level",
  "CustomerProgress",
  "PointTransaction",
  "Submission",
  "Referral",
  "Reward",
  "Winner",
  "PurchaseVerification",
  "Notification",
  "AuditEvent",
];

function loadLocalEnv(): void {
  let contents: string;
  try {
    contents = requireEnvFile();
  } catch {
    return;
  }

  for (const line of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      if (line.includes('="')) value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    } else {
      value = value.replace(/\s+#.*$/, "").trimEnd();
    }
    process.env[match[1]] = value;
  }
}

function requireEnvFile(): string {
  // readFileSync is intentionally avoided so migration startup stays async.
  return envFileContents;
}

let envFileContents = "";

async function loadEnvFile(): Promise<void> {
  try {
    envFileContents = await readFile(resolve(".env"), "utf8");
  } catch {
    // Environment variables may be supplied directly by the host.
  }
  loadLocalEnv();
}

async function findPsql(): Promise<string> {
  const configured = process.env.PSQL_PATH?.trim();
  if (configured) {
    await access(configured);
    return configured;
  }
  if (process.platform === "win32") {
    for (const version of ["18", "17", "16", "15", "14"]) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${version}\\bin\\psql.exe`;
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Check the next common PostgreSQL installation path.
      }
    }
  }
  return "psql";
}

function postgresEnvironment(): NodeJS.ProcessEnv {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL for the PostgreSQL source.");

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The PostgreSQL source URL is malformed.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("The PostgreSQL source URL must use the postgres protocol.");
  }

  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "20",
    PGSSLMODE: url.searchParams.get("sslmode") || "require",
    PGAPPNAME: "navratri-postgres-to-mongodb-migration",
  };
}

function redact(value: string, environment: NodeJS.ProcessEnv): string {
  let output = value;
  for (const secret of [environment.PGPASSWORD, environment.PGUSER]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE URL REDACTED]").slice(0, 800);
}

async function readSourceSnapshot(psqlPath: string, environment: NodeJS.ProcessEnv): Promise<Map<ModelName, Row[]>> {
  const selects = MODELS.map((model) => {
    // PostgreSQL int8 is emitted as a JSON number by default. Keep Shopify's
    // optional session userId as text so JavaScript never rounds a BigInt.
    const document = model === "Session"
      ? `to_jsonb(source_row) || jsonb_build_object('userId', source_row."userId"::text)`
      : "to_jsonb(source_row)";
    return `SELECT '${model}'::text AS model_name, (${document})::text AS row_data FROM public."${model}" AS source_row`;
  });
  const sql = selects.join(" UNION ALL ");
  const rowsByModel = new Map<ModelName, Row[]>(MODELS.map((model) => [model, []]));

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(psqlPath, ["-X", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-F", "\t", "-c", sql], {
      env: environment,
      windowsHide: true,
    });
    let pending = "";
    let stderr = "";
    let parseError: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (parseError) return;
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line) {
          try {
            const separator = line.indexOf("\t");
            if (separator < 1) throw new Error("Malformed psql output row.");
            const model = line.slice(0, separator) as ModelName;
            const rows = rowsByModel.get(model);
            if (!rows) throw new Error("PostgreSQL returned an unexpected model name.");
            rows.push(JSON.parse(line.slice(separator + 1)) as Row);
          } catch (error) {
            parseError = error instanceof Error ? error : new Error("Could not parse PostgreSQL row output.");
            child.kill();
            return;
          }
        }
        newline = pending.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error) => rejectPromise(new Error(`Could not start psql: ${error.message}`)));
    child.on("close", (code) => {
      if (parseError) return rejectPromise(parseError);
      if (code !== 0) return rejectPromise(new Error(`PostgreSQL export failed: ${redact(stderr || `psql exited with code ${code}`, environment)}`));
      try {
        if (pending.trim()) {
          const separator = pending.indexOf("\t");
          if (separator < 1) throw new Error("Malformed final psql output row.");
          const model = pending.slice(0, separator) as ModelName;
          const rows = rowsByModel.get(model);
          if (!rows) throw new Error("PostgreSQL returned an unexpected model name.");
          rows.push(JSON.parse(pending.slice(separator + 1)) as Row);
        }
        resolvePromise();
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error("Could not parse final PostgreSQL row output."));
      }
    });
  });

  return rowsByModel;
}

function modelDelegate(client: MongoClient, model: ModelName): MigratableDelegate {
  const property = `${model[0].toLowerCase()}${model.slice(1)}`;
  return (client as unknown as Record<string, MigratableDelegate>)[property];
}

function convertSourceRows(client: MongoClient, model: ModelName, rows: Row[]): Row[] {
  const runtimeModels = (client as unknown as { _runtimeDataModel: { models: Record<string, { fields: RuntimeField[] }> } })._runtimeDataModel.models;
  const fields = runtimeModels[model]?.fields || [];
  return rows.map((source) => {
    const row = { ...source };
    for (const field of fields) {
      const value = row[field.name];
      if (value === null || value === undefined) continue;
      if (field.type === "DateTime" && typeof value === "string") row[field.name] = new Date(value);
      if (field.type === "BigInt" && typeof value === "string") row[field.name] = BigInt(value);
    }
    return row;
  });
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function rowsMatch(source: Row, target: Row): boolean {
  return Object.keys(source).every((key) => JSON.stringify(canonical(source[key])) === JSON.stringify(canonical(target[key])));
}

async function assertNoTargetConflicts(client: MongoClient, sourceRows: Map<ModelName, Row[]>): Promise<void> {
  for (const model of MODELS) {
    const source = sourceRows.get(model) || [];
    const target = await modelDelegate(client, model).findMany();
    const byId = new Map(source.map((row) => [row.id, row]));
    const unknownIds = target.filter((row) => !byId.has(row.id)).length;
    const conflictingRows = target.filter((row) => {
      const sourceRow = byId.get(row.id);
      return sourceRow && !rowsMatch(sourceRow, row);
    }).length;
    if (unknownIds || conflictingRows) {
      throw new Error(`${model} target contains ${unknownIds} unrelated and ${conflictingRows} conflicting record(s); no records were copied.`);
    }
  }
}

async function createPartialIndexes(client: MongoClient): Promise<void> {
  await client.$runCommandRaw({
    createIndexes: "PointTransaction",
    indexes: [{
      key: { customerProgressId: 1, levelId: 1, transactionType: 1 },
      name: "customerProgressId_levelId_transactionType_partial_unique",
      unique: true,
      partialFilterExpression: { levelId: { $type: "string" } },
    }],
  });
  await client.$runCommandRaw({
    createIndexes: "Reward",
    indexes: [{
      key: { discountCode: 1 },
      name: "discountCode_partial_unique",
      unique: true,
      partialFilterExpression: { discountCode: { $type: "string" } },
    }],
  });
}

async function main(): Promise<void> {
  await loadEnvFile();
  const psqlPath = await findPsql();
  const postgresEnv = postgresEnvironment();
  const sourceRows = await readSourceSnapshot(psqlPath, postgresEnv);
  const mongo = new MongoClient();

  try {
    await mongo.$connect();
    const hello = await mongo.$runCommandRaw({ hello: 1 });
    if (!hello?.setName) throw new Error("MongoDB must support replica-set transactions before migration.");

    await assertNoTargetConflicts(mongo, sourceRows);
    if (process.env.MONGODB_MIGRATION_DRY_RUN === "1") {
      console.info("PostgreSQL → MongoDB dry run; no target records or indexes were changed:");
      for (const model of MODELS) {
        console.info(`${model}: source=${sourceRows.get(model)?.length || 0}, target=${await modelDelegate(mongo, model).count()}`);
      }
      return;
    }

    await createPartialIndexes(mongo);

    const results: Array<{ model: ModelName; source: number; copied: number; target: number; idsAndFieldsMatch: boolean }> = [];
    for (const model of MODELS) {
      const rows = convertSourceRows(mongo, model, sourceRows.get(model) || []);
      const delegate = modelDelegate(mongo, model);
      for (const row of rows) {
        const update: Record<string, unknown> = { ...row };
        delete update.id;
        await delegate.upsert({ where: { id: row.id }, create: row, update });
      }

      const targetRows = await delegate.findMany();
      const targetById = new Map(targetRows.map((row) => [row.id, row]));
      const idsAndFieldsMatch = rows.length === targetRows.length && rows.every((row) => {
        const target = targetById.get(row.id);
        return target !== undefined && rowsMatch(row, target);
      });
      results.push({
        model,
        source: rows.length,
        copied: rows.length,
        target: await delegate.count(),
        idsAndFieldsMatch,
      });
    }

    console.info("PostgreSQL → MongoDB migration verification:");
    for (const result of results) {
      console.info(`${result.model}: source=${result.source}, copied=${result.copied}, target=${result.target}, idsAndFieldsMatch=${result.idsAndFieldsMatch}`);
    }
    if (results.some((result) => result.source !== result.target || !result.idsAndFieldsMatch)) {
      process.exitCode = 1;
    }
  } finally {
    await mongo.$disconnect();
  }
}

main().catch((error) => {
  console.error("PostgreSQL → MongoDB migration stopped.", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
