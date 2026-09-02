/* =====================================================================
 * testar_periodo.mjs — o recorte livre (de tal dia até tal dia).
 *
 *   node testar_periodo.mjs [saida_2026-08-17.json]
 *
 * A tela deixou de saber só "semana fechada de segunda a domingo". Quem
 * escolhe as duas pontas ganha três riscos novos, e cada um tem asserção
 * aqui:
 *
 *   1. a JANELA. Comparar 21 dias contra os 7 anteriores inventaria uma
 *      queda de dois terços. O período anterior tem de ter o mesmo tamanho.
 *   2. o BENCHMARK. Ele é mensal; a fatia de um recorte de N dias é
 *      proporcional a N — e para N = 7 tem de continuar dando exatamente o
 *      número de antes, senão a validação 44/44 contra o Python cai.
 *   3. o TEXTO. Todo este projeto existe porque um número certo saiu com o
 *      rótulo errado ("Appointments Booked"). Chamar 21 dias de "semana" é
 *      o mesmo defeito com outra roupa.
 *
 * Nada aqui vai à rede.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { janela, ehSemanaPadrao, rotuloPeriodo, construir } from "./contrato.js";
import { redigir, paraPeriodo, osN } from "./redacao.js";

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
const app = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      fonte +
        "\nexport { S, montarMensagem, partesMensagem, incoerencias, chaveP, fimP, diasP," +
        " periodoPadrao, rotuloPeriodo as rotuloPeriodoApp, ehSemanaPadrao as ehSemanaPadraoApp," +
        " somaDias, diasEntre, ontem, pendencias, termosProibidos, checklist };",
    ).toString("base64")
);

let falhas = 0;
const erro = (m) => {
  falhas++;
  console.log("  ✗ " + m);
};
const eq = (rotulo, obtido, esperado) => {
  if (JSON.stringify(obtido) !== JSON.stringify(esperado)) erro(`${rotulo}: ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`);
  else console.log(`  ✓ ${rotulo}: ${JSON.stringify(obtido)}`);
};
const ok = (rotulo, cond, detalhe) => (cond ? console.log(`  ✓ ${rotulo}`) : erro(`${rotulo}${detalhe ? " — " + detalhe : ""}`));

/* ═══ 1. a janela ═══════════════════════════════════════════════════ */
console.log("1) janela");

const semana = janela("2026-08-17");
eq("semana fechada continua 7 dias", [semana.w0_ini, semana.w0_fim, semana.dias], ["2026-08-17", "2026-08-23", 7]);
eq(
  "passar o domingo explícito não muda nada",
  janela("2026-08-17", "2026-08-23"),
  semana,
);

const quinze = janela("2026-08-10", "2026-08-24");
eq("15 dias", quinze.dias, 15);
eq("o período anterior tem o MESMO tamanho", [quinze.w1_ini, quinze.w1_fim], ["2026-07-26", "2026-08-09"]);
eq("e o retrasado também", [quinze.w2_ini, quinze.w2_fim], ["2026-07-11", "2026-07-25"]);
ok(
  "as três janelas não se sobrepõem e são contíguas",
  quinze.w2_fim < quinze.w1_ini && quinze.w1_fim < quinze.w0_ini,
);
eq("um dia só é um período válido", janela("2026-08-20", "2026-08-20").dias, 1);
eq("fim antes do começo cai na semana de 7 dias", janela("2026-08-17", "2026-08-10").w0_fim, "2026-08-23");

eq("mês é o do último dia (regra do SQL)", janela("2026-08-20", "2026-09-05").mes_ini, "2026-09-01");

eq("semana padrão", ehSemanaPadrao("2026-08-17", "2026-08-23"), true);
eq("seg a seg NÃO é semana padrão", ehSemanaPadrao("2026-08-17", "2026-08-24"), false);
eq("ter a seg NÃO é semana padrão", ehSemanaPadrao("2026-08-18", "2026-08-24"), false);

/* ═══ 2. o rótulo ═══════════════════════════════════════════════════ */
console.log("\n2) rótulo — as duas implementações não podem divergir");
for (const [a, b] of [
  ["2026-08-17", "2026-08-23"],
  ["2026-08-04", "2026-09-01"],
  ["2026-01-01", "2026-01-01"],
  ["2025-12-29", "2026-01-04"],
]) {
  const c = rotuloPeriodo(a, b);
  const t = app.rotuloPeriodoApp(a, b);
  if (c !== t) erro(`contrato.js diz "${c}" e app.js diz "${t}" para ${a}..${b}`);
  else console.log(`  ✓ ${a}..${b} → ${c}`);
}
eq("a semana fechada mantém o rótulo de 16 semanas", rotuloPeriodo("2026-08-17", "2026-08-23"), "Mon, 08/17 to Sun, 08/23");

/* ═══ 3. o benchmark é fatiado, e 7 dias não muda nada ═══════════════ */
console.log("\n3) benchmark proporcional");

/** Um cliente sintético, com dados só onde o cálculo olha. */
const CID = "c1";
const cliente = {
  id: CID, name: "#001 TESTE", number: "001", number_int: 1, gestor_mb: "Fulano",
  company_niche: "flooring", tier_client: null, plan_client: null,
  appointment_quantity: 26, appointment_value: null,
  account_id_meta: "act_1", account_id_google: null, account_id_glsa: null,
};
const insight = (d, spend, leads) => ({
  client_id: CID, insight_date: d, platform: "meta", campaign_name: "x",
  spend, leads, impressions: 100, clicks: 10, page_views: 5,
});
/** 14 dias de investimento igual: 2 leads e $100 por dia. */
const dias14 = [];
for (let k = 0; k < 28; k++) {
  const d = new Date(Date.UTC(2026, 7, 3) + k * 86400000).toISOString().slice(0, 10);
  dias14.push(insight(d, 100, 2));
}
const dados = {
  clients: [cliente],
  insights: dias14,
  appts: [],
  benchmarks: [{ niche: "flooring", cpl: 50, leads_month: 43.3, appt_booked: 26 }],
  opts: [],
  primeiroDia: { [CID]: "2026-01-01" },
};

const umaSemana = construir(dados, { week_start: "2026-08-17", tz: "America/New_York", render_platforms: ["meta"] })[0].payload;
const duasSemanas = construir(dados, { week_start: "2026-08-10", week_end: "2026-08-23", tz: "America/New_York", render_platforms: ["meta"] })[0].payload;

eq("7 dias: 14 leads", umaSemana.midia.total.leads, 14);
eq("14 dias: 28 leads", duasSemanas.midia.total.leads, 28);
// bm_leads_mes = 43,3 → semana = 43,3/4,33 = 10 leads; 14 dias = 20 leads.
eq("alvo de leads da semana", umaSemana.benchmark.bm_leads_semana, 10);
eq("alvo de leads em 14 dias dobra", duasSemanas.benchmark.bm_leads_semana, 20);
eq("ritmo de leads é o MESMO nos dois recortes", duasSemanas.benchmark.ritmo_leads, umaSemana.benchmark.ritmo_leads);
ok(
  "o ritmo não seria o mesmo sem fatiar (prova de que a conta é essa)",
  Math.abs(28 / 10 - umaSemana.benchmark.ritmo_leads) > 0.5,
  "o teste ficaria verde por acaso",
);
eq("meta de agendamento da semana", umaSemana.benchmark.bm_appt_semana, 6);
// 26/4,33 = 6,0046 → arredonda para 6,00 em 7 dias e 12,01 em 14: o
// arredondamento é do contrato, não da fatia.
eq("meta de agendamento em 14 dias", duasSemanas.benchmark.bm_appt_semana, 12.01);
eq("cenário não muda por causa do tamanho", duasSemanas.cenario.codigo, umaSemana.cenario.codigo);

eq("semana fechada se declara padrão", umaSemana.semana.padrao, true);
eq("recorte de 14 dias NÃO se declara padrão", duasSemanas.semana.padrao, false);
eq("e leva os dias junto", duasSemanas.semana.dias, 14);

// piso do cenário E ($150 na semana) proporcional
const semLead = {
  ...dados,
  insights: dias14.map((x) => ({ ...x, leads: 0, spend: 30 })), // $30/dia, 0 lead
};
const cenarioDe = (dados, ini, fim) =>
  construir(dados, { week_start: ini, week_end: fim, tz: "America/New_York", render_platforms: ["meta"] })[0].cenario;

eq("E entra na semana ($210 investidos, zero lead)", cenarioDe(semLead, "2026-08-17"), "E");
// o piso encolhe com o recorte curto: $30 num dia é 1/7 de $210, e continua
// sendo incidente — com o piso cheio de $150 seria classificado como semana
// fraca, que é uma leitura mais macia do que o dado permite.
eq("e continua entrando num dia só ($30 contra piso de $21,43)", cenarioDe(semLead, "2026-08-17", "2026-08-17"), "E");
// mas NÃO cresce no recorte longo: um mês inteiro com investimento e nenhum
// lead é incidente com qualquer régua.
const mesSemLead = { ...dados, insights: dias14.map((x) => ({ ...x, leads: 0, spend: 10 })) };
eq("28 dias com $280 e zero lead continua sendo E", cenarioDe(mesSemLead, "2026-08-03", "2026-08-30"), "E");
// e o ruído de verdade não vira incidente
const pouco = { ...dados, insights: dias14.map((x) => ({ ...x, leads: 0, spend: 5 })) };
eq("um dia com $5 e zero lead NÃO é incidente", cenarioDe(pouco, "2026-08-17", "2026-08-17") !== "E", true);

/* ═══ 4. o texto deixa de se chamar semana ═══════════════════════════ */
console.log("\n4) redação — 'semana' vira 'período'");

const FUTURO = /pr[óo]ximas?\s+semanas?|semanas?\s+(?:que\s+vem|seguinte)/gi;
const CONCORDANCIA = /\b(a|as|da|das|na|nas|uma|umas|esta|estas|essa|essas|nesta|nestas|desta|destas|mesma|mesmas|outra|outras|toda|todas|pela|pelas)\s+per[íi]odos?\b/i;

const arq = process.argv[2] || path.join(AQUI, "saida_2026-08-17.json");
const linhas = JSON.parse(fs.readFileSync(arq, "utf8"));
console.log(`  (${linhas.length} clientes reais de ${path.basename(arq)})`);

let comSemana = 0;
let comConcordancia = 0;
let comLexico = 0;
let semData = 0;
let mudou = 0;
const exemplos = [];

for (const r of linhas) {
  const p = JSON.parse(JSON.stringify(r.payload));
  // o mesmo contrato, declarado como recorte de 21 dias
  p.semana.padrao = false;
  p.semana.dias = 21;
  p.semana.inicio = "2026-08-03";
  p.semana.label = rotuloPeriodo("2026-08-03", p.semana.fim);

  const escolhas = {};
  // responde toda lacuna com a primeira opção, para exercitar o texto fechado
  const seco = redigir(p, {});
  for (const l of seco.lacunas) escolhas[l.id] = l.opcoes[0].valor;
  const out = redigir(p, escolhas);
  const todo = [out.como_foi, out.proximo_passo, out.pedido_cliente].join(" ");

  const sobrou = todo.replace(FUTURO, "").match(/\bsemanas?\b/gi);
  if (sobrou) {
    comSemana++;
    if (exemplos.length < 3) exemplos.push(`${r.client_name}: “${sobrou.join(", ")}” em: ${todo.slice(0, 160)}`);
  }
  const conc = todo.match(CONCORDANCIA);
  if (conc) {
    comConcordancia++;
    if (exemplos.length < 6) exemplos.push(`${r.client_name}: concordância “${conc[0]}”`);
  }
  if (out.avisos.lexico.length) comLexico++;
  if (out.avisos.sem_prazo) semData++;

  const antes = redigir({ ...p, semana: { ...p.semana, padrao: true } }, escolhas);
  if (antes.como_foi !== out.como_foi) mudou++;
}

eq("blocos com 'semana' sobrando (fora do futuro)", comSemana, 0);
eq("blocos com concordância quebrada", comConcordancia, 0);
eq("blocos com palavra do léxico proibido", comLexico, 0);
eq("blocos sem data no próximo passo", semData, 0);
ok(`o texto realmente mudou em ${mudou} de ${linhas.length} blocos`, mudou > linhas.length / 2);
for (const e of exemplos) console.log("    · " + e);

eq(
  "a semana futura fica intacta",
  paraPeriodo("O marco da próxima semana é fechar 5 leads, e a leitura sai na semana seguinte."),
  "O marco da próxima semana é fechar 5 leads, e a leitura sai na semana seguinte.",
);
eq(
  "concordância no meio da frase",
  paraPeriodo("A semana fechou com 3 leads e nesta semana o CPL caiu; comparamos com a semana passada."),
  "O período fechou com 3 leads e neste período o CPL caiu; comparamos com o período anterior.",
);

/* ═══ 5. o nome do dia no "próximo passo" ═══════════════════════════ */
console.log("\n5) datas do próximo passo");
{
  const base = JSON.parse(JSON.stringify(linhas.find((r) => r.cenario === "E" || r.cenario === "D").payload));
  const casos = [
    ["2026-08-23", "domingo (semana fechada)"],
    ["2026-08-25", "terça"],
    ["2026-08-28", "sexta"],
  ];
  for (const [fim, nome] of casos) {
    const p = { ...base, semana: { ...base.semana, fim, padrao: fim !== "2026-08-23", dias: 7 } };
    const out = redigir(p, {});
    const datas = `${out.proximo_passo} ${out.pedido_cliente}`.match(/\b(\d{2})\/(\d{2})\b/g) || [];
    // toda data citada junto da palavra "segunda" tem de cair numa segunda
    const m = `${out.proximo_passo} ${out.pedido_cliente}`.match(/segunda,\s*(\d{2})\/(\d{2})/);
    if (m) {
      const d = new Date(Date.UTC(2026, Number(m[2]) - 1, Number(m[1])));
      ok(`fim ${nome}: "segunda, ${m[1]}/${m[2]}" é mesmo uma segunda`, d.getUTCDay() === 1, `caiu em ${d.getUTCDay()}`);
    } else {
      ok(`fim ${nome}: tem data no próximo passo`, datas.length > 0);
    }
  }
}

/* ═══ 6. a tela: chave, mensagem e coerência ════════════════════════ */
console.log("\n6) tela");

app.S.semana = "2026-08-17";
app.S.fim = null;
eq("sem fim escolhido, o período é a semana fechada", app.fimP(), "2026-08-23");
eq("e a CHAVE é a antiga — rascunho de quem já usa a tela não some", app.chaveP(), "2026-08-17");
eq("período padrão", app.periodoPadrao(), true);

app.S.fim = "2026-08-23";
eq("escolher o próprio domingo continua sendo a chave antiga", app.chaveP(), "2026-08-17");

app.S.fim = "2026-08-30";
eq("recorte livre ganha chave própria", app.chaveP(), "2026-08-17..2026-08-30");
eq("14 dias", app.diasP(), 14);
eq("não é padrão", app.periodoPadrao(), false);
app.S.fim = null;

{
  const p = JSON.parse(JSON.stringify(linhas[0].payload));
  const texto = { comoFoi: "Texto.", proximoPasso: "Ação em 25/08.", pedido: "Um pedido." };

  const msgSemana = app.montarMensagem(p, texto);
  ok("semana fechada mantém 'Weekly Touch Point'", msgSemana.includes("📌 Weekly Touch Point:"));
  ok("e 'Agendamentos na semana'", msgSemana.includes("📅 Agendamentos na semana:"));

  p.semana.padrao = false;
  const msgPeriodo = app.montarMensagem(p, texto);
  ok("recorte livre não diz 'Weekly'", !msgPeriodo.includes("Weekly"));
  ok("e diz 'Agendamentos no período'", msgPeriodo.includes("📅 Agendamentos no período:"));
  ok("o resto da mensagem é o mesmo", msgPeriodo.split("\n").length === msgSemana.split("\n").length);

  // as partes coladas TÊM de dar a mensagem inteira: é o que garante que
  // editar dentro da mensagem edita a mensagem que vai para o cliente
  const colado = app
    .partesMensagem(p, texto)
    .map((x) => (x.tipo === "fixo" ? x.texto : `${x.rotulo}\n${x.valor}`))
    .join("\n\n");
  eq("partes coladas === mensagem", colado === msgPeriodo, true);
  const campos = app.partesMensagem(p, texto).filter((x) => x.tipo === "campo").map((x) => x.k);
  eq("os três campos editáveis", campos, ["comoFoi", "proximoPasso", "pedido"]);
  const semPedido = app.partesMensagem(p, { ...texto, pedido: "" }).filter((x) => x.tipo === "campo").map((x) => x.k);
  eq("sem pedido, a mensagem não leva o bloco", semPedido, ["comoFoi", "proximoPasso"]);
  const noCartao = app.partesMensagem(p, { ...texto, pedido: "" }, true).filter((x) => x.tipo === "campo").map((x) => x.k);
  eq("mas o cartão continua oferecendo os três para editar", noCartao, ["comoFoi", "proximoPasso", "pedido"]);
}

{
  // mês que NÃO contém o período: a incoerência é esperada, não é erro
  const p = JSON.parse(JSON.stringify(linhas.find((r) => r.payload.midia.total.leads > 0).payload));
  p.semana.inicio = "2026-08-20";
  p.semana.fim = "2026-09-05";
  p.semana.padrao = false;
  p.mes.inicio = "2026-09-01";
  p.mes.leads = 0;
  p.mes.agendamentos = 0;
  p.mes.spend = 0;
  eq("mês fora do período não acusa incoerência", app.incoerencias(p), []);

  p.mes.inicio = "2026-08-01";
  p.semana.inicio = "2026-08-20";
  ok("mas dentro do mesmo mês continua acusando", app.incoerencias(p).length > 0);
}

/* ═══ 7. o Code node GERADO valida as duas pontas ═══════════════════
 *
 * O servidor não confia na tela. Um `week_end` inventado à mão no payload
 * tem de ser recusado no n8n, não só no navegador — é a mesma regra que já
 * vale para a segunda-feira e para o marcador `[…]`.
 *
 * Roda o código que o build.py colou no JSON (não o fonte), com a leitura
 * do Supabase substituída por vazio: o que se testa aqui é a porta. */
console.log("\n7) validação no Code node gerado");
{
  const wf = JSON.parse(fs.readFileSync(path.join(LIVE, "n8n", "01_mb-touchpoint-week.json"), "utf8"));
  const codigo = wf.nodes.find((n) => n.name === "Contrato").parameters.jsCode;
  const cfg = Object.fromEntries(
    wf.nodes.find((n) => n.name === "Config").parameters.assignments.assignments.map((x) => [x.name, x.value]),
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const rodar = new AsyncFunction(codigo);

  const chamar = async (body) => {
    globalThis.$ = (nome) => {
      if (nome === "Config") return { first: () => ({ json: cfg }) };
      if (nome === "Webhook") return { first: () => ({ json: { headers: { "x-tp-token": cfg.token }, body } }) };
      throw new Error("node desconhecido: " + nome);
    };
    // a leitura do Supabase não acontece: o que se testa aqui é a porta
    globalThis.$helpers = { async httpRequest() { return []; } };
    return (await rodar())[0].json;
  };
  const recusa = async (rotulo, body, trecho) => {
    try {
      await chamar(body);
      erro(`${rotulo}: passou e devia ter sido recusado`);
    } catch (e) {
      const m = String(e.message || e);
      if (trecho && !m.includes(trecho)) erro(`${rotulo}: recusou com outra mensagem — ${m}`);
      else console.log(`  ✓ ${rotulo}`);
    }
  };

  const base = { week_start: "2026-08-17", tz: "America/New_York" };
  await recusa("segunda continua obrigatória sem week_end", { ...base, week_start: "2026-08-18" }, "segunda-feira");
  await recusa("week_end fora do formato", { ...base, week_end: "18/08/2026" }, "formato");
  await recusa("week_end antes do week_start", { ...base, week_end: "2026-08-10" }, "antes de");
  await recusa("período maior que 92 dias", { week_start: "2026-01-01", week_end: "2026-06-30" }, "máximo é 92");
  await recusa("week_end hoje", { ...base, week_end: new Date().toISOString().slice(0, 10) }, "ontem ou antes");
  // futuro perto, para cair na regra do "ontem" e não na do tamanho
  await recusa(
    "week_end no futuro",
    { week_start: "2026-08-31", week_end: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) },
    "ontem ou antes",
  );

  const solto = await chamar({ week_start: "2026-08-18", week_end: "2026-08-27", tz: "America/New_York" });
  ok("com week_end, começar numa terça é aceito", solto.ok === true, JSON.stringify(solto).slice(0, 120));
  eq("e devolve as duas pontas", [solto.week_start, solto.week_end], ["2026-08-18", "2026-08-27"]);
}

/* ═══ 8. o mês que NÃO contém o período ══════════════════════════════
 *
 * Achado testando 25/08 a 01/09 no ar: o recorte atravessa a virada, o mês
 * do contrato vira 01/09 a 01/09 (um dia) e a prosa saiu dizendo "vamos
 * levantar os 0 leads do mês" logo depois de "6 leads" no período. É o
 * defeito que originou o projeto — número certo, rótulo falso — escrito de
 * outro jeito.
 *
 * A regra que este bloco segura: quando o mês não contém o período, NENHUM
 * número do texto pode estar pendurado na palavra "mês". Falar do mês sem
 * número (a verba do mês acabou) continua valendo. */
console.log("\n8) mês que não contém o período");
{
  const NUM_NO_MES = [/\d[^.]{0,30}?\b(?:do|no)\s+m[êe]s\b/i, /\b(?:do|no)\s+m[êe]s\b[^.]{0,30}?\d/i];
  const ARTIGO_PLURAL = /\b(os|as|aos|dos|nos|nas)\s+1\s+\w/i;
  // "período … ela/dela" — pronome que ficou no feminino depois da troca.
  // A configuração e a campanha são femininas de verdade, então a busca é
  // pela frase do PPA, que era a única que falava DO recorte.
  const PRONOME = /per[íi]odo[^.]{0,60}\bmas\s+ela\b/i;

  let comNumeroDoMes = 0, comArtigo = 0, comPronome = 0;
  const mostra = [];
  for (const r of linhas) {
    const p = JSON.parse(JSON.stringify(r.payload));
    // 25/08 a 01/09: 8 dias, e o mês do contrato é só 01/09
    p.semana = { inicio: "2026-08-25", fim: "2026-09-01", dias: 8, padrao: false,
                 label: rotuloPeriodo("2026-08-25", "2026-09-01"), timezone: p.semana.timezone };
    p.mes = { ...p.mes, inicio: "2026-09-01", fim: "2026-09-01", leads: 0, agendamentos: 0, spend: 0 };
    p.agendamento = { ...p.agendamento, mes_ate_domingo: 0 };

    const escolhas = {};
    for (const l of redigir(p, {}).lacunas) escolhas[l.id] = l.opcoes[0].valor;
    const out = redigir(p, escolhas);
    const todo = [out.como_foi, out.proximo_passo, out.pedido_cliente].join(" ");
    // a data (01/09) tem dígito e não é afirmação sobre o mês; o valor em
    // dólar É — "$1.200 investidos no mês" é exatamente o que se procura.
    const semData = todo.replace(/\b\d{1,2}\/\d{1,2}\b/g, "«data»");

    if (NUM_NO_MES.some((re) => re.test(semData))) {
      comNumeroDoMes++;
      if (mostra.length < 4) mostra.push(`${r.client_name} [${out.cenario}]: ${semData.match(NUM_NO_MES[0])?.[0] || semData.match(NUM_NO_MES[1])?.[0]}`);
    }
    if (ARTIGO_PLURAL.test(todo)) {
      comArtigo++;
      if (mostra.length < 6) mostra.push(`${r.client_name}: artigo — "${todo.match(ARTIGO_PLURAL)[0]}"`);
    }
    if (PRONOME.test(todo)) {
      comPronome++;
      if (mostra.length < 8) mostra.push(`${r.client_name}: pronome — "${todo.match(PRONOME)[0].slice(-40)}"`);
    }
  }
  eq("blocos citando NÚMERO do mês que não contém o período", comNumeroDoMes, 0);
  eq('blocos com artigo plural em 1 ("os 1 lead")', comArtigo, 0);
  eq("blocos com pronome feminino sobrando depois da troca", comPronome, 0);
  for (const m of mostra) console.log("    · " + m);

  // e o artigo tem de estar certo nos dois lados
  eq("artigo com 1", osN(1, "lead", "leads"), "o 1 lead");
  eq("artigo com 6", osN(6, "lead", "leads"), "os 6 leads");
}

/* ═══ 9. o cabeçalho do canal também é rótulo ═══════════════════════
 *
 * O bloco que embrulha a mensagem no canal dizia "Weekly Touchpoints"
 * sempre. Num recorte de 8 dias isso é o mesmo defeito da linha de dentro,
 * só que na moldura — e essa moldura o cliente lê. Quem decide é o Code
 * node do envio, a partir das duas pontas. */
console.log("\n9) cabeçalho do canal");
{
  const wf = JSON.parse(fs.readFileSync(path.join(LIVE, "n8n", "03_mb-touchpoint-envio.json"), "utf8"));
  const codigo = wf.nodes.find((n) => n.name === "Montar bloco").parameters.jsCode;
  const cfg = Object.fromEntries(
    wf.nodes.find((n) => n.name === "Config").parameters.assignments.assignments.map((x) => [x.name, x.value]),
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const rodar = new AsyncFunction(codigo);
  const chamar = async (body) => {
    globalThis.$ = (nome) => {
      if (nome === "Config") return { first: () => ({ json: cfg }) };
      if (nome === "Webhook") return { first: () => ({ json: { headers: { "x-tp-token": cfg.token }, body } }) };
      throw new Error("node desconhecido: " + nome);
    };
    return (await rodar())[0].json;
  };
  const bloco1 = [{ client_id: "c1", cliente: "#001 TESTE", message_text: "Olá.\nAd Spend: $1.00" }];

  const semana = await chamar({ gestor: "Fulano", blocos: bloco1, periodo: "Mon, 08/17 to Sun, 08/23", week_start: "2026-08-17" });
  ok("semana fechada mantém 'Weekly Touchpoints'", semana.mensagem.includes("📋 **Weekly Touchpoints — Mon, 08/17 to Sun, 08/23**"), semana.mensagem.split("\n")[2]);

  const semanaExplicita = await chamar({ gestor: "Fulano", blocos: bloco1, periodo: "Mon, 08/17 to Sun, 08/23", week_start: "2026-08-17", week_end: "2026-08-23" });
  ok("segunda a domingo explícito também é semana", semanaExplicita.mensagem.includes("Weekly Touchpoints"));

  const livre = await chamar({ gestor: "Fulano", blocos: bloco1, periodo: "Tue, 08/25 to Tue, 09/01", week_start: "2026-08-25", week_end: "2026-09-01" });
  ok("recorte livre NÃO diz Weekly", !livre.mensagem.includes("Weekly"), livre.mensagem.split("\n")[2]);
  ok("e mantém o resto do cabeçalho", livre.mensagem.includes("📋 **Touchpoints — Tue, 08/25 to Tue, 09/01**"), livre.mensagem.split("\n")[2]);
  ok("o bloco do cliente não muda", livre.mensagem.includes("**Cliente: #001 TESTE**"));

  const cs = await chamar({ destino: "cs", cs: "eduarda", gestor: "Fulano", blocos: bloco1, periodo: "Tue, 08/25 to Tue, 09/01", week_start: "2026-08-25", week_end: "2026-09-01" });
  ok("a cópia da CS nunca disse Weekly e continua assim", !cs.mensagem.includes("Weekly") && cs.mensagem.includes("🔒 **Touchpoints —"));
}

console.log(falhas === 0 ? "\n✓ tudo passou" : `\n✗ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
