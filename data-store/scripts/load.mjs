// Loader: pushes data/*.json into Supabase using the SERVICE ROLE key.
// Run locally/CI only. Never ship the service role key to the browser.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/load.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const entities = JSON.parse(readFileSync('data/entities.json'));
const metrics  = JSON.parse(readFileSync('data/metrics.json'));
const obs      = JSON.parse(readFileSync('data/observations.json'));

const region = c => ({AUS:'Oceania',NZL:'Oceania',USA:'Americas',CAN:'Americas',MEX:'Americas',CHL:'Americas',
COL:'Americas',CRI:'Americas',JPN:'Asia',KOR:'Asia',ISR:'Middle East'}[c] ?? 'Europe');

async function run() {
  let r;
  r = await db.from('entities').upsert(entities.map(e => ({ ...e, region: region(e.code) })));
  if (r.error) throw r.error; console.log('entities:', entities.length);

  r = await db.from('metrics').upsert(metrics.map(m => ({
    metric_id:m.metric_id,name:m.name,unit:m.unit,basis:m.basis,direction:m.direction,
    category:m.category,source_tier:m.source_tier,source_org:m.source_org,
    source_dataset:m.source_dataset,source_url:m.source_url,source_published:m.source_published,period:m.period })));
  if (r.error) throw r.error; console.log('metrics:', metrics.length);

  for (let i = 0; i < obs.length; i += 500) {
    r = await db.from('observations').upsert(obs.slice(i, i + 500),
      { onConflict: 'metric_id,entity,period' });
    if (r.error) throw r.error;
  }
  console.log('observations:', obs.length, '\nLoad complete.');
}
run().catch(e => { console.error(e); process.exit(1); });
