# TouchPoint ao vivo — banca de teste

**30/08/2026** · a redação passou a sair **sem modelo de linguagem**. Custo por semana: **$0,00**.

O protótipo da Fase 3 tinha dado real congelado num HTML: dava para olhar, não para testar.
Esta pasta é a mesma tela, ligada no Supabase, para você rodar qualquer semana, gerar a
redação de verdade e ver a mensagem exata que iria para o canal.

**O Ruche OS não muda.** Nenhuma migration foi aplicada, nenhum arquivo do dashboard foi
tocado. O envio ao ClickUp **foi liberado em 30/08** — a trava que sobrou é humana, e
está descrita mais abaixo.

---

## O que mudou em 30/08 — a redação saiu da API

A Fase 3 mandava os três campos (`como_foi`, `proximo_passo`, `pedido_cliente`) para a
Messages API. O caminho estava provado, mas travou no faturamento — e, olhando de novo,
pagar API por um texto que segue uma régua fechada era caro pelo motivo errado: **a régua
é o texto**. Os cenários A–H já decidiam por onde abrir, o que entregar e o que é
proibido; o modelo só preenchia lacunas de redação em cima disso.

Agora a régua virou tabela e template em `src/redacao.js`, e roda no Code node do n8n.

| | Fase 3 (Messages API) | agora (`redacao.js`) |
|---|---|---|
| Custo por semana | ~$0,50 | **$0,00** |
| Depende de saldo em conta | sim | não |
| Escrever a semana toda | 44 chamadas, decisão de custo | um clique |
| Viola o léxico da 8.7 | possível — a guarda avisava depois | **impossível**, testado nos 88 blocos |
| "Próximo passo" sem data | acontecia | **nunca**, testado nos 88 blocos |
| Número que não está no contrato | possível | **impossível**, testado nos 88 blocos |
| Variedade do texto | alta | **baixa** — repete estrutura entre clientes do mesmo cenário |

A última linha é o preço, e é honesto dizer que é o preço. A variação por cliente/semana
é sorteada por hash (determinística — mesmo cliente e mesma semana dão sempre o mesmo
texto), o que evita 16 semanas começando com a mesma palavra, mas não substitui redação.
O gestor edita por cima, no mesmo textarea de antes.

### O que a máquina continua não escrevendo

A regra dura da Fase 3 sobrevive inteira: **fato passado que não está no banco não vira
frase.** O motivo de uma pausa não existe em tabela nenhuma. Antes isso virava
`[MB: motivo da pausa]` e devolvia o trabalho para o gestor em texto livre.

Agora vira **lacuna**: a pergunta vem com uma lista fechada de respostas, e o gestor
escolhe em um clique. Vocabulário controlado no lugar do modelo — é o que troca a IA aqui.

> Por que a campanha ficou parada nesta semana?
> `Verba do mês encerrada` · `Pausa pedida pelo cliente` · `Pausa técnica para troca de
> criativo/página` · `Cobrança do anúncio recusada` · `Conta de anúncio em revisão pela
> plataforma` · `Agenda de obra cheia — pausa combinada` · `Contrato em renovação`

Escolhida a resposta, o bloco fecha sozinho — inclusive a data de retomada, quando ela é
dedutível da opção (verba do mês encerrada ⇒ volta no dia 1º do ciclo seguinte).

**Compromisso futuro não é fato passado.** O que a agência vai fazer e quando é protocolo
do cenário mais data real calculada a partir do domingo que fecha a semana. Por isso o
"Próximo passo" fecha sem ninguém digitar, mesmo com `mb_optimizations` vazia — o gargalo
que a Fase 3 declarava. Quando há otimização registrada, ela entra no lugar do protocolo.

### Quanto sai publicável sozinho

Semana de 17 a 23/08, os 44 clientes:

| | |
|---|---|
| Publicáveis direto, sem ninguém digitar | **33** |
| Esperando **uma** resposta de lista (todos cenário F, campanha parada) | **11** — e as 11 fecham |
| Blocos com número fora do contrato | **0** |
| Blocos com palavra do léxico proibido | **0** |
| Blocos sem data no "Próximo passo" | **0** |

Na semana de 10 a 16/08 são 15 pendentes, pela mesma razão: 15 clientes sem veiculação.


---

## 01/09 — corrigir número, e mandar para o CS

Duas coisas entraram numa tela cuja regra era **"nenhum número nasce aqui"**.
As duas são exceções declaradas, e cada uma tem um teste que a segura.

### Corrigir número quando o banco está errado

O botão **Corrigir números**, no cartão do cliente, abre a lista do que dá para
consertar: investimento e leads por plataforma, agendamento da semana, o mês
inteiro, a meta (e a **origem** dela), a semana anterior e o cenário.

O caso que obrigou isso a existir já está na pesquisa: **#526 GTF tem
`account_id_meta` cadastrado e nunca teve uma linha em `ad_insights`** — 23
agendamentos de mídia em agosto e "sem investimento no período" no bloco. O
banco está errado, e mandar o erro para o cliente é pior do que corrigir à mão.

O que a correção faz:

| | |
|---|---|
| Refaz o que é derivado | CPL **por soma** (nunca média de coluna), totais, variação contra a semana anterior, ritmo contra o benchmark |
| Cria a plataforma que não existe | é o caso do investimento que nunca chegou ao banco |
| Reescreve o texto na hora | se a régua escreveu, reescreve sozinho; se **você** escreveu, ela não sobrescreve — avisa |
| Exige motivo | sem motivo não salva. O motivo vai para o CS e para o CSV, nunca para o cliente |
| Aparece em todo lugar | `✎` no número, `≠` na lista, chip no cartão, contador na faixa, bloco na prévia do envio |

O que ela **não** faz, de propósito:

- **não escreve no Supabase.** O cadastro continua errado. É por isso que a
  prévia do envio tem **Baixar CSV para corrigir o cadastro**: sem alguém
  arrumar a origem, a mesma correção volta na semana seguinte;
- **não desbloqueia bloco bloqueado** (D6 e falta de gestor continuam valendo);
- **não reclassifica o cenário sozinha.** A régua de classificação mora no
  contrato, não na tela — então o cenário está lá na lista, para você escolher.

A guarda que importa é a última: corrigir o número do cabeçalho e deixar o
parágrafo citando o antigo seria **exatamente** o defeito que originou o
projeto. O checklist ganhou um item que procura cada número de antes da
correção dentro do texto, e o cartão abre um alerta vermelho quando acha.

### Enviar para CS

O botão **Enviar para CS** (na barra e no rodapé da prévia) manda o touchpoint
para a **conversa privada** de uma das duas CS no ClickUp:

| CS | conversa |
|---|---|
| Eduarda Zancanella | `8cdt0k7-22714` |
| Amanda Blaszczyk | `8cdt0k7-24774` |

Dá para mandar a semana toda ou só o cliente aberto, para uma CS ou para as
duas. É uma mensagem por gestor, igual ao canal — o mesmo texto que o cliente
recebe, com duas diferenças que só existem no destino interno:

1. o cabeçalho diz `🔒 Touchpoints` e nomeia a CS, para não virar mais uma
   mensagem sem remetente claro na caixa de entrada dela;
2. o cliente que teve número corrigido vem com a **nota interna** — o de→para
   e o motivo. No canal do cliente essa nota não existe.

**Quem resolve o id da conversa é o node Config do workflow**, nunca a tela: a
tela é uma página pública, e um id de conversa privada no bundle é um convite a
mandar o touchpoint para a pessoa errada. A tela manda `cs: "eduarda"`.

⚠️ **A mensagem chega pela conta que assina o `CLICKUP_TOKEN` do n8n — hoje a do
Patrick.** Para a CS, é um DM do Patrick. Trocar o token exige refazer os dois
ids de conversa (`CS_DESTINOS`, em `n8n/build.py`), porque um DM é entre duas
pessoas específicas.

O envio ao CS **não conta como semana publicada**: são registros separados, e a
barra mostra os dois. Ele tem freio de mão próprio (`envio_cs_liberado`), então
dá para derrubar o envio ao cliente sem derrubar o interno, e vice-versa.

### A trava que impede o pior cenário desta mudança

Se a tela nova subir e o workflow **não**, o n8n antigo ignora `destino` e cai
no canal padrão — que é o do cliente — com o `confirmar: true` junto. Seria uma
cópia interna publicada para o cliente.

Por isso `enviarParaCS` faz um dry-run antes e só continua se a resposta voltar
com `destino: "cs"`, o nome da CS e um `channel_id` resolvido. Workflow antigo
não devolve nada disso, e a tela recusa o envio dizendo qual comando falta.

---

## Como funciona

```
navegador  ──POST──▶  n8n mb-touchpoint-week     ──GET──▶  Supabase (só leitura)
                            │ calcula o contrato 7.3
                            ▼
                      44 blocos com número real
                            │
           ──POST──▶  n8n mb-touchpoint-redacao   (redacao.js — sem rede)
                            │ escreve 3 campos + devolve as lacunas
                            ▼
           ──POST──▶  n8n mb-touchpoint-envio    ──────▶  ClickUp  ✋ TRAVADO
                            │ monta a mensagem do canal
                            ▼  devolve a prévia, não publica
```

O rascunho fica no `localStorage` do navegador, junto com as respostas das lacunas.
**Não** vai para o Supabase — a tabela `mb_touchpoints` não existe, e criá-la é decisão
sua (`../APLICAR.md`, passo 3).

---

## O cálculo é o mesmo — e isso foi medido

`fn_mb_touchpoint_week` não está aplicada. Em vez de esperar, portei a função para JS
(`src/contrato.js`) e rodo no Code node, lendo pelo PostgREST. Comparado contra
`fase1/ref_contract.py`, a implementação de referência que já tinha passado no aceite
contra os blocos publicados no ClickUp:

| Semana | Clientes | Campos comparados | Resultado |
|---|---|---|---|
| 10–16/08/2026 | 44 | 16 | **44/44 idênticos** |
| 17–23/08/2026 | 44 | 16 | **44/44 idênticos** |

**Onde o porte segue o SQL e não o Python:** o casamento de nicho. `ref_contract.py` tem
um `NICHE_ALIAS` (`cabinets`→`Cabinets`) que o SQL não tem — o SQL casa por
`lower(btrim(...))` exato. O porte faz o que o SQL faz. Nas duas semanas testadas isso não
produziu diferença.

---

## O que aplicar, na ordem

### 1. Publicar os workflows no n8n

```bash
cd n8n
python build.py                       # só gera os .json
python build.py --publicar            # cria/atualiza e ativa os 3
python build.py --publicar --com-ia   # idem + a rota de reserva que gasta API
```

`build.py` monta os JSON a partir de `src/contrato.js` e `src/redacao.js` (as fontes
únicas), cria ou atualiza por nome e ativa. Rodar de novo é idempotente.

| Workflow | id | Path | Estado |
|---|---|---|---|
| MB TouchPoint — semana (live, somente leitura) | `JRzjbVbWGdgX6CcG` | `mb-touchpoint-week` | ✅ 200, 44/44 |
| MB TouchPoint — redação (live) | `5lbJMgNZ9tj0gigY` | `mb-touchpoint-redacao` | ⚠️ **precisa republicar** — os nós mudaram |
| MB TouchPoint — envio ao ClickUp (live) | `svVZhxutLSPXxDpJ` | `mb-touchpoint-envio` | ⚠️ **precisa republicar** — ganhou o destino `cs` |
| MB TouchPoint — redação por IA (live, reserva) | — | `mb-touchpoint-redacao-ia` | gravado em disco, **não publicado** |

A redação mantém **nome e path**, então republicar atualiza o workflow que já existe e a
tela não muda de endereço. O que sai são os nós `Montar prompt` e `Anthropic`; o que entra
é um Code node `Redigir`. O node `Config` perde a `anthropic_key` — sobra só o token.

A versão com a Messages API continua montada, num path próprio, para o dia em que houver
saldo e você quiser comparar os dois textos lado a lado. Ela **não** sobe com `--publicar`
sozinho: precisa de `--com-ia`, de propósito.

### 2. Abrir a tela

**No ar:** https://team-ruche.github.io/touchpoints/ — GitHub Pages, servindo os mesmos
dois arquivos desta pasta (no repo eles moram em `docs/`, que é o único subdiretório que o
Pages serve a partir do branch principal). Na primeira abertura ela pede o token dos
webhooks, que fica no `localStorage` do navegador; sem ele a página carrega e não lê nada.

**Local**, se preferir:

```bash
cd app
python -m http.server 8080
# abre http://localhost:8080
```

A pasta é estática (dois arquivos, sem build) — serve em qualquer lugar. O botão
**Ajustes** troca a base dos webhooks e o token sem republicar nada.

### 3. Testar

1. Navegue até a semana **17–23/08** — é a que tem gabarito conferido.
2. Confira que dão **44 clientes**, 12 verdes / 17 amarelos / 7 laranjas / 8 vermelhos.
3. Clique em **Escrever a semana toda**. Devem sair 33 blocos fechados e 11 esperando uma
   resposta.
4. Abra um dos 11, escolha o motivo da pausa na lista e veja o texto fechar sozinho.
5. Busque `202`, depois `#202`, depois `flooring` — os três acham a mesma linha.
6. Filtre por cenário `F` e por gestor ao mesmo tempo: é interseção, não união.
7. Escolha uma data qualquer no calendário — cai na segunda daquela semana.
8. Clique em **Revisar e enviar** e leia a mensagem exata. Publicar é o botão do rodapé, e
   ele pede confirmação digitada.

---

## O que os testes cobrem

```bash
cd src
node testar_redacao.mjs            # a redação nos 88 blocos das 2 semanas
node testar_redacao.mjs --amostra  # imprime um texto por cenário
node simular_redacao.mjs 2026-08-17  # roda o Code node GERADO, sem Intl no escopo
node testar_app.mjs                # a mensagem final, montada, nos 44 clientes
node testar_filtros.mjs            # busca, calendário, filtros e registro de envio
node testar_correcao.mjs         # correção de número e o envio para a CS
node validar.mjs 2026-08-17 ../gabarito_2026-08-17.json   # o contrato vs. o Python
node simular_n8n.mjs 2026-08-17 ../gabarito_2026-08-17.json
node testar_webhooks.mjs 2026-08-17 ../gabarito_2026-08-17.json  # ponta a ponta
```

`testar_redacao.mjs` é o que garante que a semana sai publicável de graça. Nos 88 blocos:

- **zero** palavra do léxico da 8.7;
- **zero** "Próximo passo" sem data;
- **zero** número que não esteja no contrato — cada número do texto é procurado dentro do
  payload, e os poucos que são conta (custo por agendamento, quanto falta no mês) estão
  declarados com a fórmula no próprio teste. É a versão automatizável do achado que
  originou o projeto: um redator que só pode escrever números que existem no contrato não
  consegue repetir o "Appointments Booked";
- marcador só em F (e em D quando o funil não sustenta uma causa) — e **toda** opção do
  vocabulário, não só a primeira, tem de fechar o bloco sem violar nada.

`simular_redacao.mjs` roda o código que o `build.py` colou dentro do JSON — não o fonte —
com `Intl` e `URLSearchParams` **apagados do escopo**. As duas ausências já derrubaram um
deploy: a simulação passava no Node local e o workflow quebrava no ar.

`testar_webhooks.mjs` confere, além do contrato: o preflight de CORS, que o webhook sem
token é recusado, que uma `week_start` que não é segunda é recusada, que o envio devolve
prévia quando falta `confirmar`, e que um bloco com `[…]` é barrado no servidor.

`testar_correcao.mjs` cobre as duas exceções novas. As três asserções que
importam: o número corrigido chega à mensagem final **e** ao texto da régua; a
nota interna aparece no DM da CS e **não** aparece no bloco do canal; e o Code
node gerado resolve `cs: "eduarda"` para uma conversa que **não** é o canal do
cliente — recusando CS desconhecida, marcador `[…]` e envio sem `confirmar`.

`testar_filtros.mjs` exercita busca, calendário, filtros, estado do bloco e o registro de
envio contra os 44 clientes reais — inclusive a regra que mais importa ali: **o filtro da
tela não pode mexer no que vai ser enviado.** Filtrar é para revisar; enviar é sobre a
semana inteira. Se o filtro mandasse no envio, uma busca esquecida na caixa faria um
cliente sumir do envio sem ninguém perceber.

`testar_app.mjs` já achou **um bug real** no `model.ts` da Fase 4 — a linha do acumulado
do mês escrevia "de N contratados" também para quem não tem meta contratada, o que
atingiria 17 dos 44 blocos desta semana. Corrigido aqui; o diff para o dashboard está em
`PATCH-model-ts.md` e precisa entrar antes de a tela ir para o Ruche OS.

## O envio real — liberado em 30/08, e o que ficou no lugar do cadeado

O passo final publica no canal `8cdt0k7-57414` (**Touchpoints**), que é o canal real dos
clientes. Até 30/08 ele estava travado por dois cadeados de máquina. Agora publica.

O cadeado de servidor (`envio_real_liberado`) existia porque o outro (`confirmar: true`)
viaja no navegador e podia ser mandado por engano. Ele não sumiu — **virou humano**:

1. **A prévia continua sendo o caminho.** "Revisar e enviar" pede o dry-run de cada gestor
   e mostra a mensagem inteira. Publicar é um segundo botão, no rodapé daquele diálogo.
2. **Confirmação digitada.** O diálogo de publicar mostra o canal, os gestores e quantos
   clientes vão, e só habilita o botão depois de alguém digitar `PUBLICAR`.
3. **Registro de "já publiquei".** A tela grava o que foi publicado por semana e por
   gestor, mostra isso na barra e **grita** no diálogo se você for reenviar. Existe porque
   a pesquisa achou reenvio do mesmo bloco em **6 das 16 semanas** do canal — é o erro mais
   comum aqui, e o único que o cliente enxerga.
4. **Canal de ensaio.** Em **Ajustes**, um id de canal opcional. Com ele preenchido, o
   diálogo de publicar nasce marcado para o ensaio: a mensagem sai de verdade, mas naquele
   canal. É onde dá para apertar o botão inteiro sem cliente vendo — e o ensaio **não**
   conta como semana publicada.

O servidor continua recusando qualquer bloco que contenha `[…]`: a tela já barra, mas o
servidor não confia na tela.

**Freio de mão:** trocar `envio_real_liberado` para `False` em `build.py` e republicar
derruba o envio na hora, sem mexer na tela.

⚠️ **O que isso muda no risco.** Com o envio liberado, quem tiver a URL da tela **e** o
token consegue publicar no canal dos clientes. O token não está no bundle (fica no
`localStorage` de quem digitou), mas ele passou a ser a única barreira de máquina. Trocar
é um comando: novo `TP_TOKEN` no `config.env` → `python n8n/build.py --publicar` → colar o
novo em Ajustes.

### Uma coisa que nunca rodou até 30/08

O node que chama o ClickUp estava atrás dos dois cadeados desde que foi escrito — ou seja,
**nunca tinha executado**. Ao destravar, a conferência contra a documentação da API v3
achou o motivo pelo qual o primeiro envio de verdade teria falhado: o corpo exige `type`
(`"message"` ou `"post"`), e o workflow mandava só `content` e `content_format`.
Corrigido. O que foi verificado de fato, só lendo: o token responde, o workspace
`9007039079` existe, o canal `8cdt0k7-57414` é o **Touchpoints** e dá para ler as
mensagens dele. **O POST em si continua sem ter rodado** — é para isso que serve o canal
de ensaio: crie um canal qualquer no ClickUp, cole o id em Ajustes e publique nele uma vez
antes de publicar valendo.

---

## O que esta banca **não** é

- **Não grava rascunho no banco.** `localStorage`, por navegador. Trocou de máquina,
  perdeu — use **Exportar rascunhos**. Quando `mb_touchpoints` existir, isso vira
  `fn_mb_touchpoint_save`.
- **Não tem controle de acesso.** A tela do Ruche OS gateia em
  `mb_touchpoint_can_operate()`; aqui não há login. Os webhooks têm um token
  compartilhado, que **viaja no bundle da página**.
- **Não registra envio.** Sem `mb_touchpoints`, publicar não deixa rastro além do próprio
  ClickUp. É mais uma razão para o envio real ficar travado.
- **Não renderiza Google/GLSA** (D6). Quem investe fora do Meta continua ficando vermelho
  em vez de receber "sem veiculação".
- **Não escreve como um humano escreveria.** Ver a tabela lá em cima: a estrutura repete
  dentro do mesmo cenário. Se isso incomodar mais do que o custo, `--com-ia` traz a
  Messages API de volta em um comando.

## Onde os segredos moram

O node **Config** de cada workflow carrega a chave em texto — o mesmo padrão do
`BD - [RucheOS] HP Dial Webhook`, que já roda em produção. Quem abre o n8n lê a
`service_role` do Supabase e o token do ClickUp. Com a redação fora da API, a chave da
Anthropic **saiu** do workflow padrão: ela só aparece na rota de reserva.

Isso é aceitável para uma banca de teste porque o n8n já é essa fronteira de confiança,
mas **não é o que deve ir para produção**: quando a tela entrar no dashboard, a leitura
passa a ser `POST /rpc/fn_mb_touchpoint_week` com o JWT do usuário logado.

⚠️ Os JSON gerados em `n8n/` carregam essas chaves em texto. **Não versione essa pasta.**

---

## Arquivos

```
live/
  README.md              este arquivo
  PATCH-model-ts.md      bug achado no model.ts da Fase 4 + o diff
  creds.py               lê as credenciais do handover e do config.env
  gabarito.py            roda ref_contract.py e grava o gabarito
  src/contrato.js        porte de fn_mb_touchpoint_week — fonte única do cálculo
  src/redacao.js         a redação sem IA — fonte única do texto
  src/validar.mjs        roda o porte e faz o diff contra o gabarito do Python
  src/simular_n8n.mjs    roda o Code node GERADO do contrato
  src/simular_redacao.mjs  roda o Code node GERADO da redação, sem Intl no escopo
  src/testar_redacao.mjs   léxico, prazo, números, lacunas e determinismo
  src/testar_app.mjs     exercita a mensagem final nos 44 clientes, sem navegador
  src/testar_webhooks.mjs  ponta a ponta nos webhooks publicados
  n8n/build.py           monta e publica os workflows        ⚠️ gera JSON com chave
  src/testar_filtros.mjs   busca, calendário, filtros, registro de envio
  src/testar_correcao.mjs  correção de número, nota interna e o Code node do envio
  app/index.html         a tela
  app/app.js             estado, régua dos cenários, léxico, mensagem final
```

`src/contrato.js` e `src/redacao.js` são as fontes únicas: `build.py` cola cada um dentro
do seu Code node. Se precisar mexer no cálculo ou no texto, mexa no arquivo e rode
`build.py` de novo — editar o JSON do workflow cria a segunda versão que a gente não quer.
