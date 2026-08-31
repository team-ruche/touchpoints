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

/* ─────────────────────────────── semana ──────────────────────────────── */

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Segunda-feira da última semana FECHADA. A semana corrente nunca entra. */
function ultimaSemanaFechada(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow - 7);
  return iso(d);
}
function somaSemanas(ws, n) {
  const [y, m, dd] = ws.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() + n * 7);
  return iso(d);
}
/** "Mon, 08/17 to Sun, 08/23" — o mesmo rótulo que o canal usa há 16 semanas. */
function rotuloSemana(ws) {
  const [y, m, dd] = ws.split("-").map(Number);
  const a = new Date(y, m - 1, dd);
  const b = new Date(y, m - 1, dd + 6);
  const f = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return `Mon, ${f(a)} to Sun, ${f(b)}`;
}

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

function montarMensagem(p, texto) {
  const l = ["Olá, Pessoal! Tudo bem? 👋", "", `📌 Weekly Touch Point: ${p.semana.label}`, ""];

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

  // Agendamento REAL da semana. Antes esta linha imprimia a meta contratada.
  l.push(`📅 Agendamentos na semana: ${p.agendamento.semana}`);
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
  l.push("");
  l.push("Como foi:");
  l.push(texto.comoFoi.trim());
  l.push("");
  l.push("🚀 Próximo passo:");
  l.push(texto.proximoPasso.trim());
  if (texto.pedido.trim()) {
    l.push("");
    l.push("🤝 O que precisamos de você:");
    l.push(texto.pedido.trim());
  }
  return l.join("\n");
}

/* ─────────────── checklist antes de publicar (seção 8.8) ─────────────── */

function checklist(p, texto) {
  const temData = /\b\d{1,2}[/-]\d{1,2}\b|segunda|terça|quarta|quinta|sexta|amanhã|semana que vem/i.test(
    texto.proximoPasso,
  );
  const plats = Object.entries(p.midia.por_plataforma);
  const t = p.midia.total;
  return [
    { id: "proveniencia", label: "Todo número exibido tem proveniência registrada",
      ok: Object.keys(p.proveniencia ?? {}).length > 0 },
    { id: "contrato", label: "Nenhum número veio de campo de contrato disfarçado de resultado",
      ok: (p.agendamento.criterio_data ?? "").includes("occurred_at") },
    { id: "mes", label: "Agendamento da semana e acumulado do mês estão presentes",
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
}

/** Marcadores `[…]` que sobraram. A tela não deixa enviar com eles. */
function pendencias(texto) {
  const all = `${texto.comoFoi}\n${texto.proximoPasso}\n${texto.pedido}`;
  return [...all.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]);
}

/* ═══════════════════════════════ estado ═══════════════════════════════ */

const S = {
  semana: lerJSON("tp_semana", null) || ultimaSemanaFechada(),
  linhas: [],
  leitura: null,
  sel: null,
  filtroSemaforo: null,
  filtroGestor: "",
  carregando: false,
  erro: null,
  gerando: new Set(),
};

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

/** O texto vigente: o que o MB escreveu, senão o esqueleto.
 *  `lacunas` e `escolhas` vêm junto: são o que a redação sem IA devolve
 *  quando um fato não está no banco (o motivo de uma pausa, por exemplo) e
 *  o que o gestor já respondeu na lista fechada. */
function textoDe(r) {
  const d = rascunhoDe(S.semana, r.client_id);
  if (d && d.texto)
    return {
      texto: d.texto,
      origem: d.origem || "rascunho",
      lacunas: d.lacunas || [],
      escolhas: d.escolhas || {},
    };
  return { texto: rascunhoDeTexto(r.payload), origem: "esqueleto", lacunas: [], escolhas: {} };
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

function render() {
  renderBarra();
  renderStrip();
  renderLista();
  renderCartao();
}

function renderBarra() {
  $("#weeklabel").textContent = rotuloSemana(S.semana);
  $("#weekiso").textContent = S.semana;
  const n = S.linhas.length;
  $("#contagem").textContent = S.carregando
    ? "carregando…"
    : n
      ? `${n} clientes elegíveis${S.leitura ? ` · ${S.leitura.ad_insights} linhas de ad_insights, ${S.leitura.agendamentos} agendamentos lidos em ${(S.leitura.ms / 1000).toFixed(1)}s` : ""}`
      : "";
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
          `<button class="tile sem ${k}" data-sem="${k}" aria-pressed="${S.filtroSemaforo === k}">
             <div class="k">${rot[k]}</div><div class="v">${cont[k]}</div></button>`,
      )
      .join("") +
    `<div class="tile"><div class="k">sem marcador</div><div class="v">${prontos}</div></div>`;
  for (const b of document.querySelectorAll(".tile.sem")) {
    b.onclick = () => {
      S.filtroSemaforo = S.filtroSemaforo === b.dataset.sem ? null : b.dataset.sem;
      render();
    };
  }
}

function visiveis() {
  return S.linhas.filter((r) => {
    if (S.filtroSemaforo && r.semaforo !== S.filtroSemaforo) return false;
    if (S.filtroGestor && !(r.gestores || []).some((g) => g.toLowerCase().includes(S.filtroGestor.toLowerCase())))
      return false;
    return true;
  });
}

function renderLista() {
  const vs = visiveis();
  $("#listhead").textContent = `${vs.length} de ${S.linhas.length}`;
  $("#list").innerHTML = vs
    .map((r) => {
      const d = rascunhoDe(S.semana, r.client_id);
      const marca = d ? (d.origem === "regua" ? "✦" : "✎") : "";
      return `<button class="row" role="option" data-id="${r.client_id}" aria-current="${S.sel === r.client_id}">
        <span class="dot ${r.semaforo}"></span>
        <span class="nm">${esc(r.client_name)}</span>
        <span class="cen">${marca}${r.cenario}</span></button>`;
    })
    .join("");
  for (const b of document.querySelectorAll("#list .row")) {
    b.onclick = () => {
      S.sel = b.dataset.id;
      render();
    };
  }
}

function numero(k, v, prov) {
  return `<div class="num" title="${esc(prov || "")}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
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
    el.innerHTML = `<p class="meta">Escolha uma semana e clique em <b>Carregar</b>.</p>`;
    return;
  }
  const r = S.linhas.find((x) => x.client_id === S.sel) || visiveis()[0];
  if (!r) {
    el.innerHTML = `<p class="meta">Nenhum cliente com esse filtro.</p>`;
    return;
  }
  S.sel = r.client_id;

  const p = r.payload;
  const t = p.midia.total;
  const ag = p.agendamento;
  const bm = p.benchmark;
  const cen = CENARIO[p.cenario.codigo] || CENARIO.X;
  const { texto, origem, lacunas, escolhas } = textoDe(r);
  const pend = pendencias(texto);
  const proib = termosProibidos(`${texto.comoFoi} ${texto.proximoPasso} ${texto.pedido}`);
  const chk = checklist(p, texto);
  const mensagem = montarMensagem(p, texto);
  const gerando = S.gerando.has(r.client_id);

  const plats = Object.entries(p.midia.por_plataforma);

  el.innerHTML = `
    <div class="chips">
      <span class="cname">${esc(p.identificacao.cliente)}</span>
      <span class="chip ${cen.tom}">${p.cenario.codigo} · ${esc(cen.titulo)}</span>
      <span class="chip">${esc(p.identificacao.nicho || "sem nicho")}</span>
      ${p.identificacao.plano ? `<span class="chip">${esc(p.identificacao.plano)}</span>` : ""}
      <span class="chip">${esc((p.identificacao.gestores || []).join(", ") || "sem gestor")}</span>
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
      <h3>Semana — ${plats.length ? plats.map(([k]) => PLATAFORMA_LABEL[k] ?? k).join(" + ") : "sem investimento"}</h3>
      <div class="nums">
        ${numero("Ad Spend", money(t.spend), p.proveniencia.spend_leads)}
        ${numero("Leads", t.leads, p.proveniencia.spend_leads)}
        ${numero("CPL", money(t.cpl), p.proveniencia.cpl)}
        ${numero("Agendamentos", ag.semana, p.proveniencia.agendamento)}
        ${numero("Impressões", t.impressions.toLocaleString("pt-BR"), p.proveniencia.spend_leads)}
        ${numero("Page views", t.page_views.toLocaleString("pt-BR"), p.proveniencia.spend_leads)}
      </div>
    </div>

    <div class="sec">
      <h3>Contra a semana anterior</h3>
      <div class="nums">
        ${numero("Δ Spend", money(p.comparacao.var_spend), `semana ${p.comparacao.semana_anterior.inicio} a ${p.comparacao.semana_anterior.fim}`)}
        ${numero("Δ Leads", (p.comparacao.var_leads > 0 ? "+" : "") + p.comparacao.var_leads, "diferença de leads")}
        ${numero("Δ Agend.", (p.comparacao.var_appts > 0 ? "+" : "") + p.comparacao.var_appts, "diferença de agendamentos")}
        ${numero("CPL anterior", money(p.comparacao.semana_anterior.cpl), "CPL da semana anterior")}
      </div>
    </div>

    <div class="sec">
      <h3>No mês</h3>
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
      <h3>Contexto do MB — otimizações registradas na semana</h3>
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
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">Redação</h3>
        <span class="chip ${origem === "regua" ? "info" : ""}">${origem === "regua" ? "escrita pela régua do cenário" : origem === "rascunho" ? "editada por você" : "esqueleto"}</span>
        <button id="btn-ia" ${gerando || !r.pode_gerar ? "disabled" : ""}>${gerando ? "escrevendo…" : "Escrever"}</button>
        <button id="btn-reset" class="ghost">Voltar ao esqueleto</button>
        <span class="fhint" style="margin-left:auto">sem modelo de linguagem · $0.00</span>
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
      ${["comoFoi", "proximoPasso", "pedido"]
        .map((k, i) => {
          const rot = ["Como foi", "🚀 Próximo passo", "🤝 O que precisamos de você"][i];
          return `<div class="field">
            <div class="fh"><span class="fl">${rot}</span>
              <span class="fhint">${k === "comoFoi" ? "máx. 2 frases" : k === "proximoPasso" ? "1 a 2 frases, com data" : "1 frase"}</span></div>
            <textarea class="box ed" data-k="${k}" rows="${k === "comoFoi" ? 4 : 2}">${esc(texto[k])}</textarea>
          </div>`;
        })
        .join("")}
      ${
        pend.length
          ? `<div class="callout critical"><b>${pend.length} marcador(es) por preencher.</b>
             Enquanto houver <span class="mono">[…]</span> no texto, o envio fica travado — é o comportamento
             correto: a informação não está no banco.
             <div style="margin-top:6px" class="mono">${pend.map(esc).join(" · ")}</div></div>`
          : ""
      }
      ${
        proib.length
          ? `<div class="nota" style="background:var(--warning-bg);border-color:var(--warning-bd)">
             <b style="color:var(--warning)">Léxico:</b>
             ${proib.map((x) => `“${esc(x.termo)}” → ${esc(x.troque)}`).join(" · ")}</div>`
          : ""
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

    <div class="sec">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h3 style="margin:0">Mensagem que vai para o canal</h3>
        <button id="btn-copiar" class="ghost">Copiar</button>
      </div>
      <div class="msg">${esc(mensagem)}</div>
    </div>
  `;

  for (const ta of document.querySelectorAll("textarea.ed")) {
    ta.oninput = () => {
      const novo = { ...texto, [ta.dataset.k]: ta.value };
      // editar à mão não descarta as lacunas nem as respostas já dadas
      salvarRascunho(S.semana, r.client_id, { texto: novo, origem: "rascunho", lacunas, escolhas });
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

  const bIa = $("#btn-ia");
  if (bIa) bIa.onclick = () => escrever(r, escolhas);
  const bR = $("#btn-reset");
  if (bR)
    bR.onclick = () => {
      apagarRascunho(S.semana, r.client_id);
      render();
    };
  const bC = $("#btn-copiar");
  if (bC)
    bC.onclick = async () => {
      await navigator.clipboard.writeText(mensagem);
      aviso("Mensagem copiada.", "info");
    };
}

/* ═══════════════════════════════ ações ═══════════════════════════════ */

async function carregarSemana() {
  S.carregando = true;
  S.erro = null;
  S.linhas = [];
  render();
  try {
    const j = await chamar("mb-touchpoint-week", { week_start: S.semana, tz: cfg.tz });
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
    const j = await chamar("mb-touchpoint-redacao", { contrato: r.payload, escolhas: escolhas || {} });
    if (j.ok === false) throw new Error(j.dica ? `${j.erro} — ${j.dica}` : j.erro || "a redação voltou com erro");
    const texto = {
      comoFoi: j.como_foi ?? "",
      proximoPasso: j.proximo_passo ?? "",
      pedido: j.pedido_cliente ?? "",
    };
    if (!texto.comoFoi) throw new Error("resposta sem os três campos: " + JSON.stringify(j).slice(0, 200));
    salvarRascunho(S.semana, r.client_id, {
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
  if (!alvo.length) return aviso("Nenhum cliente elegível nesta semana.");
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

/** Agrupa por gestor e pede a prévia da mensagem do canal. Não publica. */
async function montarEnvio() {
  const prontos = S.linhas.filter((r) => {
    if (!r.pode_gerar) return false;
    const { texto } = textoDe(r);
    return pendencias(texto).length === 0;
  });
  if (!prontos.length) {
    aviso("Nenhum cliente pronto: todos estão bloqueados ou ainda têm marcadores [ ].");
    return;
  }
  const porGestor = new Map();
  for (const r of prontos) {
    for (const g of r.gestores.length ? r.gestores : ["(sem gestor)"]) {
      if (!porGestor.has(g)) porGestor.set(g, []);
      const { texto } = textoDe(r);
      porGestor.get(g).push({
        client_id: r.client_id,
        cliente: r.payload.identificacao.cliente,
        message_text: montarMensagem(r.payload, texto),
      });
    }
  }
  const saidas = [];
  for (const [gestor, blocos] of porGestor) {
    try {
      const j = await chamar("mb-touchpoint-envio", {
        gestor,
        blocos,
        periodo: rotuloSemana(S.semana),
        week_start: S.semana,
        // sem `confirmar: true` — dry-run. O envio real tem outro cadeado no n8n.
      });
      saidas.push(j);
    } catch (e) {
      saidas.push({ ok: false, gestor, erro: String(e.message || e) });
    }
  }
  abrirEnvio(saidas);
}

function abrirEnvio(saidas) {
  const dlg = $("#dlg-envio");
  $("#envio-corpo").innerHTML = saidas
    .map((s) =>
      s.ok === false
        ? `<div class="callout critical"><b>${esc(s.gestor || "")}</b><div class="mono">${esc(s.erro)}</div></div>`
        : `<div class="sec"><h3>@${esc(s.gestor)} — ${s.clientes} cliente(s), ${s.caracteres} caracteres
             ${s.dry_run ? `<span class="chip warning">dry-run · ${esc(s.motivo_dry_run)}</span>` : `<span class="chip critical">PUBLICADO</span>`}</h3>
           <div class="msg">${esc(s.mensagem)}</div></div>`,
    )
    .join("");
  dlg.showModal();
}

/* ═══════════════════════════════ ajustes ═══════════════════════════════ */

function abrirAjustes() {
  $("#in-base").value = cfg.base;
  $("#in-token").value = cfg.token;
  $("#dlg-cfg").showModal();
}

function exportarRascunhos() {
  const blob = new Blob([JSON.stringify(RASCUNHOS, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `touchpoint-rascunhos-${S.semana}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ═══════════════════════════════ boot ═══════════════════════════════ */

function ligar() {
  $("#prev").onclick = () => {
    S.semana = somaSemanas(S.semana, -1);
    gravarJSON("tp_semana", S.semana);
    carregarSemana();
  };
  $("#next").onclick = () => {
    const prox = somaSemanas(S.semana, 1);
    if (prox > ultimaSemanaFechada()) {
      aviso("A semana corrente nunca entra — só semana fechada.");
      return;
    }
    S.semana = prox;
    gravarJSON("tp_semana", S.semana);
    carregarSemana();
  };
  $("#recarregar").onclick = carregarSemana;
  $("#f-gestor").oninput = (e) => {
    S.filtroGestor = e.target.value;
    render();
  };
  $("#btn-todos").onclick = escreverTodos;
  $("#btn-envio").onclick = montarEnvio;
  $("#btn-cfg").onclick = abrirAjustes;
  $("#btn-export").onclick = exportarRascunhos;
  $("#cfg-salvar").onclick = () => {
    cfg.base = $("#in-base").value.trim().replace(/\/$/, "");
    cfg.token = $("#in-token").value.trim();
    gravarJSON("tp_cfg", { base: cfg.base, token: cfg.token });
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
