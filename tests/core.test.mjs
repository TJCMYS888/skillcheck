import test from "node:test";
import assert from "node:assert/strict";
import {
  cases,
  versions,
  validateCase,
  demoOutput,
  gradeOutput,
  executeCase,
  summarize,
  compareRuns,
  fingerprint,
  escapeHtml,
} from "../docs/core.mjs";
const normal = {
  id: "own",
  name: "社团招新",
  date: "2026-11-02",
  location: "教学楼",
  price: "免费",
  details: "摄影体验",
  expected_block: false,
};
test("suite has unique identifiers and at least twelve explicit cases", () => {
  assert.ok(cases.length >= 12);
  assert.equal(new Set(cases.map((x) => x.id)).size, cases.length);
});
test("name is required", () =>
  assert.throws(() => validateCase({ ...normal, name: "" }), /名称/));
test("details are required", () =>
  assert.throws(() => validateCase({ ...normal, details: "" }), /资料/));
test("strict demo marks missing facts rather than filling defaults", () => {
  const c = { ...normal, date: "", location: "" },
    out = demoOutput(c, versions[1]);
  assert.equal(out.facts.date, "待确认");
  assert.ok(out.missing.includes("date"));
  assert.equal(gradeOutput(out, c).passed, true);
});
test("known bad demo fixture exposes invented facts", () => {
  const c = { ...normal, date: "" };
  const result = gradeOutput(demoOutput(c, versions[0]), c);
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((x) => x.code === "fact_date" && !x.passed));
});
test("conflicting prices are raised for human confirmation", () => {
  const c = { ...normal, price: "免费 / 19元" };
  const o = demoOutput(c, versions[1]);
  assert.ok(o.conflicts.includes("price"));
  assert.equal(o.facts.price, "待确认");
  assert.equal(gradeOutput(o, c).passed, true);
});
test("valid JSON alone is insufficient to pass", () =>
  assert.equal(gradeOutput({}, normal).passed, false));
test("extra missing flags on complete input fail", () => {
  const o = demoOutput(normal, versions[1]);
  o.missing = ["date"];
  assert.equal(gradeOutput(o, normal).passed, false);
});
test("input blocking never invokes producer", async () => {
  let calls = 0;
  const r = await executeCase(
    { ...normal, name: "", expected_block: true },
    versions[1],
    async () => {
      calls++;
    },
  );
  assert.equal(calls, 0);
  assert.equal(r.status, "blocked");
  assert.equal(r.passed, true);
});
test("upstream failure is recorded as error, not success", async () => {
  const r = await executeCase(normal, versions[1], async () => {
    throw Error("测试超时");
  });
  assert.equal(r.status, "error");
  assert.equal(r.passed, false);
  assert.match(r.error, /测试超时/);
});
test("malformed model content is kept for diagnosis", async () => {
  const r = await executeCase(normal, versions[1], async () => ({
    content: "broken JSON",
  }));
  assert.equal(r.status, "error");
  assert.equal(r.raw, "broken JSON");
});
test("summary counts cancellation and partial runs honestly", () => {
  const s = summarize(
    [{ passed: true, status: "success", latency_ms: 10 }],
    12,
  );
  assert.equal(s.completed, 1);
  assert.equal(s.total, 12);
  assert.equal(s.passed, 1);
  assert.equal(s.pass_rate, 1 / 12);
});
test("fingerprints include case contents, not only IDs", () =>
  assert.notEqual(
    fingerprint([normal]),
    fingerprint([{ ...normal, date: "不同" }]),
  ));
test("comparisons reject different suites or modes and incomplete runs", () => {
  const a = { suite_hash: "a", mode: "demo", complete: true, rows: [] };
  assert.equal(compareRuns(a, { ...a, suite_hash: "b" }).comparable, false);
  assert.equal(compareRuns(a, { ...a, mode: "live" }).comparable, false);
  assert.equal(compareRuns(a, { ...a, complete: false }).comparable, false);
});
test("matched comparison identifies actual case transitions", () => {
  const a = {
    suite_hash: "a",
    mode: "demo",
    complete: true,
    rows: [
      { case_id: "1", passed: false },
      { case_id: "2", passed: true },
    ],
  };
  const b = {
    ...a,
    rows: [
      { case_id: "1", passed: true },
      { case_id: "2", passed: false },
    ],
  };
  const c = compareRuns(a, b);
  assert.equal(c.comparable, true);
  assert.deepEqual(c.improved, ["1"]);
  assert.deepEqual(c.regressed, ["2"]);
});
test("untrusted labels are HTML escaped", () =>
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;"));
