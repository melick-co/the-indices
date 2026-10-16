import type { SupabaseClient } from '@supabase/supabase-js';
import { factCheckStory, type FactCheck } from '@/lib/fact-check';
import { auditClaims, type ClaimAudit } from '@/lib/claim-audit';
import { asCheckable, columnIssues, decideCheck, type RubCheck, type RubCopy } from '@/lib/rub-rules';

/**
 * The Rub's strict check: the column rules, then the same figure check (lib/fact-check.ts) and claim audit
 * (lib/claim-audit.ts) that stories pass, against the stored series the column names. Story house style
 * (lib/style-check.ts) does not apply to a column. Fails closed: anything that did not run is not a pass.
 */
export async function strictCheckRub(db: SupabaseClient, rub: RubCopy, metricIds: string[]): Promise<RubCheck> {
  const ids = [...new Set(metricIds.map((m) => m.trim()).filter(Boolean))];
  const story = asCheckable(rub);
  const apiKey = !!process.env.ANTHROPIC_API_KEY?.trim();

  let fact: FactCheck | null = null;
  let factError: string | null = null;
  try {
    fact = await factCheckStory(db, story, ids);
  } catch (e) {
    factError = e instanceof Error ? e.message : String(e);
  }
  const figuresOk = !!fact && fact.issues.every((i) => i === 'no chart');

  let audit: ClaimAudit | null = null;
  let auditError: string | null = null;
  if (figuresOk && apiKey) {
    try {
      audit = await auditClaims(db, story, ids);
    } catch (e) {
      auditError = e instanceof Error ? e.message : String(e);
    }
  }
  return decideCheck({ columnIssues: columnIssues(rub), fact, factError, audit, auditError, apiKey });
}
