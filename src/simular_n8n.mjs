/* =====================================================================
 * simular_n8n.mjs — roda o Code node de `mb-touchpoint-week` EXATAMENTE como
 * ele está no JSON do workflow, emulando o que o n8n injeta ($helpers, $()).
 *
 *   node simular_n8n.mjs 2026-08-17 [caminho-do-gabarito.json]
 *
 * Por que existe: o Code node não dá para testar sem publicar no n8n. Isto
 * pega o código gerado (não o fonte) e prova que ele roda, lê o Supabase de
 * verdade e devolve o mesmo contrato do gabarito. Só leitura.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.dirname(AQUI);

const wf = JSON.parse(fs.readFileSync(path.join(LIVE, "n8n", "01_mb-touchpoint-week.json"), "utf8"));
const codigo = wf.nodes.find((n) => n.name === "Contrato").parameters.jsCode;
const conf = wf.nodes.find((n) => n.name === "Config").parameters.assignments.assignments;
const cfg = Object.fromEntries(conf.map((a) => [a.name, a.value]));

const week = process.argv[2] || "2026-08-17";
const gabPath = process.argv[3];

/* ── o que o n8n injeta no Code node ── */
const nós = {
  Config: { first: () => ({ json: cfg }) },
  Webhook: {
    first: () => ({
      json: { headers: { "x-tp-token": cfg.token }, body: { week_start: week, tz: "America/New_York" } },
    }),
  },
};
globalThis.$ = (nome) => {
  if (!nós[nome]) throw new Error("node desconhecido na simulação: " + nome);
  return nós[nome];
};
globalThis.$helpers = {
  async httpRequest({ url, headers }) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  },
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const rodar = new AsyncFunction(codigo);

console.error(`rodando o Code node para ${week} …`);
const t0 = Date.now();
const saida = await rodar();
const j = saida[0].json;

console.log("ok:", j.ok, "| total:", j.total, "| motor:", j.motor);
console.log("leitura:", j.leitura);
console.log("tempo total:", ((Date.now() - t0) / 1000).toFixed(1) + "s");

const conta = (f) => j.linhas.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {});
console.log("semaforo:", conta((r) => r.semaforo));
console.log("cenario :", conta((r) => r.cenario));
console.log("pode_gerar:", j.linhas.filter((r) => r.pode_gerar).length, "/", j.linhas.length);

/* ── o payload tem tudo que a tela consome? ── */
const p = j.linhas[0].payload;
const exigidos = [
  "identificacao.cliente", "identificacao.gestores", "semana.label", "semana.timezone",
  "midia.renderizar", "midia.por_plataforma", "midia.total.cpl", "midia.total.spend_renderizavel",
  "comparacao.semana_anterior.cpl", "comparacao.var_appts",
  "agendamento.semana", "agendamento.meta_usada", "agendamento.origem_meta",
  "agendamento.criterio_data", "agendamento.referencia_interna_por_data_da_visita",
  "mes.fim", "mes.meta_mensal", "benchmark.bm_leads_mes", "benchmark.cpl_vs_bm",
  "contexto_mb", "qualidade.motivo_sem_veiculacao", "qualidade.primeiro_dia_veiculacao",
  "cenario.codigo", "proveniencia.spend_leads", "proveniencia.agendamento",
];
const faltando = exigidos.filter((c) => c.split(".").reduce((o, k) => (o == null ? undefined : o[k]), p) === undefined);
console.log("\ncampos do contrato que a tela consome:", faltando.length ? "FALTANDO -> " + faltando.join(", ") : "todos presentes");

if (!gabPath) process.exit(0);

/* ── diff contra o gabarito do Python ── */
const gab = JSON.parse(fs.readFileSync(gabPath, "utf8"));
const porId = new Map(j.linhas.map((r) => [r.client_id, r]));
const CAMPOS = [
  ["spend", (g, x) => [g.midia.total.spend, x.payload.midia.total.spend]],
  ["leads", (g, x) => [g.midia.total.leads, x.payload.midia.total.leads]],
  ["cpl", (g, x) => [g.midia.total.cpl, x.payload.midia.total.cpl]],
  ["appts", (g, x) => [g.agendamento.semana, x.payload.agendamento.semana]],
  ["appts_mes", (g, x) => [g.agendamento.mes_ate_domingo, x.payload.agendamento.mes_ate_domingo]],
  ["mes_leads", (g, x) => [g.mes.leads, x.payload.mes.leads]],
  ["mes_spend", (g, x) => [g.mes.spend, x.payload.mes.spend]],
  ["dias_veic", (g, x) => [g.qualidade.dias_veiculacao, x.payload.qualidade.dias_veiculacao]],
  ["semaforo", (g, x) => [g.qualidade.semaforo, x.semaforo]],
  ["pode_gerar", (g, x) => [g.qualidade.pode_gerar, x.pode_gerar]],
  ["cenario", (g, x) => [g.cenario.codigo, x.cenario]],
];
let iguais = 0;
const difs = [];
for (const g of gab) {
  const x = porId.get(g.client_id);
  if (!x) continue;
  const d = [];
  for (const [nome, f] of CAMPOS) {
    const [a, b] = f(g, x);
    const na = a ?? null, nb = b ?? null;
    const ok = typeof na === "number" && typeof nb === "number" ? Math.abs(na - nb) < 0.011 : na === nb;
    if (!ok) d.push(`${nome}: py=${JSON.stringify(na)} n8n=${JSON.stringify(nb)}`);
  }
  d.length ? difs.push({ c: g.cliente, d }) : iguais++;
}
console.log(`\n════ ${iguais}/${gab.length} clientes idênticos ao gabarito em ${CAMPOS.length} campos ════`);
for (const x of difs) console.log(`• ${x.c}\n    ` + x.d.join("\n    "));
