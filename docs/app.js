/* =====================================================================
 * TouchPoints — banca de teste ao vivo.
 *
 * Regra que manda aqui, a mesma do model.ts do Ruche OS: NENHUM número
 * nasce nesta camada. Tudo que a tela mostra vem do contrato devolvido pelo
 * webhook `mb-touchpoint-week`. A tela só formata e monta texto.
 *
 * Era exatamente o contrário que quebrava o touchpoint manual: o campo
 * "Appointments Booked" imprimia clients.appointment_quantity (a META MENSAL
 * contratada) como se fosse resultado da semana. Se um número parecer errado
 * aqui, o cadastro está errado — não o texto.
 *
 * O que esta banca NÃO faz, de propósito:
 *   • não escreve nada no Supabase (a tabela mb_touchpoints não existe, e
 *     criá-la é decisão do Lucas). O rascunho mora no navegador.
 *   • não publica no ClickUp sem dois cadeados (ver README).
 * ===================================================================== */

/* ───────────────────────────── configuração ───────────────────────────── */

/* O token dos webhooks NÃO mora aqui. Este arquivo é versionado, e um token
   commitado é um token público — qualquer um passaria a ler o investimento e
   os leads de todos os clientes pelo `mb-touchpoint-week`. Na primeira
   abertura a tela pede o token e guarda no `localStorage` deste navegador;
   `python n8n/build.py` imprime qual é. */
const PADRAO = {
  base: "https://webhook.ruchedigital.online/webhook",
  token: "",
  tz: "America/New_York",
};

const cfg = { ...PADRAO, ...lerJSON("tp_cfg", {}) };

function lerJSON(k, fb) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fb;
  } catch {
    return fb;
  }
}
function gravarJSON(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

async function chamar(rota, corpo) {
  const r = await fetch(`${cfg.base}/${rota}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tp-token": cfg.token },
    body: JSON.stringify({ ...corpo, token: cfg.token }),
  });
  const txt = await r.text();
  let j = null;
  try {
    j = JSON.parse(txt);
  } catch {
    /* deixa j nulo: o erro cru é mais útil que "JSON inválido" */
  }
  if (!r.ok) {
    const detalhe = (j && (j.message || j.error)) || txt.slice(0, 400) || `HTTP ${r.status}`;
    throw new Error(detalhe);
  }
  return j;
}

/* ────────────────────────── semana e período ─────────────────────────── */

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Ontem. É o teto de qualquer recorte: o dia de hoje ainda está entrando
 *  no `ad_insights`, e meio dia de investimento vira número menor do que
 *  foi — o mesmo tipo de erro que o projeto existe para não cometer. */
function ontem(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  return iso(d);
}
function somaDias(s, n) {
  const [y, m, dd] = s.split("-").map(Number);
  return iso(new Date(y, m - 1, dd + n));
}
/** Quantos dias tem o intervalo, contando as duas pontas. */
function diasEntre(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1;
}
const diaDaSemanaDe = (s) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(y, m - 1, dd).getDay();
};
const primeiroDoMes = (s) => s.slice(0, 8) + "01";

/** Segunda-feira da última semana FECHADA. A semana corrente nunca entra. */
function ultimaSemanaFechada(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow - 7);
  return iso(d);
}
/** Segunda-feira da semana que contém `data` (YYYY-MM-DD). */
function segundaDa(data) {
  const [y, m, dd] = data.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
/** Domingo que fecha a semana que começa em `ws`. */
function domingoDa(ws) {
  const [y, m, dd] = ws.split("-").map(Number);
  return iso(new Date(y, m - 1, dd + 6));
}
function somaSemanas(ws, n) {
  const [y, m, dd] = ws.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() + n * 7);
  return iso(d);
}
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, 08/17 to Sun, 08/23" — o mesmo rótulo que o canal usa há 16 semanas.
 *  Num recorte livre o dia da semana é o de verdade das duas pontas.
 *  ⚠️ `src/contrato.js` tem a mesma função (arquivos separados, sem import):
 *  mexeu aqui, mexa lá — `testar_app.mjs` compara as duas. */
function rotuloPeriodo(ini, fim) {
  const f = (s) => `${s.slice(5, 7)}/${s.slice(8, 10)}`;
  return `${DOW_EN[diaDaSemanaDe(ini)]}, ${f(ini)} to ${DOW_EN[diaDaSemanaDe(fim)]}, ${f(fim)}`;
}
function rotuloSemana(ws) {
  return rotuloPeriodo(ws, domingoDa(ws));
}
/** Semana fechada de verdade: começa numa segunda e tem 7 dias. Só ela pode
 *  ser chamada de "semana" no texto e no rótulo do canal. */
const ehSemanaPadrao = (ini, fim) => diaDaSemanaDe(ini) === 1 && fim === domingoDa(ini);

/* ───────────────── cenários (seções 8.3 a 8.5 da pesquisa) ───────────────── */

const CENARIO = {
  A: { titulo: "Semana forte", tom: "positive", abrePor: "o número da semana",
       entrega: "o que causou o resultado e o que será feito para sustentar; se o CPL estiver abaixo do benchmark, convide a escalar",
       proibido: "prometer repetição (“vamos manter esse ritmo”)" },
  B: { titulo: "Lead entra, agenda não enche", tom: "warning", abrePor: "o custo por lead comparado ao alvo",
       entrega: "nomear que o gargalo está DEPOIS do anúncio — velocidade de resposta e follow-up. Traga os leads do mês e quantos viraram agendamento",
       proibido: "propor troca de criativo · culpar o cliente" },
  C: { titulo: "Poucos leads, agenda ok", tom: "info", abrePor: "o agendamento",
       entrega: "que o que importa é custo por agendamento, não volume de lead; compare com o valor do agendamento contratado",
       proibido: "pedir desculpa pelo volume de leads" },
  D: { titulo: "Semana fraca dos dois lados", tom: "critical",
       abrePor: "o que se moveu — nunca pelo número ruim (roteiro de 5 passos abaixo)",
       entrega: "causa nomeada + ação com data + próximo marco",
       proibido: "abrir pelo número · “infelizmente” · “semana difícil” · “não conseguimos”" },
  E: { titulo: "Investiu e não gerou lead", tom: "critical", abrePor: "a ação já tomada",
       entrega: "tratar como incidente, não como performance: verificação técnica antes de qualquer mudança de verba",
       proibido: "dizer “falha de rastreamento” ao cliente · prometer verba nova antes de verificar" },
  F: { titulo: "Sem veiculação", tom: "neutral", abrePor: "o motivo da pausa",
       entrega: "por que parou, o que falta e quando volta",
       proibido: "“Sem dados de campanha encontrados para o período”" },
  G: { titulo: "Conta em aprendizado", tom: "info", abrePor: "o tempo de conta",
       entrega: "o que é normal nesta fase e qual o marco da próxima semana",
       proibido: "comparar com semana anterior que não existe" },
  H: { titulo: "Recuperação", tom: "positive", abrePor: "a variação positiva",
       entrega: "ligar a melhora à ação registrada e dizer o que vem agora",
       proibido: "declarar vitória" },
  X: { titulo: "Sem benchmark para classificar", tom: "neutral",
       abrePor: "os números da semana, sem comparação de ritmo",
       entrega: "o resultado absoluto; o nicho do cliente não tem linha em niche_benchmarks",
       proibido: "inventar alvo de CPL ou de volume" },
};

const ROTEIRO_D = [
  "Abrir pelo que se moveu — nunca pelo número ruim. Ordem: (a) alguma métrica melhorou? (b) o acumulado do mês está dentro? (c) existe otimização registrada na semana? Use a primeira verdadeira; se nenhuma for, abra pela ação que começa na segunda.",
  "Dar o número inteiro na segunda frase. Sem rodeio e sem diminutivo.",
  "Nomear a causa em linguagem de dono. Uma frase, uma causa, verificável.",
  "Ação com prazo e critério: o que muda, quando entra no ar, quando dá para ler.",
  "Próximo marco + pedido: uma data em que o cliente vê algo e uma coisa que ele faz.",
];

function causaProvavel(p) {
  const t = p.midia.total, bm = p.benchmark;
  if (t.spend <= 0) return null;
  if (t.leads > 0 && p.agendamento.semana === 0)
    return "Os leads chegaram; o que não aconteceu foi o contato rápido com eles";
  if (t.page_views > 0 && t.leads === 0)
    return "Estão clicando e não estão preenchendo o formulário — o problema está na página";
  if (t.impressions > 0 && t.clicks > 0 && t.page_views === 0)
    return "As pessoas estão vendo o anúncio e não estão clicando — é anúncio, e já está sendo trocado";
  if (bm.bm_leads_semana && t.leads < bm.bm_leads_semana * 0.6 && t.page_views < 40)
    return "Estamos alcançando pouca gente na sua região por esse valor de investimento";
  return null;
}

/* ───────────────────────── léxico (seção 8.7) ───────────────────────── */

const PROIBIDOS = [
  { termo: /sem dados de campanha/i, troque: "diga por que parou e quando volta" },
  { termo: /falha de rastreamento|rastreamento/i, troque: "“o formulário pode não estar registrando os leads”" },
  { termo: /\bpixel\b/i, troque: "“o formulário pode não estar registrando os leads”" },
  { termo: /vamos otimizar/i, troque: "diga o que pausa e o que sobe, com data" },
  { termo: /semana desafiadora|infelizmente/i, troque: "o número, direto" },
  { termo: /excelente semana/i, troque: "“melhor semana do mês: X leads contra Y na anterior”" },
  { termo: /\bCTR\b|\bCPC\b|\badset\b|\bCBO\b/i, troque: "termo do cliente, não do gestor" },
  { termo: /\bcontatos\b/i, troque: "leads" },
  { termo: /vou revisar/i, troque: "“vamos revisar”" },
];

function termosProibidos(texto) {
  const achados = [];
  for (const p of PROIBIDOS) {
    const m = texto.match(p.termo);
    if (m) achados.push({ termo: m[0], troque: p.troque });
  }
  return achados;
}

/* ─────────────────────────── formatação ─────────────────────────── */

const money = (v) =>
  v === null || v === undefined
    ? "—"
    : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dia = (s) => (s ? `${s.split("-")[2]}/${s.split("-")[1]}` : "—");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/* ════════════ correção de número (incoerência de cadastro) ════════════
 *
 * A regra desta tela continua a mesma: nenhum número NASCE aqui. O que
 * existe agora é uma exceção declarada — nomeada, justificada e visível.
 *
 * O motivo é concreto e a pesquisa já achou: cliente com agendamento de
 * mídia e ZERO investimento registrado. O #526 GTF tem account_id_meta
 * cadastrado e NUNCA teve uma linha em ad_insights; o bloco dele sai
 * dizendo "sem investimento no período", que é o que o banco diz e não é o
 * que aconteceu. Mandar isso para o cliente é pior do que corrigir à mão.
 *
 * O que a correção NÃO faz, de propósito:
 *   • não escreve no Supabase — o cadastro continua errado, e é a
 *     exportação que leva a lista de correções para quem conserta;
 *   • não desbloqueia bloco bloqueado (D6 e falta de gestor continuam);
 *   • não reclassifica o cenário sozinha — a régua de classificação mora no
 *     contrato, não aqui. Quem corrige escolhe o cenário, na mão.
 *
 * Toda correção guarda de→para e um motivo obrigatório, e aparece no
 * cartão, na lista, na prévia do envio e na nota interna que vai ao CS.
 * Nunca aparece na mensagem do cliente.
 */

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const inteiro = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Mesma escada do `classe()` de contrato.js. É o único derivado que a tela
 *  recalcula — e só depois de uma correção, para o cartão não exibir um
 *  ritmo que já não corresponde ao número corrigido ao lado. */
function classeRitmo(ritmo) {
  if (ritmo === null || ritmo === undefined) return null;
  if (ritmo >= 0.9) return "forte";
  if (ritmo >= 0.6) return "dentro";
  return "fraco";
}

const PLAT_ORDEM = ["meta", "google", "glsa"];

/** Os campos corrigíveis, montados a partir do contrato do próprio cliente.
 *  Plataforma AUSENTE entra na lista quando é renderizável: o caso que
 *  motivou isto é justamente o investimento que nunca chegou ao banco. */
function camposCorrigiveis(p) {
  const plats = [...new Set([...Object.keys(p.midia.por_plataforma), ...(p.midia.renderizar || [])])].sort(
    (a, b) => PLAT_ORDEM.indexOf(a) - PLAT_ORDEM.indexOf(b),
  );
  const campos = [];
  for (const k of plats) {
    const m = p.midia.por_plataforma[k] || {};
    const nome = PLATAFORMA_LABEL[k] ?? k;
    campos.push({ id: `midia.por_plataforma.${k}.spend`, grupo: "Semana",
      rotulo: `Investimento — ${nome}`, tipo: "money", valor: m.spend ?? 0 });
    campos.push({ id: `midia.por_plataforma.${k}.leads`, grupo: "Semana",
      rotulo: `Leads — ${nome}`, tipo: "int", valor: m.leads ?? 0 });
  }
  campos.push({ id: "agendamento.semana", grupo: "Semana",
    rotulo: `Agendamentos ${p.semana.padrao === false ? "no período" : "na semana"}`,
    tipo: "int", valor: p.agendamento.semana });

  campos.push({ id: "mes.spend", grupo: "Mês", rotulo: "Investimento no mês", tipo: "money", valor: p.mes.spend });
  campos.push({ id: "mes.leads", grupo: "Mês", rotulo: "Leads no mês", tipo: "int", valor: p.mes.leads });
  campos.push({ id: "mes.agendamentos", grupo: "Mês", rotulo: "Agendamentos no mês", tipo: "int", valor: p.mes.agendamentos });
  campos.push({ id: "agendamento.meta_usada", grupo: "Mês", rotulo: "Meta de agendamento no mês",
    tipo: "int", valor: p.agendamento.meta_usada });
  // O rótulo da meta é o bug de origem em miniatura: número certo, origem
  // falsa. Quem corrige a meta precisa poder dizer de onde ela vem.
  campos.push({
    id: "agendamento.origem_meta", grupo: "Mês", rotulo: "Origem da meta", tipo: "select",
    valor: p.agendamento.origem_meta,
    opcoes: [
      { valor: "contrato", rotulo: "contratada — sai como “de N contratados”" },
      { valor: "benchmark", rotulo: "referência do nicho — sai como “referência para a sua vertical”" },
    ],
  });

  campos.push({ id: "comparacao.semana_anterior.spend", grupo: "Semana anterior",
    rotulo: "Investimento na semana anterior", tipo: "money", valor: p.comparacao.semana_anterior.spend });
  campos.push({ id: "comparacao.semana_anterior.leads", grupo: "Semana anterior",
    rotulo: "Leads na semana anterior", tipo: "int", valor: p.comparacao.semana_anterior.leads });
  campos.push({ id: "agendamento.semana_anterior", grupo: "Semana anterior",
    rotulo: "Agendamentos na semana anterior", tipo: "int", valor: p.agendamento.semana_anterior });

  campos.push({
    id: "cenario.codigo", grupo: "Classificação", tipo: "select",
    rotulo: "Cenário",
    dica: "o contrato classificou pelo número errado — reclassifique",
    valor: p.cenario.codigo,
    opcoes: Object.entries(CENARIO).map(([k, v]) => ({ valor: k, rotulo: `${k} · ${v.titulo}` })),
  });
  return campos;
}

const lerPath = (o, path) => path.split(".").reduce((a, k) => (a === null || a === undefined ? a : a[k]), o);

function escreverPath(o, path, v) {
  const ks = path.split(".");
  let a = o;
  for (const k of ks.slice(0, -1)) {
    if (a[k] === null || typeof a[k] !== "object") a[k] = {};
    a = a[k];
  }
  a[ks[ks.length - 1]] = v;
}

/** Aplica as correções e refaz TUDO que depende delas: CPL (por soma, nunca
 *  média de coluna), totais, variação contra a semana anterior e ritmo
 *  contra o benchmark. Meio-termo aqui é o pior dos mundos — seria o texto
 *  citando um número e a mensagem imprimindo outro, que é exatamente o
 *  defeito que originou este projeto. */
function aplicarCorrecoes(p, c) {
  const campos = (c && c.campos) || {};
  if (!Object.keys(campos).length) return p;
  const q = JSON.parse(JSON.stringify(p));
  const de = {};

  for (const [id, v] of Object.entries(campos)) {
    de[id] = lerPath(p, id);
    const partes = id.split(".");
    if (id.startsWith("midia.por_plataforma.") && !q.midia.por_plataforma[partes[2]]) {
      q.midia.por_plataforma[partes[2]] = { spend: 0, leads: 0, cpl: null, impressions: 0, clicks: 0, page_views: 0 };
    }
    escreverPath(q, id, v);
  }

  /* 1. plataforma → CPL, e o total por SOMA (checklist 8.8, item 5) */
  const rend = new Set(q.midia.renderizar || []);
  let sp = 0, ld = 0, im = 0, cl = 0, pv = 0, spRender = 0;
  for (const [k, m] of Object.entries(q.midia.por_plataforma)) {
    m.spend = r2(Number(m.spend) || 0);
    m.leads = inteiro(m.leads);
    m.cpl = m.leads > 0 ? r2(m.spend / m.leads) : null;
    sp += m.spend;
    ld += m.leads;
    im += Number(m.impressions) || 0;
    cl += Number(m.clicks) || 0;
    pv += Number(m.page_views) || 0;
    if (rend.has(k)) spRender += m.spend;
  }
  const t = q.midia.total;
  t.spend = r2(sp);
  t.leads = ld;
  t.cpl = ld > 0 ? r2(sp / ld) : null;
  t.impressions = im;
  t.clicks = cl;
  t.page_views = pv;
  t.spend_renderizavel = r2(spRender);
  t.spend_nao_renderizado = r2(sp - spRender);

  /* 2. semana anterior e as três variações */
  const a = q.comparacao.semana_anterior;
  a.spend = r2(Number(a.spend) || 0);
  a.leads = inteiro(a.leads);
  a.cpl = a.leads > 0 ? r2(a.spend / a.leads) : null;
  q.agendamento.semana = inteiro(q.agendamento.semana);
  q.agendamento.semana_anterior = inteiro(q.agendamento.semana_anterior);
  q.comparacao.var_spend = r2(t.spend - a.spend);
  q.comparacao.var_leads = t.leads - a.leads;
  q.comparacao.var_appts = q.agendamento.semana - q.agendamento.semana_anterior;

  /* 3. mês. `mes_ate_domingo` é o mesmo acumulado do mês — o texto lê um, a
        mensagem lê o outro, e eles não podem discordar. */
  q.mes.spend = r2(Number(q.mes.spend) || 0);
  q.mes.leads = inteiro(q.mes.leads);
  q.mes.agendamentos = inteiro(q.mes.agendamentos);
  q.agendamento.mes_ate_domingo = q.mes.agendamentos;
  if (q.agendamento.meta_usada !== null && q.agendamento.meta_usada !== undefined) {
    q.agendamento.meta_usada = Number(q.agendamento.meta_usada);
    q.mes.meta_mensal = q.agendamento.meta_usada;
  }

  /* 4. ritmo contra o benchmark — as mesmas divisões de contrato.js,
        inclusive a fatia do período: o benchmark é MENSAL e, num recorte de
        N dias, a fatia é (mensal / 4,33) × N/7. Recalcular aqui com o
        divisor de uma semana devolveria um ritmo que contradiz o contrato
        que a própria tela acabou de exibir. */
  const bm = q.benchmark;
  const semanasP = (q.semana && q.semana.dias ? q.semana.dias : 7) / 7;
  const porPeriodo = (mensal) => (mensal / 4.33) * semanasP;
  if (q.agendamento.meta_usada) bm.bm_appt_semana = r2(porPeriodo(q.agendamento.meta_usada));
  if (bm.bm_leads_mes) bm.bm_leads_semana = r2(porPeriodo(bm.bm_leads_mes));
  bm.ritmo_leads = bm.bm_leads_mes ? r2(t.leads / porPeriodo(bm.bm_leads_mes)) : null;
  bm.ritmo_appts = q.agendamento.meta_usada
    ? r2(q.agendamento.semana / porPeriodo(q.agendamento.meta_usada))
    : null;
  bm.classe_leads = classeRitmo(bm.ritmo_leads);
  bm.classe_appts = classeRitmo(bm.ritmo_appts);
  bm.cpl_vs_bm = bm.bm_cpl && t.cpl !== null ? r2(t.cpl / bm.bm_cpl) : null;

  /* 5. a correção passa a fazer parte do contrato: quem ler o payload depois
        sabe que houve mão humana, o que mudou e por quê. */
  q.correcao = {
    campos: { ...campos },
    de,
    motivo: (c && c.motivo) || "",
    em: (c && c.em) || null,
  };
  q.proveniencia = {
    ...(q.proveniencia || {}),
    correcao_manual: `${Object.keys(campos).length} campo(s) corrigido(s) na tela — motivo: ${(c && c.motivo) || "—"}`,
  };
  return q;
}

/** "Rótulo: de → para", uma linha por correção. Serve ao cartão, à prévia do
 *  envio, à nota interna do CS e ao CSV que vai para quem conserta o
 *  cadastro. Recebe o payload ORIGINAL — é dele que sai o "de". */
function resumoCorrecao(p, c) {
  if (!c || !c.campos) return [];
  const dic = new Map(camposCorrigiveis(p).map((f) => [f.id, f]));
  return Object.entries(c.campos).map(([id, v]) => {
    const f = dic.get(id);
    const fmt = (x) =>
      x === null || x === undefined || x === "" ? "—" : f && f.tipo === "money" ? money(x) : String(x);
    return { id, rotulo: f ? f.rotulo : id, de: fmt(lerPath(p, id)), para: fmt(v) };
  });
}

const linhaCorrecao = (x) => `${x.rotulo}: ${x.de} → ${x.para}`;

/** O mês CONTÉM a semana. Corrigir um e esquecer o outro produz um bloco que
 *  cita dois números que não podem coexistir — o primeiro ensaio da rota da
 *  CS saiu assim: 9 leads na semana e "os 0 leads do mês" no parágrafo.
 *
 *  Nos 88 blocos reais das semanas de 10/08 e 17/08 isto NUNCA dispara
 *  sozinho, então quando dispara é sempre correção feita pela metade — e por
 *  isso o diálogo trava o salvar em vez de só avisar. */
function incoerencias(p) {
  const fora = [];
  // A regra vale enquanto o mês CONTÉM o período. Num recorte livre que
  // atravessa a virada (20/08 a 05/09) o "No mês" é o mês do último dia e
  // é MENOR que o período de propósito — acusar aí seria alarme falso, e
  // alarme falso é o que faz ninguém olhar para o alarme verdadeiro.
  if (p.mes.inicio && p.mes.inicio > p.semana.inicio) return fora;
  const rec = p.semana.padrao === false ? "o período" : "a semana";
  if (p.mes.leads < p.midia.total.leads)
    fora.push(`o mês está com ${p.mes.leads} leads e ${rec} com ${p.midia.total.leads}`);
  if (p.mes.agendamentos < p.agendamento.semana)
    fora.push(`o mês está com ${p.mes.agendamentos} agendamentos e ${rec} com ${p.agendamento.semana}`);
  if (p.mes.spend < p.midia.total.spend - 0.01)
    fora.push(`o mês está com ${money(p.mes.spend)} investidos e ${rec} com ${money(p.midia.total.spend)}`);
  return fora;
}

/** Números que existiam ANTES da correção e ainda aparecem no texto. É a
 *  guarda que impede o pior resultado possível desta feature: o gestor
 *  conserta o número no cabeçalho e o parágrafo continua citando o antigo. */
function citaNumeroAntigo(p, texto) {
  const corr = p.correcao;
  if (!corr) return [];
  const todo = `${texto.comoFoi} ${texto.proximoPasso} ${texto.pedido}`;
  const vistos = new Set();
  const achados = [];
  for (const [id, antigo] of Object.entries(corr.de)) {
    if (id.endsWith("origem_meta") || id.endsWith("codigo")) continue;
    if (antigo === null || antigo === undefined) continue;
    const novo = corr.campos[id];
    const n = Number(antigo);
    if (!Number.isFinite(n) || n === 0 || Number(novo) === n) continue;
    for (const forma of [String(n), n.toFixed(2), String(Math.round(n))]) {
      if (vistos.has(forma)) continue;
      vistos.add(forma);
      const re = new RegExp(`(^|[^\\d.,])${forma.replace(/[.]/g, "\\.")}([^\\d.,]|$)`);
      if (re.test(todo)) achados.push(forma);
    }
  }
  return achados;
}

/* ───────────────────── rascunho de texto (esqueleto) ───────────────────── */

function rascunhoDeTexto(p) {
  const t = p.midia.total, ag = p.agendamento, bm = p.benchmark, opt = p.contexto_mb[0];
  const meta = ag.meta_usada != null ? Math.round(ag.meta_usada) : null;
  const noMes =
    `No mês são ${p.mes.leads} leads e ${ag.mes_ate_domingo} agendamentos` +
    (meta != null
      ? `, contra a meta de ${meta} agendamentos${ag.origem_meta === "benchmark" ? " (referência do nicho — este cliente não tem meta contratada)" : ""}.`
      : ".");
  const prazo = opt?.validar_em ? `a leitura confiável é ${dia(opt.validar_em)}` : "[data de leitura]";

  switch (p.cenario.codigo) {
    case "A":
      return {
        comoFoi: `Semana de ${t.leads} leads a ${money(t.cpl)} cada${bm.bm_cpl ? `, contra o nosso alvo de ${money(bm.bm_cpl)} para ${p.identificacao.nicho ?? "a sua vertical"}` : ""}. ${noMes} [o que causou o resultado]`,
        proximoPasso: `[o que será feito para sustentar] — [data].`,
        pedido: "[um pedido pequeno e concreto]",
      };
    case "B":
      return {
        comoFoi: `Esta semana o custo por lead ficou em ${money(t.cpl)}${bm.bm_cpl ? `, ${t.cpl != null && t.cpl <= bm.bm_cpl ? "abaixo" : "acima"} do nosso alvo de ${money(bm.bm_cpl)} para ${p.identificacao.nicho ?? "a vertical"}` : ""} — a parte de anúncios está entregando. ${noMes} O gargalo não está no anúncio: está no tempo entre o lead chegar e alguém ligar.`,
        proximoPasso: `Vamos mapear os ${p.mes.leads} leads do mês e identificar quantos foram contatados em até 10 minutos — te trago esse número [dia].`,
        pedido: "Confirmar quem é a pessoa responsável por ligar para o lead assim que ele entra.",
      };
    case "C":
      return {
        comoFoi: `Foram ${ag.semana} agendamentos na semana com ${money(t.spend)} investidos${ag.semana > 0 ? ` — ${money(t.spend / ag.semana)} por agendamento` : ""}. O volume de leads foi menor, e é o custo por agendamento que importa aqui. ${noMes}`,
        proximoPasso: "[o que mantém o custo por agendamento] — [data].",
        pedido: "[um pedido pequeno e concreto]",
      };
    case "D": {
      const causa = causaProvavel(p);
      return {
        comoFoi: `[abra pelo que se moveu — ver roteiro] O resultado da semana foi ${t.leads} ${t.leads === 1 ? "lead" : "leads"}${t.cpl != null ? ` a ${money(t.cpl)}` : ""}${bm.bm_cpl ? `, contra o nosso alvo de ${money(bm.bm_cpl)} para essa vertical` : ""}. ${causa ? `A causa: ${causa.toLowerCase()}.` : "[nomeie a causa — uma frase, verificável]"} ${noMes}`,
        proximoPasso: `${opt?.acao ? opt.acao : "[o que muda e quando entra no ar]"} e ${prazo}.`,
        pedido: "[um pedido pequeno e concreto — foto de obra, contato do responsável, confirmação]",
      };
    }
    case "E":
      return {
        comoFoi: `Antes de mexer em qualquer coisa, paramos para conferir: a semana teve ${money(t.spend)} investidos e nenhum lead registrado, e isso quase sempre é o formulário ou a página deixando de registrar — não o anúncio.`,
        proximoPasso: "Conferência ponta a ponta do formulário nesta segunda; enquanto isso o investimento fica no valor atual, sem aumento.",
        pedido: "Avisar se chegou alguma ligação ou mensagem direta essa semana — isso ajuda a confirmar de onde o contato está entrando.",
      };
    case "F":
      return {
        comoFoi: `A campanha ficou pausada de ${dia(p.semana.inicio)} a ${dia(p.semana.fim)} porque [motivo].`,
        proximoPasso: "Volta ao ar em [data]. [o que falta para isso]",
        pedido: "[o que depende do cliente para voltar]",
      };
    case "G":
      return {
        comoFoi: `A conta está no ${p.qualidade.dias_veiculacao ?? "?"}º dia de veiculação. Nesta fase o sistema ainda está aprendendo quem responde ao anúncio, e o custo por lead oscila — foram ${t.leads} leads${t.cpl != null ? ` a ${money(t.cpl)}` : ""} nesta semana.`,
        proximoPasso: "O marco da próxima semana é [marco]. [o que será ajustado]",
        pedido: "[um pedido pequeno e concreto]",
      };
    case "H":
      return {
        comoFoi: `A semana melhorou: ${t.leads} leads contra ${p.comparacao.semana_anterior.leads} na anterior${opt?.acao ? `, depois de ${opt.acao.toLowerCase()}` : ""}. ${noMes}`,
        proximoPasso: `[o que vem agora para consolidar] — ${prazo}.`,
        pedido: "[um pedido pequeno e concreto]",
      };
    default:
      return {
        comoFoi: `Semana de ${money(t.spend)} investidos, ${t.leads} leads${t.cpl != null ? ` a ${money(t.cpl)}` : ""} e ${ag.semana} agendamentos. ${noMes}`,
        proximoPasso: "[o que muda e quando] — [data].",
        pedido: "[um pedido pequeno e concreto]",
      };
  }
}

/* ──────────── mensagem final (seção 8.2 — seis blocos, nesta ordem) ──────────── */

const PLATAFORMA_LABEL = { meta: "Meta Ads", google: "Google Ads", glsa: "Google Local Services" };

/**
 * A mensagem em PEDAÇOS: o que veio do contrato (fixo, não editável) e os
 * três campos de texto (editáveis). A tela monta o cartão com isto para que
 * o gestor edite dentro da mensagem final, e `montarMensagem` é a mesma
 * lista colada — não existe uma segunda montagem para divergir da primeira.
 */
function partesMensagem(p, texto, todosOsCampos) {
  const l = ["Olá, Pessoal! Tudo bem? 👋", "", `📌 ${p.semana.padrao === false ? "" : "Weekly "}Touch Point: ${p.semana.label}`, ""];

  // Plataforma zerada nunca aparece: era o "Google Ads: $0,00" para quem
  // investe que a v1 evita bloqueando o cliente (D6).
  const plats = Object.entries(p.midia.por_plataforma).filter(([k]) => p.midia.renderizar.includes(k));
  const varias = plats.length > 1;
  for (const [k, m] of plats) {
    if (varias) l.push(`— ${PLATAFORMA_LABEL[k] ?? k} —`);
    l.push(`💰 Ad Spend: ${money(m.spend)}`);
    l.push(`📩 Leads Generated: ${m.leads}`);
    l.push(`🎯 Cost Per Lead: ${m.cpl == null ? "—" : money(m.cpl)}`);
    if (varias) l.push("");
  }
  if (!plats.length) l.push("💰 Sem investimento no período.");

  // Agendamento REAL do período. Antes esta linha imprimia a meta contratada.
  l.push(`📅 Agendamentos ${p.semana.padrao === false ? "no período" : "na semana"}: ${p.agendamento.semana}`);
  l.push("");

  const meta = p.agendamento.meta_usada != null ? Math.round(p.agendamento.meta_usada) : null;
  l.push(`📊 No mês (${dia(p.mes.inicio)} a ${dia(p.mes.fim)}):`);
  l.push(`• Leads: ${p.mes.leads}`);
  // CORREÇÃO em cima do model.ts da Fase 4: lá esta linha escrevia
  // "de N contratados" sempre, inclusive quando N vem do benchmark do nicho
  // porque o cliente NÃO TEM meta contratada — 17 dos 44 blocos da semana de
  // 17/08. É o mesmo erro que originou o projeto: número certo, rótulo falso.
  // A régua da IA (regra 6) já distinguia; só a mensagem final não distinguia.
  l.push(
    `• Agendamentos: ${p.mes.agendamentos}` +
      (meta == null
        ? ""
        : p.agendamento.origem_meta === "contrato"
          ? ` de ${meta} contratados`
          : ` de ${meta} — referência para a sua vertical`),
  );
  const partes = [
    { tipo: "fixo", texto: l.join("\n") },
    { tipo: "campo", k: "comoFoi", rotulo: "Como foi:", dica: "máx. 2 frases", linhas: 4, valor: texto.comoFoi.trim() },
    {
      tipo: "campo", k: "proximoPasso", rotulo: "🚀 Próximo passo:",
      dica: "1 a 2 frases, com data", linhas: 2, valor: texto.proximoPasso.trim(),
    },
  ];
  // O bloco do pedido só existe quando há pedido — no cartão ele aparece
  // sempre (vazio é editável), na mensagem não.
  if (texto.pedido.trim() || todosOsCampos) {
    partes.push({
      tipo: "campo", k: "pedido", rotulo: "🤝 O que precisamos de você:",
      dica: "1 frase", linhas: 2, valor: texto.pedido.trim(),
    });
  }
  return partes;
}

function montarMensagem(p, texto) {
  return partesMensagem(p, texto)
    .map((x) => (x.tipo === "fixo" ? x.texto : `${x.rotulo}\n${x.valor}`))
    .join("\n\n");
}

/* ─────────────── checklist antes de publicar (seção 8.8) ─────────────── */

function checklist(p, texto) {
  const temData = /\b\d{1,2}[/-]\d{1,2}\b|segunda|terça|quarta|quinta|sexta|amanhã|semana que vem/i.test(
    texto.proximoPasso,
  );
  const plats = Object.entries(p.midia.por_plataforma);
  const t = p.midia.total;
  const corr = p.correcao || null;
  // duas formas porque as duas frases regem diferente: "agendamento DO
  // período" e "o mês contém O período".
  const rec = p.semana.padrao === false ? "do período" : "da semana";
  const recorte = p.semana.padrao === false ? "o período" : "a semana";
  const itens = [
    { id: "proveniencia", label: "Todo número exibido tem proveniência registrada",
      ok: Object.keys(p.proveniencia ?? {}).length > 0 },
    { id: "contrato", label: "Nenhum número veio de campo de contrato disfarçado de resultado",
      ok: (p.agendamento.criterio_data ?? "").includes("occurred_at") },
    { id: "mes", label: `Agendamento ${rec} e acumulado do mês estão presentes`,
      ok: p.agendamento.semana != null && p.agendamento.mes_ate_domingo != null },
    { id: "zerada", label: "Só aparecem plataformas com investimento > 0",
      ok: plats.every(([, m]) => m.spend > 0) },
    { id: "cpl", label: "CPL recalculado por soma, não pela média da coluna",
      ok: t.leads === 0 || t.cpl == null || Math.abs(t.cpl - t.spend / t.leads) < 0.02 },
    { id: "cenario", label: "O cenário foi decidido pelo dado, não pelo texto", ok: true },
    { id: "data", label: "Existe uma data no “Próximo passo”", ok: temData },
    { id: "pedido", label: "Existe o bloco “O que precisamos de você”", ok: texto.pedido.trim().length > 0 },
    { id: "lexico", label: "Nenhuma palavra proibida do léxico aparece no texto",
      ok: termosProibidos(`${texto.comoFoi} ${texto.proximoPasso} ${texto.pedido}`).length === 0 },
    { id: "acao", label: "A ação citada corresponde a uma otimização registrada na conta",
      ok: p.contexto_mb.length > 0, manual: true },
  ];
  // A correção de número é uma exceção declarada à regra "nenhum número
  // nasce na tela". Ela tem de aparecer no checklist, e não passar batida.
  if (corr) {
    itens.push({
      id: "correcao",
      label: `${Object.keys(corr.campos).length} número(s) corrigido(s) à mão — motivo registrado`,
      ok: Boolean((corr.motivo || "").trim()),
      manual: true,
    });
    itens.push({
      id: "texto_corrigido",
      label: "O texto não repete nenhum número de antes da correção",
      ok: citaNumeroAntigo(p, texto).length === 0,
    });
  } else {
    itens.push({ id: "correcao", label: "Nenhum número foi corrigido à mão", ok: true });
  }
  itens.push({
    id: "coerencia",
    label: `${p.semana.padrao === false ? "Período" : "Semana"} e mês fecham entre si — o mês contém ${recorte}`,
    ok: incoerencias(p).length === 0,
  });
  return itens;
}

/** Marcadores `[…]` que sobraram. A tela não deixa enviar com eles. */
function pendencias(texto) {
  const all = `${texto.comoFoi}\n${texto.proximoPasso}\n${texto.pedido}`;
  return [...all.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]);
}

/* ═══════════════════════════════ estado ═══════════════════════════════ */

const FILTROS_PADRAO = { semaforo: null, gestor: "", busca: "", cenario: "", estado: "", soCorrigidos: false };

const S = {
  // `semana` continua sendo o PRIMEIRO dia do recorte — o nome ficou porque
  // a semana fechada é o caso normal e porque os testes leem este campo.
  semana: lerJSON("tp_periodo", {}).inicio || lerJSON("tp_semana", null) || ultimaSemanaFechada(),
  // `fim` nulo = semana fechada de 7 dias a partir de `semana`. Só um recorte
  // livre grava um valor aqui.
  fim: lerJSON("tp_periodo", {}).fim || null,
  linhas: [],
  leitura: null,
  sel: null,
  ...FILTROS_PADRAO,
  ...lerJSON("tp_filtros", {}),
  carregando: false,
  erro: null,
  gerando: new Set(),
};

/* ── o recorte carregado, em um lugar só ────────────────────────────────
 *
 * Tudo que era "a semana" passa por aqui. `fimP()` cai na semana fechada
 * quando ninguém escolheu um fim, e `chaveP()` devolve exatamente a chave
 * antiga (só o `week_start`) nesse caso — é isso que preserva os rascunhos,
 * as correções e o registro de envio que já estão no navegador de quem usa
 * a tela desde 30/08. */
const fimP = () => (S.fim && S.fim >= S.semana ? S.fim : domingoDa(S.semana));
const diasP = () => diasEntre(S.semana, fimP());
const periodoPadrao = () => ehSemanaPadrao(S.semana, fimP());
const chaveP = () => (periodoPadrao() ? S.semana : `${S.semana}..${fimP()}`);
const rotuloP = () => rotuloPeriodo(S.semana, fimP());

/** Troca o recorte e recarrega. Um caminho só: prev/next, calendário e
 *  atalhos passam todos por aqui, e nenhum deles pode passar do teto. */
function irPara(inicio, fim, { silencioso } = {}) {
  const f = fim && fim >= inicio ? fim : domingoDa(inicio);
  if (f > ontem()) {
    if (!silencioso) aviso("O período tem de terminar ontem ou antes — o dia de hoje ainda não fechou.");
    return false;
  }
  if (inicio === S.semana && f === fimP()) return false;
  S.semana = inicio;
  S.fim = f;
  gravarJSON("tp_periodo", { inicio: S.semana, fim: S.fim });
  gravarJSON("tp_semana", S.semana); // compatibilidade com a versão anterior
  carregarSemana();
  return true;
}

function salvarFiltros() {
  gravarJSON("tp_filtros", {
    semaforo: S.semaforo,
    gestor: S.gestor,
    busca: S.busca,
    cenario: S.cenario,
    estado: S.estado,
    soCorrigidos: S.soCorrigidos,
  });
}

/** Registro de envio. Vive no navegador porque `mb_touchpoints` não existe —
 *  e existe porque a pesquisa achou reenvio do mesmo bloco em 6 das 16
 *  semanas do canal. Sem isto, publicar duas vezes é um clique. */
let ENVIADOS = lerJSON("tp_enviados", {});
const chaveE = (ws, gestor) => `${ws}|${gestor}`;
const envioDe = (ws, gestor) => ENVIADOS[chaveE(ws, gestor)] || null;
function registrarEnvio(ws, gestor, dados) {
  ENVIADOS[chaveE(ws, gestor)] = { ...dados, em: new Date().toISOString() };
  gravarJSON("tp_enviados", ENVIADOS);
}
/** Gestores desta semana que já receberam publicação. */
function enviosDaSemana(ws) {
  return Object.entries(ENVIADOS)
    .filter(([k]) => k.startsWith(ws + "|"))
    .map(([k, v]) => ({ gestor: k.slice(ws.length + 1), ...v }));
}

/** As CS que recebem o touchpoint na conversa privada do ClickUp.
 *
 *  O id do canal NÃO mora aqui: quem resolve `eduarda` → canal de DM é o
 *  node Config do workflow de envio. A tela é pública, e um id de DM no
 *  bundle é um convite a mandar mensagem para a pessoa errada por engano.
 *
 *  A mensagem chega pela conta que assina o token do ClickUp no n8n — hoje
 *  a do Patrick. Para quem recebe, é um DM do Patrick, não de um robô. */
const CS = [
  { id: "eduarda", nome: "Eduarda Zancanella", curto: "Eduarda" },
  { id: "amanda", nome: "Amanda Blaszczyk", curto: "Amanda" },
];

const chaveCS = (ws, cs) => `${ws}|cs:${cs}`;
let CS_ENVIADOS = lerJSON("tp_cs_enviados", {});
const envioCSDe = (ws, cs) => CS_ENVIADOS[chaveCS(ws, cs)] || null;
function registrarEnvioCS(ws, cs, dados) {
  CS_ENVIADOS[chaveCS(ws, cs)] = { ...dados, em: new Date().toISOString() };
  gravarJSON("tp_cs_enviados", CS_ENVIADOS);
}


/** Rascunhos: chave `${week_start}|${client_id}`. Vivem só neste navegador. */
const chaveR = (ws, cid) => `${ws}|${cid}`;
let RASCUNHOS = lerJSON("tp_rascunhos", {});

function rascunhoDe(ws, cid) {
  return RASCUNHOS[chaveR(ws, cid)] || null;
}
function salvarRascunho(ws, cid, dados) {
  RASCUNHOS[chaveR(ws, cid)] = { ...dados, atualizado_em: new Date().toISOString() };
  if (!gravarJSON("tp_rascunhos", RASCUNHOS)) {
    aviso("Não consegui gravar o rascunho neste navegador (armazenamento bloqueado). Exporte o JSON antes de fechar.");
  }
}
function apagarRascunho(ws, cid) {
  delete RASCUNHOS[chaveR(ws, cid)];
  gravarJSON("tp_rascunhos", RASCUNHOS);
}

/** Correções de número. Ficam FORA do rascunho de texto de propósito:
 *  "Voltar ao esqueleto" descarta o que a régua escreveu, e não pode
 *  descartar junto o conserto de um número errado no cadastro. */
let CORRECOES = lerJSON("tp_correcoes", {});

const correcaoDe = (ws, cid) => CORRECOES[chaveR(ws, cid)] || null;

function salvarCorrecao(ws, cid, c) {
  if (!c || !Object.keys(c.campos || {}).length) delete CORRECOES[chaveR(ws, cid)];
  else CORRECOES[chaveR(ws, cid)] = { ...c, em: new Date().toISOString() };
  if (!gravarJSON("tp_correcoes", CORRECOES)) {
    aviso("Não consegui gravar a correção neste navegador (armazenamento bloqueado). Exporte antes de fechar.");
  }
}

const temCorrecao = (r) => {
  const c = correcaoDe(chaveP(), r.client_id);
  return Boolean(c && Object.keys(c.campos || {}).length);
};

/** O contrato COM as correções aplicadas. TUDO na tela passa por aqui — se
 *  duas partes da tela lessem payloads diferentes, o texto citaria um número
 *  e a mensagem imprimiria outro. */
const payloadDe = (r) => aplicarCorrecoes(r.payload, correcaoDe(chaveP(), r.client_id));

/** As correções da semana inteira: prévia do envio, nota do CS e CSV. */
function correcoesDaSemana() {
  return S.linhas
    .filter(temCorrecao)
    .map((r) => {
      const c = correcaoDe(chaveP(), r.client_id);
      return {
        cliente: r.client_name,
        client_id: r.client_id,
        motivo: c.motivo || "",
        em: c.em,
        itens: resumoCorrecao(r.payload, c),
      };
    });
}

/** A nota que acompanha o bloco quando ele vai para o CS. Nunca vai para o
 *  canal do cliente: quem imprime é o workflow, e só no destino `cs`. */
function notaInternaDe(r) {
  if (!temCorrecao(r)) return null;
  const c = correcaoDe(chaveP(), r.client_id);
  return (
    "número corrigido à mão — " +
    resumoCorrecao(r.payload, c).map(linhaCorrecao).join("; ") +
    " · motivo: " +
    (c.motivo || "—")
  );
}


/** O texto vigente: o que o MB escreveu, senão o esqueleto.
 *  `lacunas` e `escolhas` vêm junto: são o que a redação sem IA devolve
 *  quando um fato não está no banco (o motivo de uma pausa, por exemplo) e
 *  o que o gestor já respondeu na lista fechada. */
function textoDe(r) {
  const d = rascunhoDe(chaveP(), r.client_id);
  if (d && d.texto)
    return {
      texto: d.texto,
      origem: d.origem || "rascunho",
      lacunas: d.lacunas || [],
      escolhas: d.escolhas || {},
    };
  return { texto: rascunhoDeTexto(payloadDe(r)), origem: "esqueleto", lacunas: [], escolhas: {} };
}

/* ═══════════════════════════════ render ═══════════════════════════════ */

const $ = (s) => document.querySelector(s);

function aviso(msg, tom = "warning") {
  const el = $("#toast");
  el.className = `toast ${tom}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => (el.hidden = true), 6000);
}

/** O recorte DIGITADO nos dois calendários, que só vira o recorte carregado
 *  quando alguém clica em Aplicar. Separar os dois é o que impede a tela de
 *  disparar duas leituras enquanto a pessoa escolhe a segunda data. */
function pendente() {
  return { de: (S.pend && S.pend.de) || S.semana, ate: (S.pend && S.pend.ate) || fimP() };
}

function pintarAplicar() {
  const b = $("#btn-aplicar");
  if (!b) return;
  const { de, ate } = pendente();
  const mudou = de !== S.semana || ate !== fimP();
  const invalido = de > ate ? "o último dia é antes do primeiro" : ate > ontem() ? "o período tem de terminar ontem ou antes — hoje ainda não fechou" : null;
  b.disabled = !mudou || Boolean(invalido);
  b.classList.toggle("primary", mudou && !invalido);
  b.title = invalido || (mudou ? `carregar ${de} → ${ate} (${diasEntre(de, ate)} dias)` : "é o período já carregado");
}

function render() {
  renderBarra();
  renderStrip();
  renderLista();
  renderCartao();
}

function renderBarra() {
  $("#weeklabel").textContent = rotuloP();
  // Um recorte que não é semana fechada tem de gritar: o texto muda por
  // causa disso (“semana” vira “período”) e o benchmark é proporcional.
  $("#weekiso").innerHTML = periodoPadrao()
    ? esc(S.semana)
    : `${esc(S.semana)} → ${esc(fimP())} <span class="chip info">período livre · ${diasP()} dias</span>`;
  const n = S.linhas.length;
  $("#contagem").textContent = S.carregando
    ? "carregando…"
    : n
      ? `${n} clientes elegíveis${S.leitura ? ` · ${S.leitura.ad_insights} linhas de ad_insights, ${S.leitura.agendamentos} agendamentos lidos em ${(S.leitura.ms / 1000).toFixed(1)}s` : ""}`
      : "";

  // Calendário: duas pontas livres. O teto é ONTEM — o dia de hoje ainda
  // está entrando no ad_insights e sairia menor do que foi.
  const de = $("#f-de");
  const ate = $("#f-ate");
  const teto = ontem();
  de.max = teto;
  ate.max = teto;
  const pend = pendente();
  if (de.value !== pend.de) de.value = pend.de;
  if (ate.value !== pend.ate) ate.value = pend.ate;
  $("#f-atalho").value = "";
  pintarAplicar();

  // gestores vêm da semana carregada, não de uma lista fixa
  const sel = $("#f-gestor");
  const gs = [...new Set(S.linhas.flatMap((r) => r.gestores || []))].sort();
  const desejado = `<option value="">todos os gestores</option>` +
    gs.map((g) => `<option value="${esc(g)}"${S.gestor === g ? " selected" : ""}>${esc(g)}</option>`).join("");
  if (sel.dataset.assinatura !== gs.join("|") + "::" + S.gestor) {
    sel.innerHTML = desejado;
    sel.dataset.assinatura = gs.join("|") + "::" + S.gestor;
  }
  $("#f-busca").value = S.busca;
  $("#f-cenario").value = S.cenario;
  $("#f-estado").value = S.estado;
  $("#f-limpar").disabled = !filtrosAtivos();

  const envs = enviosDaSemana(chaveP());
  const csEnv = CS.filter((c) => envioCSDe(chaveP(), c.id));
  $("#envio-estado").innerHTML =
    (envs.length
      ? `<span class="badge-env">● publicado neste período: ${envs.map((e) => esc(e.gestor)).join(", ")}</span> `
      : "") +
    (csEnv.length
      ? `<span class="badge-env" style="background:var(--info-bg);border-color:var(--info-bd);color:var(--info)">● CS: ${csEnv
          .map((c) => esc(c.curto))
          .join(", ")}</span>`
      : "");
}

function renderStrip() {
  const cont = { verde: 0, amarelo: 0, laranja: 0, vermelho: 0 };
  for (const r of S.linhas) cont[r.semaforo]++;
  const rot = {
    verde: "prontos",
    amarelo: "atenção",
    laranja: "sem veiculação",
    vermelho: "bloqueados",
  };
  const prontos = S.linhas.filter((r) => {
    const { texto } = textoDe(r);
    return r.pode_gerar && pendencias(texto).length === 0;
  }).length;
  $("#strip").innerHTML =
    ["verde", "amarelo", "laranja", "vermelho"]
      .map(
        (k) =>
          `<button class="tile sem ${k}" data-sem="${k}" aria-pressed="${S.semaforo === k}">
             <div class="k">${rot[k]}</div><div class="v">${cont[k]}</div></button>`,
      )
      .join("") +
    `<div class="tile"><div class="k">sem marcador</div><div class="v">${prontos}</div></div>` +
    `<button class="tile sem corr" id="tile-corr" aria-pressed="${S.soCorrigidos}"
       title="clientes com número corrigido à mão nesta semana">
       <div class="k">corrigidos</div><div class="v">${S.linhas.filter(temCorrecao).length}</div></button>`;
  for (const b of document.querySelectorAll(".tile.sem[data-sem]")) {
    b.onclick = () => {
      S.semaforo = S.semaforo === b.dataset.sem ? null : b.dataset.sem;
      salvarFiltros();
      render();
    };
  }
  const tc = $("#tile-corr");
  if (tc)
    tc.onclick = () => {
      S.soCorrigidos = !S.soCorrigidos;
      salvarFiltros();
      render();
    };
}

/** O estado do bloco, do ponto de vista de quem vai enviar. É o que o filtro
 *  "estado" usa e o que decide se o cliente entra no envio. */
function estadoDe(r) {
  if (!r.pode_gerar) return "bloqueado";
  const d = rascunhoDe(chaveP(), r.client_id);
  if (!d || !d.texto) return "sem-texto";
  const { texto, origem } = textoDe(r);
  if (pendencias(texto).length) return "pendente";
  return origem === "rascunho" ? "editado" : "pronto";
}

/** Busca por nome ou por número do cliente. `#202`, `202` e `flooring` acham
 *  a mesma linha — o gestor lembra do número, o chefe lembra do nome. */
function casaBusca(r, termo) {
  const q = termo.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  const nome = String(r.client_name || "").toLowerCase();
  const num = String(r.payload?.identificacao?.numero || "").toLowerCase();
  const nicho = String(r.payload?.identificacao?.nicho || "").toLowerCase();
  return nome.includes(q) || num === q || num.startsWith(q) || nicho.includes(q);
}

function visiveis() {
  return S.linhas.filter((r) => {
    if (S.semaforo && r.semaforo !== S.semaforo) return false;
    if (S.gestor && !(r.gestores || []).includes(S.gestor)) return false;
    if (S.cenario && r.cenario !== S.cenario) return false;
    if (S.estado && estadoDe(r) !== S.estado) return false;
    if (S.soCorrigidos && !temCorrecao(r)) return false;
    if (!casaBusca(r, S.busca)) return false;
    return true;
  });
}

const filtrosAtivos = () =>
  Boolean(S.semaforo || S.gestor || S.cenario || S.estado || S.soCorrigidos || S.busca.trim());

const MARCA_ESTADO = {
  bloqueado: "",
  "sem-texto": "",
  pendente: "◻",
  editado: "✎",
  pronto: "✦",
};

function renderLista() {
  const vs = visiveis();
  $("#listhead").textContent =
    `${vs.length} de ${S.linhas.length}` + (filtrosAtivos() ? " · filtrado" : "");
  $("#list").innerHTML = vs.length
    ? vs
        .map((r) => {
          const marca = (temCorrecao(r) ? "≠" : "") + (MARCA_ESTADO[estadoDe(r)] || "");
          return `<button class="row" role="option" data-id="${r.client_id}" aria-current="${S.sel === r.client_id}"
            title="${esc(r.client_name)} · cenário ${r.cenario} · ${estadoDe(r)}">
            <span class="dot ${r.semaforo}"></span>
            <span class="nm">${esc(r.client_name)}</span>
            <span class="cen">${marca}${r.cenario}</span></button>`;
        })
        .join("")
    : `<div class="meta" style="padding:14px">Nenhum cliente com esse filtro.</div>`;
  for (const b of document.querySelectorAll("#list .row")) {
    b.onclick = () => {
      S.sel = b.dataset.id;
      render();
    };
  }
}

function numero(k, v, prov, corrigido) {
  return `<div class="num${corrigido ? " corrigido" : ""}" title="${esc(
    (corrigido ? "CORRIGIDO À MÃO — " : "") + (prov || ""),
  )}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function renderCartao() {
  const el = $("#card");
  if (S.erro) {
    el.innerHTML = `<div class="callout critical"><b>Não consegui carregar a semana.</b>
      <div style="margin-top:6px" class="mono">${esc(S.erro)}</div>
      <p style="margin:10px 0 0">Confira em <b>Ajustes</b> se a base do webhook e o token estão certos,
      e se os três workflows estão <b>ativos</b> no n8n.</p></div>`;
    return;
  }
  if (S.carregando) {
    el.innerHTML = `<p class="meta">Lendo o Supabase e calculando o contrato…</p>`;
    return;
  }
  if (!S.linhas.length) {
    el.innerHTML = `<p class="meta">Escolha um período e clique em <b>Recarregar</b>.</p>`;
    return;
  }
  const r = S.linhas.find((x) => x.client_id === S.sel) || visiveis()[0];
  if (!r) {
    el.innerHTML = `<p class="meta">Nenhum cliente com esse filtro.</p>`;
    return;
  }
  S.sel = r.client_id;

  const p = payloadDe(r);
  const corr = correcaoDe(chaveP(), r.client_id);
  const itensCorr = corr ? resumoCorrecao(r.payload, corr) : [];
  const t = p.midia.total;
  const ag = p.agendamento;
  const bm = p.benchmark;
  const cen = CENARIO[p.cenario.codigo] || CENARIO.X;
  const { texto, origem, lacunas, escolhas } = textoDe(r);
  const pend = pendencias(texto);
  const proib = termosProibidos(`${texto.comoFoi} ${texto.proximoPasso} ${texto.pedido}`);
  const chk = checklist(p, texto);
  const citaAntigo = citaNumeroAntigo(p, texto);
  const incoerencia = incoerencias(p);
  /* O mês do contrato é o do ÚLTIMO dia (regra do SQL). Num recorte que
     atravessa a virada isso deixa o "No mês" menor que o próprio período —
     não é erro, mas quem manda tem de ver antes do cliente ver. */
  const mesParcial =
    p.mes.inicio > p.semana.inicio
      ? { diasMes: diasEntre(p.mes.inicio, p.mes.fim), diasPeriodo: diasEntre(p.semana.inicio, p.semana.fim) }
      : null;
  const mensagem = montarMensagem(p, texto);
  /** Um número do cabeçalho foi corrigido? `sufixo` casa por final de path,
   *  porque o investimento é por plataforma e o total é derivado dele. */
  const tocou = (sufixo) =>
    Boolean(corr && Object.keys(corr.campos || {}).some((k) => k === sufixo || k.endsWith("." + sufixo)));
  const gerando = S.gerando.has(r.client_id);

  const plats = Object.entries(p.midia.por_plataforma);

  el.innerHTML = `
    <div class="chips">
      <span class="cname">${esc(p.identificacao.cliente)}</span>
      <span class="chip ${cen.tom}">${p.cenario.codigo} · ${esc(cen.titulo)}</span>
      <span class="chip">${esc(p.identificacao.nicho || "sem nicho")}</span>
      ${p.identificacao.plano ? `<span class="chip">${esc(p.identificacao.plano)}</span>` : ""}
      <span class="chip">${esc((p.identificacao.gestores || []).join(", ") || "sem gestor")}</span>
      ${itensCorr.length ? `<span class="chip info">≠ ${itensCorr.length} número(s) corrigido(s)</span>` : ""}
    </div>
    <div class="meta">${esc(p.semana.label)} · fuso ${esc(p.semana.timezone)} · ${esc(p.identificacao.tier || "")}</div>

    ${
      p.qualidade.bloqueios.length
        ? `<div class="sec"><div class="callout critical"><b>Bloqueado — não gera bloco.</b>
             <ul>${p.qualidade.bloqueios.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div></div>`
        : ""
    }
    ${
      p.qualidade.avisos.length
        ? `<div class="sec"><div class="callout" style="background:var(--warning-bg);border:1px solid var(--warning-bd)">
             <b style="color:var(--warning)">Avisos</b>
             <ul>${p.qualidade.avisos.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div></div>`
        : ""
    }

    <div class="sec">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">${periodoPadrao() ? "Semana" : "Período"} — ${plats.length ? plats.map(([k]) => PLATAFORMA_LABEL[k] ?? k).join(" + ") : "sem investimento"}</h3>
        <button id="btn-corrigir">${itensCorr.length ? "Revisar correção" : "Corrigir números"}</button>
        <span class="fhint" style="margin-left:auto">o número vem do banco — corrija só quando o banco estiver errado</span>
      </div>
      ${
        itensCorr.length
          ? `<div class="callout" style="background:var(--info-bg);border:1px solid var(--info-bd);margin-bottom:9px">
               <b style="color:var(--info)">Números corrigidos à mão.</b> O Supabase continua com o valor antigo —
               exporte a lista e mande para quem conserta o cadastro, senão a mesma correção volta na semana que vem.
               <ul>${itensCorr
                 .map(
                   (x) =>
                     `<li>${esc(x.rotulo)}: <span class="mono">${esc(x.de)}</span> → <b class="mono">${esc(x.para)}</b></li>`,
                 )
                 .join("")}</ul>
               <div style="margin-top:6px"><b>Motivo:</b> ${esc(corr.motivo || "—")}</div>
             </div>`
          : ""
      }
      <div class="nums">
        ${numero("Ad Spend", money(t.spend), p.proveniencia.spend_leads, tocou("spend"))}
        ${numero("Leads", t.leads, p.proveniencia.spend_leads, tocou("leads"))}
        ${numero("CPL", money(t.cpl), p.proveniencia.cpl, tocou("spend") || tocou("leads"))}
        ${numero("Agendamentos", ag.semana, p.proveniencia.agendamento, tocou("agendamento.semana"))}
        ${numero("Impressões", t.impressions.toLocaleString("pt-BR"), p.proveniencia.spend_leads)}
        ${numero("Page views", t.page_views.toLocaleString("pt-BR"), p.proveniencia.spend_leads)}
      </div>
    </div>

    <div class="sec">
      <h3>Contra o período anterior — os ${diasP()} dias imediatamente antes</h3>
      <div class="nums">
        ${numero("Δ Spend", money(p.comparacao.var_spend), `período anterior: ${p.comparacao.semana_anterior.inicio} a ${p.comparacao.semana_anterior.fim}`)}
        ${numero("Δ Leads", (p.comparacao.var_leads > 0 ? "+" : "") + p.comparacao.var_leads, "diferença de leads")}
        ${numero("Δ Agend.", (p.comparacao.var_appts > 0 ? "+" : "") + p.comparacao.var_appts, "diferença de agendamentos")}
        ${numero("CPL anterior", money(p.comparacao.semana_anterior.cpl), "CPL do período anterior")}
      </div>
    </div>

    <div class="sec">
      <h3>No mês</h3>
      ${
        mesParcial
          ? `<div class="callout" style="background:var(--warning-bg);border:1px solid var(--warning-bd);margin-bottom:9px">
               <b style="color:var(--warning)">O mês cobre ${mesParcial.diasMes} de ${mesParcial.diasPeriodo} dias do período.</b>
               O contrato define o mês como o do <b>último dia</b> do recorte, e este recorte atravessa a virada:
               o bloco <span class="mono">📊 No mês</span> da mensagem vai de ${dia(p.mes.inicio)} a ${dia(p.mes.fim)}
               e sai <b>menor</b> que o período logo acima dele. O texto não cita mais esse número — mas a linha
               continua na mensagem. Se ela atrapalhar, termine o período no último dia do mês.
             </div>`
          : ""
      }
      <div class="mesbox">
        <span class="lbl">${dia(p.mes.inicio)} a ${dia(p.mes.fim)} · ${esc(p.proveniencia.meta_mensal)}</span>
        <span>Leads: <b>${p.mes.leads}</b></span>
        <span>Investimento: <b>${money(p.mes.spend)}</b></span>
        <span>Agendamentos: <b>${p.mes.agendamentos}</b>${ag.meta_usada != null ? ` de <b>${Math.round(ag.meta_usada)}</b> ${ag.origem_meta === "contrato" ? "contratados" : "(referência do nicho)"}` : ""}</span>
      </div>
      <div class="meta" style="margin-top:6px">
        Ritmo de leads ${bm.ritmo_leads ?? "—"} (${bm.classe_leads ?? "sem classe"}) ·
        ritmo de agendamento ${bm.ritmo_appts ?? "—"} (${bm.classe_appts ?? "sem classe"}) ·
        benchmark ${esc(bm.nicho_benchmark || "nenhum")}${bm.bm_cpl ? `, CPL alvo ${money(bm.bm_cpl)}` : ""}
      </div>
    </div>

    <div class="sec">
      <h3>Régua do cenário ${p.cenario.codigo}</h3>
      <div class="regua ${cen.tom === "critical" ? "callout critical" : ""}" style="background:var(--panel-2);border:1px solid var(--line-soft)">
        <div class="t">${esc(cen.titulo)}</div>
        <dl class="l">
          <dt>Abre por</dt><dd>${esc(cen.abrePor)}</dd>
          <dt>Entrega</dt><dd>${esc(cen.entrega)}</dd>
          <dt>Proibido</dt><dd>${esc(cen.proibido)}</dd>
        </dl>
        ${p.cenario.codigo === "D" ? `<ol>${ROTEIRO_D.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      </div>
    </div>

    <div class="sec">
      <h3>Contexto do MB — otimizações registradas no período</h3>
      ${
        p.contexto_mb.length
          ? `<ul style="margin:0;padding-left:18px;font-size:12.5px">${p.contexto_mb
              .map(
                (o) =>
                  `<li><b>${esc(o.acao || "—")}</b>${o.problema ? ` · ${esc(o.problema)}` : ""}${o.validar_em ? ` · validar em ${dia(o.validar_em)}` : ""}</li>`,
              )
              .join("")}</ul>`
          : `<div class="nota"><b>Nenhuma otimização registrada.</b> Sem isso, o “Próximo passo” volta como
             <span class="mono">[MB: …]</span> — a IA não inventa ação. É o gargalo real da Fase 3:
             <span class="mono">mb_optimizations</span> tem 8 linhas na base inteira.</div>`
      }
    </div>

    <div class="sec">
      <h3>Checklist antes de publicar (8.8)</h3>
      <div class="check">
        ${chk
          .map(
            (c) =>
              `<div><span class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "!"}</span>
               <span class="txt ${c.ok ? "done" : ""}">${esc(c.label)}${c.manual ? " (confere você)" : ""}</span></div>`,
          )
          .join("")}
      </div>
    </div>

    <!-- ── o touchpoint final, editável NO LUGAR ─────────────────────────
         Os três campos deixaram de morar numa seção separada lá em cima:
         eles são as partes editáveis desta mensagem. O que está fora deles
         é o que a tela não deixa digitar — número, e número vem do
         contrato. Editar aqui é ver o resultado no mesmo lugar. -->
    <div class="sec">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">Touchpoint final — o que vai para o cliente</h3>
        <span class="chip ${origem === "regua" ? "info" : ""}">${origem === "regua" ? "escrito pela régua do cenário" : origem === "rascunho" ? "editado por você" : "esqueleto"}</span>
        <button id="btn-ia" ${gerando || !r.pode_gerar ? "disabled" : ""}>${gerando ? "escrevendo…" : "Escrever"}</button>
        <button id="btn-reset" class="ghost">Voltar ao esqueleto</button>
        <span class="fhint" style="margin-left:auto">os campos com borda tracejada são seus · $0.00 de API</span>
      </div>
      ${
        lacunas.length
          ? `<div class="callout" style="background:var(--panel-2);border:1px solid var(--line-soft);margin-bottom:10px">
               <b>O banco não tem estes fatos — responda e o texto se fecha sozinho.</b>
               ${lacunas
                 .map(
                   (l) => `<div class="field" style="margin-top:8px">
                     <div class="fh"><span class="fl">${esc(l.pergunta)}</span>
                       <span class="fhint mono">${esc(l.marcador)}</span></div>
                     <select class="box lac" data-lac="${esc(l.id)}">
                       <option value="">— escolha —</option>
                       ${l.opcoes
                         .map(
                           (o) =>
                             `<option value="${esc(o.valor)}"${escolhas[l.id] === o.valor ? " selected" : ""}>${esc(o.rotulo)}</option>`,
                         )
                         .join("")}
                     </select>
                   </div>`,
                 )
                 .join("")}
             </div>`
          : ""
      }
      <div class="msg viva">
        ${partesMensagem(p, texto, true)
          .map((x) =>
            x.tipo === "fixo"
              ? `<div class="fixo">${esc(x.texto)}</div>`
              : `<div class="fixo rot">${esc(x.rotulo)}</div>
                 <div class="campo"><span class="tag">${esc(x.dica)}</span>
                   <textarea class="box ed" data-k="${x.k}" rows="${x.linhas}"
                     placeholder="${esc(x.rotulo)}">${esc(x.valor)}</textarea></div>`,
          )
          .join("")}
      </div>
      ${
        pend.length
          ? `<div class="callout critical" style="margin-top:10px"><b>${pend.length} marcador(es) por preencher.</b>
             Enquanto houver <span class="mono">[…]</span> no texto, o envio fica travado — é o comportamento
             correto: a informação não está no banco.
             <div style="margin-top:6px" class="mono">${pend.map(esc).join(" · ")}</div></div>`
          : ""
      }
      ${
        incoerencia.length
          ? `<div class="callout critical" style="margin-top:10px"><b>Período e mês não fecham:</b>
             ${esc(incoerencia.join(" · "))}. Abra <b>Corrigir números</b> e acerte o mês também.</div>`
          : ""
      }
      ${
        citaAntigo.length
          ? `<div class="callout critical" style="margin-top:10px"><b>O texto ainda cita ${esc(citaAntigo.join(", "))}</b> —
             número de antes da correção. Reescreva pela régua ou corrija a frase à mão.</div>`
          : ""
      }
      ${
        proib.length
          ? `<div class="nota" style="background:var(--warning-bg);border-color:var(--warning-bd)">
             <b style="color:var(--warning)">Léxico:</b>
             ${proib.map((x) => `“${esc(x.termo)}” → ${esc(x.troque)}`).join(" · ")}</div>`
          : ""
      }

      <div class="acoes">
        <button id="btn-copiar" class="ghost">Copiar mensagem</button>
        <button id="btn-cs">Enviar para CS</button>
        <button id="btn-envio-daqui" class="primary">Revisar e enviar</button>
        <span class="fhint">
          “Enviar para CS” manda para a conversa privada da Eduarda ou da Amanda;
          “Revisar e enviar” abre a prévia do canal que o cliente lê.
        </span>
      </div>
    </div>
  `;

  /* A caixa cresce com o texto: dentro da mensagem, uma barra de rolagem
     escondendo a última frase é a forma mais fácil de publicar meia frase. */
  const crescer = (ta) => {
    // `height:0` e não `auto`: com `auto` o navegador devolve a altura do
    // atributo `rows`, e a caixa de 4 linhas nunca encolhe para 2.
    ta.style.height = "0px";
    ta.style.height = ta.scrollHeight + 2 + "px";
  };
  for (const ta of document.querySelectorAll(".msg textarea.ed")) crescer(ta);
  for (const ta of document.querySelectorAll("textarea.ed")) {
    ta.oninput = () => {
      crescer(ta);
      const novo = { ...texto, [ta.dataset.k]: ta.value };
      // editar à mão não descarta as lacunas nem as respostas já dadas
      salvarRascunho(chaveP(), r.client_id, { texto: novo, origem: "rascunho", lacunas, escolhas });
      clearTimeout(renderCartao._t);
      renderCartao._t = setTimeout(() => {
        const pos = ta.selectionStart;
        const k = ta.dataset.k;
        render();
        const alvo = document.querySelector(`textarea.ed[data-k="${k}"]`);
        if (alvo) {
          alvo.focus();
          alvo.setSelectionRange(pos, pos);
        }
      }, 700);
    };
  }
  // Escolher a resposta de uma lacuna reescreve o bloco na hora — é de graça.
  for (const sel of document.querySelectorAll("select.lac")) {
    sel.onchange = () => {
      const novas = { ...escolhas, [sel.dataset.lac]: sel.value };
      if (!sel.value) delete novas[sel.dataset.lac];
      escrever(r, novas);
    };
  }

  const bCorr = $("#btn-corrigir");
  if (bCorr) bCorr.onclick = () => abrirCorrecao(r);
  const bIa = $("#btn-ia");
  if (bIa) bIa.onclick = () => escrever(r, escolhas);
  const bR = $("#btn-reset");
  if (bR)
    bR.onclick = () => {
      apagarRascunho(chaveP(), r.client_id);
      render();
    };
  const bC = $("#btn-copiar");
  if (bC)
    bC.onclick = async () => {
      await navigator.clipboard.writeText(mensagem);
      aviso("Mensagem copiada.", "info");
    };
  // Os dois envios moram aqui embaixo, ao lado do texto que eles mandam.
  const bCs = $("#btn-cs");
  if (bCs) bCs.onclick = abrirCS;
  const bEnv = $("#btn-envio-daqui");
  if (bEnv) bEnv.onclick = montarEnvio;
}

/* ═══════════════════════════════ ações ═══════════════════════════════ */

async function carregarSemana() {
  S.carregando = true;
  S.erro = null;
  S.linhas = [];
  render();
  try {
    const j = await chamar("mb-touchpoint-week", { week_start: S.semana, week_end: fimP(), tz: cfg.tz });
    S.linhas = j.linhas || [];
    S.leitura = j.leitura || null;
    S.sel = S.linhas[0]?.client_id ?? null;
  } catch (e) {
    S.erro = String(e.message || e);
  } finally {
    S.carregando = false;
    render();
  }
}

/**
 * Escreve os três campos. Desde 30/08 isto NÃO chama modelo nenhum: o
 * webhook `mb-touchpoint-redacao` roda `redacao.js`, que monta o texto a
 * partir da régua do cenário e do contrato. Custo por semana: zero.
 *
 * `escolhas` são as respostas das lacunas — os fatos que o banco não tem
 * (o motivo de uma pausa) e que o gestor responde de lista fechada.
 */
async function escrever(r, escolhas, silencioso) {
  S.gerando.add(r.client_id);
  if (!silencioso) render();
  try {
    const j = await chamar("mb-touchpoint-redacao", { contrato: payloadDe(r), escolhas: escolhas || {} });
    if (j.ok === false) throw new Error(j.dica ? `${j.erro} — ${j.dica}` : j.erro || "a redação voltou com erro");
    const texto = {
      comoFoi: j.como_foi ?? "",
      proximoPasso: j.proximo_passo ?? "",
      pedido: j.pedido_cliente ?? "",
    };
    if (!texto.comoFoi) throw new Error("resposta sem os três campos: " + JSON.stringify(j).slice(0, 200));
    salvarRascunho(chaveP(), r.client_id, {
      texto,
      origem: "regua",
      lacunas: j.lacunas || [],
      escolhas: escolhas || {},
      motor: j.motor || null,
    });

    // A guarda de saída avisa, não reescreve: quem decide a palavra final é o
    // gestor. `[MB: …]` é comportamento CORRETO — a informação não está no
    // banco. A diferença para a versão com IA é que agora ele vem com a
    // pergunta e a lista de respostas ao lado.
    const a = j.avisos || {};
    if (silencioso) return (j.lacunas || []).length;
    const partes = [];
    if ((a.lexico || []).length) partes.push(`léxico: ${a.lexico.map((x) => `“${x.termo}”`).join(", ")}`);
    if (a.sem_prazo) partes.push("o “Próximo passo” não tem data");
    if ((j.lacunas || []).length) partes.push(`${j.lacunas.length} pergunta(s) para você responder abaixo`);
    if (partes.length) aviso("Texto escrito, mas: " + partes.join(" · "));
    else aviso("Redação pronta, sem custo de API.", "info");
    return (j.lacunas || []).length;
  } catch (e) {
    if (!silencioso) aviso("Redação falhou: " + (e.message || e), "critical");
    throw e;
  } finally {
    S.gerando.delete(r.client_id);
    if (!silencioso) render();
  }
}

/** Escreve a semana inteira. Só faz sentido porque a redação ficou de graça:
 *  com a Messages API isto era uma decisão de custo, agora é um clique. */
async function escreverTodos() {
  const alvo = S.linhas.filter((r) => r.pode_gerar);
  if (!alvo.length) return aviso("Nenhum cliente elegível neste período.");
  let feitos = 0;
  let comPergunta = 0;
  let falhas = 0;
  aviso(`Escrevendo ${alvo.length} blocos…`, "info");
  for (const r of alvo) {
    try {
      const { escolhas } = textoDe(r);
      const n = await escrever(r, escolhas, true);
      feitos++;
      if (n) comPergunta++;
    } catch {
      falhas++;
    }
  }
  render();
  aviso(
    `${feitos} blocos escritos` +
      (comPergunta ? ` · ${comPergunta} esperam uma resposta sua` : "") +
      (falhas ? ` · ${falhas} falharam` : "") +
      " · $0.00 de API",
    falhas ? "warning" : "info",
  );
}

/** Os blocos que entram no envio, agrupados por gestor.
 *
 *  O FILTRO NÃO ENTRA AQUI de propósito. Filtrar é para revisar; enviar é
 *  sobre a semana inteira. Se o filtro mandasse no envio, uma busca esquecida
 *  na caixa faria o cliente de fora sumir sem ninguém perceber. */
function blocosParaEnvio() {
  const porGestor = new Map();
  for (const r of S.linhas) {
    if (estadoDe(r) !== "pronto" && estadoDe(r) !== "editado") continue;
    const { texto } = textoDe(r);
    const p = payloadDe(r);
    // A nota da correção só é IMPRESSA no destino `cs` — quem decide é o
    // workflow. O canal do cliente recebe o bloco sem nota nenhuma.
    const nota = notaInternaDe(r);
    for (const g of r.gestores.length ? r.gestores : ["(sem gestor)"]) {
      if (!porGestor.has(g)) porGestor.set(g, []);
      porGestor.get(g).push({
        client_id: r.client_id,
        cliente: p.identificacao.cliente,
        message_text: montarMensagem(p, texto),
        ...(nota ? { nota_interna: nota } : {}),
      });
    }
  }
  return porGestor;
}

/** Pede ao n8n a prévia (dry-run) de cada gestor. Nada é publicado aqui. */
async function montarEnvio() {
  const porGestor = blocosParaEnvio();
  if (!porGestor.size) {
    aviso("Nenhum cliente pronto: ou estão bloqueados, ou sem texto, ou ainda com marcador [ ].");
    return;
  }
  const saidas = [];
  for (const [gestor, blocos] of porGestor) {
    try {
      const j = await chamar("mb-touchpoint-envio", {
        gestor,
        blocos,
        periodo: rotuloP(),
        week_start: S.semana,
        week_end: fimP(),
        // sem `confirmar: true` — prévia. Publicar é o botão do rodapé.
      });
      saidas.push({ ...j, gestor, blocos });
    } catch (e) {
      saidas.push({ ok: false, gestor, erro: String(e.message || e) });
    }
  }
  abrirEnvio(saidas);
}

function abrirEnvio(saidas) {
  const dlg = $("#dlg-envio");
  const boas = saidas.filter((s) => s.ok !== false);
  const jaEnviados = boas.filter((s) => envioDe(chaveP(), s.gestor));

  $("#envio-aviso").innerHTML = jaEnviados.length
    ? `<b style="color:var(--critical)">Atenção: ${jaEnviados.length} gestor(es) já tiveram este período publicado</b>
       — ${jaEnviados
         .map((s) => `${esc(s.gestor)} em ${new Date(envioDe(chaveP(), s.gestor).em).toLocaleString("pt-BR")}`)
         .join(" · ")}.
       Publicar de novo manda a mensagem <b>outra vez</b> para o cliente. A pesquisa achou reenvio do mesmo
       bloco em 6 das 16 semanas do canal — é o erro mais comum aqui.`
    : `<b>Prévia.</b> O n8n montou a mensagem exata e ainda <b>não</b> publicou. O botão
       <b>Publicar no canal</b> lá embaixo é que envia — e ele pede confirmação digitada.`;

  const corrs = correcoesDaSemana();
  $("#envio-correcoes").innerHTML = corrs.length
    ? `<div class="callout" style="background:var(--info-bg);border:1px solid var(--info-bd);margin-bottom:14px">
         <b style="color:var(--info)">${corrs.length} cliente(s) com número corrigido à mão.</b>
         O que vai para o cliente é o número corrigido. O de→para e o motivo ficam internos —
         vão na nota do CS e no CSV, nunca na mensagem.
         <ul>${corrs
           .map(
             (c) =>
               `<li><b>${esc(c.cliente)}</b> — ${esc(c.itens.map(linhaCorrecao).join("; "))}<br>
                <span class="meta">motivo: ${esc(c.motivo || "—")}</span></li>`,
           )
           .join("")}</ul>
         <button class="ghost" id="btn-csv" style="margin-top:6px">Baixar CSV para corrigir o cadastro</button>
       </div>`
    : "";
  const bcsv = $("#btn-csv");
  if (bcsv) bcsv.onclick = baixarCorrecoesCSV;

  $("#envio-corpo").innerHTML = saidas
    .map((s) =>
      s.ok === false
        ? `<div class="callout critical"><b>${esc(s.gestor || "")}</b><div class="mono">${esc(s.erro)}</div></div>`
        : `<div class="sec"><h3>@${esc(s.gestor)} — ${s.clientes} cliente(s), ${s.caracteres} caracteres
             ${
               envioDe(chaveP(), s.gestor)
                 ? `<span class="chip critical">já publicado</span>`
                 : s.dry_run
                   ? `<span class="chip warning">prévia</span>`
                   : `<span class="chip critical">PUBLICADO</span>`
             }</h3>
           <div class="msg">${esc(s.mensagem)}</div></div>`,
    )
    .join("");

  const total = boas.reduce((a, s) => a + (s.clientes || 0), 0);
  $("#envio-rodape").innerHTML = boas.length
    ? `<button class="ghost" data-fechar>Fechar</button>
       <button id="btn-cs-daqui">Enviar para CS</button>
       <button class="primary" id="btn-publicar">Publicar no canal — ${boas.length} mensagem(ns), ${total} cliente(s)</button>`
    : `<button class="ghost" data-fechar>Fechar</button>`;

  const bp = $("#btn-publicar");
  if (bp) bp.onclick = () => abrirPublicar(boas);
  const bcs = $("#btn-cs-daqui");
  if (bcs)
    bcs.onclick = () => {
      dlg.close();
      abrirCS();
    };
  for (const b of dlg.querySelectorAll("[data-fechar]")) b.onclick = () => dlg.close();
  dlg.showModal();
}

/* ─────────────────── publicar de verdade (canal do cliente) ─────────────────── */

function abrirPublicar(saidas) {
  const dlg = $("#dlg-publicar");
  const total = saidas.reduce((a, s) => a + (s.clientes || 0), 0);
  // Ensaio: publica de verdade, num canal sem cliente. É o que permite alguém
  // clicar no botão inteiro antes de fazer isso valendo.
  let ensaio = Boolean(cfg.ensaio);
  $("#pub-alvo").innerHTML = cfg.ensaio
    ? `<div class="field" style="margin-top:10px">
         <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
           <input type="checkbox" id="pub-ensaio" checked style="margin-top:3px">
           <span>Mandar para o <b>canal de ensaio</b> (<span class="mono">${esc(cfg.ensaio)}</span>)
             em vez do <span class="mono">Touchpoints</span>. A mensagem sai de verdade — só não vai
             para o cliente.</span>
         </label>
       </div>`
    : "";
  $("#pub-resumo").innerHTML = `
    <div class="mesbox">
      <span class="lbl">${esc(rotuloP())} · canal Touchpoints</span>
      <span>Mensagens: <b>${saidas.length}</b> (uma por gestor)</span>
      <span>Clientes: <b>${total}</b></span>
      <span>Gestores: <b>${saidas.map((s) => esc(s.gestor)).join(", ")}</b></span>
    </div>`;

  const repetidos = saidas.filter((s) => envioDe(chaveP(), s.gestor));
  $("#pub-jaenviado").innerHTML = repetidos.length
    ? `<div class="callout critical" style="margin-top:10px"><b>REENVIO</b> —
       ${repetidos.map((s) => esc(s.gestor)).join(", ")} já receberam este período. O cliente vai ver a
       mensagem duas vezes.</div>`
    : "";

  const campo = $("#pub-confirma");
  const botao = $("#pub-executar");
  const cx = $("#pub-ensaio");
  const pintar = () => {
    ensaio = cx ? cx.checked : false;
    botao.textContent = ensaio ? "Publicar no ensaio" : "Publicar agora";
    // Só o envio de verdade exige digitar. No ensaio o atrito não protege
    // nada — e um botão difícil de apertar é um botão que ninguém testa.
    campo.closest(".field").hidden = ensaio;
    botao.disabled = ensaio ? false : campo.value.trim().toUpperCase() !== "PUBLICAR";
  };
  campo.value = "";
  if (cx) cx.onchange = pintar;
  campo.oninput = pintar;
  pintar();
  botao.onclick = () => publicar(saidas, ensaio ? cfg.ensaio : null);
  for (const b of dlg.querySelectorAll("[data-fechar]")) b.onclick = () => dlg.close();
  dlg.showModal();
  if (!ensaio) campo.focus();
}

async function publicar(saidas, canalEnsaio) {
  const botao = $("#pub-executar");
  botao.disabled = true;
  botao.textContent = "publicando…";
  const feitos = [];
  const falhas = [];
  for (const s of saidas) {
    try {
      const j = await chamar("mb-touchpoint-envio", {
        gestor: s.gestor,
        blocos: s.blocos,
        periodo: rotuloP(),
        week_start: S.semana,
        week_end: fimP(),
        confirmar: true,
        ...(canalEnsaio ? { channel_id: canalEnsaio } : {}),
      });
      if (j.dry_run) {
        falhas.push(`${s.gestor}: voltou dry-run — ${j.motivo_dry_run}`);
      } else if (canalEnsaio) {
        // Ensaio não conta como semana publicada: o cliente não recebeu nada.
        feitos.push(s.gestor);
      } else {
        // Registrar ANTES de qualquer outra coisa: se o navegador morrer
        // agora, o que não pode acontecer é a mensagem existir no canal e a
        // tela achar que não existe. Errar para o lado de "já enviei".
        registrarEnvio(chaveP(), s.gestor, {
          clientes: j.client_ids ? j.client_ids.length : s.clientes,
          client_ids: j.client_ids || [],
          clickup_message_id: j.clickup_message_id || null,
        });
        feitos.push(s.gestor);
      }
    } catch (e) {
      falhas.push(`${s.gestor}: ${String(e.message || e)}`);
    }
  }
  $("#dlg-publicar").close();
  $("#dlg-envio").close();
  botao.textContent = "Publicar agora";
  render();
  const onde = canalEnsaio ? "no canal de ensaio" : "no canal Touchpoints";
  if (feitos.length && !falhas.length) aviso(`Publicado ${onde}: ${feitos.join(", ")}.`, "info");
  else if (feitos.length) aviso(`Publicado ${onde}: ${feitos.join(", ")}. Falhou: ${falhas.join(" · ")}`, "warning");
  else aviso(`Não publicou: ${falhas.join(" · ")}`, "critical");
}


/* ═════════════ diálogo: corrigir números do contrato ═════════════ */

function abrirCorrecao(r) {
  const dlg = $("#dlg-num");
  const base = r.payload; // o contrato como o banco devolveu — o "de"
  const atual = correcaoDe(chaveP(), r.client_id) || { campos: {}, motivo: "" };
  const campos = camposCorrigiveis(base);

  $("#num-cliente").textContent = base.identificacao.cliente;
  $("#num-motivo").value = atual.motivo || "";

  const grupos = [...new Set(campos.map((c) => c.grupo))];
  $("#num-campos").innerHTML = grupos
    .map((g) => {
      const doGrupo = campos.filter((c) => c.grupo === g);
      return `<div class="sec"><h3>${esc(g)}</h3>
        <div style="display:grid;gap:8px">
          ${doGrupo
            .map((c) => {
              const posto = Object.prototype.hasOwnProperty.call(atual.campos, c.id) ? atual.campos[c.id] : c.valor;
              const doBanco =
                c.valor === null || c.valor === undefined
                  ? "—"
                  : c.tipo === "money"
                    ? money(c.valor)
                    : String(c.valor);
              const entrada =
                c.tipo === "select"
                  ? `<select class="box corr" data-id="${esc(c.id)}" data-tipo="select" style="width:100%">
                       ${c.opcoes
                         .map(
                           (o) =>
                             `<option value="${esc(o.valor)}"${String(posto) === o.valor ? " selected" : ""}>${esc(o.rotulo)}</option>`,
                         )
                         .join("")}
                     </select>`
                  : `<input type="number" class="corr" data-id="${esc(c.id)}" data-tipo="${c.tipo}"
                       step="${c.tipo === "money" ? "0.01" : "1"}" ${c.tipo === "int" ? 'min="0"' : ""}
                       value="${posto === null || posto === undefined ? "" : esc(posto)}"
                       style="font:inherit;font-size:12.5px;padding:5px 9px;border-radius:8px;
                              border:1px solid var(--line);background:var(--panel-2);color:var(--ink);width:100%">`;
              return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 150px 190px;gap:10px;align-items:center">
                  <span style="font-size:12.5px">${esc(c.rotulo)}${
                    c.dica ? `<br><span class="fhint">${esc(c.dica)}</span>` : ""
                  }</span>
                  <span class="mono meta" title="valor calculado pelo contrato">banco: ${esc(doBanco)}</span>
                  ${entrada}
                </div>`;
            })
            .join("")}
        </div></div>`;
    })
    .join("");

  /** O que difere do banco. Digitar o mesmo número não é correção — e não
   *  pode pintar o bloco de "corrigido à mão" nem exigir motivo. */
  const coletar = () => {
    const fora = {};
    for (const el of dlg.querySelectorAll(".corr")) {
      const c = campos.find((x) => x.id === el.dataset.id);
      if (!c) continue;
      if (el.dataset.tipo === "select") {
        if (el.value !== String(c.valor)) fora[c.id] = el.value;
        continue;
      }
      if (el.value.trim() === "") continue;
      const v = el.dataset.tipo === "money" ? r2(el.value) : inteiro(el.value);
      const antigo = c.valor === null || c.valor === undefined ? null : Number(c.valor);
      if (antigo === null || Math.abs(v - antigo) > 0.001) fora[c.id] = v;
    }
    return fora;
  };

  const pintar = () => {
    const fora = coletar();
    const n = Object.keys(fora).length;
    // Roda a correção inteira a cada tecla e checa o resultado: é barato, e
    // é a única forma de pegar a correção pela metade ANTES de salvar.
    const inc = incoerencias(n ? aplicarCorrecoes(base, { campos: fora, motivo: "" }) : base);
    $("#num-incoerencia").innerHTML = inc.length
      ? `<div class="callout critical" style="margin-bottom:12px"><b>Isso não fecha:</b>
           <ul>${inc.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
           O mês contém a semana. Corrija o mês também — senão o texto cita dois números
           que não podem existir juntos.</div>`
      : "";
    $("#num-salvar").textContent = n ? `Salvar ${n} correção(ões)` : "Salvar correção";
    $("#num-salvar").disabled = inc.length > 0 || (n === 0 && !Object.keys(atual.campos).length);
  };
  for (const el of dlg.querySelectorAll(".corr")) {
    el.oninput = pintar;
    el.onchange = pintar;
  }
  pintar();

  $("#num-limpar").onclick = () => {
    salvarCorrecao(chaveP(), r.client_id, null);
    dlg.close();
    aviso("Correções descartadas — o bloco voltou aos números do banco.", "info");
    reescreverSePreciso(r);
  };

  $("#num-salvar").onclick = () => {
    const fora = coletar();
    const motivo = $("#num-motivo").value.trim();
    if (Object.keys(fora).length && motivo.length < 5) {
      aviso("Escreva o motivo da correção — ele vai para o CS e para quem conserta o cadastro.", "critical");
      $("#num-motivo").focus();
      return;
    }
    salvarCorrecao(chaveP(), r.client_id, Object.keys(fora).length ? { campos: fora, motivo } : null);
    dlg.close();
    reescreverSePreciso(r);
  };

  for (const b of dlg.querySelectorAll("[data-fechar]")) b.onclick = () => dlg.close();
  dlg.showModal();
}

/** Corrigir número muda o texto. Se a régua escreveu, reescreve sozinho — é
 *  de graça. Se a pessoa escreveu, NÃO sobrescreve: avisa, porque o texto
 *  ainda cita o número antigo e quem decide a palavra final é ela. */
function reescreverSePreciso(r) {
  const d = rascunhoDe(chaveP(), r.client_id);
  if (!d || !d.texto) {
    render();
    return;
  }
  if (d.origem === "regua") {
    escrever(r, d.escolhas || {}).catch(() => {});
    return;
  }
  render();
  const antigos = citaNumeroAntigo(payloadDe(r), textoDe(r).texto);
  aviso(
    antigos.length
      ? `O texto foi editado à mão e ainda cita ${antigos.join(", ")} — o número de antes da correção.`
      : "Números corrigidos. O texto foi editado à mão, então não foi reescrito — confira.",
    "warning",
  );
}

/* ═════════════ diálogo: enviar para CS ═════════════ */

/** Os blocos que vão para a CS. `escopo` = a semana toda ou só o cliente
 *  aberto — "finalizar o touchpoint" é as duas coisas dependendo do dia. */
function blocosCS(escopo) {
  const porGestor = blocosParaEnvio();
  if (escopo !== "cliente") return porGestor;
  const m = new Map();
  for (const [g, bs] of porGestor) {
    const f = bs.filter((b) => b.client_id === S.sel);
    if (f.length) m.set(g, f);
  }
  return m;
}

function abrirCS() {
  const dlg = $("#dlg-cs");
  let escopo = "semana";
  let escolhidas = [];

  const selecionado = S.linhas.find((x) => x.client_id === S.sel);
  $("#cs-escopo").innerHTML = `
    <div class="field">
      <div class="fh"><span class="fl">O que mandar</span></div>
      <div style="display:grid;gap:6px">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
          <input type="radio" name="cs-escopo" value="semana" checked>
          <span>O <b>período todo</b> — todos os blocos prontos</span></label>
        <label style="display:flex;gap:8px;align-items:center;cursor:${selecionado ? "pointer" : "not-allowed"};opacity:${selecionado ? 1 : 0.5}">
          <input type="radio" name="cs-escopo" value="cliente" ${selecionado ? "" : "disabled"}>
          <span>Só <b>${esc(selecionado ? selecionado.client_name : "o cliente aberto")}</b></span></label>
      </div>
    </div>`;

  $("#cs-quem").innerHTML = `
    <div class="field">
      <div class="fh"><span class="fl">Para quem</span></div>
      <div style="display:grid;gap:6px">
        ${CS.map((c) => {
          const j = envioCSDe(chaveP(), c.id);
          return `<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" class="cs-quem" value="${c.id}" style="margin-top:3px">
            <span><b>${esc(c.curto)}</b> <span class="meta">${esc(c.nome)}</span>
            ${j ? `<span class="chip critical" style="margin-left:6px">já recebeu este período · ${new Date(j.em).toLocaleString("pt-BR")}</span>` : ""}
            </span></label>`;
        }).join("")}
      </div>
    </div>`;

  const corrs = correcoesDaSemana();
  $("#cs-correcoes").innerHTML = corrs.length
    ? `<div class="callout" style="background:var(--info-bg);border:1px solid var(--info-bd);margin-bottom:10px">
         <b style="color:var(--info)">${corrs.length} cliente(s) com número corrigido à mão.</b>
         A CS recebe a nota interna com o de→para e o motivo. O cliente, não.
         <ul>${corrs.map((c) => `<li><b>${esc(c.cliente)}</b> — ${esc(c.itens.map(linhaCorrecao).join("; "))}</li>`).join("")}</ul>
       </div>`
    : "";

  const pintar = () => {
    escopo = dlg.querySelector('input[name="cs-escopo"]:checked').value;
    escolhidas = [...dlg.querySelectorAll(".cs-quem")].filter((x) => x.checked).map((x) => x.value);
    const porGestor = blocosCS(escopo);
    const clientes = [...porGestor.values()].reduce((a, b) => a + b.length, 0);
    $("#cs-resumo").innerHTML = `
      <div class="mesbox">
        <span class="lbl">${esc(rotuloP())}</span>
        <span>Clientes: <b>${clientes}</b></span>
        <span>Mensagens por CS: <b>${porGestor.size}</b> (uma por gestor)</span>
        <span>Gestores: <b>${[...porGestor.keys()].map(esc).join(", ") || "—"}</b></span>
      </div>`;
    $("#cs-enviar").disabled = !escolhidas.length || !clientes;
    $("#cs-enviar").textContent = escolhidas.length
      ? `Enviar para ${escolhidas.map((i) => CS.find((c) => c.id === i).curto).join(" e ")}`
      : "Enviar";
    $("#cs-previa-btn").disabled = !escolhidas.length || !clientes;
    $("#cs-previa").innerHTML = "";
  };
  for (const el of dlg.querySelectorAll('input[name="cs-escopo"], .cs-quem')) el.onchange = pintar;
  pintar();

  $("#cs-previa-btn").onclick = async () => {
    const cs = escolhidas[0];
    const porGestor = blocosCS(escopo);
    $("#cs-previa").innerHTML = `<p class="meta">montando a prévia…</p>`;
    const saidas = [];
    for (const [gestor, blocos] of porGestor) {
      try {
        // sem `confirmar` — o mesmo dry-run do canal, só que no destino cs
        const j = await chamar("mb-touchpoint-envio", {
          destino: "cs",
          cs,
          gestor,
          blocos,
          periodo: rotuloP(),
          week_start: S.semana,
          week_end: fimP(),
        });
        saidas.push({ gestor, mensagem: j.mensagem, caracteres: j.caracteres });
      } catch (e) {
        saidas.push({ gestor, erro: String(e.message || e) });
      }
    }
    $("#cs-previa").innerHTML =
      `<div class="sec"><h3>Prévia — o que ${esc(CS.find((c) => c.id === cs).curto)} vai ler</h3>` +
      saidas
        .map((s) =>
          s.erro
            ? `<div class="callout critical"><b>${esc(s.gestor)}</b><div class="mono">${esc(s.erro)}</div></div>`
            : `<div class="field"><div class="fh"><span class="fl">@${esc(s.gestor)}</span>
                 <span class="fhint">${s.caracteres} caracteres</span></div>
               <div class="msg">${esc(s.mensagem)}</div></div>`,
        )
        .join("") +
      `</div>`;
  };

  $("#cs-enviar").onclick = () => enviarParaCS(escolhidas, escopo);
  for (const b of dlg.querySelectorAll("[data-fechar]")) b.onclick = () => dlg.close();
  dlg.showModal();
}

async function enviarParaCS(ids, escopo) {
  const botao = $("#cs-enviar");
  const texto = botao.textContent;
  botao.disabled = true;
  botao.textContent = "enviando…";
  const porGestor = blocosCS(escopo);
  const ok = [];
  const falhas = [];

  // TRAVA DE VERSÃO. Se esta tela subir antes do workflow atualizado, o n8n
  // antigo ignora `destino` e cai no `channel_id || clickup_canal` — ou seja,
  // manda para o canal que o CLIENTE lê, com `confirmar: true` junto. Um
  // dry-run antes prova que o workflow do outro lado entende `cs` e resolveu
  // um canal que não é o do cliente. Sem essa prova, não envia nada.
  try {
    const [gestor1, blocos1] = [...porGestor][0];
    const prova = await chamar("mb-touchpoint-envio", {
      destino: "cs",
      cs: ids[0],
      gestor: gestor1,
      blocos: blocos1,
      periodo: rotuloP(),
      week_start: S.semana,
      week_end: fimP(),
    });
    if (prova.destino !== "cs" || !prova.cs_nome || !prova.channel_id) {
      throw new Error(
        "o workflow mb-touchpoint-envio ainda é o antigo: não entende destino:cs e mandaria para o canal do cliente. Rode `python n8n/build.py --publicar`.",
      );
    }
  } catch (e) {
    botao.textContent = texto;
    botao.disabled = false;
    aviso("Não enviei nada — " + String(e.message || e), "critical");
    return;
  }

  for (const cs of ids) {
    const quem = CS.find((c) => c.id === cs);
    let clientes = 0;
    for (const [gestor, blocos] of porGestor) {
      try {
        const j = await chamar("mb-touchpoint-envio", {
          destino: "cs",
          cs,
          gestor,
          blocos,
          periodo: rotuloP(),
          week_start: S.semana,
          week_end: fimP(),
          confirmar: true,
        });
        if (j.dry_run) falhas.push(`${quem.curto}/${gestor}: voltou dry-run — ${j.motivo_dry_run}`);
        else clientes += blocos.length;
      } catch (e) {
        falhas.push(`${quem.curto}/${gestor}: ${String(e.message || e)}`);
      }
    }
    if (clientes) {
      registrarEnvioCS(chaveP(), cs, { clientes, escopo, mensagens: porGestor.size });
      ok.push(`${quem.curto} (${clientes})`);
    }
  }
  botao.textContent = texto;
  botao.disabled = false;
  $("#dlg-cs").close();
  render();
  if (ok.length && !falhas.length) aviso(`Touchpoint enviado para ${ok.join(" e ")}.`, "info");
  else if (ok.length) aviso(`Enviado para ${ok.join(" e ")}. Falhou: ${falhas.join(" · ")}`, "warning");
  else aviso(`Não enviou: ${falhas.join(" · ")}`, "critical");
}

/** O CSV que vai para quem conserta o cadastro. Sem isto a correção morre no
 *  navegador e volta idêntica na semana seguinte. */
function baixarCorrecoesCSV() {
  const linhas = [["semana", "cliente", "client_id", "campo", "de", "para", "motivo", "corrigido_em"]];
  for (const c of correcoesDaSemana()) {
    for (const i of c.itens) linhas.push([chaveP(), c.cliente, c.client_id, i.rotulo, i.de, i.para, c.motivo, c.em]);
  }
  if (linhas.length === 1) return aviso("Nenhuma correção nesta semana.");
  const csv = linhas
    .map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `touchpoint-correcoes-${chaveP()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ═══════════════════════════════ ajustes ═══════════════════════════════ */

function abrirAjustes() {
  $("#in-base").value = cfg.base;
  $("#in-token").value = cfg.token;
  $("#in-ensaio").value = cfg.ensaio || "";
  $("#dlg-cfg").showModal();
}

function exportarRascunhos() {
  // Leva as correções junto: sem elas o arquivo descreve um texto que cita
  // números que não estão em lugar nenhum.
  const blob = new Blob(
    [JSON.stringify({ rascunhos: RASCUNHOS, correcoes: CORRECOES, enviados: ENVIADOS, cs: CS_ENVIADOS }, null, 1)],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `touchpoint-rascunhos-${chaveP()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ═══════════════════════════════ boot ═══════════════════════════════ */

function ligar() {
  // As setas andam o TAMANHO do recorte, não sete dias: num período de 15
  // dias, "anterior" são os 15 dias colados atrás — o mesmo intervalo que a
  // tela usa como comparação.
  const andar = (sinal) => {
    S.pend = null;
    const d = diasP();
    irPara(somaDias(S.semana, sinal * d), somaDias(fimP(), sinal * d));
  };
  $("#prev").onclick = () => andar(-1);
  $("#next").onclick = () => andar(1);
  $("#recarregar").onclick = carregarSemana;

  /* ── recorte livre: de tal dia até tal dia ─────────────────────────
     Os dois calendários só ANOTAM a escolha; quem carrega é o Aplicar.
     Carregar a cada mudança dispararia uma leitura no meio da escolha —
     e a leitura da semana leva ~2s. */
  const anotar = (campo) => (e) => {
    const v = e.target.value;
    if (!v) return;
    S.pend = { ...pendente(), [campo]: v };
    // escolher um começo depois do fim é engano de digitação, não intenção:
    // o fim acompanha, e a pessoa corrige depois se quiser.
    if (campo === "de" && S.pend.de > S.pend.ate) S.pend.ate = S.pend.de;
    if (campo === "ate" && S.pend.ate < S.pend.de) S.pend.de = S.pend.ate;
    renderBarra();
  };
  $("#f-de").onchange = anotar("de");
  $("#f-ate").onchange = anotar("ate");
  $("#btn-aplicar").onclick = () => {
    const { de, ate } = pendente();
    S.pend = null;
    if (!irPara(de, ate)) renderBarra();
  };

  /* Atalhos. Todos terminam ONTEM, menos os dois que têm fim próprio. */
  $("#f-atalho").onchange = (e) => {
    const v = e.target.value;
    if (!v) return;
    S.pend = null;
    const fim = ontem();
    if (v === "semana") {
      const ws = ultimaSemanaFechada();
      irPara(ws, domingoDa(ws));
    } else if (v === "mes") {
      irPara(primeiroDoMes(fim), fim);
    } else if (v === "mespassado") {
      const fimPassado = somaDias(primeiroDoMes(fim), -1);
      irPara(primeiroDoMes(fimPassado), fimPassado);
    } else {
      irPara(somaDias(fim, -(Number(v) - 1)), fim);
    }
    e.target.value = "";
  };

  const filtro = (id, campo, evento = "onchange") => {
    $(id)[evento] = (e) => {
      S[campo] = e.target.value;
      salvarFiltros();
      render();
    };
  };
  filtro("#f-busca", "busca", "oninput");
  filtro("#f-gestor", "gestor");
  filtro("#f-cenario", "cenario");
  filtro("#f-estado", "estado");
  $("#f-limpar").onclick = () => {
    Object.assign(S, FILTROS_PADRAO);
    salvarFiltros();
    render();
  };

  $("#btn-todos").onclick = escreverTodos;
  $("#btn-envio").onclick = montarEnvio;
  // “Enviar para CS” agora vive no rodapé do cartão, junto do texto final.
  $("#btn-cfg").onclick = abrirAjustes;
  $("#btn-export").onclick = exportarRascunhos;
  $("#cfg-salvar").onclick = () => {
    cfg.base = $("#in-base").value.trim().replace(/\/$/, "");
    cfg.token = $("#in-token").value.trim();
    cfg.ensaio = $("#in-ensaio").value.trim();
    gravarJSON("tp_cfg", { base: cfg.base, token: cfg.token, ensaio: cfg.ensaio });
    $("#dlg-cfg").close();
    carregarSemana();
  };
  for (const b of document.querySelectorAll("[data-fechar]")) b.onclick = (e) => e.target.closest("dialog").close();

  render();
  if (!cfg.token) {
    abrirAjustes();
    aviso("Cole o token dos webhooks para começar — `python n8n/build.py` imprime qual é.", "info");
    return;
  }
  carregarSemana();
}

document.addEventListener("DOMContentLoaded", ligar);
