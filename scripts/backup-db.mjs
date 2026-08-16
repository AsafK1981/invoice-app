#!/usr/bin/env node
/**
 * Nightly off-platform backup of the production Supabase project.
 *
 * Why this exists: the Supabase org is on the free plan, which has NO automatic
 * backups (verified 2026-08-16: GET /database/backups -> pitr_enabled:false,
 * backups:[]). Until this script existed there was no copy of the production
 * data anywhere outside Supabase. See docs/restore-runbook.md for how to
 * bring a backup back to life.
 *
 * Modes
 *   node scripts/backup-db.mjs                 -> produce an encrypted archive
 *   node scripts/backup-db.mjs --verify <dir> -> restore-check an unpacked
 *                                                 backup dir against a scratch
 *                                                 Postgres (VERIFY_DB_URL)
 *
 * What a backup contains (inside <name>.tar.gz.enc):
 *   db.dump         pg_dump custom format, schemas public + auth + storage
 *                   (data + DDL + functions + triggers + RLS policies)
 *   schema.sql      the same DDL as plain SQL, for humans / any Postgres
 *   public-data.sql plain COPY data of the public schema (format-independent
 *                   fallback if pg_restore is ever unavailable)
 *   storage/<bucket>/<path>  every object of every Storage bucket
 *   manifest.json   row count of every table, object counts, sizes, git sha
 *
 * Encryption: openssl enc -aes-256-cbc -pbkdf2 with BACKUP_PASSPHRASE.
 * Without the passphrase the archive is noise. The passphrase lives in the
 * repo's Actions secrets, in .env.local, and in Asaf's password manager.
 *
 * Env (production run):
 *   SUPABASE_DB_URL             postgres:// URL through the session pooler (port 5432)
 *   BACKUP_PASSPHRASE           symmetric key for the archive
 *   NEXT_PUBLIC_SUPABASE_URL    for Storage download
 *   SUPABASE_SERVICE_ROLE_KEY   for Storage download
 *   BACKUP_OUT_DIR              optional, default ./backup-out
 *   GIT_SHA                     optional, recorded in the manifest
 * Env (--verify):
 *   VERIFY_DB_URL               a throwaway Postgres to restore into
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Client } = pg;

// Supabase's pooler presents a chain rooted in Supabase's own CA (not a public
// one), so we pin that root instead of disabling verification. Extracted from
// the live chain 2026-08-16 (Supabase Root 2021 CA, valid to 2031-04-26,
// sha256 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA).
const SUPABASE_CA_PATH = fileURLToPath(new URL("./supabase-root-2021-ca.crt", import.meta.url));
const SUPABASE_CA = fs.readFileSync(SUPABASE_CA_PATH, "utf8");
const isSupabase = (url) => /\.supabase\.(com|co)[:/]/.test(url);
// libpq (pg_dump) reads these; verify-full = verify chain AND hostname.
const PG_ENV = { ...process.env, PGSSLMODE: "verify-full", PGSSLROOTCERT: SUPABASE_CA_PATH };

// ---------- helpers ----------
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const die = (msg) => {
  console.error("✗ " + msg);
  process.exit(1);
};
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stderr?.slice(-4000)}`);
  }
  return r.stdout;
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) die(`${name} is not set`);
  return v;
}
function bytesHuman(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
// Tables we count. Everything in public + the two non-public tables that
// matter for a restore. Kept as a query so a new table is picked up
// automatically without editing this file.
const COUNT_QUERY = `
  select n.nspname as schema, c.relname as table
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and (n.nspname = 'public'
         or (n.nspname = 'auth' and c.relname in ('users','identities','mfa_factors'))
         or (n.nspname = 'storage' and c.relname in ('buckets','objects')))
  order by 1, 2`;

async function countRows(dbUrl) {
  const client = new Client({
    connectionString: dbUrl,
    ssl: isSupabase(dbUrl) ? { ca: SUPABASE_CA, rejectUnauthorized: true } : undefined,
  });
  await client.connect();
  try {
    const { rows } = await client.query(COUNT_QUERY);
    const counts = {};
    for (const r of rows) {
      const key = `${r.schema}.${r.table}`;
      const res = await client.query(`select count(*)::bigint as n from ${quoteIdent(r.schema)}.${quoteIdent(r.table)}`);
      counts[key] = Number(res.rows[0].n);
    }
    return counts;
  } finally {
    await client.end();
  }
}
const quoteIdent = (s) => '"' + s.replace(/"/g, '""') + '"';

// ---------- storage download ----------
async function downloadAllStorage(destRoot) {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw new Error("listBuckets: " + error.message);
  const summary = {};
  for (const b of buckets) {
    let files = 0;
    let bytes = 0;
    const walk = async (prefix) => {
      let offset = 0;
      for (;;) {
        const { data, error } = await sb.storage.from(b.name).list(prefix, { limit: 1000, offset });
        if (error) throw new Error(`list ${b.name}/${prefix}: ${error.message}`);
        if (!data?.length) break;
        for (const entry of data) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.id === null) {
            // folder
            await walk(rel);
            continue;
          }
          const { data: blob, error: dlErr } = await sb.storage.from(b.name).download(rel);
          if (dlErr) throw new Error(`download ${b.name}/${rel}: ${dlErr.message}`);
          const buf = Buffer.from(await blob.arrayBuffer());
          const dest = path.join(destRoot, b.name, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buf);
          files++;
          bytes += buf.length;
        }
        if (data.length < 1000) break;
        offset += data.length;
      }
    };
    await walk("");
    summary[b.name] = { files, bytes, public: !!b.public };
    log(`  storage/${b.name}: ${files} files, ${bytesHuman(bytes)}`);
  }
  return summary;
}

// ---------- backup ----------
async function backup() {
  const dbUrl = requireEnv("SUPABASE_DB_URL");
  const passphrase = requireEnv("BACKUP_PASSPHRASE");
  const outRoot = path.resolve(process.env.BACKUP_OUT_DIR || "backup-out");
  const stamp = new Date().toISOString().replace(/[:]/g, "").replace(/\.\d{3}Z$/, "Z"); // 2026-08-16T230000Z
  const name = `invoice-app-${stamp}`;
  const work = path.join(outRoot, name);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  log(`pg_dump -> ${name}/db.dump`);
  const schemas = ["-n", "public", "-n", "auth", "-n", "storage"];
  run("pg_dump", ["-Fc", "--no-owner", "--no-privileges", ...schemas, "-f", path.join(work, "db.dump"), dbUrl], { env: PG_ENV });
  log("pg_dump schema-only -> schema.sql");
  run("pg_dump", ["-Fp", "--schema-only", "--no-owner", "--no-privileges", ...schemas, "-f", path.join(work, "schema.sql"), dbUrl], { env: PG_ENV });
  log("pg_dump public data -> public-data.sql");
  run("pg_dump", ["-Fp", "--data-only", "--no-owner", "-n", "public", "-f", path.join(work, "public-data.sql"), dbUrl], { env: PG_ENV });

  log("counting rows");
  const tables = await countRows(dbUrl);

  log("downloading storage objects");
  const storage = await downloadAllStorage(path.join(work, "storage"));

  const manifest = {
    name,
    createdAt: new Date().toISOString(),
    gitSha: process.env.GIT_SHA || null,
    projectRef: "ddrlnwwuzehatjfachgu",
    region: "eu-west-2",
    postgresVersion: run("pg_dump", ["--version"]).trim(),
    tables,
    storage,
    files: {
      "db.dump": fs.statSync(path.join(work, "db.dump")).size,
      "schema.sql": fs.statSync(path.join(work, "schema.sql")).size,
      "public-data.sql": fs.statSync(path.join(work, "public-data.sql")).size,
    },
  };
  fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2));

  log("tar + encrypt");
  const tgz = path.join(outRoot, `${name}.tar.gz`);
  run("tar", ["-czf", tgz, "-C", outRoot, name]);
  const enc = `${tgz}.enc`;
  run("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-pass", "env:BACKUP_PASSPHRASE", "-in", tgz, "-out", enc], {
    env: { ...process.env, BACKUP_PASSPHRASE: passphrase },
  });
  fs.rmSync(tgz);
  fs.rmSync(work, { recursive: true, force: true });

  const size = fs.statSync(enc).size;
  const summary = {
    ok: true,
    archive: enc,
    name,
    bytes: size,
    tables: Object.keys(tables).length,
    rows: Object.values(tables).reduce((a, b) => a + b, 0),
    storageFiles: Object.values(storage).reduce((a, b) => a + b.files, 0),
    manifest,
  };
  fs.writeFileSync(path.join(outRoot, `${name}.manifest.json`), JSON.stringify(manifest, null, 2));
  log(`✓ ${path.basename(enc)} (${bytesHuman(size)}) - ${summary.tables} tables, ${summary.rows} rows, ${summary.storageFiles} storage files`);
  console.log("BACKUP_SUMMARY " + JSON.stringify({ ...summary, manifest: undefined }));
  // For GitHub Actions step outputs
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `archive=${enc}\nname=${name}\nbytes=${size}\nrows=${summary.rows}\nstorage_files=${summary.storageFiles}\n`);
  }
}

// ---------- verify (restore into a scratch DB and compare counts) ----------
async function verify(dir) {
  const verifyUrl = requireEnv("VERIFY_DB_URL");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const dump = path.join(dir, "db.dump");
  if (!fs.existsSync(dump)) die("db.dump missing in " + dir);

  const admin = new Client({ connectionString: verifyUrl });
  await admin.connect();
  // Roles referenced by policies / grants in the dump. Restore would fail
  // noisily without them; they carry no privileges here.
  for (const role of ["anon", "authenticated", "service_role", "supabase_admin", "supabase_auth_admin", "supabase_storage_admin", "dashboard_user", "postgres"]) {
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$;`);
  }
  await admin.query("create extension if not exists pgcrypto");
  await admin.query("create extension if not exists \"uuid-ossp\"");
  await admin.query("create schema if not exists extensions");
  await admin.query("create schema if not exists auth");
  await admin.query("create schema if not exists storage");
  await admin.end();

  // pg_restore in two passes: DDL first, then data with triggers disabled so
  // immutability triggers and FK ordering can't reject legitimate rows.
  // Non-fatal errors (a missing extension function in a default, a GRANT to
  // an unknown role) are tolerated: correctness is judged by the row counts.
  const common = ["--no-owner", "--no-privileges", "-d", verifyUrl];
  const r1 = spawnSync("pg_restore", ["--schema-only", ...common, dump], { encoding: "utf8" });
  const r2 = spawnSync("pg_restore", ["--data-only", "--disable-triggers", ...common, dump], { encoding: "utf8" });
  const errLines = (r1.stderr + r2.stderr).split("\n").filter((l) => /error/i.test(l));
  log(`pg_restore: ${errLines.length} error lines (tolerated, judged by counts)`);
  if (errLines.length) console.log(errLines.slice(0, 40).join("\n"));

  const restored = await countRows(verifyUrl);
  const mismatches = [];
  for (const [table, expected] of Object.entries(manifest.tables)) {
    const got = restored[table];
    if (got !== expected) mismatches.push(`${table}: expected ${expected}, restored ${got ?? "MISSING"}`);
  }
  // Storage files on disk vs manifest
  const storageMismatch = [];
  for (const [bucket, info] of Object.entries(manifest.storage)) {
    const p = path.join(dir, "storage", bucket);
    const n = fs.existsSync(p) ? countFiles(p) : 0;
    if (n !== info.files) storageMismatch.push(`${bucket}: expected ${info.files} files, found ${n}`);
  }
  if (mismatches.length || storageMismatch.length) {
    console.error("✗ RESTORE VERIFY FAILED\n" + [...mismatches, ...storageMismatch].join("\n"));
    process.exit(2);
  }
  const rows = Object.values(restored).reduce((a, b) => a + b, 0);
  log(`✓ restore verified: ${Object.keys(manifest.tables).length} tables, ${rows} rows match; storage files match`);
}
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

// ---------- main ----------
const args = process.argv.slice(2);
try {
  if (args[0] === "--verify") {
    if (!args[1]) die("usage: backup-db.mjs --verify <unpacked-backup-dir>");
    await verify(path.resolve(args[1]));
  } else {
    await backup();
  }
} catch (e) {
  die(e.message || String(e));
}
