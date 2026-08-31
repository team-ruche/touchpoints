/* =====================================================================
 * testar_app.mjs — exercita as funções puras do app (régua de cenários,
 * léxico, checklist, marcadores e a mensagem final) contra o contrato REAL
 * já calculado, sem navegador.
 *
 *   node testar_app.mjs [saida_2026-08-17.json]
 *
 * O que isso prova: que a mensagem que o cliente receberia sai montada, com
 * os números certos, e que as travas (marcador [ ], léxico, checklist)
 * disparam onde devem.
 *
 * Roda DUAS vezes por cliente: com o esqueleto (que deixa marcador de
 * propósito) e com a redação de verdade — a de `redacao.js`, sem IA. A
 * segunda passada é a que diz se a semana sai publicável de graça.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redigir } from "./redacao.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.dirname(AQUI);

/* ── shims: o app.js toca localStorage e document só na borda ── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };

const fonte = fs.readFileSync(path.join(LIVE, "app", "app.js"), "utf8");
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      fonte +
        "\nexport { montarMensagem, checklist, pendencias, termosProibidos, rascunhoDeTexto, rotuloSemana, ultimaSemanaFechada, CENARIO };",
    ).toString("base64")
);

const arq = process.argv[2] || path.join(AQUI, "saida_2026-08-17.json");
const linhas = JSON.parse(fs.readFileSync(arq, "utf8"));
console.log(`contrato: ${linhas.length} clientes  (${path.basename(arq)})\n`);

let ok = 0;
const prontos = { publicaveis: 0, pendentes: 0, fechaveis: 0 };
const problemas = [];
const semMarcador = [];

for (const r of linhas) {
  const p = r.payload;
  const texto = mod.rascunhoDeTexto(p);
  const msg = mod.montarMensagem(p, texto);
  const pend = mod.pendencias(texto);
  const chk = mod.checklist(p, texto);

  // 1. a mensagem tem os seis blocos da seção 8.2, nesta ordem
  const exige = ["Weekly Touch Point:", "📅 Agendamentos na semana:", "📊 No mês (", "Como foi:", "🚀 Próximo passo:"];
  for (const e of exige) if (!msg.includes(e)) problemas.push(`${r.client_name}: falta “${e}” na mensagem`);

  // 2. o número de agendamento impresso é o da semana, NUNCA a meta contratada.
  //    Este é o bug de origem: #542 recebeu "25" numa semana de zero.
  const m = msg.match(/📅 Agendamentos na semana: (\d+)/);
  if (!m) problemas.push(`${r.client_name}: linha de agendamento ausente`);
  else if (Number(m[1]) !== p.agendamento.semana)
    problemas.push(`${r.client_name}: imprimiu ${m[1]}, contrato diz ${p.agendamento.semana}`);
  else if (
    p.agendamento.meta_mensal_contratada != null &&
    Number(m[1]) === p.agendamento.meta_mensal_contratada &&
    p.agendamento.semana !== p.agendamento.meta_mensal_contratada
  )
    problemas.push(`${r.client_name}: imprimiu a META, não o resultado`);

  // 3. plataforma com spend 0 não pode aparecer (checklist 8.8 item 4)
  for (const [k, v] of Object.entries(p.midia.por_plataforma))
    if (v.spend <= 0) problemas.push(`${r.client_name}: plataforma ${k} com spend 0 no payload`);

  // 4. CPL por soma, não média de coluna
  const t = p.midia.total;
  if (t.leads > 0 && Math.abs(t.cpl - t.spend / t.leads) > 0.02)
    problemas.push(`${r.client_name}: CPL ${t.cpl} != ${t.spend}/${t.leads}`);

  // 5. o esqueleto tem de deixar marcador onde só um humano decide
  if (pend.length === 0) semMarcador.push(`${r.client_name} (${r.cenario})`);

  if (!chk.find((c) => c.id === "contrato").ok)
    problemas.push(`${r.client_name}: checklist "contrato" reprovou — criterio_data errado`);

  /* ── segunda passada: a redação de verdade, sem modelo de linguagem ── */
  const w = redigir(p);
  const tw = { comoFoi: w.como_foi, proximoPasso: w.proximo_passo, pedido: w.pedido_cliente };
  const msgW = mod.montarMensagem(p, tw);
  const chkW = mod.checklist(p, tw);

  for (const e of exige) if (!msgW.includes(e)) problemas.push(`${r.client_name}: redação — falta “${e}”`);
  if (mod.termosProibidos(`${tw.comoFoi} ${tw.proximoPasso} ${tw.pedido}`).length)
    problemas.push(`${r.client_name}: redação viola o léxico do app`);
  // o checklist do app é o mesmo do Ruche OS: se ele reprovar, o bloco não sobe
  for (const c of chkW)
    if (!c.ok && !c.manual) problemas.push(`${r.client_name}: redação reprovou no checklist "${c.id}"`);

  const pendW = mod.pendencias(tw);
  if (pendW.length) {
    if (w.cenario !== "F" && w.cenario !== "D")
      problemas.push(`${r.client_name} [${w.cenario}]: marcador fora de F/D — ${pendW.join(" ")}`);
    prontos.pendentes++;
    // responder a lacuna tem de fechar o bloco por completo
    const escolhas = {};
    for (const l of w.lacunas) escolhas[l.id] = l.opcoes[0].valor;
    const cheio = redigir(p, escolhas);
    const tc = { comoFoi: cheio.como_foi, proximoPasso: cheio.proximo_passo, pedido: cheio.pedido_cliente };
    if (mod.pendencias(tc).length) problemas.push(`${r.client_name}: sobrou marcador depois de responder`);
    else prontos.fechaveis++;
  } else prontos.publicaveis++;

  ok++;
}

console.log(`mensagens montadas: ${ok}/${linhas.length}`);
console.log(`problemas: ${problemas.length ? "" : "nenhum"}`);
for (const x of problemas) console.log("  ✗ " + x);

console.log(`\n── com a redação sem IA ──`);
console.log(`publicáveis direto ......... ${prontos.publicaveis}/${linhas.length}`);
console.log(`esperando 1 resposta ....... ${prontos.pendentes} (todas fecham: ${prontos.fechaveis})`);
console.log(`custo de API ............... $0.00`);

console.log(`\nsem nenhum marcador [ ] no esqueleto: ${semMarcador.length}`);
if (semMarcador.length) console.log("  " + semMarcador.join("\n  "));
console.log("  (cenários E e F escrevem texto fechado — os demais SEMPRE deixam marcador,");
console.log("   e é isso que trava o envio até o gestor preencher)");

/* ── amostra: um cliente por cenário ── */
console.log("\n" + "═".repeat(72));
const vistos = new Set();
for (const r of linhas) {
  if (vistos.has(r.cenario)) continue;
  vistos.add(r.cenario);
  const w2 = redigir(r.payload);
  const texto = { comoFoi: w2.como_foi, proximoPasso: w2.proximo_passo, pedido: w2.pedido_cliente };
  console.log(`\n─── ${r.cenario} · ${mod.CENARIO[r.cenario].titulo} · ${r.client_name} ` + "─".repeat(8));
  console.log(mod.montarMensagem(r.payload, texto));
}

process.exit(problemas.length ? 1 : 0);
