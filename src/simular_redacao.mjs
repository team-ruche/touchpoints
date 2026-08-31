/* =====================================================================
 * simular_redacao.mjs — roda o Code node GERADO de `mb-touchpoint-redacao`,
 * emulando o que o n8n injeta ($('Config'), $('Webhook')).
 *
 *   node simular_redacao.mjs [2026-08-17]
 *
 * Por que existe: o Code node só dá para testar publicando. Isto pega o
 * código que o build.py colou dentro do JSON — não o fonte — e prova que
 * ele roda no formato do sandbox, para os 44 clientes, e devolve
 * exatamente o mesmo texto que `redigir()` devolve aqui fora.
 *
 * Não chama rede nenhuma: a redação sem IA não tem para onde ligar.
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redigir } from "./redacao.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.dirname(AQUI);
const week = process.argv[2] || "2026-08-17";

const wf = JSON.parse(fs.readFileSync(path.join(LIVE, "n8n", "02_mb-touchpoint-redacao.json"), "utf8"));
const nodeRedigir = wf.nodes.find((n) => n.name === "Redigir");
if (!nodeRedigir) throw new Error('o workflow não tem o node "Redigir" — rode build.py');
const codigo = nodeRedigir.parameters.jsCode;
const cfg = Object.fromEntries(
  wf.nodes.find((n) => n.name === "Config").parameters.assignments.assignments.map((a) => [a.name, a.value]),
);

/* O sandbox do task-runner do n8n NÃO tem Intl nem URLSearchParams. Já
   derrubou um deploy: a simulação passava no Node local e o workflow
   quebrava no ar. Aqui a gente esconde os dois antes de rodar o código
   gerado — se ele depender de algum, quebra aqui e não em produção. */
const guardados = { Intl: globalThis.Intl, URLSearchParams: globalThis.URLSearchParams };
delete globalThis.Intl;
delete globalThis.URLSearchParams;

const linhas = JSON.parse(fs.readFileSync(path.join(AQUI, `saida_${week}.json`), "utf8"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let iguais = 0;
let divergentes = 0;
let comLacuna = 0;
const t0 = Date.now();

for (const r of linhas) {
  const corpo = { contrato: r.payload };
  globalThis.$ = (nome) => {
    const nós = {
      Config: { first: () => ({ json: cfg }) },
      Webhook: { first: () => ({ json: { headers: { "x-tp-token": cfg.token }, body: corpo } }) },
    };
    if (!nós[nome]) throw new Error("node desconhecido na simulação: " + nome);
    return nós[nome];
  };

  const saida = await new AsyncFunction(codigo)();
  const doNode = saida[0].json;
  const daqui = redigir(r.payload);

  if (JSON.stringify(doNode) === JSON.stringify(daqui)) iguais++;
  else {
    divergentes++;
    console.log(`  ✗ ${r.payload.identificacao.cliente}`);
    for (const k of ["como_foi", "proximo_passo", "pedido_cliente"]) {
      if (doNode[k] !== daqui[k]) console.log(`    ${k}\n      node: ${doNode[k]}\n      aqui: ${daqui[k]}`);
    }
  }
  if (doNode.lacunas && doNode.lacunas.length) comLacuna++;
}

/* Prova que o cadeado do token está no código gerado, não só no fonte. */
let recusou = false;
try {
  globalThis.$ = (nome) =>
    ({
      Config: { first: () => ({ json: cfg }) },
      Webhook: { first: () => ({ json: { headers: {}, body: { contrato: linhas[0].payload } } }) },
    })[nome];
  await new AsyncFunction(codigo)();
} catch (e) {
  recusou = /token/.test(String(e.message));
}

Object.assign(globalThis, guardados);

console.log(`\nsemana ................ ${week}`);
console.log(`blocos pelo Code node . ${iguais + divergentes}`);
console.log(`idênticos ao fonte .... ${iguais}`);
console.log(`divergentes ........... ${divergentes}`);
console.log(`com lacuna ............ ${comLacuna}`);
console.log(`sem Intl / URLSearchParams no escopo ... ok`);
console.log(`recusa sem token ...... ${recusou ? "ok" : "NÃO RECUSOU"}`);
console.log(`tempo ................. ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`chamadas de API ....... 0`);

process.exit(divergentes === 0 && recusou ? 0 : 1);
