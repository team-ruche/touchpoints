/* =====================================================================
 * testar_webhooks.mjs — bate nos três webhooks publicados e confere a saída
 * contra o gabarito. É o teste de ponta a ponta que só dá para fazer depois
 * de o workflow estar no ar.
 *
 *   node testar_webhooks.mjs 2026-08-17 [gabarito.json]
 *
 * O envio é chamado SEM `confirmar`, então é dry-run: nada é publicado no
 * canal do ClickUp.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redigir } from "./redacao.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.dirname(AQUI);

const wf = JSON.parse(fs.readFileSync(path.join(LIVE, "n8n", "01_mb-touchpoint-week.json"), "utf8"));
const TOKEN = Object.fromEntries(
  wf.nodes.find((n) => n.name === "Config").parameters.assignments.assignments.map((a) => [a.name, a.value]),
).token;
const BASE = "https://webhook.ruchedigital.online/webhook";

const week = process.argv[2] || "2026-08-17";
const gabPath = process.argv[3];

async function chamar(rota, corpo, ms = 240000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${BASE}/${rota}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tp-token": TOKEN },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* devolve o cru */ }
    return { status: r.status, j, txt, ms: Date.now() - t0 };
  } finally {
    clearTimeout(kill);
  }
}

/* ── 1. CORS: a tela roda em outra origem, isso precisa passar ── */
const pre = await fetch(`${BASE}/mb-touchpoint-week`, {
  method: "OPTIONS",
  headers: { Origin: "http://localhost:8080", "Access-Control-Request-Method": "POST",
             "Access-Control-Request-Headers": "content-type,x-tp-token" },
});
console.log(`1) preflight CORS -> ${pre.status} | allow-origin: ${pre.headers.get("access-control-allow-origin")} | allow-headers: ${pre.headers.get("access-control-allow-headers")}`);

/* ── 2. o cadeado do token recusa quem não tem ── */
const semToken = await fetch(`${BASE}/mb-touchpoint-week`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ week_start: week }),
});
console.log(`2) sem token -> ${semToken.status} ${semToken.status >= 400 ? "(recusado, correto)" : "⚠ ACEITOU"}`);

/* ── 3. semana que não é segunda-feira tem de ser recusada ── */
const terca = await chamar("mb-touchpoint-week", { week_start: "2026-08-18" }, 60000);
console.log(`3) week_start numa terça -> ${terca.status} ${terca.status >= 400 ? "(recusado, correto)" : "⚠ ACEITOU"}`);

/* ── 4. o contrato da semana ── */
const w = await chamar("mb-touchpoint-week", { week_start: week, tz: "America/New_York" });
console.log(`\n4) mb-touchpoint-week -> ${w.status} em ${(w.ms / 1000).toFixed(1)}s`);
if (w.status !== 200) {
  console.log("   corpo:", w.txt.slice(0, 800));
  process.exit(1);
}
const linhas = w.j.linhas;
console.log(`   total=${w.j.total} | leitura=`, w.j.leitura);
const conta = (f) => linhas.reduce((a, x) => ((a[f(x)] = (a[f(x)] || 0) + 1), a), {});
console.log("   semaforo:", conta((r) => r.semaforo));
console.log("   cenario :", conta((r) => r.cenario));

if (gabPath) {
  const gab = JSON.parse(fs.readFileSync(gabPath, "utf8"));
  const porId = new Map(linhas.map((r) => [r.client_id, r]));
  const C = [
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
  let iguais = 0; const difs = [];
  for (const g of gab) {
    const x = porId.get(g.client_id); if (!x) continue;
    const d = [];
    for (const [n, f] of C) {
      const [a, b] = f(g, x); const na = a ?? null, nb = b ?? null;
      const ok = typeof na === "number" && typeof nb === "number" ? Math.abs(na - nb) < 0.011 : na === nb;
      if (!ok) d.push(`${n}: py=${JSON.stringify(na)} n8n=${JSON.stringify(nb)}`);
    }
    d.length ? difs.push(`${g.cliente}: ${d.join(", ")}`) : iguais++;
  }
  console.log(`   ════ ${iguais}/${gab.length} idênticos ao gabarito ════`);
  for (const x of difs) console.log("   ✗ " + x);
}

/* ── 5. redação num cliente de verdade — SEM modelo de linguagem ──
   A asserção que importa: o workflow no ar devolve exatamente o que
   `redacao.js` devolve aqui. Se divergir, alguém editou o Code node à mão
   em vez de rodar o build.py — a segunda versão que a gente não quer. */
const alvo = linhas.find((r) => r.pode_gerar && r.cenario === "E") || linhas.find((r) => r.pode_gerar);
console.log(`\n5) mb-touchpoint-redacao — ${alvo.client_name} (cenário ${alvo.cenario})`);
const red = await chamar("mb-touchpoint-redacao", { contrato: alvo.payload });
console.log(`   -> ${red.status} em ${(red.ms / 1000).toFixed(1)}s`);
if (red.status !== 200) {
  console.log("   corpo:", red.txt.slice(0, 900));
} else if (red.j.ok === false) {
  console.log("   guarda de saída barrou:", red.j.erro, JSON.stringify(red.j).slice(0, 300));
} else {
  const local = redigir(alvo.payload);
  const bate = ["como_foi", "proximo_passo", "pedido_cliente"].every((k) => red.j[k] === local[k]);
  console.log(`   motor: ${red.j.motor} | custo_api: ${red.j.custo_api} | igual ao fonte: ${bate ? "sim" : "NÃO"}`);
  if (!bate)
    for (const k of ["como_foi", "proximo_passo", "pedido_cliente"])
      if (red.j[k] !== local[k]) console.log(`   ✗ ${k}\n     no ar: ${red.j[k]}\n     fonte: ${local[k]}`);
  console.log(`   avisos:`, JSON.stringify(red.j.avisos));
  console.log(`   lacunas:`, (red.j.lacunas || []).map((l) => l.id).join(", ") || "nenhuma");
  console.log(`\n   como_foi      : ${red.j.como_foi}`);
  console.log(`   proximo_passo : ${red.j.proximo_passo}`);
  console.log(`   pedido_cliente: ${red.j.pedido_cliente}`);
}

/* ── 5b. um cliente COM lacuna: responder pela lista tem de fechar o bloco ── */
const comLacuna = linhas.find((r) => r.pode_gerar && r.cenario === "F");
if (comLacuna) {
  const l1 = await chamar("mb-touchpoint-redacao", { contrato: comLacuna.payload });
  const lac = (l1.j && l1.j.lacunas) || [];
  console.log(`\n5b) lacuna — ${comLacuna.client_name}: ${lac.length} pergunta(s), ${(lac[0]?.opcoes || []).length} opções`);
  if (lac.length) {
    const escolhas = { [lac[0].id]: lac[0].opcoes[0].valor };
    const l2 = await chamar("mb-touchpoint-redacao", { contrato: comLacuna.payload, escolhas });
    const sobrou = (l2.j.avisos?.pendencias || []).length;
    console.log(`   escolhendo "${lac[0].opcoes[0].rotulo}" -> ${sobrou ? "AINDA TEM MARCADOR" : "bloco fechado"}`);
    console.log(`   como_foi      : ${l2.j.como_foi}`);
    console.log(`   proximo_passo : ${l2.j.proximo_passo}`);
  }
}

/* ── 6. envio: dry-run, tem de recusar publicar ── */
const bloco = {
  client_id: alvo.client_id,
  cliente: alvo.payload.identificacao.cliente,
  message_text: "Olá, Pessoal! Tudo bem? 👋\n\nTexto de teste sem marcador.",
};
const env = await chamar("mb-touchpoint-envio", {
  gestor: alvo.gestores[0] || "Teste",
  blocos: [bloco],
  periodo: "17/08 a 23/08",
  week_start: week,
});
console.log(`\n6) mb-touchpoint-envio (sem confirmar) -> ${env.status}`);
if (env.status === 200) {
  console.log(`   dry_run=${env.j.dry_run} | publicar=${env.j.publicar} | motivo: ${env.j.motivo_dry_run}`);
  console.log(`   caracteres=${env.j.caracteres} | canal=${env.j.channel_id}`);
} else console.log("   corpo:", env.txt.slice(0, 500));

/* ── 7. `confirmar: true` PUBLICA DE VERDADE desde 30/08 ──────────────────
 *
 * Este passo nasceu quando `envio_real_liberado` era false: mandar
 * `confirmar: true` provava que o segundo cadeado segurava. Quando o cadeado
 * foi liberado, o mesmo passo virou uma publicação real — e publicou, em
 * 01/09, um "**@Teste** ... Texto de teste sem marcador" no canal que os
 * clientes leem (apagado logo depois).
 *
 * A lição é a de sempre por aqui: teste que manda `confirmar` tem de dizer
 * PARA ONDE. Sem `--ensaio <channel_id>` ele não manda nada.
 */
const iEnsaio = process.argv.indexOf("--ensaio");
const canalEnsaio = iEnsaio > 0 ? process.argv[iEnsaio + 1] : null;
if (canalEnsaio) {
  const forc = await chamar("mb-touchpoint-envio", {
    gestor: "Teste", blocos: [bloco], periodo: "17/08 a 23/08", week_start: week,
    confirmar: true, channel_id: canalEnsaio,
  });
  console.log(`7) confirmar:true no canal de ensaio ${canalEnsaio} -> ${forc.status} | ` +
    `dry_run=${forc.j?.dry_run} | msg=${forc.j?.clickup_message_id || "—"}`);
} else {
  console.log("7) confirmar:true — PULADO de propósito.");
  console.log("   `envio_real_liberado` está aberto: com confirmar:true isto publicaria no");
  console.log("   canal Touchpoints, que o cliente lê. Para exercitar o POST de verdade:");
  console.log("   node testar_webhooks.mjs 2026-08-17 --ensaio 8cdt0k7-XXXXX");
}

/* ── 7b. a rota da CS: dry-run, só para provar que o destino resolve ── */
for (const cs of ["eduarda", "amanda"]) {
  const r = await chamar("mb-touchpoint-envio", {
    destino: "cs", cs, gestor: "Teste", blocos: [bloco],
    periodo: "17/08 a 23/08", week_start: week,
    // sem `confirmar`: isto NÃO manda DM para ninguém
  });
  const j = r.j || {};
  const separado = j.channel_id && j.channel_id !== env.j?.channel_id;
  console.log(`7b) destino cs=${cs} -> ${r.status} | ${j.cs_nome || "?"} | canal=${j.channel_id} ` +
    `${separado ? "(≠ canal do cliente, correto)" : "⚠ CAIU NO CANAL DO CLIENTE"} | dry_run=${j.dry_run}`);
}
const csRuim = await chamar("mb-touchpoint-envio", {
  destino: "cs", cs: "fulana", gestor: "Teste", blocos: [bloco],
  periodo: "17/08 a 23/08", week_start: week,
});
console.log(`7c) cs desconhecida -> ${csRuim.status} ${csRuim.status >= 400 ? "(recusada, correto)" : "⚠ ACEITOU"}`);

/* ── 8. bloco com marcador tem de ser recusado pelo servidor ── */
const marc = await chamar("mb-touchpoint-envio", {
  gestor: "Teste", periodo: "17/08 a 23/08", week_start: week,
  blocos: [{ ...bloco, message_text: "Volta ao ar em [data]." }],
});
console.log(`8) bloco com marcador [ ] -> ${marc.status} ${marc.status >= 400 ? "(recusado, correto)" : "⚠ ACEITOU"}`);
