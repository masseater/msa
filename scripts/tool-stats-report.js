const { Chart } = globalThis;
const data = JSON.parse(document.getElementById("report-data").textContent);

function fmt(n) {
  return Math.round(n).toLocaleString();
}

function esc(s) {
  return String(s).replace(
    /[&<>"]/gu,
    (c) => ({ '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}

function bucketTitle(items) {
  return `${data.bucketLabels[items[0].dataIndex]} tokens`;
}

function table(rows, el) {
  const select = () => document.getElementById(el === "tools" ? "toolSelect" : "bashSelect");
  document.getElementById(el).innerHTML =
    '<table class="w-full text-sm"><thead class="text-zinc-400"><tr><th class="text-left p-2">Name</th><th class="text-right p-2">Calls</th><th class="text-right p-2">Results</th><th class="text-right p-2">Est. tokens</th><th class="text-right p-2">Avg/result</th><th class="text-left p-2 w-64">Histogram</th></tr></thead><tbody>' +
    rows
      .map(
        (r, i) =>
          `<tr class="border-t border-zinc-800 hover:bg-zinc-800/50 cursor-pointer" data-row="${i}"><td class="p-2 font-mono">${esc(r.name)}</td><td class="p-2 text-right">${fmt(r.calls)}</td><td class="p-2 text-right">${fmt(r.results ?? r.samples.length)}</td><td class="p-2 text-right">${fmt(r.estimatedTokens)}</td><td class="p-2 text-right">${fmt(r.avg)}</td><td class="p-2"><canvas id="${el}Hist${i}" height="34"></canvas></td></tr>`,
      )
      .join("") +
    "</tbody></table>";
  rows.forEach(
    (r, i) =>
      new Chart(document.getElementById(`${el}Hist${i}`), {
        data: {
          datasets: [{ backgroundColor: "#60a5fa", data: r.histogram, label: r.name }],
          labels: data.bucketLabels,
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: bucketTitle } } },
          responsive: true,
          scales: { x: { display: false }, y: { display: false } },
        },
        type: "bar",
      }),
  );
  document.querySelectorAll(`#${el} tr[data-row]`).forEach((row) =>
    row.addEventListener("click", () => {
      select().value = row.dataset.row;
      select().dispatchEvent(new Event("change"));
    }),
  );
}

function fillSelect(id, rows) {
  document.getElementById(id).innerHTML = rows
    .map((r, i) => `<option value="${i}">${esc(r.name)}</option>`)
    .join("");
}

function summary(r) {
  return `${fmt(r.calls)} calls, ${fmt(r.results ?? r.samples.length)} results, ${fmt(r.estimatedTokens)} estimated result tokens, ${fmt(r.avg)} avg/result`;
}

function singleHistogram(canvasId, summaryId, selectId, rows) {
  let chart;
  function update() {
    const row = rows[Number(document.getElementById(selectId).value)] ?? rows[0];
    chart?.destroy();
    if (row === undefined) {
      document.getElementById(summaryId).textContent = "No data";
      return;
    }
    document.getElementById(summaryId).textContent = summary(row);
    chart = new Chart(document.getElementById(canvasId), {
      data: {
        datasets: [{ backgroundColor: "#60a5fa", data: row.histogram, label: row.name }],
        labels: data.bucketLabels,
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (item) => `${fmt(item.raw)} results`, title: bucketTitle },
          },
        },
        scales: {
          x: { title: { display: true, text: "estimated tokens/result" } },
          y: { beginAtZero: true, title: { display: true, text: "result count" } },
        },
      },
      type: "bar",
    });
  }
  document.getElementById(selectId).addEventListener("change", update);
  update();
}

function totals(id, label, value) {
  return new Chart(document.getElementById(id), {
    data: {
      datasets: [{ data: data.tools.map(value), label }],
      labels: data.tools.map((r) => r.name),
    },
    options: { plugins: { legend: { display: false } } },
    type: "bar",
  });
}

table(data.tools, "tools");
table(data.bashCommands, "bash");
fillSelect("toolSelect", data.tools);
fillSelect("bashSelect", data.bashCommands);
singleHistogram("toolHistogram", "toolSummary", "toolSelect", data.tools);
singleHistogram("bashHistogram", "bashSummary", "bashSelect", data.bashCommands);
totals("tokens", "estimated tokens", (r) => r.estimatedTokens);
totals("calls", "calls", (r) => r.calls);
