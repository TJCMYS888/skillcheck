import {
  cases as initialCases,
  versions as initialVersions,
  rubricVersion,
  validateCase,
  demoOutput,
  executeCase,
  summarize,
  compareRuns,
  fingerprint,
  modelMessages,
  escapeHtml as e,
} from "./core.mjs";
const $ = (id) => document.getElementById(id),
  storageKey = "skillcheck.v1";
let suite = structuredClone(initialCases),
  versions = structuredClone(initialVersions),
  runs = [],
  current = null,
  selected = null,
  running = false,
  stopped = false,
  controller = null,
  service = null;
function notice(t, error = false) {
  $("notice").hidden = false;
  $("notice").textContent = t;
  $("notice").className = "notice" + (error ? " error" : "");
}
const safely =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      notice(err.message, true);
    }
  };
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ suite, versions, runs }));
  } catch {
    notice("本地存储已满或不可用，请立即导出报告。", true);
  }
}
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function version() {
  return versions.find((x) => x.id === $("version").value);
}
function renderVersions(id) {
  $("version").innerHTML = versions
    .map((v) => `<option value="${e(v.id)}">${e(v.name)}</option>`)
    .join("");
  $("version").value = id ?? versions[0].id;
  loadVersion();
}
function loadVersion() {
  const v = version();
  $("prompt").value = v.prompt;
  $("policy").value = v.policy;
}
function rowLabel(row) {
  return (
    {
      success: "完成",
      error: "调用／解析错误",
      blocked: "输入拦截",
      cancelled: "已取消",
    }[row?.status] ?? "待运行"
  );
}
function render() {
  const rows = current?.rows ?? [],
    activeSuite = current?.suite ?? suite,
    s = summarize(rows, activeSuite.length);
  $("stat-pass").textContent = current ? `${s.passed} / ${s.total}` : "—";
  $("stat-complete").textContent = `${s.completed} / ${s.total}`;
  $("stat-fail").textContent = current ? String(s.failed) : "—";
  $("stat-review").textContent = String(
    rows.filter((r) => r.review?.decision !== "pending" && r.review?.decision)
      .length,
  );
  $("progress").textContent = running
    ? `正在执行 ${Math.min(s.completed + 1, s.total)} / ${s.total}，已完成结果会保留`
    : `${activeSuite.length}条合成用例${current ? ` · ${current.complete ? "完整运行" : "未完成运行"}` : "，未运行"}`;
  $("run-meta").textContent = current
    ? `${current.version.name} · ${current.mode === "demo" ? "规则演示（非模型成绩）" : current.model} · 样本${current.suite_hash} · ${rubricVersion}`
    : `事实核验规则 ${rubricVersion} · 自由文本质量另行复核`;
  $("case-rows").innerHTML = activeSuite
    .map((c) => {
      const r = rows.find((x) => x.case_id === c.id),
        review =
          { pending: "待复核", approved: "可采用", rejected: "需修改" }[
            r?.review?.decision
          ] ?? "—";
      return `<tr class="${selected === c.id ? "selected" : ""}"><td><button data-case="${e(c.id)}">${e(c.id)} ↗</button></td><td>${e(c.label)}</td><td>${e(rowLabel(r))}</td><td><span class="status ${r ? (r.passed ? "good" : "bad") : ""}">${r ? (r.passed ? "通过" : "未通过") : "未运行"}</span></td><td>${e(review)}</td></tr>`;
    })
    .join("");
  for (const id of ["export-report", "export-md"]) $(id).disabled = !current;
  $("run").disabled = running;
  for (const id of [
    "version",
    "prompt",
    "policy",
    "mode",
    "save-version",
    "add-case",
    "import-cases",
    "history",
  ])
    $(id).disabled = running;
  $("stop").hidden = !running;
  if (selected) renderDetail();
}
function renderHistory() {
  const options = runs
    .map(
      (r, i) =>
        `<option value="${i}">${e(r.version.name)} · ${e(r.mode)} · ${e(new Date(r.created_at).toLocaleTimeString())}${r.complete ? "" : " · 中止"}</option>`,
    )
    .join("");
  $("history").innerHTML = '<option value="">选择历史运行…</option>' + options;
  for (const id of ["compare-a", "compare-b"]) $(id).innerHTML = options;
  $("compare-a").value = runs.length > 1 ? "1" : "0";
  $("compare-b").value = "0";
}
function renderDetail() {
  const c = (current?.suite ?? suite).find((x) => x.id === selected),
    r = current?.rows.find((x) => x.case_id === selected);
  if (!c) return;
  $("detail-panel").hidden = false;
  $("detail-title").textContent = `${c.id} · ${c.label}`;
  $("detail-time").textContent = r
    ? `${r.latency_ms}ms · ${rowLabel(r)}`
    : "未运行";
  $("case-input").textContent = JSON.stringify(c, null, 2);
  $("checks").innerHTML = r?.grade
    ? r.grade.checks
        .map(
          (x) =>
            `<div class="check ${x.passed ? "" : "fail"}"><strong>${x.passed ? "✓ 通过" : "× 未通过"} · ${e(x.code)}</strong><br>${e(x.detail)}</div>`,
        )
        .join("")
    : `<p class="micro">${e(r?.error ?? "运行后显示规则检查。预期拦截的用例不调用模型。")}</p>`;
  $("raw").textContent = r?.raw ?? r?.error ?? "尚无输出";
  $("review-decision").value = r?.review?.decision ?? "pending";
  $("review-note").value = r?.review?.note ?? "";
  $("save-review").disabled = !r || running;
}
$("version").onchange = loadVersion;
$("save-version").onclick = safely(() => {
  const prompt = $("prompt").value.trim();
  if (!prompt || prompt.length > 12000) throw Error("提示词应为1—12000字");
  const v = {
    id: `custom-${Date.now()}`,
    name: `V${versions.length + 1} · 自定义`,
    policy: $("policy").value,
    prompt,
  };
  versions.push(v);
  renderVersions(v.id);
  persist();
  notice("新版本已保存，历史运行中的提示词快照保持不变。");
});
$("mode").onchange = () => {
  $("mode-badge").textContent =
    $("mode").value === "demo" ? "合成用例 · 规则演示" : "合成用例 · 真实模型";
};
$("run").onclick = safely(async () => {
  if (running) return;
  const v = structuredClone(version()),
    mode = $("mode").value;
  if ($("prompt").value !== v.prompt || $("policy").value !== v.policy)
    throw Error("提示词或策略已修改，请先另存为新版本。");
  if (mode === "live" && !service?.configured)
    throw Error("请先在本地服务配置AI_API_KEY与AI_MODEL，再刷新页面。");
  current = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    mode,
    model: mode === "demo" ? "rule-fixture-v1" : service.model,
    version: v,
    prompt_hash: fingerprint(v),
    suite_hash: fingerprint({ suite, rubricVersion }),
    rubric: rubricVersion,
    suite: structuredClone(suite),
    rows: [],
    complete: false,
    source:
      mode === "demo"
        ? "synthetic-rule-fixtures"
        : "synthetic-inputs-live-model",
  };
  running = true;
  stopped = false;
  selected = null;
  $("detail-panel").hidden = true;
  notice(
    mode === "demo"
      ? "正在运行离线规则样例…"
      : "正在调用已配置模型，每条结果将独立保存…",
  );
  render();
  try {
    for (const c of current.suite) {
      if (stopped) break;
      controller = new AbortController();
      const producer = async (c, v) => {
        if (mode === "demo") return demoOutput(c, v);
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: modelMessages(c, v) }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error ?? "模型请求失败");
        return data;
      };
      current.rows.push(await executeCase(c, v, producer));
      render();
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    current.complete = !stopped && current.rows.length === current.suite.length;
    current.summary = summarize(current.rows, current.suite.length);
    runs.unshift(current);
    runs = runs.slice(0, 12);
    persist();
    renderHistory();
    notice(
      current.complete
        ? mode === "demo"
          ? "演示运行完成。这里的通过率来自规则样例，不是模型效果结论。"
          : "真实模型运行完成，请继续人工复核自由文本与可用性。"
        : "运行已停止，已完成用例及取消状态已保留。",
    );
  } finally {
    running = false;
    controller = null;
    render();
  }
});
$("stop").onclick = () => {
  stopped = true;
  controller?.abort();
};
$("case-rows").onclick = (event) => {
  const b = event.target.closest("[data-case]");
  if (b) {
    selected = b.dataset.case;
    render();
  }
};
$("save-review").onclick = () => {
  const r = current?.rows.find((x) => x.case_id === selected);
  if (!r) return;
  r.review = {
    decision: $("review-decision").value,
    note: $("review-note").value.trim(),
    at: new Date().toISOString(),
  };
  persist();
  render();
  notice("人工意见已保存，自动验收结果保持独立。");
};
$("history").onchange = () => {
  if ($("history").value === "") return;
  current = runs[Number($("history").value)];
  selected = null;
  $("detail-panel").hidden = true;
  render();
};
$("compare").onclick = () => {
  const a = runs[Number($("compare-a").value)],
    b = runs[Number($("compare-b").value)];
  if (a === b) {
    $("comparison").textContent = "请选择两次不同运行。";
    return;
  }
  const result = compareRuns(a, b);
  $("comparison").innerHTML = result.comparable
    ? `<p>${e(a.version.name)} → ${e(b.version.name)}${a.mode === "demo" ? " · 规则演示，不代表真实模型提升" : ""}</p><div class="comparison-grid"><div><strong>由未通过变为通过：${result.improved.length}条</strong><br>${e(result.improved.join("、") || "无")}</div><div><strong>由通过变为未通过：${result.regressed.length}条</strong><br>${e(result.regressed.join("、") || "无")}</div></div><p class="micro">对比仅覆盖当前合成样本；没有线上A/B实验或用户效果结论。</p>`
    : e(result.reason);
};
$("export-report").onclick = () =>
  download("skillcheck-report.json", JSON.stringify(current, null, 2));
$("export-md").onclick = () => {
  const s = summarize(current.rows, current.suite.length),
    content =
      `# SkillCheck评测记录\n\n模式：${current.mode}｜模型：${current.model}\n\n来源：${current.source}\n\n规则：${current.rubric}｜样本：${current.suite_hash}｜提示词：${current.prompt_hash}\n\n完成${s.completed}/${s.total}；自动验收通过${s.passed}/${s.total}（含预期输入拦截）。\n\n${current.mode === "demo" ? "本报告为确定性规则演示，不是模型基准或提升结论。" : "本报告为合成样本上的实际模型调用；不代表线上效果。"}\n\n|用例|状态|验收|人工意见|\n|---|---|---|---|\n` +
      current.rows
        .map(
          (r) =>
            `|${r.case_id}|${r.status}|${r.passed ? "通过" : "未通过"}|${r.review?.decision ?? "pending"}|`,
        )
        .join("\n") +
      "\n\n自由文本语义、文案质量与业务价值需人工复核。完整原始输出见JSON报告。\n";
  download("skillcheck-report.md", content, "text/markdown;charset=utf-8");
};
function validateSuite(data) {
  if (!Array.isArray(data) || !data.length || data.length > 50)
    throw Error("用例集应包含1—50条样本");
  const ids = new Set();
  for (const c of data) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id.trim() ||
      c.id.length > 30 ||
      ids.has(c.id) ||
      typeof c.label !== "string" ||
      c.label.length > 100
    )
      throw Error("用例编号必须唯一，且包含有效场景说明");
    ids.add(c.id);
    for (const f of ["name", "details", "date", "location", "price"])
      if (
        typeof c[f] !== "string" ||
        c[f].length > (f === "details" ? 12000 : 500)
      )
        throw Error("用例字段缺失或长度无效");
    if (typeof c.expected_block !== "boolean")
      throw Error("expected_block必须为布尔值");
    if (!c.expected_block) validateCase(c);
  }
  return data;
}
$("export-cases").onclick = () =>
  download("skillcheck-cases.json", JSON.stringify(suite, null, 2));
$("import-cases").onchange = safely(async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 500000) throw Error("文件超过500KB");
    const next = validateSuite(JSON.parse(await file.text()));
    suite = next;
    current = null;
    selected = null;
    persist();
    render();
    notice("评测集已替换，历史运行仍保留原用例快照。");
  } finally {
    event.target.value = "";
  }
});
$("add-case").onclick = () => $("case-dialog").showModal();
$("close-case").onclick = () => $("case-dialog").close();
$("case-form").onsubmit = safely((event) => {
  event.preventDefault();
  const f = event.target,
    c = {};
  for (const key of [
    "id",
    "label",
    "name",
    "date",
    "location",
    "price",
    "details",
  ])
    c[key] = f.elements[key].value.trim();
  c.expected_block = f.elements.expected_block.checked;
  validateSuite([...suite, c]);
  suite.push(c);
  current = null;
  selected = null;
  $("case-dialog").close();
  f.reset();
  persist();
  render();
  notice("新用例已加入，下一次运行会生成新的样本标识。");
});
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (saved) {
    suite = validateSuite(saved.suite);
    if (
      Array.isArray(saved.versions) &&
      saved.versions.length &&
      saved.versions.every(
        (v) =>
          typeof v.id === "string" &&
          typeof v.prompt === "string" &&
          ["creative", "grounded"].includes(v.policy),
      )
    )
      versions = saved.versions;
    runs = Array.isArray(saved.runs)
      ? saved.runs
          .filter(
            (r) =>
              Array.isArray(r.rows) &&
              Array.isArray(r.suite) &&
              r.version?.name,
          )
          .slice(0, 12)
      : [];
    current = runs[0] ?? null;
  }
} catch {
  notice("本地旧数据无法读取，已加载默认评测集。", true);
}
renderVersions(
  versions.some((v) => v.id === current?.version?.id)
    ? current.version.id
    : undefined,
);
renderHistory();
render();
fetch("/api/status")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((s) => {
    service = s;
    $("service").textContent = s.configured
      ? `本地模型：${s.model}`
      : "真实模式需AI_API_KEY、AI_MODEL及AI_BASE_URL。";
  })
  .catch(() => {
    $("service").textContent =
      "静态演示站可离线评测规则。真实模式请运行python server.py。";
  });
