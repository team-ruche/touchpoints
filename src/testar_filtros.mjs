/* =====================================================================
 * testar_filtros.mjs — busca, calendário e filtros, sem navegador.
 *
 *   node testar_filtros.mjs [saida_2026-08-17.json]
 *
 * A tela vai ser demonstrada para quem decide se ela entra no Ruche OS.
 * "Buscar não achou o cliente" na frente dessa pessoa é caro, e é o tipo de
 * coisa que só aparece quando alguém digita — então digita aqui.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
        "\nexport { S, visiveis, casaBusca, estadoDe, segundaDa, domingoDa, ultimaSemanaFechada," +
        " somaSemanas, filtrosAtivos, blocosParaEnvio, blocosCS, envioDe, registrarEnvio, enviosDaSemana," +
        " salvarRascunho, FILTROS_PADRAO, idsEnviaveis, idsSelecionados, idsForaDaSelecao," +
        " estaSelecionado, alternarSelecao, gravarSelecao, selecionarVisiveis, selecaoDaSemana };",
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
const limpar = () => Object.assign(mod.S, mod.FILTROS_PADRAO);

const eq = (rotulo, obtido, esperado) => {
  if (obtido !== esperado) erro(`${rotulo}: ${obtido} (esperado ${esperado})`);
  else console.log(`  ✓ ${rotulo}: ${obtido}`);
};

console.log(`contrato: ${linhas.length} clientes · semana ${SEMANA}\n`);

/* ── 1. calendário: qualquer dia cai na segunda daquela semana ── */
console.log("1) calendário");
const dom = mod.domingoDa(SEMANA);
for (const d of [SEMANA, mod.somaSemanas(SEMANA, 0), dom]) {
  if (mod.segundaDa(d) !== SEMANA) erro(`segundaDa(${d}) = ${mod.segundaDa(d)}, esperado ${SEMANA}`);
}
eq("domingo da semana", dom, "2026-08-23");
eq("dia seguinte já é outra semana", mod.segundaDa("2026-08-24"), "2026-08-24");
eq("virada de ano", mod.segundaDa("2026-01-01"), "2025-12-29");
if (mod.ultimaSemanaFechada() >= mod.iso?.(new Date()) ) erro("a semana corrente entrou");

/* ── 2. busca ── */
console.log("\n2) busca por cliente");
const alvo = linhas.find((r) => /\d/.test(r.client_name));
const numero = alvo.payload.identificacao.numero;
const nome = alvo.client_name;
const palavra = nome.replace(/^#\S+\s*/, "").split(/\s+/)[0];

limpar();
mod.S.busca = numero;
eq(`por número "${numero}"`, mod.visiveis().some((r) => r.client_id === alvo.client_id), true);
mod.S.busca = "#" + numero;
eq(`por "#${numero}"`, mod.visiveis().some((r) => r.client_id === alvo.client_id), true);
mod.S.busca = palavra.toLowerCase();
eq(`por nome "${palavra.toLowerCase()}"`, mod.visiveis().some((r) => r.client_id === alvo.client_id), true);
mod.S.busca = "  " + palavra.toUpperCase() + "  ";
eq("com espaço e maiúscula", mod.visiveis().some((r) => r.client_id === alvo.client_id), true);
mod.S.busca = "zzzznaoexiste";
eq("termo inexistente", mod.visiveis().length, 0);
mod.S.busca = "";
eq("busca vazia devolve tudo", mod.visiveis().length, linhas.length);

// buscar por nicho: o chefe lembra do serviço, não do número
const nicho = (linhas.find((r) => r.payload.identificacao.nicho) || {}).payload.identificacao.nicho;
mod.S.busca = nicho.toLowerCase();
const porNicho = mod.visiveis().length;
eq(`por nicho "${nicho}" acha alguém`, porNicho > 0, true);

/* ── 3. filtros combinam (E, não OU) ── */
console.log("\n3) filtros");
limpar();
for (const cod of ["A", "B", "D", "E", "F", "G", "H", "X"]) {
  mod.S.cenario = cod;
  const n = mod.visiveis().length;
  const esperado = linhas.filter((r) => r.cenario === cod).length;
  if (n !== esperado) erro(`cenário ${cod}: ${n} != ${esperado}`);
}
console.log("  ✓ cada cenário devolve exatamente os seus");

limpar();
mod.S.semaforo = "verde";
const verdes = mod.visiveis();
eq("semáforo verde", verdes.length, linhas.filter((r) => r.semaforo === "verde").length);

const g = [...new Set(linhas.flatMap((r) => r.gestores || []))][0];
limpar();
mod.S.gestor = g;
eq(`gestor "${g}"`, mod.visiveis().every((r) => r.gestores.includes(g)), true);

// combinado: gestor + cenário tem de ser interseção
mod.S.cenario = "F";
const comb = mod.visiveis();
eq(
  "gestor + cenário é interseção",
  comb.every((r) => r.gestores.includes(g) && r.cenario === "F"),
  true,
);
eq("filtrosAtivos() acusa", mod.filtrosAtivos(), true);
limpar();
eq("filtrosAtivos() limpo", mod.filtrosAtivos(), false);

/* ── 4. estado do bloco ── */
console.log("\n4) estado");
limpar();
const bloqueados = linhas.filter((r) => !r.pode_gerar).length;
mod.S.estado = "bloqueado";
eq("bloqueados", mod.visiveis().length, bloqueados);
mod.S.estado = "sem-texto";
eq("sem texto = todo o resto", mod.visiveis().length, linhas.length - bloqueados);

// escreve um rascunho e confere que o estado muda
const livre = linhas.find((r) => r.pode_gerar);
mod.salvarRascunho(SEMANA, livre.client_id, {
  texto: { comoFoi: "texto pronto.", proximoPasso: "ação em 25/08.", pedido: "um pedido." },
  origem: "regua",
  lacunas: [],
  escolhas: {},
});
eq("depois de escrever, sai de sem-texto", mod.estadoDe(livre), "pronto");
mod.S.estado = "pronto";
eq("filtro pronto acha ele", mod.visiveis().some((r) => r.client_id === livre.client_id), true);

mod.salvarRascunho(SEMANA, livre.client_id, {
  texto: { comoFoi: "sobrou [MB: motivo da pausa].", proximoPasso: "x em 25/08.", pedido: "y." },
  origem: "regua",
  lacunas: [{ id: "motivo_pausa" }],
  escolhas: {},
});
eq("com marcador vira pendente", mod.estadoDe(livre), "pendente");

/* ── 5. o FILTRO NÃO PODE MEXER NO ENVIO ── */
console.log("\n5) filtro não vaza para o envio");
mod.salvarRascunho(SEMANA, livre.client_id, {
  texto: { comoFoi: "texto pronto.", proximoPasso: "ação em 25/08.", pedido: "um pedido." },
  origem: "regua",
  lacunas: [],
  escolhas: {},
});
limpar();
const semFiltro = mod.blocosParaEnvio();
mod.S.busca = "zzzznaoexiste";
const comFiltro = mod.blocosParaEnvio();
eq("visíveis com filtro impossível", mod.visiveis().length, 0);
eq(
  "blocos do envio não mudam",
  JSON.stringify([...comFiltro.keys()].sort()),
  JSON.stringify([...semFiltro.keys()].sort()),
);
limpar();

/* ── 5b. a SELEÇÃO, que é o jeito de mandar vários de uma vez ──────────
 *
 * A seleção é o oposto do filtro: ela é explícita, aparece marcada na lista
 * e nomeia na tela quem ficou de fora. O que os casos abaixo seguram é a
 * diferença entre "não escolhi ninguém" (= todos, o padrão de sempre) e
 * "desmarquei todo mundo" (= não envia nada). Confundir os dois é o clique
 * de "Nenhum" virando um envio para 42 clientes. */
console.log("\n5b) seleção de clientes para o envio");
limpar();
mod.gravarSelecao(null);

// a seção 5 deixou UM cliente pronto; para exercitar "vários de uma vez"
// é preciso mais de um, então escreve um texto fechado para os primeiros 5
for (const r of mod.S.linhas.filter((x) => x.pode_gerar).slice(0, 5)) {
  mod.salvarRascunho(SEMANA, r.client_id, {
    texto: { comoFoi: "texto pronto.", proximoPasso: "ação em 25/08.", pedido: "um pedido." },
    origem: "regua",
    lacunas: [],
    escolhas: {},
  });
}

const prontos = mod.idsEnviaveis();
eq("há prontos suficientes para o teste", prontos.length >= 3, true);
eq("sem seleção, vão todos os prontos", mod.idsSelecionados().length, prontos.length);
eq("sem seleção, ninguém fica de fora", mod.idsForaDaSelecao().length, 0);
eq("sem seleção, o estado é 'todos'", mod.selecaoDaSemana(), null);

const dois = prontos.slice(0, 2);
mod.gravarSelecao(new Set(dois));
eq("com dois marcados, vão dois", mod.idsSelecionados().length, 2);
eq("e o resto aparece como fora", mod.idsForaDaSelecao().length, prontos.length - 2);
eq("o marcado está marcado", mod.estaSelecionado(dois[0]), true);
eq("o não marcado, não", mod.estaSelecionado(prontos[2]), false);
eq(
  "e só eles entram nos blocos do envio",
  [...mod.blocosParaEnvio().values()].reduce((a, b) => a + b.length, 0),
  // um cliente pode ter mais de um gestor, e aí o bloco dele sai em duas
  // mensagens — a conta certa é por bloco, não por cliente
  [...mod.blocosParaEnvio(dois).values()].reduce((a, b) => a + b.length, 0),
);

// desmarcar todos NÃO pode virar "todos"
mod.gravarSelecao(new Set());
eq("desmarcar todo mundo manda ninguém", mod.idsSelecionados().length, 0);
eq("e isso NÃO é o mesmo que não ter seleção", mod.selecaoDaSemana() === null, false);
eq("com ninguém marcado, não há blocos", mod.blocosParaEnvio().size, 0);

// marcar de volta todo mundo volta a ser "todos", e não uma lista congelada:
// senão um cliente que ficar pronto depois nunca mais entraria no envio
mod.gravarSelecao(new Set(prontos));
mod.alternarSelecao(prontos[0]);
mod.alternarSelecao(prontos[0]);
eq("remarcar todos volta ao estado 'todos'", mod.selecaoDaSemana(), null);

// a ponte explícita entre filtrar e enviar
const gestorTeste = mod.S.linhas.find((r) => (r.gestores || []).length)?.gestores[0];
if (gestorTeste) {
  mod.S.gestor = gestorTeste;
  mod.selecionarVisiveis();
  const visProntos = mod
    .visiveis()
    .filter((r) => ["pronto", "editado"].includes(mod.estadoDe(r)))
    .map((r) => r.client_id);
  eq("“só os visíveis” marca exatamente o que o filtro mostra", mod.idsSelecionados().length, visProntos.length);
  limpar();
  eq("e limpar o filtro não desmarca ninguém", mod.idsSelecionados().length, visProntos.length);
}

// o escopo "período todo" da CS IGNORA a seleção — é a saída para quem
// selecionou dois clientes e quer mandar a semana inteira para a CS
mod.gravarSelecao(new Set(dois));
eq(
  "CS: “período todo” ignora a seleção",
  [...mod.blocosCS("semana").values()].reduce((a, b) => a + b.length, 0),
  [...mod.blocosParaEnvio(mod.idsEnviaveis()).values()].reduce((a, b) => a + b.length, 0),
);
eq(
  "CS: “selecionados” usa a mesma seleção da lista",
  [...mod.blocosCS("selecao").values()].reduce((a, b) => a + b.length, 0),
  [...mod.blocosParaEnvio(dois).values()].reduce((a, b) => a + b.length, 0),
);
mod.S.sel = dois[0];
eq("CS: “só o cliente aberto” manda um bloco por gestor dele", [...mod.blocosCS("cliente").values()].every((b) => b.length === 1), true);
mod.gravarSelecao(null);
limpar();

/* ── 6. registro de envio (o que evita mandar duas vezes) ── */
console.log("\n6) registro de envio");
eq("antes: nada publicado", mod.enviosDaSemana(SEMANA).length, 0);
mod.registrarEnvio(SEMANA, "Fulano", { clientes: 3, client_ids: ["a", "b", "c"] });
eq("depois: 1 gestor", mod.enviosDaSemana(SEMANA).length, 1);
eq("acha pelo gestor", Boolean(mod.envioDe(SEMANA, "Fulano")), true);
eq("outro gestor segue livre", mod.envioDe(SEMANA, "Sicrano"), null);
eq("outra semana segue livre", mod.enviosDaSemana("2026-08-10").length, 0);

console.log(falhas === 0 ? "\n✓ tudo passou" : `\n✗ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
