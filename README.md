# touchpoints

Gerador do Weekly TouchPoint da Ruche: lê o Supabase, calcula o bloco de cada cliente,
**escreve o texto** e monta a mensagem que vai para o canal do ClickUp.

Roda em três webhooks do n8n mais uma tela estática. **Não chama modelo de linguagem** —
custo de API por semana: `$0.00`.

```
navegador  ──▶  n8n mb-touchpoint-week     ──▶  Supabase (só leitura)
                mb-touchpoint-redacao           (redacao.js, sem rede)
                mb-touchpoint-envio        ──▶  ClickUp  ✋ travado por 2 cadeados
```

---

## Por que ele existe

O touchpoint semanal era manual e um campo estava mentindo há 16 semanas: o
`🎯 Appointments Booked` imprimia `clients.appointment_quantity` — a **meta mensal
contratada** — como se fosse o agendamento da semana. Em 62 de 108 blocos auditados o
número exibido era idêntico ao campo de contrato.

Daí a regra que manda em tudo aqui: **nenhum número nasce na camada de texto.** Todo
número vem do contrato calculado, e o teste `testar_redacao.mjs` procura cada número do
texto dentro do payload — um redator que só pode escrever números que existem no contrato
não consegue repetir aquele erro.

## Como o texto é escrito, sem IA

O cenário do cliente (A–H) é decidido pelo dado **antes** de qualquer palavra: ritmo de
leads e de agendamento contra o benchmark do nicho, dias de veiculação, investimento,
comparação com a semana anterior. Cada cenário tem régua — por onde abrir, o que entregar,
o que é proibido — e a régua virou tabela e template em [`src/redacao.js`](src/redacao.js).

**Fato passado que não está no banco não vira frase.** O motivo de uma pausa não existe em
tabela nenhuma, então ele não é inventado: vira **lacuna**, uma pergunta com lista fechada
que o gestor responde em um clique. Compromisso futuro (o que a agência vai fazer e
quando) é protocolo do cenário mais data real, e por isso fecha sozinho.

Na semana de 17 a 23/08, com 44 clientes: **33 blocos publicáveis sem ninguém digitar**,
11 esperando uma resposta de lista — e as 11 fecham.

## A tela

**https://team-ruche.github.io/touchpoints/** — servida pelo GitHub Pages a partir de
`docs/` no branch `main`. Não há credencial no bundle: na primeira abertura ela pede o
token dos webhooks e guarda no `localStorage` do seu navegador. Sem o token, a página não
lê nada.

Para rodar local em vez disso: `cd docs && python -m http.server 8080`.

## Rodar

```bash
# 1. credenciais (fora do repo, sempre)
export TP_TOKEN=...                     # token compartilhado tela ↔ webhooks
export SUPABASE_SERVICE_ROLE_KEY=...
export CLICKUP_TOKEN=... CLICKUP_CHANNEL_ID=...
export N8N_API_KEY=...
# dentro do workspace da Ruche nada disso é preciso: build.py lê do
# config.env e do HANDOVER_RUCHE_OS.md que já estão na máquina

# 2. publicar os workflows
python n8n/build.py                     # só gera os .json (não versionados)
python n8n/build.py --publicar          # cria/atualiza e ativa no n8n

# 3. abrir a tela
cd docs && python -m http.server 8080
# cole o token em "Ajustes" na primeira abertura
```

## Testes

```bash
cd src
node testar_redacao.mjs              # léxico, prazo, números, lacunas, determinismo
node testar_redacao.mjs --amostra    # um texto por cenário
node simular_redacao.mjs 2026-08-17  # roda o Code node GERADO, sem Intl no escopo
node testar_app.mjs                  # a mensagem final montada, nos 44 clientes
node validar.mjs 2026-08-17          # o contrato vs. a implementação de referência
node testar_webhooks.mjs 2026-08-17  # ponta a ponta nos webhooks publicados
```

Os testes que leem contrato precisam de `src/saida_<semana>.json`, que `validar.mjs`
gera lendo o Supabase. Esses arquivos **não** são versionados: carregam nome,
investimento e leads de cliente real.

## O que NÃO está aqui, de propósito

- **`n8n/*.json`** — os workflows gerados carregam a `service_role` do Supabase e o token
  do ClickUp em texto, no node `Config`. São artefato de build: rode `python n8n/build.py`.
  (O workflow da redação é o único dos três que não carrega segredo nenhum — ele não tem
  para onde ligar.)
- **`src/saida_*.json`** e os gabaritos — dado de cliente.
- **O token dos webhooks** — mora no `config.env` ou em `TP_TOKEN`, e a tela pede na
  primeira abertura.

## Estado

Nada disto está aplicado ao Ruche OS. Nenhuma migration rodou, nenhum arquivo do dashboard
foi tocado, e o envio ao ClickUp nasce travado por dois cadeados independentes. Os
detalhes, as medições e o que falta estão em [`BANCA.md`](BANCA.md).
