// Reading the numbers typed into the planning toolbox.
//
// THE MATHS IS NOT HERE ANY MORE. Scoring options, framing an order and
// allocating a budget all live in backend/app/engine/planning.py and are
// reached through `planning` in api/client.ts. CLAUDE.md is explicit that
// calculation belongs in the engine, and the practical reason is mobile: four
// sets of decision rules reimplemented in a second language, kept in step by
// hand, is exactly the drift the API-first rule exists to prevent.
//
// What remains is reading a form field, which is a client concern and stays
// with the client.

/**
 * Read a number out of one of the toolbox's `type="number"` fields.
 *
 * The browser normalises those to a dot-decimal string whatever the owner's
 * locale, so this stays a plain dot parser. It does handle a comma decimal,
 * because a PASTED value skips that normalisation — and an earlier version
 * stripped the comma out, turning "12,50" into 1250. A hundredfold error in a
 * price field, silently.
 *
 * Free text and CSV cells are a different problem and go through
 * `parseLocaleNumber` in lib/money.ts, which knows the owner's conventions.
 */
export function num(s: string): number {
  const raw = s.trim()
  // A comma with no dot alongside it can only be a decimal mark here.
  const normalised = raw.includes(',') && !raw.includes('.')
    ? raw.replace(',', '.')
    : raw
  const n = parseFloat(normalised.replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}
