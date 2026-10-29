const { Chart } = globalThis;
const data = JSON.parse(document.getElementById("report-data").textContent);

function fmt(n) {
  return Math.round(n).toLocaleString();
}

function filled(node, className, text) {
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function bucketTitle(items) {
  return `${data.bucketLabels[items[0].dataIndex]} tokens`;
}

const HEADINGS = [
  ["Name", "text-left p-2"],
  ["Calls", "text-right p-2"],
  ["Results", "text-right p-2"],
  ["Est. tokens", "text-right p-2"],
  ["Avg/result", "text-right p-2"],
  ["Histogram", "text-left p-2 w-64"],
];

function tableRow(el, r, i) {
  const row = filled(
    document.createElement("tr"),
    "border-t border-zinc-800 hover:bg-zinc-800/50 cursor-pointer",
  );
  row.dataset.row = String(i);
  const canvas = document.createElement("canvas");
  canvas.id = `${el}Hist${i}`;
  canvas.height = 34;
  const histogram = filled(document.createElement("td"), "p-2");
  histogram.append(canvas);
  row.append(
    filled(document.createElement("td"), "p-2 font-mono", r.name),
    filled(document.createElement("td"), "p-2 text-right", fmt(r.calls)),
    filled(document.createElement("td"), "p-2 text-right", fmt(r.results ?? r.samples.length)),
    filled(document.createElement("td"), "p-2 text-right", fmt(r.estimatedTokens)),
    filled(document.createElement("td"), "p-2 text-right", fmt(r.avg)),
    histogram,
  );
  return row;
}

function table(rows, el) {
  const select = () => document.getElementById(el === "tools" ? "toolSelect" : "bashSelect");
  const head = document.createElement("tr");
  head.append(
    ...HEADINGS.map(([text, className]) => filled(document.createElement("th"), className, text)),
  );
  const thead = filled(document.createElement("thead"), "text-zinc-400");
  thead.append(head);
  const tbody = document.createElement("tbody");
  tbody.append(...rows.map((r, i) => tableRow(el, r, i)));
  const tableElement = filled(document.createElement("table"), "w-full text-sm");
  tableElement.append(thead, tbody);
  document.getElementById(el).replaceChildren(tableElement);
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
  document.getElementById(id).replaceChildren(
    ...rows.map((r, i) => {
      const option = filled(document.createElement("option"), undefined, r.name);
      option.value = String(i);
      return option;
    }),
  );
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
