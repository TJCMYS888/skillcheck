import { mkdir, writeFile } from "node:fs/promises";
import {
  cases,
  versions,
  rubricVersion,
  demoOutput,
  executeCase,
  summarize,
  fingerprint,
  compareRuns,
} from "../docs/core.mjs";
const root = new URL("../examples/", import.meta.url);
await mkdir(root, { recursive: true });
const reports = [];
for (const version of versions) {
  const rows = [];
  for (const c of cases)
    rows.push(await executeCase(c, version, async (c, v) => demoOutput(c, v)));
  const run = {
    id: `demo-${version.id}`,
    created_at: new Date().toISOString(),
    mode: "demo",
    model: "rule-fixture-v1",
    source: "synthetic-rule-fixtures",
    version,
    suite: cases,
    rubric: rubricVersion,
    suite_hash: fingerprint({ suite: cases, rubricVersion }),
    prompt_hash: fingerprint(version),
    complete: true,
    rows,
    summary: summarize(rows, cases.length),
  };
  reports.push(run);
  await writeFile(
    new URL(`${version.id}-report.json`, root),
    JSON.stringify(run, null, 2),
  );
}
await writeFile(
  new URL("comparison.json", root),
  JSON.stringify(
    {
      ...compareRuns(...reports),
      scope: "Rule-demo differences, not model improvement",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    reports.map((r) => ({
      version: r.version.id,
      passed: r.summary.passed,
      total: r.summary.total,
      source: r.source,
    })),
  ),
);
