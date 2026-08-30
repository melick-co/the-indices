/**
 * OECD SDMX connector (work in progress).
 * Discovery helpers work today; configured series load once keys are verified.
 *
 *   node scripts/watch-oecd.mjs discover household
 *   node scripts/watch-oecd.mjs structure OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL
 */
const BASE = 'https://sdmx.oecd.org/public/rest';
const UA = 'caveat-indices/0.1 (+https://the-indices.vercel.app)';

async function oecdFetch(path, accept = 'application/vnd.sdmx.structure+json') {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, accept },
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OECD ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function discover(term) {
  const json = await oecdFetch('/dataflow/all?detail=referencepartial&format=jsondata');
  const flows = json?.data?.dataflows ?? json?.dataflows ?? [];
  const t = (term ?? '').toLowerCase();
  const hits = flows.filter((f) =>
    !t || `${f.id} ${f.name ?? ''}`.toLowerCase().includes(t));
  console.log(`${hits.length} dataflow(s) matching "${term ?? '(all)'}" (showing 40):\n`);
  for (const f of hits.slice(0, 40)) {
    console.log(`  ${f.id.padEnd(40)} ${f.name ?? ''}`);
  }
}

async function structure(ref) {
  const json = await oecdFetch(`/datastructure/${ref}?references=children&format=jsondata`);
  const ds = json?.data?.dataStructures?.[0];
  const dims = ds?.dataStructureComponents?.dimensionList?.dimensions ?? [];
  const cls = json?.data?.codelists ?? [];
  console.log(`Dimensions for ${ref}:\n`);
  dims.forEach((d, i) => {
    const clRef = d.localRepresentation?.enumeration?.split('=').pop();
    const cl = cls.find((c) => c.id === clRef?.split(':').pop()?.split('(')[0]);
    console.log(`  ${i + 1}. ${d.id}`);
    (cl?.codes ?? []).slice(0, 10).forEach((c) => console.log(`       ${String(c.id).padEnd(12)} ${c.name}`));
    if ((cl?.codes ?? []).length > 10) console.log(`       ... ${cl.codes.length - 10} more`);
  });
}

const [, , cmd, arg] = process.argv;
const run = { discover: () => discover(arg), structure: () => structure(arg) }[cmd];
if (!run) {
  console.log(`Usage:
  node scripts/watch-oecd.mjs discover <term>
  node scripts/watch-oecd.mjs structure <agency,dataflow@id>`);
  process.exit(0);
}
run().catch((e) => { console.error(e.message); process.exit(1); });
