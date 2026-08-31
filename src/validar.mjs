/* =====================================================================
 * validar.mjs — roda o porte JS contra o Supabase e compara com o gabarito
 * gerado por ref_contract.py (a implementação de referência da Fase 1).
 *
 *   node validar.mjs 2026-08-17 <caminho-do-gabarito.json>
 *
 * Só leitura. Não escreve nada no Ruche OS.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carregar, construir } from "./contrato.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const RAIZ = "C:\\Users\\zuque\\OneDrive\\Área de Trabalho\\Ruche";
const HANDOVER = path.join(RAIZ, "stripe-conciliacao", "HANDOVER_RUCHE_OS.md");

const h = fs.readFileSync(HANDOVER, "utf8");
const KEY = h.match(/\|\s*SERVICE_ROLE_KEY\s*\|\s*`([^`]+)`/)[1];
const BASE = "https://api.ruchedigital.com";
const HEADERS = { apikey: KEY, Authorization: "Bearer " + KEY, Accept: "application/json" };

const http = async (url, headers) => {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 120)} :: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const week = process.argv[2] || "2026-08-17";
const gabPath = process.argv[3];

console.error(`carregando ${week} ...`);
const t0 = Date.now();
const dados = await carregar(http, BASE, HEADERS, { week_start: week, tz: "America/New_York" });
console.error(
  `clientes=${dados.clients.length} insights=${dados.insights.length} appts=${dados.appts.length} ` +
    `benchmarks=${dados.benchmarks.length} opts=${dados.opts.length}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
);

const linhas = construir(dados, { week_start: week, tz: "America/New_York", render_platforms: ["meta"] });

const dest = path.join(AQUI, `saida_${week}.json`);
fs.writeFileSync(dest, JSON.stringify(linhas, null, 1), "utf8");
console.error(`blocos=${linhas.length} -> ${dest}`);

const conta = (arr, f) => arr.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {});
console.log("semaforo:", conta(linhas, (r) => r.semaforo));
console.log("cenario :", conta(linhas, (r) => r.cenario));
console.log("pode_gerar:", linhas.filter((r) => r.pode_gerar).length, "/", linhas.length);

if (!gabPath) process.exit(0);

/* ─────────────────────────── diff contra o gabarito ─────────────────────────── */
const gab = JSON.parse(fs.readFileSync(gabPath, "utf8"));
const gabById = new Map(gab.map((r) => [r.client_id, r]));
const jsById = new Map(linhas.map((r) => [r.client_id, r]));

const soNoGab = gab.filter((r) => !jsById.has(r.client_id)).map((r) => r.cliente);
const soNoJs = linhas.filter((r) => !gabById.has(r.client_id)).map((r) => r.client_name);
if (soNoGab.length) console.log("\n⚠ só no gabarito (python):", soNoGab);
if (soNoJs.length) console.log("\n⚠ só no porte (js):", soNoJs);

const CAMPOS = [
  ["spend", (g, j) => [g.midia.total.spend, j.payload.midia.total.spend]],
  ["leads", (g, j) => [g.midia.total.leads, j.payload.midia.total.leads]],
  ["cpl", (g, j) => [g.midia.total.cpl, j.payload.midia.total.cpl]],
  ["appts_semana", (g, j) => [g.agendamento.semana, j.payload.agendamento.semana]],
  ["appts_mes", (g, j) => [g.agendamento.mes_ate_domingo, j.payload.agendamento.mes_ate_domingo]],
  ["mes_leads", (g, j) => [g.mes.leads, j.payload.mes.leads]],
  ["mes_spend", (g, j) => [g.mes.spend, j.payload.mes.spend]],
  ["w1_leads", (g, j) => [g.comparacao.semana_anterior.leads, j.payload.comparacao.semana_anterior.leads]],
  ["w1_spend", (g, j) => [g.comparacao.semana_anterior.spend, j.payload.comparacao.semana_anterior.spend]],
  ["dias_veic", (g, j) => [g.qualidade.dias_veiculacao, j.payload.qualidade.dias_veiculacao]],
  ["ritmo_leads", (g, j) => [g.benchmark.ritmo_leads, j.payload.benchmark.ritmo_leads]],
  ["ritmo_appts", (g, j) => [g.benchmark.ritmo_appts, j.payload.benchmark.ritmo_appts]],
  ["semaforo", (g, j) => [g.qualidade.semaforo, j.semaforo]],
  ["pode_gerar", (g, j) => [g.qualidade.pode_gerar, j.pode_gerar]],
  ["cenario", (g, j) => [g.cenario.codigo, j.cenario]],
  ["n_bloqueios", (g, j) => [g.qualidade.bloqueios.length, j.payload.qualidade.bloqueios.length]],
];

let iguais = 0;
const divergencias = [];
for (const g of gab) {
  const j = jsById.get(g.client_id);
  if (!j) continue;
  const difs = [];
  for (const [nome, f] of CAMPOS) {
    const [a, b] = f(g, j);
    const na = a === null || a === undefined ? null : a;
    const nb = b === null || b === undefined ? null : b;
    const igual =
      typeof na === "number" && typeof nb === "number" ? Math.abs(na - nb) < 0.011 : na === nb;
    if (!igual) difs.push(`${nome}: py=${JSON.stringify(na)} js=${JSON.stringify(nb)}`);
  }
  if (difs.length) divergencias.push({ cliente: g.cliente, nicho: g.nicho, difs });
  else iguais++;
}

console.log(`\n════ DIFF: ${iguais}/${gab.length} clientes idênticos em ${CAMPOS.length} campos ════`);
for (const d of divergencias) {
  console.log(`\n• ${d.cliente}  [nicho: ${d.nicho}]`);
  for (const x of d.difs) console.log("    " + x);
}
