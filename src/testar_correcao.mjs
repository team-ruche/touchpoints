/* =====================================================================
 * testar_correcao.mjs — a correção de número e o envio para a CS.
 *
 *   node testar_correcao.mjs [saida_2026-08-17.json]
 *
 * Duas coisas novas entraram numa tela cuja regra era "nenhum número nasce
 * aqui". Elas são exceções declaradas, e exceção sem teste vira buraco:
 *
 *   1. corrigir número à mão. O risco não é o número corrigido — é o texto
 *      continuar citando o antigo, que é EXATAMENTE o defeito que originou
 *      o projeto (número certo no cabeçalho, número velho no parágrafo).
 *   2. mandar o touchpoint para a conversa privada da CS. O risco é a nota
 *      interna (o de→para de uma correção) vazar para o canal do cliente.
 *
 * A seção 10 roda o Code node GERADO do envio — não o fonte — porque é lá
 * que a separação entre "canal do cliente" e "DM da CS" acontece.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redigir } from "./redacao.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.dirname(AQUI);

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
        "\nexport { S, CS, aplicarCorrecoes, camposCorrigiveis, resumoCorrecao, linhaCorrecao," +
        " citaNumeroAntigo, montarMensagem, checklist, salvarCorrecao, correcaoDe, payloadDe," +
        " temCorrecao, notaInternaDe, correcoesDaSemana, blocosParaEnvio, salvarRascunho, money, incoerencias };",
    ).toString("base64")
);

const arq = process.argv[2] || path.join(AQUI, "saida_2026-08-17.json");
const linhas = JSON.parse(fs.readFileSync(arq, "utf8"));
const SEMANA = linhas[0].payload.semana.inicio;
mod.S.linhas = linhas;
mod.S.semana = SEMANA;

let falhas = 0;
const erro = (m) => {
  falhas++;
  console.log("  ✗ " + m);
};
const ok = (m) => console.log("  ✓ " + m);
const eq = (rot, obtido, esperado) =>
  obtido === esperado ? ok(`${rot}: ${obtido}`) : erro(`${rot}: ${obtido} (esperado ${esperado})`);
const verdade = (rot, cond) => (cond ? ok(rot) : erro(rot));

const texto3 = (j) => ({ comoFoi: j.como_foi, proximoPasso: j.proximo_passo, pedido: j.pedido_cliente });

console.log(`contrato: ${linhas.length} clientes · semana ${SEMANA}\n`);

/* ── 1. sem correção, nada muda ── */
console.log("1) sem correção o contrato é o mesmo objeto");
const r0 = linhas.find((r) => r.payload.midia.total.leads > 0 && r.payload.midia.total.spend > 0);
verdade("aplicarCorrecoes(p, null) devolve o próprio p", mod.aplicarCorrecoes(r0.payload, null) === r0.payload);
verdade("payloadDe() sem correção devolve o próprio payload", mod.payloadDe(r0) === r0.payload);
verdade("temCorrecao() é falso", !mod.temCorrecao(r0));
verdade("checklist diz que ninguém corrigiu nada",
  mod.checklist(r0.payload, { comoFoi: "x", proximoPasso: "y", pedido: "z" }).find((c) => c.id === "correcao").ok);

/* ── 2. corrigir leads refaz CPL por SOMA, total e variação ── */
console.log("\n2) o derivado é refeito, não fica velho");
const plat0 = Object.keys(r0.payload.midia.por_plataforma)[0];
const spend0 = r0.payload.midia.por_plataforma[plat0].spend;
const c2 = { campos: { [`midia.por_plataforma.${plat0}.leads`]: 40 }, motivo: "teste" };
const p2 = mod.aplicarCorrecoes(r0.payload, c2);
eq("leads da plataforma", p2.midia.por_plataforma[plat0].leads, 40);
eq("CPL da plataforma = spend/leads", p2.midia.por_plataforma[plat0].cpl, Math.round((spend0 / 40) * 100) / 100);
eq("total.leads soma as plataformas", p2.midia.total.leads,
  Object.values(p2.midia.por_plataforma).reduce((a, m) => a + m.leads, 0));
eq("total.cpl = soma(spend)/soma(leads)", p2.midia.total.cpl,
  Math.round((p2.midia.total.spend / p2.midia.total.leads) * 100) / 100);
eq("var_leads contra a semana anterior", p2.comparacao.var_leads,
  p2.midia.total.leads - p2.comparacao.semana_anterior.leads);
verdade("o payload original não foi tocado", r0.payload.midia.por_plataforma[plat0].leads !== 40);
verdade("a correção fica registrada no payload", p2.correcao.motivo === "teste");
verdade("a proveniência declara a mão humana", /corrigido/.test(p2.proveniencia.correcao_manual));

/* ── 3. o caso que motivou tudo: plataforma que não existe no banco ── */
console.log("\n3) investimento que nunca chegou ao ad_insights (#526 GTF)");
const rZero = linhas.find(
  (r) => Object.keys(r.payload.midia.por_plataforma).length === 0 && r.payload.midia.renderizar.includes("meta"),
);
if (!rZero) erro("nenhum cliente sem plataforma nesta semana — teste não exercitado");
else {
  const campos = mod.camposCorrigiveis(rZero.payload).map((c) => c.id);
  verdade("meta aparece como corrigível mesmo sem linha no banco",
    campos.includes("midia.por_plataforma.meta.spend") && campos.includes("midia.por_plataforma.meta.leads"));
  const p3 = mod.aplicarCorrecoes(rZero.payload, {
    campos: { "midia.por_plataforma.meta.spend": 1200, "midia.por_plataforma.meta.leads": 8, "cenario.codigo": "B" },
    motivo: "conta do Meta nunca sincronizou",
  });
  eq("spend total", p3.midia.total.spend, 1200);
  eq("CPL", p3.midia.total.cpl, 150);
  eq("spend renderizável", p3.midia.total.spend_renderizavel, 1200);
  eq("cenário reclassificado à mão", p3.cenario.codigo, "B");
  const msg = mod.montarMensagem(p3, { comoFoi: "a", proximoPasso: "b", pedido: "c" });
  verdade("a mensagem deixa de dizer “sem investimento”", !msg.includes("Sem investimento no período"));
  verdade("a mensagem imprime o valor corrigido", msg.includes("$1,200.00") && msg.includes("📩 Leads Generated: 8"));
}

/* ── 4. o rótulo da meta: número certo, origem falsa é o bug de origem ── */
console.log("\n4) origem da meta troca o rótulo, não o número");
// um cliente cuja PROSA muda com a origem da meta: o cenário D e o E não
// citam o mês, e num deles o rótulo não teria onde aparecer
const clonar = (o) => JSON.parse(JSON.stringify(o));
const comRotulo = (r, origem) => {
  const p = clonar(r.payload);
  p.agendamento.origem_meta = origem;
  return redigir(p).como_foi;
};
const rMeta =
  linhas.find(
    (r) => r.payload.agendamento.meta_usada != null && comRotulo(r, "contrato") !== comRotulo(r, "benchmark"),
  ) || linhas.find((r) => r.payload.agendamento.meta_usada != null);
const pC = mod.aplicarCorrecoes(rMeta.payload, { campos: { "agendamento.origem_meta": "contrato" }, motivo: "x" });
const pB = mod.aplicarCorrecoes(rMeta.payload, { campos: { "agendamento.origem_meta": "benchmark" }, motivo: "x" });
/* O bloco "📊 No mês" saiu da mensagem em 02/09/2026, e com ele a linha
   "• Agendamentos: N de M contratados" — que era ONDE este rótulo aparecia.
   A distinção não desapareceu: ela vive na prosa do "Como foi", escrita pela
   régua. Este caso mudou de lugar junto com ela, porque a regra que ele
   segura é a mesma e continua sendo a mais cara do projeto: benchmark do
   nicho NUNCA pode ser apresentado como meta contratada. */
const t4 = { comoFoi: "a", proximoPasso: "b", pedido: "c" };
verdade("o rótulo saiu da mensagem junto com o bloco do mês",
  !mod.montarMensagem(pC, t4).includes("contratados") && !mod.montarMensagem(pC, t4).includes("📊 No mês"));
/* A régua tem quatro frases diferentes para o mês (com e sem agendamento,
   faltando ou não faltando), e cada uma diz "meta" de um jeito. O que vale
   em TODAS é o par abaixo: a palavra "contratado" só pode existir quando a
   meta veio do contrato, e "referência da sua vertical" só quando veio do
   benchmark. Amarrar a frase exata amarraria a régua; amarrar o par amarra
   a regra. */
const proC = texto3(redigir(pC)).comoFoi;
const proB = texto3(redigir(pB)).comoFoi;
verdade("a origem realmente muda a prosa", proC !== proB);
verdade("a prosa do benchmark JAMAIS diz contratado", !/contratad/i.test(proB));
verdade("a prosa do benchmark diz que a referência é da vertical", /vertical/i.test(proB));
verdade("a prosa do contrato JAMAIS chama a meta de referência da vertical", !/vertical/i.test(proC));
verdade("e ela fala de meta ou de contratado", /\bmeta\b|contratad/i.test(proC));
eq("o número da meta não mudou", pC.agendamento.meta_usada, rMeta.payload.agendamento.meta_usada);

/* ── 5. a régua reescreve em cima do número corrigido ── */
console.log("\n5) a redação sai coerente com o número corrigido");
const alvo = linhas.find((r) => r.pode_gerar && r.payload.midia.total.leads > 1);
const leadsAntigos = alvo.payload.midia.total.leads;
const pR = mod.aplicarCorrecoes(alvo.payload, {
  campos: { [`midia.por_plataforma.${Object.keys(alvo.payload.midia.por_plataforma)[0]}.leads`]: leadsAntigos + 17 },
  motivo: "leads conferidos no gerenciador",
});
const escrito = texto3(redigir(pR));
eq("o texto cita o número novo", /\d+/.test(escrito.comoFoi) && escrito.comoFoi.includes(String(leadsAntigos + 17)), true);
eq("nenhum número de antes da correção sobrou", mod.citaNumeroAntigo(pR, escrito).length, 0);
verdade("a mensagem final imprime o corrigido",
  mod.montarMensagem(pR, escrito).includes(`📩 Leads Generated: ${leadsAntigos + 17}`));

/* ── 6. e a guarda pega o texto que ficou para trás ── */
console.log("\n6) texto escrito à mão que ficou com o número velho");
const velho = { comoFoi: `A semana teve ${leadsAntigos} leads.`, proximoPasso: "b", pedido: "c" };
verdade("citaNumeroAntigo acha o número antigo", mod.citaNumeroAntigo(pR, velho).includes(String(leadsAntigos)));
verdade("o checklist reprova", !mod.checklist(pR, velho).find((c) => c.id === "texto_corrigido").ok);
verdade("e aprova o texto reescrito", mod.checklist(pR, escrito).find((c) => c.id === "texto_corrigido").ok);
verdade("correção sem motivo reprova no checklist",
  !mod.checklist(mod.aplicarCorrecoes(alvo.payload, { campos: { "agendamento.semana": 9 }, motivo: "" }), escrito)
    .find((c) => c.id === "correcao").ok);

/* ── 7. a correção sobrevive ao "voltar ao esqueleto" ── */
console.log("\n7) o que a tela guarda");
mod.salvarCorrecao(SEMANA, alvo.client_id, { campos: { "agendamento.semana": 7 }, motivo: "agendamento conferido no GHL" });
verdade("temCorrecao passa a ser verdade", mod.temCorrecao(alvo));
eq("payloadDe já vem corrigido", mod.payloadDe(alvo).agendamento.semana, 7);
eq("resumo em uma linha", mod.resumoCorrecao(alvo.payload, mod.correcaoDe(SEMANA, alvo.client_id)).length, 1);
verdade("o resumo diz de→para",
  mod.linhaCorrecao(mod.resumoCorrecao(alvo.payload, mod.correcaoDe(SEMANA, alvo.client_id))[0]).includes("→"));
eq("a semana lista o cliente corrigido", mod.correcoesDaSemana().length, 1);

/* ── 8. a nota interna nunca entra na mensagem do cliente ── */
console.log("\n8) a nota interna fica fora da mensagem");
mod.salvarRascunho(SEMANA, alvo.client_id, { texto: escrito, origem: "regua", lacunas: [], escolhas: {} });
const porGestor = mod.blocosParaEnvio();
let bloco = null;
for (const bs of porGestor.values()) bloco = bs.find((b) => b.client_id === alvo.client_id) || bloco;
verdade("o bloco carrega nota_interna", Boolean(bloco && bloco.nota_interna));
verdade("a nota diz o motivo", /agendamento conferido no GHL/.test(bloco.nota_interna));
verdade("a mensagem do cliente NÃO tem a nota", !bloco.message_text.includes("corrigido à mão"));
verdade("a mensagem do cliente NÃO tem o motivo", !bloco.message_text.includes("conferido no GHL"));
eq("a mensagem imprime o agendamento corrigido",
  /📅 Agendamentos na semana: (\d+)/.exec(bloco.message_text)[1], "7");

/* ── 9. quem não foi corrigido não ganha nota ── */
// Precisa ser um cliente que a régua FECHA sozinha: bloco com lacuna fica
// "pendente" e nem chega ao envio, então não provaria nada aqui.
let outro = null;
let semNota = null;
for (const r of linhas) {
  if (r.client_id === alvo.client_id || !r.pode_gerar) continue;
  mod.salvarRascunho(SEMANA, r.client_id, {
    texto: texto3(redigir(r.payload)), origem: "regua", lacunas: [], escolhas: {},
  });
  for (const bs of mod.blocosParaEnvio().values()) {
    const achado = bs.find((b) => b.client_id === r.client_id);
    if (achado) semNota = achado;
  }
  if (semNota) {
    outro = r;
    break;
  }
}
if (!outro) erro("nenhum cliente fecha sozinho nesta semana — teste não exercitado");
verdade("bloco sem correção não tem nota_interna", semNota && !("nota_interna" in semNota));
verdade("notaInternaDe devolve null", mod.notaInternaDe(outro) === null);

/* ── 9b. semana e mês têm de fechar entre si ── */
console.log("\n9b) correção pela metade");
let naturais = 0;
for (const r of linhas) naturais += mod.incoerencias(r.payload).length ? 1 : 0;
eq("nenhum cliente real já nasce incoerente", naturais, 0);
const meia = mod.aplicarCorrecoes(alvo.payload, {
  campos: { [`midia.por_plataforma.${Object.keys(alvo.payload.midia.por_plataforma)[0]}.leads`]: 999 },
  motivo: "corrigi a semana e esqueci o mês",
});
verdade("corrigir a semana sem o mês é pego", mod.incoerencias(meia).length > 0);
verdade("o checklist reprova", !mod.checklist(meia, escrito).find((c) => c.id === "coerencia").ok);
const inteira = mod.aplicarCorrecoes(alvo.payload, {
  campos: {
    [`midia.por_plataforma.${Object.keys(alvo.payload.midia.por_plataforma)[0]}.leads`]: 999,
    "mes.leads": 1200,
  },
  motivo: "corrigi os dois",
});
eq("corrigindo os dois, fecha", mod.incoerencias(inteira).length, 0);

/* ── 10. o Code node GERADO do envio: canal x DM da CS ── */
console.log("\n10) o workflow de envio, no código que vai para o n8n");
const wf = JSON.parse(fs.readFileSync(path.join(LIVE, "n8n", "03_mb-touchpoint-envio.json"), "utf8"));
const codigo = wf.nodes.find((n) => n.name === "Montar bloco").parameters.jsCode;
const cfg = Object.fromEntries(
  wf.nodes.find((n) => n.name === "Config").parameters.assignments.assignments.map((a) => [a.name, a.value]),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function rodar(corpo) {
  globalThis.$ = (nome) => {
    const nos = {
      Config: { first: () => ({ json: cfg }) },
      Webhook: { first: () => ({ json: { headers: { "x-tp-token": cfg.token }, body: corpo } }) },
    };
    if (!nos[nome]) throw new Error("node desconhecido: " + nome);
    return nos[nome];
  };
  const saida = await new AsyncFunction(codigo)();
  return saida[0].json;
}

const blocos = [bloco, semNota].filter(Boolean);
const comum = { blocos, gestor: "Lucas Bragança", periodo: "17/08 a 23/08", week_start: SEMANA };

const noCanal = await rodar({ ...comum, confirmar: true });
eq("canal: destino", noCanal.destino, "canal");
eq("canal: channel_id é o Touchpoints", noCanal.channel_id, cfg.clickup_canal);
verdade("canal: cabeçalho @gestor", noCanal.mensagem.startsWith("**@Lucas Bragança**"));
verdade("canal: SEM nota interna", !noCanal.mensagem.includes("corrigido à mão"));
verdade("canal: SEM o motivo da correção", !noCanal.mensagem.includes("conferido no GHL"));
verdade("canal: publica com os dois cadeados", noCanal.publicar === true && noCanal.dry_run === false);

const mapa = JSON.parse(cfg.cs_destinos);
for (const chave of Object.keys(mapa)) {
  const noCS = await rodar({ ...comum, destino: "cs", cs: chave, confirmar: true });
  eq(`cs ${chave}: destino`, noCS.destino, "cs");
  eq(`cs ${chave}: vai para a conversa privada`, noCS.channel_id, mapa[chave].channel_id);
  verdade(`cs ${chave}: não usa o canal do cliente`, noCS.channel_id !== cfg.clickup_canal);
  verdade(`cs ${chave}: cabeçalho de cópia interna`, noCS.mensagem.startsWith("🔒 **Touchpoints"));
  verdade(`cs ${chave}: nomeia a CS`, noCS.mensagem.includes(mapa[chave].nome));
  verdade(`cs ${chave}: carrega a nota interna`, noCS.mensagem.includes("⚠️") && noCS.mensagem.includes("conferido no GHL"));
  verdade(`cs ${chave}: o bloco do cliente é o MESMO texto`, noCS.mensagem.includes(bloco.message_text));
}

/* CS desconhecida, canal errado por digitação, marcador e cadeados */
let recusou = "";
try {
  await rodar({ ...comum, destino: "cs", cs: "fulana", confirmar: true });
} catch (e) {
  recusou = String(e.message);
}
verdade("CS desconhecida é recusada com a lista das conhecidas",
  /CS desconhecida/.test(recusou) && /eduarda/.test(recusou));

const semConfirmar = await rodar({ ...comum, destino: "cs", cs: "eduarda" });
verdade("CS sem confirmar volta prévia", semConfirmar.dry_run === true && /confirmar/.test(semConfirmar.motivo_dry_run));

let barrou = "";
try {
  await rodar({
    ...comum,
    destino: "cs",
    cs: "eduarda",
    blocos: [{ client_id: "x", cliente: "#000 TESTE", message_text: "sobrou um [MB: motivo] aqui" }],
    confirmar: true,
  });
} catch (e) {
  barrou = String(e.message);
}
verdade("marcador [ ] é barrado também no caminho da CS", /marcador/.test(barrou));

console.log(falhas ? `\n✗ ${falhas} falha(s)` : "\n✓ tudo passou");
process.exit(falhas ? 1 : 0);
