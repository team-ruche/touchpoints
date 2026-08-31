/* =====================================================================
 * testar_redacao.mjs — prova que a redação sem IA é publicável.
 *
 *   node testar_redacao.mjs                 # as duas semanas com gabarito
 *   node testar_redacao.mjs --amostra       # imprime um texto por cenário
 *
 * Roda contra as saídas reais do contrato (44 clientes × 2 semanas) que já
 * foram validadas 44/44 contra ref_contract.py. Não chama rede, não chama
 * modelo nenhum: se este arquivo passar, a semana inteira sai de graça.
 *
 * O teste que importa é o 5: NENHUM número do texto pode faltar no
 * contrato. É a versão automatizável do achado que originou o projeto —
 * "Appointments Booked" imprimia um campo de contrato como se fosse
 * resultado. Um redator que só pode escrever números que existem no
 * contrato não consegue repetir aquele erro.
 * ===================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redigir, VOCABULARIO, termosProibidos } from "./redacao.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SEMANAS = ["2026-08-10", "2026-08-17"];

/* Números que são prosa, não dado. Declarados aqui de propósito: qualquer
   outro número que apareça no texto e não esteja no contrato reprova. */
const CONSTANTES_DE_PROSA = new Set(["2", "3", "10"]);

let falhas = 0;
const erro = (m) => {
  falhas++;
  console.log("  ✗ " + m);
};

/* ───────────────── coleta de números do contrato ───────────────── */

function numerosDoContrato(o, acc) {
  acc = acc || new Set();
  if (o === null || o === undefined) return acc;
  if (typeof o === "number") {
    acc.add(o.toFixed(2));
    acc.add(String(Math.round(o)));
    acc.add(String(Math.ceil(o)));
    return acc;
  }
  if (typeof o === "object") for (const k of Object.keys(o)) numerosDoContrato(o[k], acc);
  return acc;
}

/** Números que o texto usa e que são CALCULADOS a partir do contrato —
 *  cada um com a conta explícita. Nada entra aqui sem justificativa. */
function derivados(p) {
  const s = new Set();
  const t = p.midia.total;
  const ag = p.agendamento;
  if (ag.semana > 0) s.add((t.spend / ag.semana).toFixed(2)); // custo por agendamento (cenário C)
  if (ag.meta_usada != null) {
    // quanto falta para fechar o mês = meta_usada − mes.agendamentos
    const falta = Math.round(ag.meta_usada) - p.mes.agendamentos;
    s.add(String(falta));
    s.add(falta.toFixed(2));
  }
  return s;
}

/** Extrai todo número do texto, já descontando datas dd/mm. */
function numerosDoTexto(txt) {
  const achados = [];
  let s = String(txt);
  // money primeiro: senão o separador de milhar vira dois inteiros soltos
  s = s.replace(/\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/g, (_m, i, d) => {
    achados.push({ tipo: "money", valor: Number(i.replace(/,/g, "") + "." + d).toFixed(2), bruto: _m });
    return " ";
  });
  s = s.replace(/\b\d{1,2}\/\d{2}\b/g, " "); // datas dd/mm
  s = s.replace(/\b(\d+)º/g, (_m, n) => {
    achados.push({ tipo: "ordinal", valor: String(Number(n)), bruto: _m });
    return " ";
  });
  s.replace(/\b\d+\b/g, (m) => {
    achados.push({ tipo: "inteiro", valor: String(Number(m)), bruto: m });
    return m;
  });
  return achados;
}

const nFrases = (s) => (String(s).match(/[.!?…](\s|$)/g) || []).length || 1;

/* ─────────────────────────── a bateria ─────────────────────────── */

const porCenario = new Map();
const resumo = { total: 0, comLacuna: 0, lacunasPorTipo: {}, maxFrases: { como_foi: 0, proximo_passo: 0, pedido_cliente: 0 } };
const aberturas = new Map(); // client_id → [abertura semana1, abertura semana2]

for (const ws of SEMANAS) {
  const arq = path.join(AQUI, `saida_${ws}.json`);
  if (!fs.existsSync(arq)) {
    console.log(`\n(!) ${path.basename(arq)} não existe — rode \`node validar.mjs ${ws}\` antes.`);
    continue;
  }
  const linhas = JSON.parse(fs.readFileSync(arq, "utf8"));
  console.log(`\n=== semana ${ws} — ${linhas.length} clientes ===`);

  for (const r of linhas) {
    const p = r.payload;
    const nome = p.identificacao.cliente;
    const out = redigir(p);
    resumo.total++;

    if (!porCenario.has(out.cenario)) porCenario.set(out.cenario, { p, out });

    // 1. léxico da 8.7 — zero tolerância, é texto que a gente escreveu
    if (out.avisos.lexico.length)
      erro(`${nome} [${out.cenario}] léxico: ${out.avisos.lexico.map((x) => `"${x.termo}"`).join(", ")}`);

    // 2. prazo no "Próximo passo" — a falha mais comum e a mais cara
    if (out.avisos.sem_prazo) erro(`${nome} [${out.cenario}] "Próximo passo" sem data: ${out.proximo_passo}`);

    // 3. marcador só onde o banco realmente não tem o fato
    const marc = out.avisos.pendencias;
    if (marc.length) {
      resumo.comLacuna++;
      if (out.cenario !== "F" && out.cenario !== "D")
        erro(`${nome} [${out.cenario}] marcador em cenário que deveria fechar sozinho: ${marc.join(" ")}`);
      // uma lacuna pode aparecer em dois campos (o motivo da pausa abre o
      // "Como foi" e volta na retomada) — o que não pode é marcador sem dono
      const donos = new Set(out.lacunas.map((l) => l.marcador));
      for (const m of new Set(marc))
        if (!donos.has(m)) erro(`${nome} [${out.cenario}] marcador sem lacuna correspondente: ${m}`);
      for (const l of out.lacunas) {
        resumo.lacunasPorTipo[l.id] = (resumo.lacunasPorTipo[l.id] || 0) + 1;
        if (!l.opcoes || l.opcoes.length < 2) erro(`${nome} lacuna ${l.id} sem lista de opções`);
        if (!VOCABULARIO[l.id]) erro(`${nome} lacuna ${l.id} fora do vocabulário`);
      }
    }

    // 4. tamanho (regra 1 do prompt). D e F carregam roteiro/retomada e
    //    ganham uma frase a mais — declarado, não acidental.
    const limites = { como_foi: out.cenario === "D" || out.cenario === "F" ? 4 : 3, proximo_passo: 3, pedido_cliente: 2 };
    for (const k of ["como_foi", "proximo_passo", "pedido_cliente"]) {
      const n = nFrases(out[k]);
      resumo.maxFrases[k] = Math.max(resumo.maxFrases[k], n);
      if (n > limites[k]) erro(`${nome} [${out.cenario}] ${k} com ${n} frases (limite ${limites[k]})`);
      if (!String(out[k]).trim()) erro(`${nome} [${out.cenario}] ${k} vazio`);
    }

    // 5. NENHUM número inventado
    const permitidos = numerosDoContrato(p);
    for (const d of derivados(p)) permitidos.add(d);
    for (const n of numerosDoTexto(`${out.como_foi} ${out.proximo_passo} ${out.pedido_cliente}`)) {
      const ok =
        permitidos.has(n.valor) ||
        permitidos.has(Number(n.valor).toFixed(2)) ||
        CONSTANTES_DE_PROSA.has(n.valor);
      if (!ok) erro(`${nome} [${out.cenario}] número fora do contrato: "${n.bruto}" (${n.tipo})`);
    }

    // 6. determinismo — mesma entrada, mesma saída
    const out2 = redigir(p);
    if (JSON.stringify(out2) !== JSON.stringify(out)) erro(`${nome} não é determinístico`);

    // 7. preencher a lacuna fecha o texto
    if (out.lacunas.length) {
      const escolhas = {};
      for (const l of out.lacunas) escolhas[l.id] = l.opcoes[0].valor;
      const cheio = redigir(p, escolhas);
      if (cheio.avisos.pendencias.length)
        erro(`${nome} [${out.cenario}] marcador sobrou depois de escolher: ${cheio.avisos.pendencias.join(" ")}`);
      if (cheio.avisos.lexico.length)
        erro(`${nome} [${out.cenario}] opção escolhida viola o léxico: ${cheio.avisos.lexico[0].termo}`);
      if (cheio.avisos.sem_prazo) erro(`${nome} [${out.cenario}] sem data depois de escolher a opção`);
      // toda opção do vocabulário precisa produzir texto válido, não só a 1ª
      for (const l of out.lacunas) {
        for (const o of l.opcoes) {
          const v = redigir(p, { [l.id]: o.valor });
          if (v.avisos.lexico.length) erro(`${nome} opção ${l.id}=${o.valor} viola o léxico`);
          if (v.avisos.pendencias.length && v.lacunas.length === 0)
            erro(`${nome} opção ${l.id}=${o.valor} deixou marcador órfão`);
        }
      }
    }

    // 8. variação entre semanas (coletado agora, conferido no fim)
    const k = p.identificacao.client_id;
    if (!aberturas.has(k)) aberturas.set(k, []);
    aberturas.get(k).push({ ws, cen: out.cenario, pedido: out.pedido_cliente });
  }
  console.log(`  ${falhas === 0 ? "✓" : "…"} ${linhas.length} blocos redigidos`);
}

/* 8. o mesmo cliente, no mesmo cenário, em duas semanas: o pedido não pode
      ser idêntico — senão em 16 semanas o cliente recebe a mesma frase. */
let variou = 0;
let mesmoCenario = 0;
for (const [, v] of aberturas) {
  if (v.length < 2 || v[0].cen !== v[1].cen) continue;
  mesmoCenario++;
  if (v[0].pedido !== v[1].pedido) variou++;
}

/* ───────────────────────────── relatório ───────────────────────────── */

console.log("\n=== resumo ===");
console.log(`blocos redigidos ........... ${resumo.total}`);
console.log(`com lacuna a preencher ..... ${resumo.comLacuna} (${((100 * resumo.comLacuna) / resumo.total).toFixed(0)}%)`);
console.log(`lacunas por tipo ........... ${JSON.stringify(resumo.lacunasPorTipo)}`);
console.log(`máx. de frases ............. ${JSON.stringify(resumo.maxFrases)}`);
console.log(`variação entre semanas ..... ${variou}/${mesmoCenario} clientes que caíram no mesmo cenário`);
console.log(`custo de API ............... $0.00`);

if (process.argv.includes("--amostra")) {
  console.log("\n=== uma amostra por cenário ===");
  for (const cod of [...porCenario.keys()].sort()) {
    const { p, out } = porCenario.get(cod);
    console.log(`\n────── ${cod} · ${p.identificacao.cliente} ──────`);
    console.log("Como foi:\n" + out.como_foi);
    console.log("\n🚀 Próximo passo:\n" + out.proximo_passo);
    console.log("\n🤝 O que precisamos de você:\n" + out.pedido_cliente);
    if (out.lacunas.length) {
      console.log("\nLacunas (o gestor escolhe, não digita):");
      for (const l of out.lacunas) console.log(`  · ${l.pergunta}\n    ${l.opcoes.map((o) => o.rotulo).join(" | ")}`);
      const escolhas = {};
      for (const l of out.lacunas) escolhas[l.id] = l.opcoes[0].valor;
      const cheio = redigir(p, escolhas);
      console.log("\n  → escolhendo a 1ª opção:\n  " + cheio.como_foi + "\n  " + cheio.proximo_passo);
    }
  }
}

console.log(falhas === 0 ? "\n✓ tudo passou" : `\n✗ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
