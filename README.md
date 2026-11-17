# BidLevel

Line-item bid leveling for utility equipment RFPs.

A utility re-bids its distribution materials every quarter: transformers, cable, conductor, cutouts, arresters, meters, switchgear. It gets back price sheets that each describe the same equipment differently: `12470GY/7200`, `12.47 kV GrdY/7.2 kV`, `0.5 MVA`, `$2,890 per M ft`, `$7,375 per 2,500 ft reel`, `9-10 months`. Before anyone can compare prices, someone has to line every vendor row up against the RFP, convert units, check each spec, chase vendors for what's missing, and write up the award. BidLevel does that pass, shows its work, and remembers what it learned for the next round.

## What it does

- **Matches each vendor line to the RFP** by reading its specs, not its line number. Lines are assigned one-to-one per vendor and per equipment type with the Hungarian algorithm. Exact ratings outrank ratings that merely exceed the requirement, so a 25 kV cable goes to the 25 kV line, not the 15 kV one.
- **Cites the vendor's own words for every check.** Each requirement (kVA, primary and secondary voltage, fluid, efficiency standard, MCOV, stranding and so on) is shown met, deviating or not stated, with the exact characters it was read from highlighted.
- **Normalizes prices and lead times** to the RFP's unit of measure and to weeks, with the arithmetic shown. Reads CSV and Excel (`.xlsx`) price sheets, including a letterhead above the table and a total row below it.
- **Won't guess.** A line that fits two RFP lines equally, or looks like an alternate offer, goes to a review queue. There, Claude can suggest a match, but the answer is discarded unless every quote it gives appears word for word in the vendor's line and it picked one of the candidates it was shown. A person accepts or rejects each suggestion.
- **Remembers.** Closing a round saves its reviewer decisions and prices. Next round, lines a reviewer already resolved are matched automatically, every price shows how it moved since the vendor's last bid, and a vendor that repeats a deviation is called out.
- **Writes the clarification requests.** One letter per vendor covers every deviation, unstated requirement, unreadable lead time, ambiguous row and unpriced line, each quoting the vendor's own row.
- **Compares award scenarios**: lowest cost line by line, lowest cost with a cap on any supplier's share, single source per vendor, and a delivery-time limit. The cap is solved by branch and bound, seeded with a greedy feasible award; it reports whether the result is proven optimal and how far it is from the uncapped minimum. Bids that deviate from spec are never awarded.
- **Prepares the award recommendation**: a printable document with the line awards and the next-best bid on each line, every excluded bid with the vendor's words, every match a person or memory made, and the rules applied.

## Results

**Hand-labeled sample** (`npm run eval`): a synthetic Q4 2026 re-bid with 18 RFP lines and three vendors writing in three styles, with planted problems.

| | |
| --- | --- |
| Bid lines matched automatically and correctly | 52 of 54 |
| Matched to the wrong RFP line | 0 |
| Left for review instead of guessed | 2 (an alternate offer, and a line with no kVA) |
| Planted spec deviations found | 3 of 3, no false ones |

**Next quarter** (`public/samples/q1-2027/`, four vendors, one of them in Excel). With the Q4 review saved to memory, all 58 lines are matched and nothing waits for review. The line a reviewer resolved in Q4 is matched from memory, every price shows its change, and Vendor B's repeated conductor deviation is flagged.

**At scale** (`npm run benchmark`). Generated solicitations the size of the published HillStar case study: about 250 grid-equipment SKUs, 22 vendors in four description styles, partial bids, and planted deviations. Over 10 seeds:

| | |
| --- | --- |
| Priced lines | 47,900 |
| Matched automatically | 99.0% |
| Matched to the wrong RFP line | 0 |
| Planted deviations accepted as compliant | 0 of 643 |
| Slowest solicitation to level | 0.64 s |

All data here is synthetic and describes no real buyer or supplier. These numbers show the matcher's behaviour on the cases it was written for, not accuracy on real bids.

## Run it

Needs Node 24.

```sh
npm install
npm run dev        # http://localhost:5173
```

The app opens on the Q4 2026 sample. To see memory at work:

1. Match the "PMT150" line in the review queue.
2. Choose **Close Q4 2026 and save to memory**.
3. Open the **Q1 2027 re-bid** tab.

To enable Claude suggestions in the review queue, start the server with an Anthropic API key in its environment. The key stays on the server: the browser calls `/api/resolve`, served by the Vite dev and preview servers (`vite.config.ts`) or by `api/resolve.ts` on a host that runs Web-standard functions.

```sh
ANTHROPIC_API_KEY=... npm run dev
```

Checks:

```sh
npm run lint
npm run typecheck
npm test           # node:test, no network, no model calls
npm run eval
npm run benchmark
npm run build
```

## Layout

| Path | What it does |
| --- | --- |
| `src/core/extract.ts` | Reads equipment type and attributes from free text, with the character span behind each value |
| `src/core/normalize.ts` | Money, units of measure (each, ft, per 100 ft, per 1,000 ft, per reel) and lead times |
| `src/core/csv.ts` | CSV parsing and header detection, with aliases for the column names vendors use |
| `src/core/xlsx.ts` | Dependency-free `.xlsx` reader (zip and XML parsed by hand, inflated with `DecompressionStream`) |
| `src/core/assign.ts` | Hungarian algorithm for one-to-one assignment |
| `src/core/level.ts` | Scoring, matching, deviation checks and the leveling result |
| `src/core/memory.ts` | Procurement memory: remembered decisions, price history and repeat deviations |
| `src/core/clarify.ts` | Per-vendor clarification requests |
| `src/core/award.ts` | Award scenarios, including the greedy-seeded branch-and-bound supplier cap |
| `src/core/report.ts` | Award recommendation with exclusions and audit trail |
| `src/core/synthetic.ts` | Seeded generator for large test solicitations |
| `src/core/evaluate.ts` | Scores a result against hand labels |
| `src/llm/suggestion.ts` | Prompt, request and answer schemas, and the grounding check for Claude suggestions |
| `server/resolve.ts` | The Claude call (`claude-opus-5-5`, structured output), run server-side |
| `src/ui/` | React interface |
| `tests/` | 77 tests, including randomized checks of the assignment and award solvers against brute force, and a two-quarter memory workflow |

## Limits

- It understands the equipment families in the samples. A new family needs extraction rules in `src/core/extract.ts`.
- It reads CSV and Excel. PDF price sheets aren't supported yet.
- Ratings where higher is acceptable (voltage class, current, insulation level) are compared as "at least". Everything else must match exactly. A real evaluation committee would set this per requirement.
- Memory is kept in the browser and shared by exporting it as a file.
- The Claude suggestion path is written against the documented Anthropic SDK but hasn't been run against the live API.

Independent project. Not affiliated with any company.
