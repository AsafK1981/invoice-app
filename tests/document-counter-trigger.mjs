// Local PostgreSQL regression suite for the document-counter trigger.
// No network, credentials, or production DB.
// Set PGLITE_MODULE to a local PGlite ES module URL, then run with Node:
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node tests/document-counter-trigger.mjs
// PGlite is deliberately not added to the application's dependency tree
// (same convention as tests/document-client-isolation.mjs).
//
// What it proves, against a real Postgres engine:
//   - an imported (directly inserted) issued document raises its counter,
//     in the same statement, so no client step can be skipped;
//   - the counter only ever goes UP (GREATEST);
//   - a multi-row import is handled per (business, type) in one statement;
//   - drafts, whose numbers are placeholders, never move the counter;
//   - live issuance through the counter is NOT double-incremented;
//   - if the counter cannot be raised, the documents are not written either;
//   - under RLS, a signed-in user can raise only their own business's counter.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const base = (await read('supabase-schema.sql')).split('-- Function to atomically')[0];
const rpc = await read('scripts/migrations/20260916-bump-document-counter-rpc.sql');
const trigger = await read('scripts/migrations/20260916-raise-counters-after-document-insert.sql');

const db = new PGlite();
let passed = 0;
const check = async (label, fn) => { await fn(); passed++; console.log(`PASS ${label}`); };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = uuid(9), biz = uuid(1), foreignBiz = uuid(2);
const one = async (sql) => (await db.query(sql)).rows[0];
const counter = async (business, type) =>
  (await one(`SELECT next_number AS n FROM document_counters WHERE business_id='${business}' AND doc_type='${type}'`))?.n ?? null;
const docCount = async (business, type) =>
  (await one(`SELECT count(*)::int AS n FROM documents WHERE business_id='${business}' AND type='${type}'`)).n;
const asRole = async (role, fn) => {
  await db.exec(`SET ROLE ${role}`);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
};
const insertDoc = (business, type, number, status = 'paid') =>
  `INSERT INTO documents (business_id, type, number, status, client_name)
   VALUES ('${business}', '${type}', ${number}, '${status}', 'Synthetic')`;

try {
  await db.exec(base);
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${owner}'::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    ALTER TABLE businesses ADD COLUMN user_id uuid;

    -- The production document_counters policies, verbatim from pg_policies.
    -- The base schema file ships with RLS disabled on this table; production
    -- has it enabled, and the trigger's behaviour under RLS is the point.
    ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can insert own counters" ON document_counters FOR INSERT
      WITH CHECK (business_id IN (SELECT businesses.id FROM businesses WHERE businesses.user_id = auth.uid()));
    CREATE POLICY "Users can view own counters" ON document_counters FOR SELECT
      USING (business_id IN (SELECT businesses.id FROM businesses WHERE businesses.user_id = auth.uid()));
    CREATE POLICY "Users can update own counters" ON document_counters FOR UPDATE
      USING (business_id IN (SELECT businesses.id FROM businesses WHERE businesses.user_id = auth.uid()));

    INSERT INTO businesses (id, name, tax_id, user_id) VALUES
      ('${biz}', 'Synthetic A', '000', '${owner}'),
      ('${foreignBiz}', 'Synthetic B', '001', '${uuid(10)}');
  `);
  await db.exec(rpc);
  await db.exec(trigger);

  await check('an imported issued document raises a missing counter to number + 1', async () => {
    assert.equal(await counter(biz, 'receipt'), null);
    await db.exec(insertDoc(biz, 'receipt', 5000));
    assert.equal(await counter(biz, 'receipt'), 5001);
  });

  await check('a lower imported number never lowers the counter', async () => {
    await db.exec(insertDoc(biz, 'receipt', 10));
    assert.equal(await counter(biz, 'receipt'), 5001);
  });

  await check('a multi-row import raises each type to its own max in one statement', async () => {
    await db.exec(`
      INSERT INTO documents (business_id, type, number, status, client_name) VALUES
        ('${biz}', 'tax_invoice', 100, 'paid', 'S'),
        ('${biz}', 'tax_invoice', 107, 'paid', 'S'),
        ('${biz}', 'tax_invoice', 103, 'sent', 'S'),
        ('${biz}', 'quote',        40, 'sent', 'S')
    `);
    assert.equal(await counter(biz, 'tax_invoice'), 108);
    assert.equal(await counter(biz, 'quote'), 41);
  });

  await check('a draft (placeholder number) never moves the counter', async () => {
    await db.exec(insertDoc(biz, 'credit_note', 1, 'draft'));
    assert.equal(await counter(biz, 'credit_note'), null);
    // Nor does it drag an existing counter anywhere.
    await db.exec(insertDoc(biz, 'receipt', 99999, 'draft'));
    assert.equal(await counter(biz, 'receipt'), 5001);
  });

  await check('a draft issued by UPDATE raises the counter to its number + 1', async () => {
    // An import can bring a document in as a DRAFT carrying its source number,
    // and a later status UPDATE issues it without ever touching the counter.
    // The INSERT trigger cannot see that; the UPDATE trigger must.
    const id = uuid(500);
    await db.exec(`INSERT INTO documents (id, business_id, type, number, status, client_name)
                   VALUES ('${id}', '${biz}', 'proforma', 7000, 'draft', 'S')`);
    assert.equal(await counter(biz, 'proforma'), null, 'the draft insert itself moves nothing');
    await db.exec(`UPDATE documents SET status = 'sent' WHERE id = '${id}'`);
    assert.equal(await counter(biz, 'proforma'), 7001);
  });

  await check('a draft-to-draft edit and an issued-to-issued edit leave the counter alone', async () => {
    const id = uuid(501);
    await db.exec(`INSERT INTO documents (id, business_id, type, number, status, client_name)
                   VALUES ('${id}', '${biz}', 'proforma', 9000, 'draft', 'S')`);
    await db.exec(`UPDATE documents SET status = 'draft', subject = 'still a draft' WHERE id = '${id}'`);
    assert.equal(await counter(biz, 'proforma'), 7001, 'draft -> draft must not fire');
    // sent -> paid on an already-issued document: not a draft transition.
    await db.exec(`UPDATE documents SET status = 'paid' WHERE id = '${uuid(500)}'`);
    assert.equal(await counter(biz, 'proforma'), 7001, 'sent -> paid must not fire');
  });

  await check('a draft renumbered and then issued raises from its FINAL number', async () => {
    const id = uuid(502);
    // Placeholder 2, not 1: an earlier check already holds (credit_note, 1),
    // and (business, type, number) is unique.
    await db.exec(`INSERT INTO documents (id, business_id, type, number, status, client_name)
                   VALUES ('${id}', '${biz}', 'credit_note', 2, 'draft', 'S')`);
    await db.exec(`UPDATE documents SET number = 3300 WHERE id = '${id}'`);
    assert.equal(await counter(biz, 'credit_note'), null, 'renumbering a draft is not issuance');
    await db.exec(`UPDATE documents SET status = 'sent' WHERE id = '${id}'`);
    assert.equal(await counter(biz, 'credit_note'), 3301);
  });

  await check('live issuance through the counter is not double-incremented', async () => {
    // What create_document_atomic does for an automatic number: take
    // next_number, advance it by one, insert that number - all in one
    // transaction. The trigger must leave the counter at N + 1, not N + 2,
    // or live numbering would start skipping.
    await db.exec(`
      BEGIN;
      UPDATE document_counters SET next_number = next_number + 1
        WHERE business_id = '${biz}' AND doc_type = 'quote';
      INSERT INTO documents (business_id, type, number, status, client_name)
        VALUES ('${biz}', 'quote', 41, 'sent', 'S');
      COMMIT;
    `);
    assert.equal(await counter(biz, 'quote'), 42);
  });

  await check('custom-number issuance (already GREATEST in the RPC) is unaffected', async () => {
    // create_document_atomic with p_number runs this exact upsert itself.
    await db.exec(`
      BEGIN;
      INSERT INTO document_counters (business_id, doc_type, next_number)
        VALUES ('${biz}', 'tax_invoice', 501)
        ON CONFLICT (business_id, doc_type)
        DO UPDATE SET next_number = GREATEST(document_counters.next_number, 501);
      INSERT INTO documents (business_id, type, number, status, client_name)
        VALUES ('${biz}', 'tax_invoice', 500, 'paid', 'S');
      COMMIT;
    `);
    assert.equal(await counter(biz, 'tax_invoice'), 501);
  });

  await check('if the counter cannot be raised, the document is not written either', async () => {
    // Force the counter write to fail, then insert. The whole statement has to
    // roll back: a committed document with an un-raised counter is exactly the
    // state this trigger exists to make impossible.
    await db.exec(`ALTER TABLE document_counters ADD CONSTRAINT test_cap CHECK (next_number < 1000000)`);
    try {
      // Compared against the value before the attempt rather than asserted to
      // be empty, since earlier checks have already raised this type.
      const docsBefore = await docCount(biz, 'proforma');
      const counterBefore = await counter(biz, 'proforma');
      await assert.rejects(db.exec(insertDoc(biz, 'proforma', 2000000)), (e) => e.code === '23514');
      assert.equal(await docCount(biz, 'proforma'), docsBefore, 'the document must not be written');
      assert.equal(await counter(biz, 'proforma'), counterBefore, 'the counter must be untouched');
    } finally {
      await db.exec(`ALTER TABLE document_counters DROP CONSTRAINT test_cap`);
    }
  });

  await check('if issuing a draft cannot raise the counter, the draft stays a draft', async () => {
    const id = uuid(503);
    await db.exec(`INSERT INTO documents (id, business_id, type, number, status, client_name)
                   VALUES ('${id}', '${biz}', 'quote', 5000000, 'draft', 'S')`);
    await db.exec(`ALTER TABLE document_counters ADD CONSTRAINT test_cap2 CHECK (next_number < 1000000)`);
    try {
      const counterBefore = await counter(biz, 'quote');
      await assert.rejects(
        db.exec(`UPDATE documents SET status = 'sent' WHERE id = '${id}'`),
        (e) => e.code === '23514',
      );
      const row = await one(`SELECT status FROM documents WHERE id = '${id}'`);
      assert.equal(row.status, 'draft', 'the issuance must roll back');
      assert.equal(await counter(biz, 'quote'), counterBefore);
    } finally {
      await db.exec(`ALTER TABLE document_counters DROP CONSTRAINT test_cap2`);
    }
  });

  await check('a signed-in user raises their own counter through RLS', async () => {
    await asRole('authenticated', async () => {
      await db.exec(insertDoc(biz, 'tax_invoice_receipt', 700));
    });
    assert.equal(await counter(biz, 'tax_invoice_receipt'), 701);
  });

  await check('a signed-in user cannot raise another business’s counter, and the document rolls back', async () => {
    const before = await docCount(foreignBiz, 'receipt');
    await asRole('authenticated', async () => {
      await assert.rejects(db.exec(insertDoc(foreignBiz, 'receipt', 800)), (e) => e.code === '42501');
    });
    assert.equal(await docCount(foreignBiz, 'receipt'), before);
    assert.equal(await counter(foreignBiz, 'receipt'), null);
  });

  await check('service_role (the admin import) raises counters across businesses', async () => {
    await asRole('service_role', async () => {
      await db.exec(insertDoc(foreignBiz, 'receipt', 900));
    });
    assert.equal(await counter(foreignBiz, 'receipt'), 901);
  });

  await check('bump_document_counter itself is not callable by anon', async () => {
    await asRole('anon', async () => {
      await assert.rejects(
        db.exec(`SELECT public.bump_document_counter('${biz}', 'receipt', 1)`),
        (e) => e.code === '42501',
      );
    });
  });

  console.log(`\n${passed} document-counter trigger checks passed.`);
} finally {
  await db.close();
}
