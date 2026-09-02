/* =====================================================================
 * ensaio_cs.mjs — o POST de verdade numa conversa privada, sem incomodar
 * a Eduarda ou a Amanda.
 *
 *   node ensaio_cs.mjs [2026-08-17]          # dry-run: mostra e não manda
 *   node ensaio_cs.mjs 2026-08-17 --enviar   # manda para o destino `ensaio`
 *
 * O caminho do envio ao ClickUp nasceu atrás de dois cadeados e passou
 * semanas sem nunca ter rodado — foi assim que o `type` obrigatório da API
 * v3 só apareceu quando destravamos. A rota da CS tem o mesmo risco: dá
 * para provar tudo em dry-run e ainda assim o primeiro POST de verdade ser
 * o que vai para a CS. Este ensaio é o que tira esse "primeiro" do caminho.
 *
 * Monta dois blocos reais da semana, e um deles com número corrigido à mão,
 * para a mensagem de ensaio mostrar as duas coisas novas de uma vez: o
 * cabeçalho de cópia interna e a nota do de→para.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.dirname(AQUI);
const RAIZ = path.dirname(path.dirname(LIVE));

const week = process.argv[2] || "2026-08-17";
const enviar = process.argv.includes("--enviar");
const CS = "ensaio"; // resolvido pelo Config do workflow, não por aqui

/* ── credenciais: as mesmas que o build.py lê, nunca digitadas ── */
const env = fs.readFileSync(path.join(RAIZ, "config.env"), "utf8");
const TOKEN = /^TP_TOKEN=(.+)$/m.exec(env)?.[1].trim();
if (!TOKEN) throw new Error("sem TP_TOKEN no config.env");
const BASE = "https://webhook.ruchedigital.online/webhook";

/* ── shims para importar o app.js, que é script de navegador ── */
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
    Buffer.from(fonte + "\nexport { montarMensagem, aplicarCorrecoes, resumoCorrecao, linhaCorrecao };").toString(
      "base64",
    )
);

async function chamar(rota, corpo) {
  const r = await fetch(`${BASE}/${rota}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tp-token": TOKEN },
    body: JSON.stringify({ ...corpo, token: TOKEN }),
  });
  const txt = await r.text();
  let j = null;
  try {
    j = JSON.parse(txt);
  } catch {
    /* deixa cru: o erro do n8n é mais útil que "JSON inválido" */
  }
  if (!r.ok) throw new Error(`${rota} ${r.status}: ${(j && (j.message || j.error)) || txt.slice(0, 300)}`);
  return j;
}

const texto3 = (j) => ({ comoFoi: j.como_foi, proximoPasso: j.proximo_passo, pedido: j.pedido_cliente });

/* ── 1. a semana, do jeito que a tela pede ── */
const semana = await chamar("mb-touchpoint-week", { week_start: week, tz: "America/New_York" });
const linhas = semana.linhas || [];
console.log(`semana ${week}: ${linhas.length} clientes`);

/* ── 2. o cliente do ensaio COM correção: o caso GTF, investimento que
       nunca chegou ao ad_insights. Sem ele na semana, cai no primeiro que
       tiver plataforma, para a nota de correção existir de qualquer jeito ── */
const semPlataforma = linhas.find(
  (r) => r.pode_gerar && Object.keys(r.payload.midia.por_plataforma).length === 0 && r.payload.midia.renderizar.includes("meta"),
);
const alvoCorrigido = semPlataforma || linhas.find((r) => r.pode_gerar && r.payload.midia.total.leads > 0);
// O mês CONTÉM a semana: corrigir um sem o outro produz "os 0 leads do mês"
// ao lado de 9 leads na semana. Foi o que a primeira versão deste ensaio
// gerou, e é por isso que o diálogo da tela hoje trava esse salvar.
const correcao = semPlataforma
  ? {
      campos: {
        "midia.por_plataforma.meta.spend": 1180.4,
        "midia.por_plataforma.meta.leads": 9,
        "mes.spend": 1180.4,
        "mes.leads": 9,
        "cenario.codigo": "B",
      },
      motivo: "ENSAIO — a conta do Meta não sincroniza com o ad_insights; investimento e leads conferidos no gerenciador",
    }
  : {
      campos: {
        "agendamento.semana": (alvoCorrigido.payload.agendamento.semana || 0) + 2,
        "mes.agendamentos": (alvoCorrigido.payload.mes.agendamentos || 0) + 2,
      },
      motivo: "ENSAIO — dois agendamentos entraram pelo call center e não estavam no relatório",
    };

/* ── 3. um segundo cliente, sem correção nenhuma, para comparar ── */
const limpo = linhas.find(
  (r) => r.pode_gerar && r.client_id !== alvoCorrigido.client_id && r.payload.midia.total.leads > 0,
);

const escolhidos = [
  { r: alvoCorrigido, correcao },
  { r: limpo, correcao: null },
].filter((x) => x.r);

/* ── 4. contrato corrigido → redação → mensagem, o mesmo caminho da tela ── */
const porGestor = new Map();
for (const { r, correcao: c } of escolhidos) {
  const p = c ? app.aplicarCorrecoes(r.payload, { ...c, em: new Date().toISOString() }) : r.payload;
  const red = await chamar("mb-touchpoint-redacao", { contrato: p, escolhas: {} });
  const texto = texto3(red);
  const sobrou = `${texto.comoFoi}\n${texto.proximoPasso}\n${texto.pedido}`.match(/\[[^\]]+\]/g);
  if (sobrou) {
    console.log(`  · ${r.client_name} ficou com marcador ${sobrou[0]} — fora do ensaio`);
    continue;
  }
  const bloco = {
    client_id: r.client_id,
    cliente: p.identificacao.cliente,
    message_text: app.montarMensagem(p, texto),
  };
  if (c) {
    bloco.nota_interna =
      "número corrigido à mão — " +
      app.resumoCorrecao(r.payload, c).map(app.linhaCorrecao).join("; ") +
      " · motivo: " +
      c.motivo;
  }
  const g = r.gestores[0] || "(sem gestor)";
  if (!porGestor.has(g)) porGestor.set(g, []);
  porGestor.get(g).push(bloco);
  console.log(`  · ${r.client_name}${c ? "  [com correção]" : ""} → @${g}`);
}

if (!porGestor.size) throw new Error("nenhum bloco fechou sozinho nesta semana — nada para ensaiar");

/* ── 5. dry-run sempre; POST só com --enviar ── */
for (const [gestor, blocos] of porGestor) {
  const previa = await chamar("mb-touchpoint-envio", {
    destino: "cs",
    cs: CS,
    gestor,
    blocos,
    periodo: `Mon, ${week.slice(5, 7)}/${week.slice(8, 10)} — ensaio`,
    week_start: week,
  });
  console.log(`\n── prévia @${gestor} → ${previa.cs_nome} · canal ${previa.channel_id} · ${previa.caracteres} chars`);
  console.log(previa.mensagem);

  if (!enviar) continue;
  const r = await chamar("mb-touchpoint-envio", {
    destino: "cs",
    cs: CS,
    gestor,
    blocos,
    periodo: `Mon, ${week.slice(5, 7)}/${week.slice(8, 10)} — ensaio`,
    week_start: week,
    confirmar: true,
  });
  console.log(
    `\nENVIADO: dry_run=${r.dry_run} · canal ${r.channel_id} · clickup_message_id=${r.clickup_message_id || "—"}`,
  );
}

if (!enviar) console.log("\n(dry-run — nada foi enviado. Rode com --enviar para mandar de verdade.)");
