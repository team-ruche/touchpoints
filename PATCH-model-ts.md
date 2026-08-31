# Patch para o dashboard — `montarMensagem` diz "contratados" para quem não contratou

**Achado em 29/08/2026**, testando a banca ao vivo contra a semana de 17–23/08.
Vale para `fase4/src/components/admin/pages/mb/touchpoints/model.ts`, que é a versão
que o `APLICAR.md` manda copiar para o Ruche OS. **Corrigir antes de a tela entrar.**

## O que acontece

`montarMensagem` escreve a linha do acumulado do mês assim:

```ts
const meta = p.agendamento.meta_usada != null ? Math.round(p.agendamento.meta_usada) : null;
linhas.push(
  `• Agendamentos: ${p.mes.agendamentos}${meta != null ? ` de ${meta} contratados` : ""}`,
);
```

`meta_usada` tem duas origens, e o contrato diz qual é em `agendamento.origem_meta`:

- `'contrato'` → `clients.appointment_quantity`, a meta que o cliente assinou;
- `'benchmark'` → `niche_benchmarks.appt_booked`, porque o cliente **não tem** meta.

A linha ignora essa distinção e escreve "contratados" nos dois casos.

## Quanto isso pega

Semana de 17–23/08/2026, 44 clientes elegíveis:

| | Clientes |
|---|---|
| meta vinda do contrato | 20 |
| meta vinda do benchmark do nicho | 21 |
| **destes, com bloco liberado para envio** | **17** |

Ou seja: 17 donos de empresa receberiam, por escrito, um número de agendamentos
"contratados" que eles nunca contrataram. `#223 CARPENTERS GARCIA` receberia
"0 de 6 contratados" tendo contrato sem meta de agendamento.

## Por que isso importa mais que um erro de texto

É a mesma família do achado que originou o projeto inteiro: o campo
`🎯 Appointments Booked` imprimia `clients.appointment_quantity` com rótulo de resultado.
Aqui o número está certo e o **rótulo** é que mente. Um cliente que responde
"eu não contratei 6 agendamentos" derruba a confiança no relatório inteiro.

A régua da IA já tratava isso — regra 6 do system da Fase 3:

> *Quando `agendamento.origem_meta = "benchmark"`, NÃO chame de "meta contratada" — é
> referência do nicho.*

Quem não obedecia era a mensagem final, que é montada em código e não passa pelo modelo.

## O patch

```diff
   const meta = p.agendamento.meta_usada != null ? Math.round(p.agendamento.meta_usada) : null;
   linhas.push(`📊 No mês (${dia(p.mes.inicio)} a ${dia(p.mes.fim)}):`);
   linhas.push(`• Leads: ${p.mes.leads}`);
-  linhas.push(
-    `• Agendamentos: ${p.mes.agendamentos}${meta != null ? ` de ${meta} contratados` : ""}`,
-  );
+  // `meta_usada` pode vir do contrato OU do benchmark do nicho. Escrever
+  // "contratados" nos dois casos põe no relatório um número que o cliente
+  // nunca assinou — 17 dos 44 blocos da semana de 17/08.
+  linhas.push(
+    `• Agendamentos: ${p.mes.agendamentos}` +
+      (meta == null
+        ? ""
+        : p.agendamento.origem_meta === "contrato"
+          ? ` de ${meta} contratados`
+          : ` de ${meta} — referência para a sua vertical`),
+  );
```

"referência para a sua vertical" em vez de "referência do nicho": a mensagem vai para o
dono da empresa, e "nicho" é palavra de agência.

Já aplicado em `live/app/app.js`. Depois do patch, os 44 blocos da semana saem com
**zero rótulos errados** (`node src/testar_app.mjs`).

## Teste que pega uma regressão disso

`src/testar_app.mjs` já verifica, para cada cliente:

- que `📅 Agendamentos na semana:` imprime `agendamento.semana` e nunca
  `meta_mensal_contratada`;
- que nenhuma plataforma com `spend = 0` aparece;
- que o CPL é soma/soma, não média de coluna;
- que os seis blocos da seção 8.2 estão na mensagem.

Vale portar essas quatro asserções para o teste do dashboard quando a tela entrar.
