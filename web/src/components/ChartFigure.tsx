/**
 * The numbers behind a chart, as a real table, for screen readers.
 *
 * Recharts draws everything — series values, axis ticks, legends — as SVG
 * `<path>` and `<text>`. A screen reader gets, at best, a stream of
 * disconnected numbers with no idea which axis or series they belong to; more
 * often it gets nothing at all. axe cannot see this: markup can be perfectly
 * valid and the chart still meaningless without sight. The forecast chart is
 * the product's primary output, so "you can't read it" is not a small gap.
 *
 * The fix is the standard one: hide the drawing from assistive technology and
 * put the same data next to it in a table that is present in the accessibility
 * tree but not on screen. Both come from the same array, so they cannot drift.
 *
 * `sr-only` (not `display:none`, not `visibility:hidden`) is what makes this
 * work — those two remove an element from the accessibility tree as well as the
 * screen.
 *
 * Usage: wrap the chart in <ChartFigure> and pass it the same rows.
 */

interface ChartDataTableProps {
  /** Sentence naming what the table holds. Already translated. */
  caption: string
  /** Column headings, already translated. The first labels the row header. */
  columns: string[]
  /** One array per row, in column order. Already formatted and translated. */
  rows: Array<Array<string | number>>
}

export function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  if (rows.length === 0) return null
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} scope="col">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0
                ? <th key={c} scope="row">{cell}</th>
                : <td key={c}>{cell}</td>,
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface ChartFigureProps extends ChartDataTableProps {
  /** The chart itself — a ResponsiveContainer and whatever wraps it. */
  children: React.ReactNode
}

/**
 * A chart plus its screen-reader table.
 *
 * The chart is `aria-hidden`. That is only legal if nothing inside it can take
 * focus — hiding focusable content strands keyboard focus on something no
 * screen reader can announce (axe's `aria-hidden-focus`, and the suite caught
 * exactly this on the first run).
 *
 * Recharts 3 defaults `accessibilityLayer` to true, which puts `tabIndex={0}`
 * and `role="application"` on the chart surface. Every chart wrapped here
 * therefore passes `accessibilityLayer={false}`. That loses nothing worth
 * keeping: the layer's arrow-key navigation announces tooltip markup through a
 * `role="application"` container that takes the screen reader's own keys away,
 * which is worse than no focus stop at all now that the table carries the
 * numbers properly. If a chart ever gains a real button, it must move outside
 * this wrapper.
 */
export default function ChartFigure({ caption, columns, rows, children }: ChartFigureProps) {
  return (
    <>
      <div aria-hidden="true">{children}</div>
      <ChartDataTable caption={caption} columns={columns} rows={rows} />
    </>
  )
}
