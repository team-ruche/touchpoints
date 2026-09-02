/* =====================================================================
 * redacao.js — a redação SEM modelo de linguagem.
 *
 * A Fase 3 escrevia `como_foi`, `proximo_passo` e `pedido_cliente` chamando
 * a Messages API. O caminho estava provado, mas travou no faturamento — e
 * pagar API por um texto que segue uma régua fechada é caro pelo motivo
 * errado: a régua É o texto. Este arquivo escreve os mesmos três campos a
 * partir do contrato, com regra e tabela, e custa zero.
 *
 * O que MUDA em relação à IA:
 *   • o texto repete estrutura entre clientes do mesmo cenário. É o preço.
 *     A variação por cliente/semana é sorteada por hash (determinística),
 *     não é redação — e o gestor edita por cima no textarea.
 *   • em compensação, ele NUNCA viola o léxico da 8.7, NUNCA fica sem data
 *     no "Próximo passo" e NUNCA escreve um número que não esteja no
 *     contrato. Os três são testados em `testar_redacao.mjs`.
 *
 * A regra dura que sobrevive inteira: FATO PASSADO que não está no banco
 * não vira frase. O motivo de uma pausa não existe em tabela nenhuma —
 * então ele não é inventado, vira LACUNA: uma pergunta com resposta de
 * lista fechada, que o gestor escolhe em um clique na tela. Vocabulário
 * controlado no lugar de texto livre é o que substitui o modelo aqui.
 *
 * COMPROMISSO FUTURO (o que a agência vai fazer e quando) não é fato
 * passado: é protocolo do cenário + data real calculada do fim da semana.
 * Por isso ele pode ser escrito sem o gestor digitar nada.
 *
 * Roda no Code node do n8n. NENHUM global de Node é usado — sem `Intl`,
 * sem `URLSearchParams`, sem `toLocaleString`. O sandbox do task-runner já
 * derrubou um deploy por causa disso.
 * ===================================================================== */

export const VERSAO_REDACAO = "templates-1";

/* ─────────────────────────── formatação ─────────────────────────── */

/** `$1,234.56`. Manual de propósito: `toLocaleString` depende de Intl, que
 *  não existe no sandbox do Code node. */
export function money(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  const neg = n < 0;
  const f = Math.abs(n).toFixed(2);
  const ponto = f.indexOf(".");
  const inteiro = f.slice(0, ponto);
  const dec = f.slice(ponto + 1);
  let out = "";
  let c = 0;
  for (let k = inteiro.length - 1; k >= 0; k--) {
    out = inteiro.charAt(k) + out;
    c++;
    if (c % 3 === 0 && k > 0) out = "," + out;
  }
  return (neg ? "-$" : "$") + out + "." + dec;
}

/** `2026-08-25` → `25/08`. */
export function ddmm(iso) {
  return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : null;
}

/** Soma dias a uma data ISO sem passar por fuso: aritmética em UTC puro. */
export function addDias(iso, n) {
  const Y = Number(iso.slice(0, 4));
  const M = Number(iso.slice(5, 7));
  const D = Number(iso.slice(8, 10));
  const d = new Date(Date.UTC(Y, M - 1, D) + n * 86400000);
  const p2 = (x) => (x < 10 ? "0" + x : "" + x);
  return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
}

/** 0 = domingo, 1 = segunda … em UTC puro, como o resto do arquivo. */
export function diaDaSemana(iso) {
  return new Date(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))),
  ).getUTCDay();
}

/* ═════════════════ período que não é semana ═════════════════
 *
 * A tela passou a aceitar intervalo livre (de tal dia até tal dia). O texto
 * inteiro deste arquivo foi escrito para SEMANA — e escrever "a semana
 * fechou com 40 leads" num recorte de 21 dias é exatamente o defeito que
 * originou o projeto: número certo, rótulo falso.
 *
 * Em vez de duplicar todos os cenários, a troca é feita na saída, com
 * vocabulário fechado: `semana` vira `período`, o determinante feminino que
 * ficou pendurado concorda, e a semana FUTURA de verdade ("na próxima
 * semana", "semana que vem", "na semana seguinte") não é tocada — ela fala
 * de uma semana do calendário, não do recorte medido.
 *
 * `testar_redacao.mjs --periodo` roda os 88 blocos reais como período de 21
 * dias e reprova qualquer "semana" que sobre fora da lista de futuro e
 * qualquer concordância quebrada.
 */

/** Determinante feminino → masculino, para quando o substantivo troca. */
const DETERMINANTE = {
  a: "o", as: "os", da: "do", das: "dos", na: "no", nas: "nos", à: "ao", às: "aos",
  pela: "pelo", pelas: "pelos", uma: "um", umas: "uns", esta: "este", estas: "estes",
  essa: "esse", essas: "esses", aquela: "aquele", aquelas: "aqueles", nesta: "neste",
  nestas: "nestes", nessa: "nesse", nessas: "nesses", desta: "deste", destas: "destes",
  dessa: "desse", dessas: "desses", mesma: "mesmo", mesmas: "mesmos", outra: "outro",
  outras: "outros", toda: "todo", todas: "todos", inteira: "inteiro", passada: "passado",
};

const casar = (molde, palavra) =>
  molde.charAt(0) === molde.charAt(0).toUpperCase() ? palavra.charAt(0).toUpperCase() + palavra.slice(1) : palavra;

export function paraPeriodo(txt) {
  if (!txt) return txt;
  const guardados = [];
  let s = String(txt);

  /* 1. semana de verdade (futura) sai da jogada */
  s = s.replace(/pr[óo]ximas?\s+semanas?|semanas?\s+(?:que\s+vem|seguinte)/gi, (m) => {
    guardados.push(m);
    // marcador impossível no texto: NUL não sobrevive a nenhuma entrada.
    // Índice entre espaços colidiria com "40 leads".
    return "\u0000" + (guardados.length - 1) + "\u0000";
  });

  /* 2. o recorte medido deixa de se chamar semana */
  s = s.replace(/\bsemana\s+passada\b/gi, (m) => casar(m, "período anterior"));
  s = s.replace(/\bsemanas\b/gi, (m) => casar(m, "períodos"));
  s = s.replace(/\bsemana\b/gi, (m) => casar(m, "período"));

  /* 3. o determinante que sobrou no feminino concorda */
  s = s.replace(/\b([A-Za-zÀ-ÿ]+)(\s+)(per[íi]odos?)\b/g, (m, det, sp, per) => {
    const novo = DETERMINANTE[det.toLowerCase()];
    return novo ? casar(det, novo) + sp + per : m;
  });

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => guardados[Number(i)]);
}

/** Primeiro dia do mês seguinte ao da data. */
function primeiroDoProximoMes(iso) {
  const Y = Number(iso.slice(0, 4));
  const M = Number(iso.slice(5, 7));
  return M === 12 ? Y + 1 + "-01-01" : Y + "-" + (M + 1 < 10 ? "0" : "") + (M + 1) + "-01";
}

const plural = (n, um, muitos) => (Number(n) === 1 ? um : muitos);

/** "nenhum lead" lê melhor que "0 leads" numa frase de relatório. */
const quantos = (n, um, muitos) =>
  Number(n) === 0 ? "nenhum " + um : n + " " + plural(n, um, muitos);

/** "os 6 leads", "o 1 lead". O artigo tem de acompanhar o número: escrever
 *  "os 1 lead" é o tipo de erro que faz o cliente parar de ler o resto. */
export const osN = (n, um, muitos) => (Number(n) === 1 ? "o 1 " + um : "os " + n + " " + muitos);

/** Primeira letra maiúscula, para quando o trecho abre a frase. */
const maiuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Junta frases garantindo ponto final e espaço único. */
function frases(lista) {
  const l = [];
  for (const f of lista) {
    if (f === null || f === undefined) continue;
    const s = String(f).trim().replace(/\s+/g, " ");
    if (!s) continue;
    l.push(/[.!?…]$/.test(s) ? s : s + ".");
  }
  return l.join(" ");
}

/* ───────────────────── variação determinística ───────────────────── */

/** FNV-1a. Mesmo cliente + mesma semana ⇒ mesmo texto, sempre. Semana
 *  diferente ⇒ abertura diferente, para o cliente não receber 16 semanas
 *  com a mesma primeira palavra. */
export function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function sorteador(p) {
  const semente = hash32(
    String((p.identificacao && p.identificacao.client_id) || "") +
      "|" +
      String((p.semana && p.semana.inicio) || ""),
  );
  let passo = 0;
  return (lista) => lista[(semente + passo++ * 2654435761) % lista.length];
}

/* ───────────────────────── léxico (8.7) ───────────────────────── */

export const PROIBIDOS = [
  [/sem dados de campanha/i, "diga por que parou e quando volta"],
  [/falha de rastreamento|rastreamento/i, "“o formulário pode não estar registrando os leads”"],
  [/\bpixel\b/i, "“o formulário pode não estar registrando os leads”"],
  [/vamos otimizar/i, "diga o que pausa e o que sobe, com data"],
  [/semana desafiadora|infelizmente/i, "o número, direto"],
  [/excelente semana/i, "“melhor semana do mês: X leads contra Y na anterior”"],
  [/\bCTR\b|\bCPC\b|\badset\b|\bCBO\b/i, "termo do cliente, não do gestor"],
  [/\bcontatos\b/i, "leads"],
  [/vou revisar/i, "“vamos revisar”"],
];

export function termosProibidos(texto) {
  const achados = [];
  for (let i = 0; i < PROIBIDOS.length; i++) {
    const m = String(texto).match(PROIBIDOS[i][0]);
    if (m) achados.push({ termo: m[0], troque: PROIBIDOS[i][1] });
  }
  return achados;
}

/* ───────────────────────── vocabulário das lacunas ─────────────────────────
 *
 * Cada lacuna é uma pergunta cuja resposta o banco não tem. O gestor
 * escolhe de uma lista fechada — não digita. Isso é o que troca o modelo:
 * a máquina monta a frase, a pessoa fornece o único fato que falta.
 */

export const VOCABULARIO = {
  motivo_pausa: {
    campo: "como_foi",
    pergunta: "Por que a campanha ficou parada nesta semana?",
    marcador: "[MB: motivo da pausa]",
    opcoes: [
      { valor: "verba_encerrada", rotulo: "Verba do mês encerrada" },
      { valor: "pedido_cliente", rotulo: "Pausa pedida pelo cliente" },
      { valor: "troca_criativo", rotulo: "Pausa técnica para troca de criativo/página" },
      { valor: "pagamento", rotulo: "Cobrança do anúncio recusada" },
      { valor: "conta_bloqueada", rotulo: "Conta de anúncio em revisão pela plataforma" },
      { valor: "capacidade", rotulo: "Agenda de obra cheia — pausa combinada" },
      { valor: "contrato", rotulo: "Contrato em renovação" },
    ],
  },
  causa_semana: {
    campo: "como_foi",
    pergunta: "Qual foi a causa da semana fraca? (o dado não separou sozinho)",
    marcador: "[MB: causa da semana]",
    opcoes: [
      { valor: "alcance", rotulo: "Alcançando pouca gente na região por esse investimento" },
      { valor: "anuncio", rotulo: "Vendo o anúncio e não clicando — é anúncio" },
      { valor: "pagina", rotulo: "Clicando e não preenchendo — é a página" },
      { valor: "followup", rotulo: "Leads chegaram, faltou o contato rápido" },
      { valor: "sazonal", rotulo: "Semana curta — feriado ou clima na região" },
    ],
  },
};

/** Frase de cada opção, por lacuna. Fica separada do vocabulário para a
 *  tela poder listar as opções sem carregar o texto. */
const FRASE_OPCAO = {
  /* `retorno` é a data em que a entrega volta, quando ela é DEDUTÍVEL. Ela
     manda na data de leitura do cenário F: prometer leitura antes da volta
     é a contradição mais fácil de cometer aqui (e a primeira que apareceu
     no teste). Quando o retorno depende do cliente, `retorno` fica null e
     o texto para de dar data em vez de inventar uma. */
  motivo_pausa: {
    verba_encerrada: (ctx) => ({
      motivo: "a verba contratada do mês já tinha sido investida",
      retomada: "A veiculação volta em " + ddmm(ctx.proximoCiclo) + ", com o novo ciclo",
      retorno: ctx.proximoCiclo,
    }),
    pedido_cliente: () => ({
      motivo: "a campanha estava pausada a seu pedido",
      retomada: "Ela volta ao ar no dia em que você confirmar",
      retorno: null,
    }),
    troca_criativo: (ctx) => ({
      motivo: "paramos a veiculação para trocar o anúncio e a página de destino",
      retomada: "O material novo entra no ar na segunda, " + ddmm(ctx.segunda),
      retorno: ctx.segunda,
    }),
    pagamento: (ctx) => ({
      motivo: "a cobrança do anúncio foi recusada e a plataforma suspendeu a entrega",
      retomada:
        "Regularizado o pagamento, a entrega volta no mesmo dia; estamos trabalhando para que seja até " +
        ddmm(ctx.terca),
      retorno: ctx.terca,
    }),
    conta_bloqueada: (ctx) => ({
      motivo: "a conta de anúncio entrou em revisão pela plataforma e a entrega ficou suspensa",
      retomada: "O pedido de revisão já está aberto e acompanhamos todo dia; damos posição até " + ddmm(ctx.quarta),
      retorno: null,
    }),
    capacidade: (ctx) => ({
      motivo: "combinamos pausar enquanto sua agenda de obra estava cheia",
      retomada: "A retomada está prevista para " + ddmm(ctx.segunda) + ", quando você confirmar a capacidade",
      retorno: ctx.segunda,
    }),
    contrato: () => ({
      motivo: "a veiculação ficou parada durante a renovação do contrato",
      retomada: "Ela volta no mesmo dia em que a renovação for assinada",
      retorno: null,
    }),
  },
  causa_semana: {
    alcance: () => "Estamos alcançando pouca gente na sua região por esse valor de investimento",
    anuncio: () => "As pessoas estão vendo o anúncio e não estão clicando — é anúncio, e já está sendo trocado",
    pagina: () => "Estão clicando e não estão preenchendo o formulário — o problema está na página",
    followup: () => "Os leads chegaram; o que não aconteceu foi o contato rápido com eles",
    sazonal: () => "A semana foi curta na sua região e a procura caiu junto",
  },
};

/* ─────────────────── diagnóstico que o DADO sustenta ─────────────────── */

/** Porte fiel do `causaProvavel` da tela. Não é chute: cada ramo é uma
 *  leitura direta do funil (impressão → clique → page view → lead → visita). */
export function causaProvavel(p) {
  const t = p.midia.total;
  const bm = p.benchmark;
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

/** Roteiro D, passo 1: o que se moveu. Ordem fixa, primeira verdadeira vence. */
function seMoveu(p) {
  const c = p.comparacao;
  const ag = p.agendamento;
  const t = p.midia.total;
  const ant = c.semana_anterior || {};
  if (c.var_appts > 0)
    return (
      "os agendamentos subiram de " + ag.semana_anterior + " para " + ag.semana + " na comparação com a semana passada"
    );
  if (c.var_leads > 0) return "os leads subiram de " + ant.leads + " para " + t.leads;
  if (t.cpl != null && ant.cpl != null && t.cpl < ant.cpl)
    return "o custo por lead caiu de " + money(ant.cpl) + " para " + money(t.cpl);
  if (p.mes.agendamentos > 0)
    return (
      "o mês já soma " +
      p.mes.agendamentos +
      " " +
      plural(p.mes.agendamentos, "agendamento", "agendamentos")
    );
  const opt = (p.contexto_mb || [])[0];
  if (opt && opt.acao) return "entrou no ar " + String(opt.acao).replace(/\.$/, "").toLowerCase();
  return null;
}

/* ══════════════════════════ o redator ══════════════════════════ */

/**
 * @param {object} p        o `payload` do contrato 7.3
 * @param {object} escolhas respostas das lacunas: `{ motivo_pausa: 'verba_encerrada' }`
 * @returns {{como_foi:string, proximo_passo:string, pedido_cliente:string,
 *            lacunas:Array, avisos:object, cenario:string, motor:string}}
 */
export function redigir(p, escolhas) {
  escolhas = escolhas || {};
  const t = p.midia.total;
  const ag = p.agendamento;
  const bm = p.benchmark;
  const cen = (p.cenario && p.cenario.codigo) || "X";
  const opt = (p.contexto_mb || [])[0] || null;
  const um = sorteador(p);

  /* Datas reais, todas derivadas do fim do período. Nenhum "em breve": o
     checklist 8.8 reprova e o cliente não consegue cobrar.

     O texto diz o nome do dia ("na segunda, 24/08"), então a âncora é a
     PRÓXIMA SEGUNDA depois do fim — não `fim + 1`. Num período fechado em
     domingo as duas contas dão o mesmo dia, que é como isto rodou até aqui;
     num período que termina numa terça, `fim + 1` seria uma quarta chamada
     de segunda. */
  const fim = p.semana.fim;
  const proximaSegunda = addDias(fim, (8 - diaDaSemana(fim)) % 7 || 7);
  const ctx = {
    segunda: proximaSegunda,
    terca: addDias(proximaSegunda, 1),
    quarta: addDias(proximaSegunda, 2),
    sexta: addDias(proximaSegunda, 4),
    proximoDomingo: addDias(proximaSegunda, 6),
    proximoCiclo: primeiroDoProximoMes(fim),
  };
  /* Quando existe otimização registrada com data de validação, ela manda:
     é a data que o próprio gestor escolheu para ler o resultado. */
  const leitura = opt && opt.validar_em ? opt.validar_em : ctx.proximoDomingo;

  const lacunas = [];
  /** Resolve uma lacuna: devolve a escolha do gestor ou registra o marcador. */
  function lacuna(id) {
    const v = VOCABULARIO[id];
    const escolha = escolhas[id];
    if (escolha && FRASE_OPCAO[id] && FRASE_OPCAO[id][escolha]) return FRASE_OPCAO[id][escolha](ctx);
    lacunas.push({
      id: id,
      campo: v.campo,
      pergunta: v.pergunta,
      marcador: v.marcador,
      opcoes: v.opcoes,
    });
    return null;
  }

  /* ── blocos reaproveitados ─────────────────────────────────────── */

  const meta = ag.meta_usada != null ? Math.round(ag.meta_usada) : null;
  /* O bloco "📊 No mês" já imprime leads, investimento e agendamentos logo
     acima do "Como foi". Repetir os mesmos números em prosa não informa
     nada — então aqui o mês entra INTERPRETADO: quanto falta para fechar.
     Regra 6 continua valendo: `benchmark` NUNCA vira "meta contratada". É o
     mesmo erro de rótulo que originou o projeto — número certo, etiqueta
     falsa. */
  const alvoMes =
    meta == null
      ? null
      : ag.origem_meta === "contrato"
        ? osN(meta, "agendamento contratado para o mês", "agendamentos contratados para o mês")
        : "a referência de " + meta + " " + plural(meta, "agendamento", "agendamentos") + " da sua vertical";
  const faltaMes = meta == null ? null : meta - p.mes.agendamentos;
  /* O mês só entra em prosa quando ele CONTÉM o período. Num recorte livre
     que atravessa a virada (20/08 a 05/09), o bloco "📊 No mês" é o mês do
     último dia — 1º a 5 de setembro — e citá-lo logo depois dos números de
     17 dias põe dois números que não podem coexistir na mesma frase. O
     cabeçalho da mensagem continua imprimindo o mês COM as datas dele, que
     é o que impede a linha de mentir. */
  const mesContemPeriodo = !p.mes.inicio || p.mes.inicio <= p.semana.inicio;
  const noMes = !mesContemPeriodo
    ? ""
    : alvoMes == null
      ? /* frase nominal: "No mês são nenhum lead" não concorda, e cliente sem
           meta e sem benchmark (meta_usada nula) caía exatamente aí */
        "No mês, " +
        quantos(p.mes.leads, "lead", "leads") +
        " e " +
        quantos(p.mes.agendamentos, "agendamento", "agendamentos")
      : p.mes.agendamentos === 0
        ? /* "faltam 7 para a referência de 7" seria verdade e leitura ruim */
          "No mês ainda não houve agendamento, e " +
          (ag.origem_meta === "contrato"
            ? meta === 1
              ? "a meta é 1 no mês"
              : "a meta são " + meta + " no mês"
            : "a referência da sua vertical é " + meta + " no mês")
        : faltaMes > 0
        ? /* concordância: o número vem do banco e pode ser 1. "No mês são 1
             agendamentos" é a mesma classe do "os 1 lead" que já foi corrigido
             em 02/09 — trecho montado por concatenação, verbo preso no plural. */
          (p.mes.agendamentos === 1
            ? "No mês há 1 agendamento até aqui"
            : "No mês são " + p.mes.agendamentos + " agendamentos até aqui") +
          ", e " +
          (faltaMes === 1 ? "falta 1" : "faltam " + faltaMes) +
          " para " + alvoMes
        : (p.mes.agendamentos === 1
            ? "No mês já há 1 agendamento"
            : "No mês já são " + p.mes.agendamentos + " agendamentos") +
          ", em cima de " + alvoMes;

  /* Regra 8: sem benchmark de CPL não se inventa alvo. */
  const contraAlvo =
    bm.bm_cpl && t.cpl != null
      ? ", contra o alvo de " + money(bm.bm_cpl) + " para " + (p.identificacao.nicho || "a sua vertical")
      : "";

  /* Regra 10: agendamento acontecendo com investimento zerado. Sem esta
     frase o cliente soma dois mais dois errado e conclui que a campanha
     parada está gerando visita. */
  const agendaSemMidia =
    ag.semana > 0 && t.spend === 0
      ? // começo de frase: `osN` devolve minúscula porque quase sempre é
        // usado no meio ("levantar os 3 leads")
        maiuscula(osN(ag.semana, "agendamento", "agendamentos")) +
        " " +
        plural(ag.semana, "veio", "vieram") +
        " do trabalho do time de atendimento, não da campanha — ela não teve investimento nesta semana"
      : null;

  /* Frase de proteção do PPA. Só entra quando a semana doeu: repetida em
     toda mensagem ela vira ruído e deixa de proteger. */
  const ppa =
    (p.identificacao.plano || "").indexOf("PPA") >= 0 &&
    ag.semana === 0 &&
    (cen === "D" || cen === "E" || cen === "F")
      ? // sem pronome de propósito: com o recorte livre "a semana" vira "o
        // período", e um "ela" pendurado deixa de concordar com o sujeito
        "No seu plano você paga por agendamento, então a semana sem agendamento não virou custo pra você — mas custou tempo, e é isso que estamos corrigindo"
      : null;

  const pedidoGenerico = () =>
    um([
      "Nos mandar 2 ou 3 fotos de obras recentes — anúncio com foto sua rende mais que banco de imagem.",
      "Confirmar o telefone que recebe as ligações do anúncio, para a gente checar se está tocando no lugar certo.",
      "Nos dizer qual serviço você mais quer vender nas próximas semanas, para a verba ir para ele.",
      "Avisar a região onde você prefere trabalhar agora, para a gente concentrar a entrega ali.",
    ]);

  let como_foi, proximo_passo, pedido_cliente;

  switch (cen) {
    /* ── A — semana forte. Proibido prometer repetição. ──────────── */
    case "A": {
      const convite =
        bm.bm_cpl && t.cpl != null && t.cpl < bm.bm_cpl
          ? "Com o custo por lead nesse patamar, aumentar o investimento hoje compra lead mais barato do que a média da sua vertical"
          : null;
      como_foi = frases([
        "Foram " +
          t.leads +
          " " +
          plural(t.leads, "lead", "leads") +
          (t.cpl != null ? " a " + money(t.cpl) + " cada" + contraAlvo : "") +
          ", com " +
          money(t.spend) +
          " investidos" +
          (opt && opt.acao ? ", depois de " + String(opt.acao).replace(/\.$/, "").toLowerCase() : ""),
        noMes,
      ]);
      proximo_passo = frases([
        (convite ? convite + ". " : "") +
          "Mantemos a configuração que produziu esta semana e conferimos na leitura de " +
          ddmm(leitura) +
          " se ela se sustenta",
      ]);
      pedido_cliente = convite
        ? "Nos dizer até " + ddmm(ctx.quarta) + " se há espaço na agenda para receber mais visitas — é a condição para subir a verba."
        : pedidoGenerico();
      break;
    }

    /* ── B — lead entra, agenda não enche. O gargalo é DEPOIS do anúncio.
       Proibido: propor troca de criativo, culpar o cliente. ──────── */
    case "B": {
      como_foi = frases([
        "O custo por lead da semana ficou em " +
          money(t.cpl) +
          contraAlvo +
          " — a parte de anúncios está entregando",
        (agendaSemMidia ? agendaSemMidia + ". " : "") +
          (noMes ? noMes + ". " : "") +
          "O que decide o próximo agendamento agora é o tempo entre o lead entrar e alguém falar com ele",
      ]);
      /* O conjunto de leads a auditar é o do MÊS quando o mês contém o
         período. Num recorte que atravessa a virada (25/08 a 01/09) o mês
         é só o pedaço do novo — e "levantar os 0 leads do mês" logo depois
         de "6 leads no período" é o defeito de rótulo do projeto inteiro,
         em uma frase. Aí o conjunto certo é o do próprio período. */
      const audit = mesContemPeriodo && p.mes.leads >= t.leads
        ? { n: p.mes.leads, onde: "do mês" }
        : { n: t.leads, onde: "do período" };
      proximo_passo =
        (audit.n > 0
          ? "Vamos levantar " + osN(audit.n, "lead", "leads") + " " + audit.onde
          : "Vamos acompanhar cada lead que entrar") +
        " e medir quantos foram atendidos em até 10 minutos; esse número chega para você em " +
        ddmm(ctx.quarta) +
        ".";
      pedido_cliente = um([
        "Confirmar quem é a pessoa responsável por ligar para o lead assim que ele entra.",
        "Nos dizer em que horário sua equipe consegue retornar ligação, para a gente concentrar a entrega nesse período.",
        "Confirmar se os leads estão chegando no WhatsApp certo — mande um print do último que você recebeu.",
      ]);
      break;
    }

    /* ── C — poucos leads, agenda ok. Proibido pedir desculpa pelo
       volume de leads: o volume não é o produto. ────────────────── */
    case "C": {
      const cpa = ag.semana > 0 ? t.spend / ag.semana : null;
      como_foi = frases([
        "Foram " +
          ag.semana +
          " " +
          plural(ag.semana, "agendamento", "agendamentos") +
          " na semana com " +
          money(t.spend) +
          " investidos" +
          (cpa != null ? " — " + money(cpa) + " por agendamento" : "") +
          (ag.valor_agendamento
            ? ", contra os " + money(ag.valor_agendamento) + " que o agendamento vale no seu plano"
            : ""),
        "O volume de leads foi menor que o de outras semanas, e é o custo por agendamento que decide aqui. " + noMes,
      ]);
      proximo_passo =
        "Mantemos a verba onde ela está produzindo agendamento e revisamos as peças de menor entrega até " +
        ddmm(ctx.quarta) +
        "; a leitura seguinte é " +
        ddmm(leitura) +
        ".";
      pedido_cliente =
        "Confirmar quais das visitas agendadas foram realizadas — é o que fecha o ciclo do número aqui.";
      break;
    }

    /* ── D — semana fraca dos dois lados. Roteiro de 5 passos.
       Proibido abrir pelo número ruim. ─────────────────────────── */
    case "D": {
      const moveu = seMoveu(p);
      const derivada = causaProvavel(p);
      const causa = derivada || lacuna("causa_semana");
      const abertura = moveu
        ? "Começando pelo que se moveu: " + moveu
        : "A ação que muda esta conta começa na segunda, " + ddmm(ctx.segunda);
      como_foi = frases([
        abertura +
          " — e o número inteiro da semana é " +
          t.leads +
          " " +
          plural(t.leads, "lead", "leads") +
          (t.cpl != null ? " a " + money(t.cpl) : "") +
          (t.spend > 0 ? " com " + money(t.spend) + " investidos" : "") +
          contraAlvo,
        causa,
        agendaSemMidia,
        ppa,
      ]);
      proximo_passo =
        (opt && opt.acao
          ? String(opt.acao).replace(/\.$/, "")
          : "Trocamos a peça de menor entrega e concentramos a verba na região que respondeu melhor") +
        ", com entrada no ar na segunda, " +
        ddmm(ctx.segunda) +
        "; a primeira leitura confiável é " +
        ddmm(leitura) +
        ".";
      pedido_cliente = um([
        "Nos mandar 2 ou 3 fotos de obras recentes até " + ddmm(ctx.quarta) + " — é o material que mais muda resultado aqui.",
        "Confirmar até " + ddmm(ctx.quarta) + " qual serviço você quer priorizar, para a verba ir inteira para ele.",
        "Nos dizer até " + ddmm(ctx.quarta) + " quais bairros você atende hoje, para a gente cortar o que está fora.",
      ]);
      break;
    }

    /* ── E — investiu e não gerou lead. É incidente, não performance.
       Proibido: falar "rastreamento"/"pixel" para o cliente e prometer
       verba nova antes de verificar. ───────────────────────────── */
    case "E": {
      como_foi = frases([
        "Antes de mexer em qualquer coisa, paramos para conferir: a semana teve " +
          money(t.spend) +
          " investidos e nenhum lead registrado" +
          (t.clicks > 0 ? ", mesmo com " + t.clicks + " " + plural(t.clicks, "clique", "cliques") + " no anúncio" : ""),
        "Quando o clique acontece e o lead não aparece, quase sempre é o formulário ou a página deixando de registrar — não o anúncio. " +
          (ppa ? ppa : noMes),
      ]);
      proximo_passo =
        "Conferência ponta a ponta do formulário e da página na segunda, " +
        ddmm(ctx.segunda) +
        ", com teste de envio real; até esse resultado sair o investimento fica no valor atual, sem aumento. Retorno para você em " +
        ddmm(ctx.terca) +
        ".";
      pedido_cliente =
        "Nos avisar se chegou alguma ligação ou mensagem direta nesta semana — isso confirma por onde o cliente está entrando.";
      break;
    }

    /* ── F — sem veiculação. O motivo NÃO está no banco: vira lacuna de
       lista fechada. Proibido "sem dados de campanha". ─────────── */
    case "F": {
      const m = lacuna("motivo_pausa");
      const pausada = p.qualidade.motivo_sem_veiculacao === "pausada";
      como_foi = frases([
        "A campanha não teve veiculação entre " +
          ddmm(p.semana.inicio) +
          " e " +
          ddmm(p.semana.fim) +
          (m ? ", porque " + m.motivo : " — " + VOCABULARIO.motivo_pausa.marcador) +
          (pausada && p.comparacao.semana_anterior.spend > 0
            ? " (na semana anterior foram " + money(p.comparacao.semana_anterior.spend) + " investidos)"
            : ""),
        agendaSemMidia,
        noMes,
        ppa,
      ]);
      /* A leitura NUNCA pode ser anterior à volta da entrega. Quando o
         retorno é dedutível, a leitura é uma semana depois dele; quando
         não é, o texto simplesmente não promete data de leitura — mas
         ainda marca o dia em que damos posição, senão fica sem prazo. */
      proximo_passo = m
        ? m.retorno
          ? m.retomada + ", e a primeira leitura do retorno é " + ddmm(addDias(m.retorno, 6)) + "."
          : m.retomada + ", e a leitura sai na semana seguinte à volta; até " + ddmm(ctx.terca) + " te damos posição."
        : "A retomada depende de " +
          VOCABULARIO.motivo_pausa.marcador +
          "; até " +
          ddmm(ctx.terca) +
          " te damos posição do que falta para a campanha voltar.";
      pedido_cliente = m
        ? "Nos confirmar até " + ddmm(ctx.terca) + " que podemos retomar a veiculação como combinado."
        : "Nos confirmar até " + ddmm(ctx.terca) + " o que precisa acontecer do seu lado para a campanha voltar.";
      break;
    }

    /* ── G — conta em aprendizado (< 21 dias). Proibido comparar com
       semana anterior que não existe. ─────────────────────────── */
    case "G": {
      const dias = p.qualidade.dias_veiculacao;
      const marco = bm.bm_leads_semana ? Math.ceil(bm.bm_leads_semana) : null;
      const leituraAprendizado = p.qualidade.primeiro_dia_veiculacao
        ? addDias(p.qualidade.primeiro_dia_veiculacao, 21)
        : leitura;
      como_foi = frases([
        "A conta está no " +
          (dias != null ? dias + "º" : "primeiro") +
          " dia de veiculação e ainda está aprendendo quem responde ao anúncio na sua região",
        "Nesta fase o custo por lead oscila: a semana fechou em " +
          t.leads +
          " " +
          plural(t.leads, "lead", "leads") +
          (t.cpl != null ? " a " + money(t.cpl) : "") +
          " com " +
          money(t.spend) +
          " investidos",
      ]);
      proximo_passo =
        "O marco da próxima semana é fechar " +
        (marco != null ? marco + " " + plural(marco, "lead", "leads") : "um volume estável de leads") +
        " mantendo o investimento atual; o custo por lead só vira número confiável a partir de " +
        ddmm(leituraAprendizado) +
        ".";
      pedido_cliente =
        "Nos mandar 2 ou 3 fotos de obras suas até " + ddmm(ctx.quarta) + " — é o que acelera o aprendizado da conta.";
      break;
    }

    /* ── H — recuperação. Proibido declarar vitória. ───────────── */
    case "H": {
      const ant = p.comparacao.semana_anterior;
      como_foi = frases([
        "A semana subiu para " +
          t.leads +
          " " +
          plural(t.leads, "lead", "leads") +
          (t.cpl != null ? " a " + money(t.cpl) : "") +
          ", contra " +
          quantos(ant.leads, "lead", "leads") +
          " na semana anterior" +
          (opt && opt.acao ? ", depois de " + String(opt.acao).replace(/\.$/, "").toLowerCase() : ""),
        (noMes ? noMes + ". " : "") + "É uma virada de uma semana, e o que interessa agora é se ela se repete",
      ]);
      proximo_passo =
        "Mantemos exatamente a configuração que produziu esta virada e conferimos na leitura de " +
        ddmm(leitura) +
        " se o patamar se sustenta.";
      pedido_cliente = pedidoGenerico();
      break;
    }

    /* ── X — nicho sem linha em niche_benchmarks. Proibido inventar
       alvo de CPL ou de volume. ───────────────────────────────── */
    default: {
      const ant = p.comparacao.semana_anterior;
      como_foi = frases([
        "A semana fechou com " +
          money(t.spend) +
          " investidos, " +
          t.leads +
          " " +
          plural(t.leads, "lead", "leads") +
          (t.cpl != null ? " a " + money(t.cpl) : "") +
          " e " +
          ag.semana +
          " " +
          plural(ag.semana, "agendamento", "agendamentos"),
        (ant.leads != null
          ? (ant.leads === 0
              ? "Na semana anterior não houve lead"
              : "Na semana anterior " +
                (ant.leads === 1 ? "foi 1 lead" : "foram " + ant.leads + " leads") +
                (ant.cpl != null ? " a " + money(ant.cpl) : "")) + ". "
          : "") + noMes,
        agendaSemMidia,
      ]);
      proximo_passo =
        (opt && opt.acao
          ? String(opt.acao).replace(/\.$/, "")
          : "Seguimos com a configuração atual e comparamos semana contra semana") +
        ", com a próxima leitura em " +
        ddmm(leitura) +
        ".";
      pedido_cliente = pedidoGenerico();
      break;
    }
  }

  /* ── recorte livre: a palavra "semana" deixa de ser verdade ──────
     Roda ANTES das guardas de propósito: o léxico e o prazo têm de ser
     conferidos no texto que o cliente vai ler, não no que a régua montou. */
  if (p.semana.padrao === false) {
    como_foi = paraPeriodo(como_foi);
    proximo_passo = paraPeriodo(proximo_passo);
    pedido_cliente = paraPeriodo(pedido_cliente);
  }

  /* ── guardas de saída: as mesmas da Fase 3, agora rodando contra um
     texto que a gente controla. Se algo aqui acusar, é bug meu. ──── */
  const todo = como_foi + " " + proximo_passo + " " + pedido_cliente;
  const temPrazo = /\b\d{1,2}[/-]\d{1,2}\b|dia \d{1,2}|segunda|terça|quarta|quinta|sexta|amanhã/i.test(proximo_passo);
  const pendencias = todo.match(/\[[^\]]+\]/g) || [];

  return {
    ok: true,
    cliente: p.identificacao.cliente,
    week_start: p.semana.inicio,
    week_end: p.semana.fim,
    dias: p.semana.dias || null,
    cenario: cen,
    como_foi: como_foi,
    proximo_passo: proximo_passo,
    pedido_cliente: pedido_cliente,
    lacunas: lacunas,
    avisos: {
      lexico: termosProibidos(todo),
      sem_prazo: !temPrazo,
      pendencias: pendencias,
    },
    motor: VERSAO_REDACAO,
    custo_api: 0,
  };
}
