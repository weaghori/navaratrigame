import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { Prisma, PrismaClient as MongoClient } from "../generated/mongodb-migration-client/index.js";
import { isR2Configured, readR2Object, r2MediaReferenceForKey, verifyR2Object } from "../app/services/r2.server.js";
import { uploadMedia } from "../app/services/storage.server.js";

type MediaReference = { model: "Submission" | "Level"; id: string; field: string; value: string };
type CompletedItem = { key: string; size: number; contentType: string; contentSha256: string; status: "completed" };
type Report = { version: 1; files: Record<string, CompletedItem>; errors: Record<string, string> };

const mongo = new MongoClient();
let reportPath = "";

async function loadLocalEnv(): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(resolve(".env"), "utf8");
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

async function findPsql(): Promise<string> {
  const configured = process.env.PSQL_PATH?.trim();
  if (configured) return configured;
  if (process.platform === "win32") {
    for (const version of ["18", "17", "16", "15", "14"]) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${version}\\bin\\psql.exe`;
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Check the next common installation path.
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
    PGAPPNAME: "navratri-postgres-to-r2-media-migration",
  };
}

function redactDiagnostic(value: string, environment: NodeJS.ProcessEnv): string {
  let output = value;
  for (const secret of [environment.PGPASSWORD, environment.PGUSER]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE URL REDACTED]").slice(0, 800);
}

async function readSourceMediaReferences(): Promise<MediaReference[]> {
  const environment = postgresEnvironment();
  const psqlPath = await findPsql();
  const sql = `
    SELECT jsonb_build_object('model','Submission','field','fileUrl','id',id,'value',"fileUrl")::text
    FROM public."Submission" WHERE "fileUrl" IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('model','Level','field',media.field,'id',level.id,'value',media.value)::text
    FROM public."Level" AS level
    CROSS JOIN LATERAL (VALUES
      ('imageUrl', level.config->>'imageUrl'),
      ('productImageUrl', level.config->>'productImageUrl'),
      ('audioUrl', level.config->>'audioUrl')
    ) AS media(field,value)
    WHERE media.value IS NOT NULL
  `;

  return new Promise<MediaReference[]>((resolvePromise, rejectPromise) => {
    const child = spawn(psqlPath, ["-X", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-c", sql], {
      env: environment,
      windowsHide: true,
    });
    const references: MediaReference[] = [];
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
            const value = JSON.parse(line) as MediaReference;
            if ((value.model !== "Submission" && value.model !== "Level") || !value.id || !value.field || typeof value.value !== "string") {
              throw new Error("PostgreSQL returned a malformed media reference.");
            }
            references.push(value);
          } catch (error) {
            parseError = error instanceof Error ? error : new Error("Could not parse PostgreSQL media references.");
            child.kill();
            return;
          }
        }
        newline = pending.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => rejectPromise(new Error(`Could not start psql: ${error.message}`)));
    child.on("close", (code) => {
      if (parseError) return rejectPromise(parseError);
      if (code !== 0) return rejectPromise(new Error(`PostgreSQL media manifest read failed: ${redactDiagnostic(stderr || `psql exited with code ${code}`, environment)}`));
      try {
        if (pending.trim()) references.push(JSON.parse(pending.trim()) as MediaReference);
        resolvePromise(references);
      } catch {
        rejectPromise(new Error("Could not parse the final PostgreSQL media reference."));
      }
    });
  });
}

async function loadReport(): Promise<Report> {
  try {
    const parsed: unknown = JSON.parse(await readFile(reportPath, "utf8"));
    if (parsed && typeof parsed === "object" && "version" in parsed && parsed.version === 1 && "files" in parsed && "errors" in parsed) {
      return parsed as Report;
    }
    throw new Error("The R2 migration report has an unsupported format.");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: 1, files: {}, errors: {} };
    }
    throw error;
  }
}

async function saveReport(report: Report): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function canonicalSource(value: string): string | null {
  if (value.startsWith("data:")) return value;
  try {
    const source = new URL(value);
    // Only migrate Supabase Storage objects. This prevents fetching arbitrary
    // admin-configured URLs and avoids SSRF through this migration.
    if (!source.hostname.endsWith(".supabase.co") || !source.pathname.includes("/storage/v1/object/")) return null;
    return `${source.origin}${source.pathname}`;
  } catch {
    return null;
  }
}

function sourceHash(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

function fileNameForSource(value: string, contentType: string): string {
  if (!value.startsWith("data:")) {
    try {
      const path = decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
      if (path && path.length <= 120) return path;
    } catch {
      // Fall through to a MIME-derived name.
    }
  }
  const [category, subtype = "bin"] = contentType.toLowerCase().split("/");
  const extension = subtype.includes("mpeg") ? "mp3" : subtype.replace(/^x-/, "").replace(/[^a-z0-9]/g, "").slice(0, 10) || "bin";
  return `migrated-${category || "media"}.${extension}`;
}

async function readSource(value: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0) throw new Error("Malformed inline media data URI.");
    const metadata = value.slice(5, comma);
    const body = value.slice(comma + 1);
    const buffer = metadata.endsWith(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
    if (buffer.byteLength === 0 || buffer.byteLength > 100 * 1024 * 1024) throw new Error("Inline media size is outside the supported migration range.");
    return { contentType: metadata.split(";")[0] || "application/octet-stream", buffer };
  }
  const response = await fetch(value, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Supabase source download failed (HTTP ${response.status}).`);
  const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > 100 * 1024 * 1024) throw new Error("Source media size is outside the supported migration range.");
  return { buffer, contentType };
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownError";
  const candidate = error as { name?: unknown; code?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const code = candidate.Code || candidate.code || candidate.name || candidate.$metadata?.httpStatusCode;
  return typeof code === "string" || typeof code === "number" ? String(code).slice(0, 80) : "UnknownError";
}

async function migrateFile(value: string, report: Report): Promise<string> {
  const canonical = canonicalSource(value);
  if (!canonical) throw new Error("Source is not an eligible Supabase or inline media URL.");
  const hash = sourceHash(canonical);
  const media = await readSource(value);
  const inputHash = createHash("sha256").update(media.buffer).digest("hex");
  const previous = report.files[hash];
  if (previous && previous.contentSha256 === inputHash && await verifyR2Object(previous.key, previous.size)) {
    const existing = await readR2Object(previous.key);
    if (createHash("sha256").update(existing).digest("hex") === inputHash) return r2MediaReferenceForKey(previous.key);
  }

  const uploaded = await uploadMedia({
    fileName: fileNameForSource(value, media.contentType),
    buffer: media.buffer,
    contentType: media.contentType,
    folder: "legacy-media",
  });
  if (uploaded.provider !== "r2") throw new Error("Cloudflare R2 was not used for the upload.");
  if (!(await verifyR2Object(uploaded.path, uploaded.size))) throw new Error("Uploaded R2 object size verification failed.");

  const stored = await readR2Object(uploaded.path);
  const storedHash = createHash("sha256").update(stored).digest("hex");
  const keyHash = uploaded.path.split("/").pop()?.split(".")[0];
  if (storedHash !== keyHash) throw new Error("Uploaded R2 object content hash verification failed.");
  if (media.contentType.startsWith("image/") && (stored[0] !== 0x52 || stored.subarray(8, 12).toString("ascii") !== "WEBP")) {
    throw new Error("Uploaded image is not a verified WebP object.");
  }

  report.files[hash] = { key: uploaded.path, size: stored.byteLength, contentType: uploaded.contentType, contentSha256: storedHash, status: "completed" };
  delete report.errors[hash];
  await saveReport(report);
  return uploaded.url;
}

async function updateMongoReference(reference: MediaReference, expectedValue: string, replacement: string, previousReplacements: string[] = []): Promise<void> {
  if (reference.model === "Submission") {
    const current = await mongo.submission.findUnique({ where: { id: reference.id }, select: { fileUrl: true } });
    if (!current) throw new Error("Submission was not found in MongoDB.");
    if (current.fileUrl === replacement) return;
    if (current.fileUrl !== expectedValue && !previousReplacements.includes(current.fileUrl || "")) throw new Error("Submission media reference changed after database migration.");
    await mongo.submission.update({ where: { id: reference.id }, data: { fileUrl: replacement } });
    return;
  }

  const level = await mongo.level.findUnique({ where: { id: reference.id }, select: { config: true } });
  if (!level?.config || typeof level.config !== "object" || Array.isArray(level.config)) throw new Error("Level media configuration is missing or invalid in MongoDB.");
  const config = { ...(level.config as Record<string, unknown>) };
  if (config[reference.field] === replacement) return;
  if (config[reference.field] !== expectedValue && !previousReplacements.includes(String(config[reference.field] || ""))) throw new Error("Level media reference changed after database migration.");
  config[reference.field] = replacement;
  await mongo.level.update({ where: { id: reference.id }, data: { config: config as Prisma.InputJsonValue } });
}

function previousR2UrlForKey(key: string): string | undefined {
  const previousBase = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!previousBase) return undefined;
  return `${previousBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function previousAppUrlForKey(key: string): string {
  const url = new URL("/api/media", "http://localhost:3000");
  url.searchParams.set("key", key);
  return url.toString();
}

function isEligible(canonical: string | null): canonical is string {
  return canonical !== null;
}

async function main(): Promise<void> {
  await loadLocalEnv();
  reportPath = resolve(process.env.R2_MEDIA_MIGRATION_REPORT || ".migration-state/supabase-to-r2.json");
  if (!isR2Configured()) throw new Error("Configure all R2 environment variables before migrating files.");
  const references = await readSourceMediaReferences();
  const report = await loadReport();
  const distinct = new Map<string, { value: string; count: number }>();
  let skipped = 0;
  for (const reference of references) {
    const canonical = canonicalSource(reference.value);
    if (!isEligible(canonical)) { skipped += 1; continue; }
    const source = distinct.get(canonical) || { value: reference.value, count: 0 };
    source.count += 1;
    distinct.set(canonical, source);
  }

  if (process.env.R2_MEDIA_DRY_RUN === "1") {
    const types = { inline: 0, supabase: 0 };
    for (const source of distinct.values()) {
      if (source.value.startsWith("data:")) types.inline += 1;
      else types.supabase += 1;
    }
    console.info(`R2 media dry run: ${references.length} references, ${distinct.size} eligible unique sources (${types.inline} inline, ${types.supabase} Supabase), ${skipped} non-Supabase external references skipped; no uploads or MongoDB changes.`);
    return;
  }

  await mongo.$connect();
  try {
    const urlMap = new Map<string, string>();
    for (const reference of references) {
      const canonical = canonicalSource(reference.value);
      if (!canonical) continue;
      const hash = sourceHash(canonical);
      try {
        let replacement = urlMap.get(canonical);
        if (!replacement) {
          replacement = await migrateFile(reference.value, report);
          urlMap.set(canonical, replacement);
        }
        const previousReplacements = report.files[hash]
          ? [previousR2UrlForKey(report.files[hash].key), previousAppUrlForKey(report.files[hash].key)].filter((value): value is string => Boolean(value))
          : [];
        await updateMongoReference(reference, reference.value, replacement, previousReplacements);
        delete report.errors[hash];
        await saveReport(report);
      } catch (error) {
        report.errors[hash] = `Migration failed (${safeErrorCode(error)}).`;
        await saveReport(report);
        console.error(`Media reference migration failed for ${reference.model}.${reference.field}.`, safeErrorCode(error));
      }
    }

    const failed = Object.keys(report.errors).length;
    const verified = Object.values(report.files).filter((file) => file.status === "completed").length;
    console.info(`Supabase/inline media migration finished: ${verified} unique R2 objects verified; ${failed} failed; ${skipped} non-Supabase external references skipped. PostgreSQL and Supabase source files remain unchanged.`);
    if (failed) process.exitCode = 1;
  } finally {
    await mongo.$disconnect();
  }
}

main().catch((error) => {
  console.error("Supabase/inline media migration stopped.", safeErrorCode(error));
  process.exitCode = 1;
}).finally(async () => {
  await mongo.$disconnect();
});
