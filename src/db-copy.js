// "Frontend copy" of a project's database: one self-contained HTML file you can open offline.
import { escapeHtml } from './design.js';
import { keys, runSql, ident } from './smart-client.js';

export async function collectTables(env, project, settings) {
  const mode = settings.storage.mode;
  if (mode === 'external') throw { status: 400, message: 'Your users are stored on your own server (external gateway), so there is no platform database to copy.' };
  if (mode === 'smartbase') {
    const s = settings.storage.smartbase, k = await keys(env, project.id);
    if (!s.ready || !k.read) throw { status: 400, message: 'Connect a Smartbase database with a read key first.' };
    const names = ((await runSql(env, k.read, s.databaseId, 'SHOW TABLES')).rows || []).map((r) => r.Tables).slice(0, 25);
    if (!names.length) return [];
    const d = await runSql(env, k.read, s.databaseId, names.map((n) => `SELECT * FROM ${ident(n)} LIMIT 5000;`).join('\n'));
    return names.map((n, i) => { const r = d.results[i] || { columns: [], rows: [] }; return { name: n, columns: r.columns, rows: r.rows.map((o) => r.columns.map((c) => o[c] ?? null)) }; });
  }
  const columns = ['id', 'provider', 'email', 'email_verified', 'name', 'created_at', 'last_login_at'];
  const { results } = await env.DB.prepare(`SELECT ${columns.join(', ')} FROM end_users WHERE project_id = ? ORDER BY created_at LIMIT 5000`).bind(project.id).all();
  return [{ name: 'end_users', columns, rows: results.map((r) => columns.map((c) => r[c] ?? null)) }];
}

export function viewerHtml(title, tables) {
  const data = JSON.stringify({ title, generated: new Date().toISOString(), tables }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font:14px Arial,sans-serif;background:#f5f7fa;color:#1f2937}header{padding:14px 18px;background:#111827;color:#fff}header small{opacity:.7;display:block;margin-top:3px}
.bar{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px}.bar button,.bar input{padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font:inherit}.bar button.on{background:#2563eb;color:#fff;border-color:#2563eb}
.wrap{overflow:auto;margin:0 18px 18px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;max-height:70vh}table{border-collapse:collapse;width:100%}th,td{padding:8px 12px;border-bottom:1px solid #eef0f3;text-align:left;white-space:nowrap}
th{position:sticky;top:0;background:#f9fafb;cursor:pointer}.n{color:#9ca3af;font-style:italic}.info{padding:0 18px 14px;color:#6b7280}</style></head><body>
<header><b id="t"></b><small id="g"></small></header><div class="bar" id="tabs"></div><div class="bar"><input id="q" placeholder="Search rows..."><button id="csv">Download CSV</button></div><div class="wrap"><table id="tbl"></table></div><div class="info" id="info"></div>
<script id="d" type="application/json">${data}</script>
<script>
var D=JSON.parse(document.getElementById('d').textContent),cur=0,sortCol=-1,asc=true;
document.getElementById('t').textContent=D.title;document.getElementById('g').textContent='Copy created '+D.generated+' - read-only snapshot';
function esc(v){return v}function rows(){var t=D.tables[cur],q=document.getElementById('q').value.toLowerCase(),r=t.rows.filter(function(x){return !q||x.some(function(c){return String(c).toLowerCase().indexOf(q)>-1})});
if(sortCol>-1)r=r.slice().sort(function(a,b){var x=a[sortCol],y=b[sortCol];if(x===y)return 0;if(x===null)return -1;if(y===null)return 1;return (x>y?1:-1)*(asc?1:-1)});return r}
function draw(){var t=D.tables[cur],tb=document.getElementById('tbl');tb.textContent='';if(!t){document.getElementById('info').textContent='This database has no tables yet.';return}
var h=tb.insertRow();t.columns.forEach(function(c,i){var th=document.createElement('th');th.textContent=c+(sortCol===i?(asc?' ^':' v'):'');th.onclick=function(){asc=sortCol===i?!asc:true;sortCol=i;draw()};h.appendChild(th)});
var r=rows();r.slice(0,2000).forEach(function(x){var tr=tb.insertRow();x.forEach(function(c){var td=tr.insertCell();if(c===null){td.textContent='NULL';td.className='n'}else td.textContent=c})});
document.getElementById('info').textContent=r.length+' of '+t.rows.length+' rows'+(r.length>2000?' (showing first 2000)':'')}
function tabs(){var b=document.getElementById('tabs');b.textContent='';D.tables.forEach(function(t,i){var x=document.createElement('button');x.textContent=t.name+' ('+t.rows.length+')';x.className=i===cur?'on':'';x.onclick=function(){cur=i;sortCol=-1;tabs();draw()};b.appendChild(x)})}
document.getElementById('q').oninput=draw;
document.getElementById('csv').onclick=function(){var t=D.tables[cur];if(!t)return;function q(c){c=c===null?'':String(c);return '"'+c.replace(/"/g,'""')+'"'}var s=[t.columns.map(q).join(',')].concat(rows().map(function(r){return r.map(q).join(',')})).join('\\n');var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([s],{type:'text/csv'}));a.download=t.name+'.csv';a.click()};
tabs();draw();
</script></body></html>`;
}
