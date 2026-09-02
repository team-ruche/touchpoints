/* =====================================================================
 * contrato.js — porte JS de fn_mb_touchpoint_week (Fase 1, arquivo 02).
 *
 * POR QUE ISSO EXISTE
 * A função SQL não está aplicada no Ruche OS e a regra é não rodar DDL lá.
 * Este arquivo faz o MESMO cálculo lendo pelo PostgREST (leitura é liberada),
 * para que a tela de teste rode com número real sem tocar no banco. Quando a
 * migration for aplicada, a tela troca este webhook por
 * `POST /rpc/fn_mb_touchpoint_week` e o payload é o mesmo — é o mesmo contrato.
 *
 * FIDELIDADE
 * A referência é o SQL, não o ref_contract.py. Onde os dois divergem, o SQL
 * manda. A divergência conhecida é o nicho: o Python tem um NICHE_ALIAS
 * (cabinets->Cabinets, painting->Painting) que o SQL não tem — o SQL casa por
 * lower(btrim(...)) exato. Aqui está o comportamento do SQL.
 *
 * ARMADILHA DA SEÇÃO 4.7 (a que gerou 114 falsos positivos na pesquisa):
 * paginar o PostgREST sem `order` devolve linha repetida e linha faltante.
 * fetchAll() abaixo NUNCA pagina sem ordenação.
 *
 * Roda em dois lugares sem alteração: no Code node do n8n e no Node local
 * (validar.mjs). Por isso não importa nada e recebe o `http` por parâmetro.
 * ===================================================================== */

/* ─────────────── datas: tudo em UTC puro, sem horário local ─────────────── */

const DIA = 86400000;

function d2s(d) {
  return d.toISOString().slice(0, 10);
}
function s2d(s) {
  return new Date(s + "T00:00:00Z");
}
function addDays(s, n) {
  return d2s(new Date(s2d(s).getTime() + n * DIA));
}
function menor(a, b) {
  return a < b ? a : b;
}
function dd_mm(s) {
  return s.slice(8, 10) + "/" + s.slice(5, 7);
}

/**
 * As sete datas que o CTE `p` do SQL define.
 *
 * PERÍODO PERSONALIZADO (02/09/2026). O SQL só conhece semana fechada de
 * segunda a domingo. Aqui `fim` é opcional: sem ele, o comportamento é
 * idêntico ao de antes (7 dias a partir da segunda) — e é por isso que a
 * validação contra `ref_contract.py` continua valendo.
 *
 * Com `fim`, o período tem N dias e as duas janelas de comparação passam a
 * ter N dias TAMBÉM, coladas para trás. É a única definição que mantém a
 * comparação honesta: comparar 15 dias contra 7 inventaria uma queda.
 */
export function janela(weekStart, fim) {
  const w0_ini = weekStart;
  const w0_fim = fim && fim >= weekStart ? fim : addDays(weekStart, 6);
  const dias = Math.round((s2d(w0_fim) - s2d(w0_ini)) / DIA) + 1;
  return {
    w0_ini,
    w0_fim,
    dias,
    w1_ini: addDays(w0_ini, -dias),
    w1_fim: addDays(w0_ini, -1),
    w2_ini: addDays(w0_ini, -2 * dias),
    w2_fim: addDays(w0_ini, -dias - 1),
    // date_trunc('month', w0_fim) — o mês é o do ÚLTIMO dia, não do primeiro.
    // Num período que cruza a virada do mês isso muda o acumulado; é de
    // propósito e está no SQL.
    mes_ini: w0_fim.slice(0, 8) + "01",
  };
}

/** Segunda-feira? O contrato só chama um período de "semana" quando ele é
 *  seg→dom de 7 dias — o resto é período, e o texto tem de dizer isso. */
export function ehSemanaPadrao(ini, fim) {
  return s2d(ini).getUTCDay() === 1 && fim === addDays(ini, 6);
}

/** "17/08 a 23/08" — dd/mm nas duas pontas.
 *
 *  Até 02/09/2026 esta linha saía em padrão americano ("Mon, 08/17 to Sun,
 *  08/23") enquanto TODO o resto da mensagem saía em dd/mm: o bloco do mês,
 *  a data do "Próximo passo", a data de validação de uma otimização. Dois
 *  formatos na mesma mensagem fazem "08/09" ser lido como 9 de agosto — o
 *  número está certo e a leitura sai falsa, que é a família de defeito que
 *  originou este projeto. Um formato só, e ele é o da prosa.
 *
 *  ⚠️ `app.js` tem a mesma função (é outro arquivo, sem import): mexeu aqui,
 *  mexa lá. `testar_periodo.mjs` compara as duas. */
export function rotuloPeriodo(ini, fim) {
  return `${dd_mm(ini)} a ${dd_mm(fim)}`;
}

/* ─────────── fuso: o corte de dia é no fuso do relatório, não em UTC ───────── */

/**
 * Regra de horário de verão dos EUA, para quando o `Intl` não estiver
 * disponível: EDT do 2º domingo de março ao 1º domingo de novembro, 02:00
 * local. Vale para America/New_York, que é o fuso padrão do relatório.
 */
function offsetNovaYork(d) {
  const ano = d.getUTCFullYear();
  const domingo = (mes, n) => {
    // n-ésimo domingo do mês, em UTC, já no instante da virada (07:00Z = 02:00 EST)
    const p = new Date(Date.UTC(ano, mes, 1));
    const primeiro = (7 - p.getUTCDay()) % 7;
    return Date.UTC(ano, mes, 1 + primeiro + (n - 1) * 7, 7);
  };
  const inicio = domingo(2, 2); // março
  const fim = domingo(10, 1); // novembro
  const t = d.getTime();
  return t >= inicio && t < fim ? -4 : -5;
}

/**
 * Converte um timestamp ISO para a data-calendário naquele fuso.
 * Equivale a `(ts at time zone p_tz)::date` do SQL.
 *
 * Prefere `Intl`, que acerta qualquer fuso e qualquer virada de horário de
 * verão. O sandbox do Code node do n8n é mais pobre que o Node local (foi lá
 * que `URLSearchParams` não existia), então há um caminho sem `Intl` — que só
 * sabe America/New_York, e é justamente o fuso do relatório.
 */
export function diaNoFuso(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  try {
    // en-CA já formata YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch (e) {
    if (tz !== "America/New_York") {
      throw new Error(`sem Intl neste runtime: só sei converter America/New_York, pediram ${tz}`);
    }
    return d2s(new Date(d.getTime() + offsetNovaYork(d) * 3600000));
  }
}

/* ─────────────────────── leitura paginada do PostgREST ────────────────────── */

/**
 * Monta a query string à mão.
 *
 * `URLSearchParams` NÃO existe no sandbox do task-runner do n8n (`evalmachine`),
 * embora exista no Node local — foi assim que o primeiro deploy quebrou. Não
 * confie em global de Node aqui: o VM do Code node expõe um conjunto menor.
 *
 * `encodeURIComponent` deixa passar `!'()*`, que o PostgREST não usa em nenhum
 * dos filtros deste arquivo, mas são escapados mesmo assim para o `in.(uuid,…)`
 * não depender de sorte.
 */
function qs(obj) {
  const enc = (s) =>
    encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return Object.keys(obj)
    .map((k) => enc(k) + "=" + enc(obj[k]))
    .join("&");
}

/**
 * @param http  função (url, headers) => Promise<array>. No n8n é $helpers.httpRequest.
 */
export async function fetchAll(http, base, headers, table, params, pageSize = 1000) {
  const out = [];
  let offset = 0;
  const p = { ...params };
  if (!p.order) p.order = "id.asc"; // seção 4.7: nunca paginar sem ordem estável
  for (;;) {
    const consulta = qs({ ...p, limit: String(pageSize), offset: String(offset) });
    const rows = await http(`${base}/rest/v1/${table}?${consulta}`, headers);
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 500000) throw new Error("paginação sem fim em " + table);
  }
  return out;
}

/* ───────────────────────────── helpers do cálculo ──────────────────────────── */

const PLACEHOLDER = ["n/a", "na", "-", "none", "null"];

function temId(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  if (s === "") return false;
  return !PLACEHOLDER.includes(s);
}

/** D7 — os mesmos separadores de gestoresOf() no front: vírgula, ; / e " e ". */
export function gestoresDe(gestor_mb) {
  return String(gestor_mb || "")
    .split(/[,;/]|\s+e\s+/i)
    .map((g) => g.trim())
    .filter(Boolean)
    .sort();
}

/** `round(x, 2)` do Postgres é half-up sobre numeric; toFixed em JS é o mais próximo disso. */
function r2(x) {
  if (x === null || x === undefined || !isFinite(x)) return null;
  return Number((Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2));
}

function plataformaDe(row) {
  const p = String(row.platform || "").toLowerCase();
  if (p === "google" && String(row.campaign_name || "").startsWith("LocalServicesCampaign")) {
    return "glsa";
  }
  return p;
}

function bucketDe(dia, j) {
  if (dia >= j.w0_ini && dia <= j.w0_fim) return "w0";
  if (dia >= j.w1_ini && dia <= j.w1_fim) return "w1";
  if (dia >= j.w2_ini && dia <= j.w2_fim) return "w2";
  return null;
}

function classe(ritmo) {
  if (ritmo === null || ritmo === undefined) return null;
  if (ritmo >= 0.9) return "forte";
  if (ritmo >= 0.6) return "dentro";
  return "fraco";
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function dolar(v) {
  // to_char(x, 'FM999999990.00') — sem separador de milhar, duas casas.
  return Number(v).toFixed(2);
}

/* ═══════════════════════════════ o contrato ═══════════════════════════════ */

/**
 * @param dados  { clients, insights, insightsAll, appts, benchmarks, opts }
 *   insights     linhas de ad_insights na janela (>= min(w2_ini, mes_ini) e <= w0_fim)
 *   insightsAll  {client_id: primeiro insight_date de sempre}  (CTE `prim`)
 * @param params { week_start, week_end, tz, render_platforms }
 */
export function construir(dados, params) {
  const j = janela(params.week_start, params.week_end);
  const padrao = ehSemanaPadrao(j.w0_ini, j.w0_fim);
  /* Benchmark é MENSAL. Para uma semana o SQL divide por 4,33; para um
     período de N dias a fatia proporcional é essa mesma divisão vezes
     N/7 — e `semanas === 1` devolve o número idêntico ao de antes. */
  const semanas = j.dias / 7;
  const porPeriodo = (mensal) => (mensal / 4.33) * semanas;
  const tz = params.tz || "America/New_York";
  const render = params.render_platforms || ["meta"];
  const clientes = dados.clients;
  const byId = new Map(clientes.map((c) => [c.id, c]));

  /* ── mídia: um balde por (cliente, bucket, plataforma) ── */
  const plat = new Map(); // cid -> plataforma -> agregado (só w0)
  const wk = new Map(); // cid|bucket -> agregado
  const mes = new Map(); // cid -> {spend, leads}
  const zero = () => ({ spend: 0, leads: 0, impressions: 0, clicks: 0, page_views: 0 });

  for (const i of dados.insights) {
    if (!byId.has(i.client_id)) continue;
    const dia = String(i.insight_date).slice(0, 10);
    const b = bucketDe(dia, j);
    const noMes = dia >= j.mes_ini && dia <= j.w0_fim;
    const pl = plataformaDe(i);

    if (noMes) {
      if (!mes.has(i.client_id)) mes.set(i.client_id, { spend: 0, leads: 0 });
      const m = mes.get(i.client_id);
      m.spend += num(i.spend);
      m.leads += num(i.leads);
    }
    if (!b) continue;

    const k = i.client_id + "|" + b;
    if (!wk.has(k)) wk.set(k, { ...zero(), spend_render: 0, spend_fora: 0 });
    const w = wk.get(k);
    w.spend += num(i.spend);
    w.leads += num(i.leads);
    w.impressions += num(i.impressions);
    w.clicks += num(i.clicks);
    w.page_views += num(i.page_views);
    if (render.includes(pl)) w.spend_render += num(i.spend);
    else w.spend_fora += num(i.spend);

    if (b === "w0") {
      if (!plat.has(i.client_id)) plat.set(i.client_id, new Map());
      const pm = plat.get(i.client_id);
      if (!pm.has(pl)) pm.set(pl, zero());
      const a = pm.get(pl);
      a.spend += num(i.spend);
      a.leads += num(i.leads);
      a.impressions += num(i.impressions);
      a.clicks += num(i.clicks);
      a.page_views += num(i.page_views);
    }
  }

  /* ── agendamento: D1 (counts_as_appointment AND is_lead_primary) e D2 (occurred_at) ── */
  const ap = new Map(); // cid -> {w0,w1,w2,mes,w0_por_visita}
  for (const a of dados.appts) {
    if (!byId.has(a.client_id)) continue;
    if (!a.counts_as_appointment || !a.is_lead_primary) continue;
    const marcado = diaNoFuso(a.occurred_at, tz);
    if (!marcado) continue;
    if (!ap.has(a.client_id)) ap.set(a.client_id, { w0: 0, w1: 0, w2: 0, mes: 0, w0_por_visita: 0 });
    const x = ap.get(a.client_id);
    const b = bucketDe(marcado, j);
    if (b) x[b] += 1;
    if (marcado >= j.mes_ini && marcado <= j.w0_fim) x.mes += 1;
    const visita = a.scheduled_at ? diaNoFuso(a.scheduled_at, tz) : null;
    if (visita && visita >= j.w0_ini && visita <= j.w0_fim) x.w0_por_visita += 1;
  }

  /* ── contexto do MB: otimizações criadas DENTRO da semana ── */
  const opt = new Map();
  for (const o of dados.opts) {
    if (!byId.has(o.client_id)) continue;
    const dia = diaNoFuso(o.created_at, tz);
    if (!dia || dia < j.w0_ini || dia > j.w0_fim) continue;
    if (!opt.has(o.client_id)) opt.set(o.client_id, []);
    opt.get(o.client_id).push({
      problema: o.problem ?? null,
      acao: o.action ?? null,
      hipotese: o.hypothesis ?? null,
      resultado_esperado: o.expected_result ?? null,
      validar_em: o.validate_on ?? null,
      tipo: o.action_kind ?? null,
      autor: o.author_name ?? null,
      _ts: o.created_at,
    });
  }
  for (const v of opt.values()) v.sort((a, b) => String(a._ts).localeCompare(String(b._ts)));

  /* ── benchmark do nicho: match tolerante a caixa e espaço (igual ao SQL) ── */
  const bmk = new Map();
  for (const b of dados.benchmarks) {
    bmk.set(String(b.niche || "").trim().toLowerCase(), b);
  }

  /* ── montagem ── */
  const linhas = [];
  for (const c of clientes) {
    const gestores = gestoresDe(c.gestor_mb);
    const tem_account_id =
      temId(c.account_id_meta) || temId(c.account_id_google) || temId(c.account_id_glsa);

    const get = (b) => wk.get(c.id + "|" + b) || { ...zero(), spend_render: 0, spend_fora: 0 };
    const W0 = get("w0"), W1 = get("w1"), W2 = get("w2");
    const A = ap.get(c.id) || { w0: 0, w1: 0, w2: 0, mes: 0, w0_por_visita: 0 };
    const M = mes.get(c.id) || { spend: 0, leads: 0 };

    const cplDe = (w) => (w.leads > 0 ? r2(w.spend / w.leads) : null);
    const w0_spend = r2(W0.spend), w0_cpl = cplDe(W0);
    const w1_spend = r2(W1.spend), w1_cpl = cplDe(W1);
    const w0_spend_render = r2(W0.spend_render);
    const w0_spend_fora = r2(W0.spend_fora);

    const pm = plat.get(c.id) || new Map();
    const plataformas_fora = [...pm.entries()]
      .filter(([k, v]) => v.spend > 0 && !render.includes(k))
      .map(([k]) => k)
      .sort();

    const primeiro_dia = dados.primeiroDia[c.id] || null;
    const dias_veiculacao =
      primeiro_dia === null
        ? null
        : Math.round((s2d(j.w0_fim) - s2d(primeiro_dia)) / DIA) + 1;

    const nb = bmk.get(String(c.company_niche || "").trim().toLowerCase()) || null;
    const bm_cpl = nb && nb.cpl !== null ? Number(nb.cpl) : null;
    const bm_leads_mes = nb && nb.leads_month !== null ? Number(nb.leads_month) : null;
    const bm_appt_mes = nb && nb.appt_booked !== null ? Number(nb.appt_booked) : null;

    const meta_usada =
      c.appointment_quantity !== null && c.appointment_quantity !== undefined
        ? Number(c.appointment_quantity)
        : bm_appt_mes;
    const origem_meta =
      c.appointment_quantity !== null && c.appointment_quantity !== undefined
        ? "contrato"
        : "benchmark";

    const bm_leads_sem = bm_leads_mes !== null ? r2(porPeriodo(bm_leads_mes)) : null;
    const bm_appt_sem = meta_usada !== null && meta_usada !== undefined ? r2(porPeriodo(meta_usada)) : null;
    const div = (v, base) => (base ? r2(v / base) : null);
    const ritmo_leads = div(W0.leads, bm_leads_mes !== null ? porPeriodo(bm_leads_mes) : 0);
    const ritmo_leads_w1 = div(W1.leads, bm_leads_mes !== null ? porPeriodo(bm_leads_mes) : 0);
    const ritmo_leads_w2 = div(W2.leads, bm_leads_mes !== null ? porPeriodo(bm_leads_mes) : 0);
    const ritmo_appts = div(A.w0, meta_usada ? porPeriodo(meta_usada) : 0);
    const classe_leads = classe(ritmo_leads);
    const classe_appts = classe(ritmo_appts);

    /* D5 + D6 — bloqueio impede gerar; aviso só avisa. */
    const bloqueios = [];
    if (gestores.length === 0) bloqueios.push("sem gestor_mb — o bloco não tem destinatário");
    if (w0_spend_fora > 0) {
      bloqueios.push(
        `investimento de $${dolar(w0_spend_fora)} em ${plataformas_fora.join("/")}, que a v1 não renderiza (D6)`,
      );
    }
    if (!tem_account_id && w0_spend === 0) {
      bloqueios.push("nenhum account id cadastrado em Meta/Google/GLSA");
    }

    const avisos = [];
    if (!nb) {
      avisos.push(
        `nicho ${c.company_niche === null || c.company_niche === undefined ? "NULL" : "'" + c.company_niche + "'"} sem benchmark — sem classificação de ritmo`,
      );
    }
    if (c.appointment_quantity === null || c.appointment_quantity === undefined) {
      avisos.push("sem meta contratada — ritmo de agendamento usa o benchmark do nicho");
    }
    if (w0_spend_render > 0 && W0.page_views === 0) avisos.push("page_views ausente no período");

    let motivo_sem_veiculacao = null;
    if (w0_spend === 0 && !tem_account_id) motivo_sem_veiculacao = "sem_cadastro";
    else if (w0_spend === 0 && w1_spend > 0) motivo_sem_veiculacao = "pausada";
    else if (w0_spend === 0) motivo_sem_veiculacao = "sem_veiculacao_prolongada";
    else if (w0_spend_render === 0 && w0_spend_fora > 0) motivo_sem_veiculacao = "plataforma_nao_renderizada";

    /* Cenário — decidido pelo dado, nesta ordem. */
    let cenario_cod;
    if (w0_spend === 0) cenario_cod = "F";
    // O piso do E é semanal ($150 em 7 dias) e existe para dizer "gastou o
    // bastante para zero lead ser incidente, não ruído". Num recorte MENOR
    // ele encolhe junto — $50 num dia só é ruído com o piso cheio e
    // incidente com o piso do dia. Num recorte MAIOR ele NÃO cresce: um mês
    // com investimento e nenhum lead é incidente com qualquer régua.
    else if (w0_spend >= 150 * Math.min(1, semanas) && W0.leads === 0) cenario_cod = "E";
    else if (dias_veiculacao !== null && dias_veiculacao < 21) cenario_cod = "G";
    else if (
      ritmo_leads !== null &&
      ritmo_leads_w1 !== null &&
      ritmo_leads_w2 !== null &&
      ritmo_leads >= 0.6 &&
      ritmo_leads > ritmo_leads_w1 &&
      ritmo_leads_w1 < 0.6 &&
      ritmo_leads_w2 < 0.6
    ) {
      cenario_cod = "H";
    } else if (classe_leads === null || classe_appts === null) cenario_cod = "X";
    else if (
      ["forte", "dentro"].includes(classe_leads) &&
      ["forte", "dentro"].includes(classe_appts)
    ) {
      cenario_cod = "A";
    } else if (["forte", "dentro"].includes(classe_leads) && classe_appts === "fraco") cenario_cod = "B";
    else if (classe_leads === "fraco" && ["forte", "dentro"].includes(classe_appts)) cenario_cod = "C";
    else cenario_cod = "D";

    const semaforo =
      bloqueios.length > 0
        ? "vermelho"
        : w0_spend === 0
          ? "laranja"
          : W0.leads === 0 || A.w0 === 0
            ? "amarelo"
            : "verde";

    const por_plataforma = {};
    for (const [k, v] of [...pm.entries()].sort()) {
      if (v.spend <= 0) continue; // checklist 8.8 item 4: plataforma zerada não entra
      por_plataforma[k] = {
        spend: r2(v.spend),
        leads: v.leads,
        cpl: v.leads > 0 ? r2(v.spend / v.leads) : null,
        impressions: v.impressions,
        clicks: v.clicks,
        page_views: v.page_views,
      };
    }

    const contexto_mb = (opt.get(c.id) || []).map(({ _ts, ...rest }) => rest);

    linhas.push({
      client_id: c.id,
      client_name: c.name,
      gestores,
      semaforo,
      pode_gerar: bloqueios.length === 0,
      cenario: cenario_cod,
      payload: {
        identificacao: {
          client_id: c.id,
          numero: c.number ?? null,
          cliente: c.name,
          gestores,
          nicho: c.company_niche ?? null,
          tier: c.tier_client ?? null,
          plano: c.plan_client ?? null,
        },
        semana: {
          inicio: j.w0_ini,
          fim: j.w0_fim,
          dias: j.dias,
          // `padrao: false` avisa quem escreve o texto que a palavra "semana"
          // está errada ali — a redação troca por "período".
          padrao,
          label: rotuloPeriodo(j.w0_ini, j.w0_fim),
          timezone: tz,
        },
        midia: {
          renderizar: render,
          por_plataforma,
          total: {
            spend: w0_spend,
            leads: W0.leads,
            cpl: w0_cpl,
            impressions: W0.impressions,
            clicks: W0.clicks,
            page_views: W0.page_views,
            spend_renderizavel: w0_spend_render,
            spend_nao_renderizado: w0_spend_fora,
          },
        },
        comparacao: {
          semana_anterior: {
            inicio: j.w1_ini,
            fim: j.w1_fim,
            dias: j.dias,
            spend: w1_spend,
            leads: W1.leads,
            cpl: w1_cpl,
            impressions: W1.impressions,
            clicks: W1.clicks,
            page_views: W1.page_views,
          },
          var_spend: r2(w0_spend - w1_spend),
          var_leads: W0.leads - W1.leads,
          var_appts: A.w0 - A.w1,
        },
        agendamento: {
          semana: A.w0,
          semana_anterior: A.w1,
          mes_ate_domingo: A.mes,
          meta_mensal_contratada:
            c.appointment_quantity === undefined ? null : c.appointment_quantity,
          meta_usada: meta_usada ?? null,
          origem_meta,
          valor_agendamento: c.appointment_value ?? null,
          status_considerados: ["BOOKED", "RESCHEDULE", "REMOTE ESTIMATE"],
          criterio_data: "occurred_at — data em que o agendamento foi marcado (D2)",
          referencia_interna_por_data_da_visita: A.w0_por_visita,
          rotulo: "agendamentos no período, todas as origens",
        },
        mes: {
          inicio: j.mes_ini,
          fim: j.w0_fim,
          spend: r2(M.spend),
          leads: M.leads,
          agendamentos: A.mes,
          meta_mensal: meta_usada ?? null,
        },
        benchmark: {
          nicho_benchmark: nb ? nb.niche : null,
          bm_cpl,
          bm_leads_mes,
          bm_leads_semana: bm_leads_sem,
          bm_appt_semana: bm_appt_sem,
          ritmo_leads,
          ritmo_appts,
          classe_leads,
          classe_appts,
          cpl_vs_bm: w0_cpl !== null && bm_cpl ? r2(w0_cpl / bm_cpl) : null,
        },
        contexto_mb,
        qualidade: {
          semaforo,
          pode_gerar: bloqueios.length === 0,
          bloqueios,
          avisos,
          motivo_sem_veiculacao,
          dias_veiculacao,
          primeiro_dia_veiculacao: primeiro_dia,
        },
        cenario: { codigo: cenario_cod },
        proveniencia: {
          spend_leads: `ad_insights, insight_date entre ${j.w0_ini} e ${j.w0_fim}, soma por cliente e plataforma`,
          cpl: "soma(spend) / soma(leads) no período — nunca a média da coluna cpl",
          agendamento: `v_appointment_effective, counts_as_appointment AND is_lead_primary, occurred_at em ${tz} entre ${j.w0_ini} e ${j.w0_fim}`,
          benchmark: nb ? "niche_benchmarks.niche = " + nb.niche : "sem benchmark para o nicho",
          meta_mensal:
            origem_meta === "contrato"
              ? "clients.appointment_quantity"
              : "niche_benchmarks.appt_booked (cliente sem meta contratada)",
          gerado_em: new Date().toISOString(),
          motor: "n8n mb-touchpoint-week (porte de fn_mb_touchpoint_week, não aplicada)",
        },
      },
    });
  }

  linhas.sort((a, b) => String(a.client_name).localeCompare(String(b.client_name), "pt-BR"));
  return linhas;
}

/* ══════════════════════ leitura: as 5 consultas do contrato ══════════════════ */

export async function carregar(http, base, headers, params) {
  const j = janela(params.week_start, params.week_end);
  const lo = menor(j.w2_ini, j.mes_ini);

  const clientsRaw = await fetchAll(http, base, headers, "clients", {
    select:
      "id,name,number,number_int,gestor_mb,company_niche,tier_client,plan_client," +
      "appointment_quantity,appointment_value,account_id_meta,account_id_google,account_id_glsa",
    is_live: "eq.true",
    order: "id.asc",
  });

  let clients = clientsRaw.filter((c) => c.number_int !== null && c.number_int !== undefined);
  if (params.gestor) {
    const g = params.gestor.toLowerCase();
    clients = clients.filter((c) => String(c.gestor_mb || "").toLowerCase().includes(g));
  }
  if (params.client_ids && params.client_ids.length) {
    const set = new Set(params.client_ids);
    clients = clients.filter((c) => set.has(c.id));
  }
  const ids = clients.map((c) => c.id);
  if (!ids.length) return { clients: [], insights: [], appts: [], benchmarks: [], opts: [], primeiroDia: {} };

  const inFilter = "in.(" + ids.join(",") + ")";

  const insights = await fetchAll(http, base, headers, "ad_insights", {
    select: "client_id,insight_date,platform,campaign_name,spend,leads,impressions,clicks,page_views",
    insight_date: `gte.${lo}`,
    and: `(insight_date.lte.${j.w0_fim})`,
    client_id: inFilter,
    order: "id.asc",
  });

  // CTE `prim`: primeiro dia de veiculação DE SEMPRE. Puxa só as duas colunas.
  const todos = await fetchAll(http, base, headers, "ad_insights", {
    select: "client_id,insight_date",
    client_id: inFilter,
    order: "id.asc",
  });
  const primeiroDia = {};
  for (const r of todos) {
    const d = String(r.insight_date).slice(0, 10);
    if (!primeiroDia[r.client_id] || d < primeiroDia[r.client_id]) primeiroDia[r.client_id] = d;
  }

  const appts = await fetchAll(http, base, headers, "v_appointment_effective", {
    select: "client_id,occurred_at,scheduled_at,counts_as_appointment,is_lead_primary",
    occurred_at: `gte.${lo}T00:00:00`,
    client_id: inFilter,
    order: "occurred_at.asc",
  });

  const benchmarks = await fetchAll(http, base, headers, "niche_benchmarks", {
    select: "niche,cpl,leads_month,appt_booked,cpa,avg_ticket",
    order: "niche.asc",
  });

  const opts = await fetchAll(http, base, headers, "mb_optimizations", {
    select:
      "client_id,created_at,problem,action,hypothesis,expected_result,validate_on,action_kind,author_name",
    created_at: `gte.${lo}T00:00:00`,
    client_id: inFilter,
    order: "created_at.asc",
  });

  return { clients, insights, appts, benchmarks, opts, primeiroDia };
}
