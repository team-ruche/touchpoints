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
import { rotuloPeriodo } from "./contrato.js";

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
        "\nexport { montarMensagem, checklist, pendencias, termosProibidos, rascunhoDeTexto, rotuloSemana," +
        " ultimaSemanaFechada, numerosForaDoContrato, camposEfetivos, CENARIO };",
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
  /* `semana.label` é DERIVADO — quem monta é `rotuloPeriodo` no contrato, e
     estas saídas foram gravadas antes de 02/09/2026, quando o rótulo saía em
     mm/dd com o dia da semana em inglês. Recalcular aqui é o que mantém a
     fixture útil sem precisar reler o banco: o que ela guarda de valioso são
     os NÚMEROS, não a formatação de uma linha. */
  p.semana.label = rotuloPeriodo(p.semana.inicio, p.semana.fim);
  const texto = mod.rascunhoDeTexto(p);
  const msg = mod.montarMensagem(p, texto);
  const pend = mod.pendencias(texto);
  const chk = mod.checklist(p, texto);

  // 1. a mensagem tem os blocos da seção 8.2, nesta ordem
  const exige = ["Weekly Touch Point:", "📅 Agendamentos na semana:", "Como foi:", "🚀 Próximo passo:"];
  for (const e of exige) if (!msg.includes(e)) problemas.push(`${r.client_name}: falta “${e}” na mensagem`);

  // 1b. o bloco "📊 No mês" SAIU da mensagem em 02/09/2026: ele repetia em
  //     número cru o que a prosa já diz interpretado e, num recorte que
  //     atravessa a virada, imprimia um mês de 1 dia embaixo de um período de
  //     8. O número continua visível NA TELA — o que ele não é mais é linha
  //     publicada. Se voltar, este teste acusa.
  if (msg.includes("📊 No mês")) problemas.push(`${r.client_name}: o bloco “📊 No mês” voltou para a mensagem`);

  // 1c. UM formato de data na mensagem inteira, e ele é dd/mm. O cabeçalho
  //     saía em mm/dd com o dia da semana em inglês enquanto o resto saía em
  //     dd/mm — "08/09" era 8 de setembro numa linha e 9 de agosto na outra.
  const cab = msg.match(/📌 [^\n]*Touch Point: (.+)/);
  if (!cab) problemas.push(`${r.client_name}: cabeçalho do Touch Point ausente`);
  else if (!/^\d{2}\/\d{2} a \d{2}\/\d{2}$/.test(cab[1].trim()))
    problemas.push(`${r.client_name}: cabeçalho fora de dd/mm — “${cab[1]}”`);

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
  if (msgW.includes("📊 No mês")) problemas.push(`${r.client_name}: redação — “📊 No mês” voltou para a mensagem`);
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

/* ── modo livre: a mensagem inteira editável ──────────────────────────
 *
 * Abrir a mensagem inteira tira a garantia ESTRUTURAL de que nenhum número
 * nasce na tela (o cabeçalho vinha do contrato e ninguém digitava dentro
 * dele). O que entra no lugar é a conferência: todo número do texto tem de
 * existir no contrato. Estes casos provam que ela acha o que tem de achar e
 * não acusa o que é legítimo. */
console.log("\n── modo livre ──");
{
  // um cliente COM linha de leads: o primeiro da lista pode estar sem
  // veiculação, e aí não há cabeçalho de número para adulterar
  const r =
    linhas.find((x) => mod.montarMensagem(x.payload, mod.rascunhoDeTexto(x.payload)).includes("📩 Leads Generated:")) ||
    linhas[0];
  const p = r.payload;
  const texto = mod.rascunhoDeTexto(p);
  const original = mod.montarMensagem(p, texto);

  const diz = (rotulo, cond, extra) => {
    if (cond) console.log(`  ✓ ${rotulo}`);
    else {
      problemas.push(`modo livre — ${rotulo}${extra ? ": " + extra : ""}`);
      console.log(`  ✗ ${rotulo}${extra ? ": " + extra : ""}`);
    }
  };

  // 1. com `livre`, é a mensagem livre que sai — e ela sai INTEIRA
  const mao = original + "\n\nP.S. escrito à mão.";
  diz("montarMensagem devolve a mensagem editada quando ela existe", mod.montarMensagem(p, texto, mao) === mao);
  diz("sem `livre`, nada muda", mod.montarMensagem(p, texto, null) === original);

  // 2. a mensagem que a própria tela montou não pode ter número fora do
  //    contrato — se tiver, o alarme é falso e ninguém vai olhar para ele
  const foraLimpo = mod.numerosForaDoContrato(p, original);
  diz("a mensagem montada pela tela passa na conferência", foraLimpo.length === 0, foraLimpo.join(", "));

  // 3. um número inventado no cabeçalho é achado — é o caso que motivou tudo
  const adulterada = original.replace(/📩 Leads Generated: \d+/, "📩 Leads Generated: 4321");
  diz("número inventado no cabeçalho é acusado", mod.numerosForaDoContrato(p, adulterada).includes("4321"));

  // 4. data dd/mm não é número inventado
  diz("data dd/mm não vira número fora do contrato",
    mod.numerosForaDoContrato(p, original + "\nA leitura confiável é 08/09.").length === 0);

  // 5. o marcador continua travando, venha ele de onde vier
  diz("marcador na mensagem livre trava igual", mod.pendencias(texto, "texto com [marcador] solto").length === 1);

  // 6. o checklist enxerga as três seções dentro do texto livre
  const c = mod.camposEfetivos(texto, original);
  diz("camposEfetivos recorta o “Próximo passo” do texto livre", c.proximoPasso.trim().length > 0, JSON.stringify(c.proximoPasso));
  const chkLivre = mod.checklist(p, texto, adulterada);
  const item = chkLivre.find((x) => x.id === "numeros_livres");
  diz("o checklist ganha o item de conferência no modo livre", Boolean(item));
  diz("e ele reprova a mensagem adulterada", item && item.ok === false);
  const itemOk = mod.checklist(p, texto, original).find((x) => x.id === "numeros_livres");
  diz("e aprova a mensagem íntegra", itemOk && itemOk.ok === true);
  diz("fora do modo livre o item não existe", !mod.checklist(p, texto).find((x) => x.id === "numeros_livres"));
}

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
