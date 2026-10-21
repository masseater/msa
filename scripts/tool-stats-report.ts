import { Effect, Schema } from "effect";

import json from "./json.ts";
import type toolStatsReportTypes from "./tool-stats-report.types.ts";

const { Json } = json;

const HEAD = `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>msa Tool Stats</title>
	<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
	<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js"></script>
</head>`;

const markup = (
  data: toolStatsReportTypes.ReportData,
): string => `<body class="bg-zinc-950 text-zinc-100 p-6">
	<main class="max-w-7xl mx-auto space-y-6">
		<h1 class="text-3xl font-bold">msa Tool Stats</h1>
		<p class="text-zinc-400">${data.files} session files from <code>${data.sessionsDir}</code>. Generated ${data.generatedAt}.</p>
		<section class="grid md:grid-cols-2 gap-6">
			<div class="bg-zinc-900 rounded p-4"><h2 class="font-semibold mb-3">Estimated result tokens by tool</h2><canvas id="tokens"></canvas></div>
			<div class="bg-zinc-900 rounded p-4"><h2 class="font-semibold mb-3">Tool calls</h2><canvas id="calls"></canvas></div>
		</section>
		<section class="grid md:grid-cols-2 gap-6">
			<div class="bg-zinc-900 rounded p-4">
				<div class="flex items-center justify-between gap-4 mb-3">
					<h2 class="font-semibold">Tool result token histogram</h2>
					<select id="toolSelect" class="bg-zinc-800 rounded px-2 py-1 text-sm"></select>
				</div>
				<p id="toolSummary" class="text-sm text-zinc-400 mb-3"></p>
				<canvas id="toolHistogram" height="120"></canvas>
			</div>
			<div class="bg-zinc-900 rounded p-4">
				<div class="flex items-center justify-between gap-4 mb-3">
					<h2 class="font-semibold">Bash result token histogram</h2>
					<select id="bashSelect" class="bg-zinc-800 rounded px-2 py-1 text-sm"></select>
				</div>
				<p id="bashSummary" class="text-sm text-zinc-400 mb-3"></p>
				<canvas id="bashHistogram" height="120"></canvas>
			</div>
		</section>
		<section class="bg-zinc-900 rounded p-4"><h2 class="font-semibold mb-3">Tools</h2><div id="tools"></div></section>
		<section class="bg-zinc-900 rounded p-4">
			<h2 class="font-semibold mb-3">Bash common commands (best effort)</h2>
			<div id="bash" class="mt-4"></div>
		</section>
	</main>`;

const chartScript = (serialized: string): string => `	<script>
		const data=${serialized};
		function fmt(n){return Math.round(n).toLocaleString()}
		function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
		function table(rows,el){
			document.getElementById(el).innerHTML='<table class="w-full text-sm"><thead class="text-zinc-400"><tr><th class="text-left p-2">Name</th><th class="text-right p-2">Calls</th><th class="text-right p-2">Results</th><th class="text-right p-2">Est. tokens</th><th class="text-right p-2">Avg/result</th><th class="text-left p-2 w-64">Histogram</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr class="border-t border-zinc-800 hover:bg-zinc-800/50 cursor-pointer" data-row="'+i+'"><td class="p-2 font-mono">'+esc(r.name)+'</td><td class="p-2 text-right">'+fmt(r.calls)+'</td><td class="p-2 text-right">'+fmt(r.results??r.samples.length)+'</td><td class="p-2 text-right">'+fmt(r.estimatedTokens)+'</td><td class="p-2 text-right">'+fmt(r.avg)+'</td><td class="p-2"><canvas id="'+el+'Hist'+i+'" height="34"></canvas></td></tr>').join('')+'</tbody></table>';
			rows.forEach((r,i)=>new Chart(document.getElementById(el+'Hist'+i),{type:'bar',data:{labels:data.bucketLabels,datasets:[{data:r.histogram,label:r.name,backgroundColor:'#60a5fa'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>data.bucketLabels[items[0].dataIndex]+' tokens'}}},scales:{x:{display:false},y:{display:false}}}}));
			document.querySelectorAll('#'+el+' tr[data-row]').forEach(row=>row.addEventListener('click',()=>document.getElementById(el==='tools'?'toolSelect':'bashSelect').value=row.dataset.row,document.getElementById(el==='tools'?'toolSelect':'bashSelect').dispatchEvent(new Event('change'))));
		}
		function fillSelect(id,rows){document.getElementById(id).innerHTML=rows.map((r,i)=>'<option value="'+i+'">'+esc(r.name)+'</option>').join('')}
		function summary(r){return fmt(r.calls)+' calls, '+fmt(r.results??r.samples.length)+' results, '+fmt(r.estimatedTokens)+' estimated result tokens, '+fmt(r.avg)+' avg/result'}
		function singleHistogram(canvasId,summaryId,selectId,rows){
			let chart;
			function update(){
				const row=rows[Number(document.getElementById(selectId).value)]??rows[0];
				document.getElementById(summaryId).textContent=row?summary(row):'No data';
				if(chart)chart.destroy();
				chart=new Chart(document.getElementById(canvasId),{type:'bar',data:{labels:data.bucketLabels,datasets:[{label:row?.name??'',data:row?.histogram??[],backgroundColor:'#60a5fa'}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>data.bucketLabels[items[0].dataIndex]+' tokens',label:(item)=>fmt(item.raw)+' results'}}},scales:{y:{beginAtZero:true,title:{display:true,text:'result count'}},x:{title:{display:true,text:'estimated tokens/result'}}}}});
			}
			document.getElementById(selectId).addEventListener('change',update);
			update();
		}
		table(data.tools,'tools');
		table(data.bashCommands,'bash');
		fillSelect('toolSelect',data.tools);
		fillSelect('bashSelect',data.bashCommands);
		singleHistogram('toolHistogram','toolSummary','toolSelect',data.tools);
		singleHistogram('bashHistogram','bashSummary','bashSelect',data.bashCommands);
		new Chart(document.getElementById('tokens'),{type:'bar',data:{labels:data.tools.map(r=>r.name),datasets:[{label:'estimated tokens',data:data.tools.map(r=>r.estimatedTokens)}]},options:{plugins:{legend:{display:false}}}});
		new Chart(document.getElementById('calls'),{type:'bar',data:{labels:data.tools.map(r=>r.name),datasets:[{label:'calls',data:data.tools.map(r=>r.calls)}]},options:{plugins:{legend:{display:false}}}});
	</script>`;

const renderReport = (data: toolStatsReportTypes.ReportData) =>
  Effect.gen(function* () {
    const serialized = yield* Schema.encodeEffect(Json)(data);
    return `${HEAD}
${markup(data)}
${chartScript(serialized)}
</body>
</html>`;
  });

const toolStatsReport = {
  renderReport,
};

export default toolStatsReport;
