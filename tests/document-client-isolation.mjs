// Local PostgreSQL regression suite. No network, credentials, or production DB.
// Set PGLITE_MODULE to a local PGlite ES module URL, then run with Node.
// PGlite is deliberately not added to the application's dependency tree.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = await read('scripts/migrations/20260908-document-client-isolation.sql');
const base = (await read('supabase-schema.sql')).split('-- Function to atomically')[0];
const db = new PGlite();
let passed = 0;
const check = async (label, fn) => { await fn(); passed++; console.log(`PASS ${label}`); };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const biz = uuid(1), foreignBiz = uuid(2), client = uuid(3), foreignClient = uuid(4);
const doc = uuid(5), owner = uuid(9);
const count = async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const reject = (sql, code) => assert.rejects(db.exec(sql), (error) => error.code === code);
// The delete guard in 20260908-documents-no-delete-once-numbered.sql keys off
// current_user, so these cases have to run under a real role rather than the
// superuser the suite otherwise uses.
const asRole = async (role, fn) => {
  await db.exec(`SET ROLE ${role}`);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
};
const rows = async (sql) => (await db.query(sql)).rows;
try {
  await db.exec(base);
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${owner}'::uuid $$;
    ALTER TABLE businesses ADD COLUMN user_id uuid;
    ALTER TABLE documents
      ADD COLUMN currency text DEFAULT 'ILS', ADD COLUMN exchange_rate numeric DEFAULT 1,
      ADD COLUMN subtotal_ils numeric, ADD COLUMN vat_ils numeric, ADD COLUMN total_ils numeric,
      ADD COLUMN zero_rated boolean DEFAULT false, ADD COLUMN client_tax_id text,
      ADD COLUMN original_document_id uuid, ADD COLUMN rounding numeric DEFAULT 0,
      ADD COLUMN round_total boolean DEFAULT false, ADD COLUMN withholding_rate numeric,
      ADD COLUMN withholding_amount numeric, ADD COLUMN discount_amount numeric,
      ADD COLUMN payment_details jsonb, ADD COLUMN payment_reference text,
      ADD COLUMN emailed_at timestamptz;
  `);
  await db.exec(await read('scripts/migrations/20260906-documents-language.sql'));
  await db.exec(await read('scripts/migrations/20260816-document-items-immutability.sql'));
  // Applied AFTER 20260906 on purpose: both files CREATE OR REPLACE the same
  // enforce_document_immutability(), so whichever runs last is the whole
  // function. This is the real production order, and it is what makes the
  // "language is still frozen" check below a genuine regression guard against
  // 20260908 having been rebuilt from a stale base.
  await db.exec(await read('scripts/migrations/20260908-documents-no-delete-once-numbered.sql'));
  await db.exec(`
    INSERT INTO businesses (id,name,tax_id,user_id) VALUES
      ('${biz}','Synthetic A','000','${owner}'), ('${foreignBiz}','Synthetic B','001','${uuid(10)}');
    INSERT INTO clients (id,business_id,name) VALUES
      ('${client}','${biz}','Synthetic A'), ('${foreignClient}','${foreignBiz}','Synthetic B');
    INSERT INTO documents (id,business_id,client_id,type,number,client_name)
      VALUES ('${doc}','${biz}','${foreignClient}','receipt',1,'Synthetic');
  `);
  await check('legacy mismatch aborts migration without partial DDL', async () => {
    await assert.rejects(db.exec(migration), /preflight failed: 1 invalid references/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'clients_id_business_id_key'")).rows[0].n, 0);
  });
  await db.exec(`UPDATE documents SET client_id='${client}' WHERE id='${doc}'`);
  await check('clean migration and repeat application succeed', async () => {
    await db.exec(migration); await db.exec(migration);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('clients_id_business_id_key','documents_client_requires_business_check','documents_client_business_fkey') AND convalidated")).rows[0].n, 3);
  });
  await check('direct foreign-client INSERT blocked', () => reject(`INSERT INTO documents (business_id,client_id,type,number,client_name) VALUES ('${biz}','${foreignClient}','receipt',2,'Synthetic')`, '23503'));
  await check('direct client reassignment blocked', () => reject(`UPDATE documents SET client_id='${foreignClient}' WHERE id='${doc}'`, '23503'));
  await check('document business reassignment blocked', () => reject(`UPDATE documents SET business_id='${foreignBiz}' WHERE id='${doc}'`, '23503'));
  await check('referenced client business reassignment blocked', () => reject(`UPDATE clients SET business_id='${foreignBiz}' WHERE id='${client}'`, '23503'));
  await check('NULL business cannot bypass composite FK', () => reject(`UPDATE documents SET business_id=NULL WHERE id='${doc}'`, '23514'));
  await check('referenced client NULL business blocked', () => reject(`UPDATE clients SET business_id=NULL WHERE id='${client}'`, '23503'));
  const rpc = (id, clientId) => `SELECT create_document_atomic(
    p_business_id => '${biz}', p_id => '${id}', p_type => 'receipt',
    p_date => CURRENT_DATE, p_client_id => '${clientId}', p_client_name => 'Synthetic',
    p_subject => NULL, p_status => 'draft', p_subtotal => 0, p_vat => 0, p_total => 0,
    p_payment_method => NULL, p_notes => NULL, p_items => '[]'::jsonb)`;
  await check('RPC foreign client blocked and counter rolled back', async () => {
    const before = await count('document_counters');
    await reject(rpc(uuid(6), foreignClient), '23503');
    assert.equal(await count('document_counters'), before);
  });
  await check('RPC same-business client succeeds', async () => { await db.exec(rpc(uuid(6), client)); });
  await db.exec(`UPDATE documents SET status='issued' WHERE id='${doc}'; INSERT INTO document_items (document_id,description,quantity,unit_price,total) VALUES ('${doc}','Synthetic',1,0,0)`);
  await check('issued document financial immutability retained', () => assert.rejects(db.exec(`UPDATE documents SET total=9 WHERE id='${doc}'`), /immutable/));
  await check('issued item direct deletion remains blocked', () => assert.rejects(db.exec(`DELETE FROM document_items WHERE document_id='${doc}'`), /cannot be deleted/));
  await check('client deletion preserves business and issued document', async () => {
    await db.exec(`DELETE FROM clients WHERE id='${client}'`);
    const row = (await db.query(`SELECT business_id,client_id,status FROM documents WHERE id='${doc}'`)).rows[0];
    assert.deepEqual(row, { business_id: biz, client_id: null, status: 'issued' });
  });
  await db.exec(`INSERT INTO clients (id,business_id,name) VALUES ('${client}','${biz}','Synthetic replacement'); UPDATE documents SET client_id='${client}' WHERE id='${uuid(6)}'`);

  // ---- 20260908-documents-no-delete-once-numbered.sql -----------------------
  // The DELETE gate moved from emailed_at to status, and the message changed.
  // `doc` here is issued but was NEVER emailed, which is exactly the row the
  // old rule let through and the numbering sequence could not afford to lose.
  await check('numbered document delete raises the new message for authenticated', async () => {
    await asRole('authenticated', () => assert.rejects(
      db.exec(`DELETE FROM documents WHERE id='${doc}'`),
      /numbered documents cannot be deleted; cancel via credit note/));
    assert.equal((await rows(`SELECT 1 FROM documents WHERE id='${doc}'`)).length, 1);
  });
  await check('emailed numbered document delete raises the same way', async () => {
    await db.exec(`UPDATE documents SET emailed_at=now() WHERE id='${doc}'`);
    await asRole('authenticated', () => assert.rejects(
      db.exec(`DELETE FROM documents WHERE id='${doc}'`),
      /numbered documents cannot be deleted; cancel via credit note/));
  });
  await check('draft delete still succeeds and cascades its items', async () => {
    const draft = uuid(7);
    await db.exec(`INSERT INTO documents (id,business_id,client_id,type,number,client_name,status)
        VALUES ('${draft}','${biz}','${client}','receipt',50,'Synthetic draft','draft');
      INSERT INTO document_items (document_id,description,quantity,unit_price,total)
        VALUES ('${draft}','Synthetic',1,0,0)`);
    await asRole('authenticated', () => db.exec(`DELETE FROM documents WHERE id='${draft}'`));
    assert.equal((await rows(`SELECT 1 FROM documents WHERE id='${draft}'`)).length, 0);
    assert.equal((await rows(`SELECT 1 FROM document_items WHERE document_id='${draft}'`)).length, 0);
  });
  // REGRESSION GUARD. 20260908 rebuilds the whole function body, so a rebuild
  // from a stale base would silently drop the language guard that
  // 20260906-documents-language.sql added. If this check ever goes green-to-red
  // it means someone rebased the function on the wrong file again.
  await check('language on an issued document is still frozen after the 20260908 rebuild', () =>
    asRole('authenticated', () => assert.rejects(
      db.exec(`UPDATE documents SET language='en' WHERE id='${doc}'`),
      /immutable: field language cannot be changed/)));
  await check('client_id re-point on an issued document raises', async () => {
    await db.exec(`INSERT INTO clients (id,business_id,name) VALUES ('${uuid(8)}','${biz}','Synthetic other');
      INSERT INTO documents (id,business_id,client_id,type,number,client_name,status)
        VALUES ('${uuid(11)}','${biz}','${client}','receipt',51,'Synthetic','issued')`);
    await asRole('authenticated', () => assert.rejects(
      db.exec(`UPDATE documents SET client_id='${uuid(8)}' WHERE id='${uuid(11)}'`),
      /immutable: field client_id cannot be changed/));
  });
  await check('client deletion still nulls client_id on an issued document', async () => {
    await asRole('authenticated', () => db.exec(`DELETE FROM clients WHERE id='${client}'`));
    assert.equal((await rows(`SELECT client_id FROM documents WHERE id='${uuid(11)}'`))[0].client_id, null);
  });
  // The exemption is service_role ONLY. An FK referential action runs as the
  // OWNER of the referencing table (postgres here), not as the caller, so a
  // cascade from businesses is NOT a way around the rule - which is precisely
  // why 'postgres' is not exempt.
  await check('businesses cascade cannot delete a numbered document', () => assert.rejects(
    db.exec(`DELETE FROM businesses WHERE id='${biz}'`),
    /numbered documents cannot be deleted/));
  await check('account wipe works: service_role deletes documents explicitly, then the business', async () => {
    // Mirrors /api/delete-account and /api/danger/delete-all, which delete from
    // documents EXPLICITLY under service_role before touching businesses.
    await asRole('service_role', () => db.exec(`DELETE FROM documents WHERE business_id='${biz}'`));
    await db.exec(`DELETE FROM businesses WHERE id='${biz}'`);
    assert.equal(await count('documents'), 0);
    assert.equal(await count('document_items'), 0);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM clients WHERE business_id='${biz}'`)).rows[0].n, 0);
  });
  console.log(`${passed} PostgreSQL isolation regression checks passed.`);
} finally { await db.close(); }
