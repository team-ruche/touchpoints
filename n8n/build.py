# -*- coding: utf-8 -*-
"""
build.py — monta os 3 workflows do n8n do TouchPoint ao vivo.

    python build.py                 # só gera os .json em live/n8n/
    python build.py --publicar      # gera E cria/atualiza no n8n, e ativa
    python build.py --publicar --com-ia   # idem, incluindo a rota de reserva que gasta API

O código do contrato NÃO é digitado aqui: ele é lido de live/src/contrato.js,
que é o mesmo arquivo validado contra ref_contract.py (44/44 clientes em duas
semanas). Assim não existe uma "segunda versão" do cálculo para divergir.

Nada aqui toca o banco do Ruche OS. As três automações são de LEITURA, com uma
exceção declarada: o envio ao ClickUp, que nasce travado por dois cadeados.
"""
import io
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.dirname(AQUI)
RAIZ = os.path.dirname(os.path.dirname(LIVE))

sys.path.insert(0, os.path.join(RAIZ, "touchpoint-generator", "live"))

# --------------------------------------------------------------------------
# credenciais: lidas dos arquivos que já existem no workspace, nunca digitadas
# --------------------------------------------------------------------------
HANDOVER = os.path.join(RAIZ, "stripe-conciliacao", "HANDOVER_RUCHE_OS.md")
CONFIG_ENV = os.path.join(RAIZ, "config.env")
N8N_SRC = os.path.join(RAIZ, "n8n-backups", "update_workflows.py")

# Dentro do workspace da Ruche esses três arquivos existem e nada precisa ser
# digitado. Fora dele (um clone solto do repo) eles não existem — aí cada
# credencial vem de variável de ambiente. Em nenhum dos dois casos ela é
# escrita neste arquivo, que é versionado.
def _ler(caminho):
    try:
        return io.open(caminho, encoding="utf-8").read()
    except OSError:
        return ""


_h = _ler(HANDOVER)
_c = _ler(CONFIG_ENV)
_n = _ler(N8N_SRC)


def _tabela(rotulo, var):
    m = re.search(r"\|\s*" + re.escape(rotulo) + r"\s*\|\s*`([^`]+)`", _h)
    return m.group(1) if m else os.environ.get(var)


def _env(k):
    m = re.search(r"^%s=(.+)$" % re.escape(k), _c, re.M)
    return m.group(1).strip() if m else os.environ.get(k)


SUPABASE_URL = "https://api.ruchedigital.com"
SUPABASE_KEY = _tabela("SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY")
ANTHROPIC_KEY = _env("ANTHROPIC_API_KEY")
CLICKUP_TOKEN = _env("CLICKUP_TOKEN")
CLICKUP_CANAL = _env("CLICKUP_CHANNEL_ID")
_m = re.search(r'API_KEY\s*=\s*"([^"]+)"', _n)
N8N_KEY = _m.group(1) if _m else os.environ.get("N8N_API_KEY")
N8N_BASE = "https://workflows.ruchedigital.online/api/v1"

# Token compartilhado entre a tela e os webhooks. Não é autenticação de
# verdade — é o que separa os webhooks de um endpoint aberto que devolve o
# investimento e os leads de todos os clientes. Mora no config.env (ou em
# TP_TOKEN), nunca neste arquivo: ele é versionado. Trocar é barato: gere
# outro, rode build.py de novo e cole em Ajustes na tela.
TOKEN = _env("TP_TOKEN")
if not TOKEN:
    raise SystemExit(
        "sem TP_TOKEN: ponha `TP_TOKEN=...` no config.env ou exporte a variável. "
        "Qualquer string serve — ela só precisa ser a mesma na tela (Ajustes)."
    )

WEBHOOK_BASE = "https://webhook.ruchedigital.online/webhook"

# --------------------------------------------------------------------------
# o contrato, lido do arquivo validado
# --------------------------------------------------------------------------
CONTRATO_JS = io.open(os.path.join(LIVE, "src", "contrato.js"), encoding="utf-8").read()
# O Code node do n8n não é um módulo ESM: tira os `export ` e mantém o resto.
CONTRATO_INLINE = re.sub(r"^export\s+", "", CONTRATO_JS, flags=re.M)

# A redação sem modelo de linguagem. Mesmo tratamento: fonte única em
# live/src/redacao.js, testada por live/src/testar_redacao.mjs (88 blocos,
# léxico limpo, prazo em todos, zero número fora do contrato).
REDACAO_JS = io.open(os.path.join(LIVE, "src", "redacao.js"), encoding="utf-8").read()
REDACAO_INLINE = re.sub(r"^export\s+", "", REDACAO_JS, flags=re.M)


def node(nome, tipo, tv, params, pos, **extra):
    d = {
        "parameters": params,
        "id": nome.lower().replace(" ", "-").replace("ç", "c").replace("ã", "a"),
        "name": nome,
        "type": tipo,
        "typeVersion": tv,
        "position": pos,
    }
    d.update(extra)
    return d


def webhook(path, pos=(0, 0)):
    """Webhook com CORS liberado — a tela roda no navegador, em outro domínio.
    O mesmo `allowedOrigins: *` que o BD - CLAUD.IA já usa em produção."""
    return node(
        "Webhook",
        "n8n-nodes-base.webhook",
        2,
        {
            "httpMethod": "POST",
            "path": path,
            "responseMode": "responseNode",
            "options": {"allowedOrigins": "*"},
        },
        list(pos),
        webhookId=path,
    )


def config(pares, pos):
    return node(
        "Config",
        "n8n-nodes-base.set",
        3.4,
        {
            "assignments": {
                "assignments": [
                    {
                        "id": str(i),
                        "name": k,
                        "value": v,
                        "type": "boolean" if isinstance(v, bool) else "string",
                    }
                    for i, (k, v) in enumerate(pares.items())
                ]
            },
            "includeOtherFields": False,
            "options": {},
        },
        list(pos),
    )


def responder(pos, nome="Responder"):
    return node(
        nome,
        "n8n-nodes-base.respondToWebhook",
        1,
        {"respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}", "options": {}},
        list(pos),
    )


def liga(*nomes):
    c = {}
    for a, b in zip(nomes, nomes[1:]):
        c[a] = {"main": [[{"node": b, "type": "main", "index": 0}]]}
    return c


GUARDA_TOKEN = """
// Cadeado do webhook. Não é autenticação forte — o token viaja no bundle da
// tela. Serve para que um endpoint público não vire torneira de crédito.
const cfg = $('Config').first().json;
const wh  = $('Webhook').first().json;
const body = wh.body || {};
const enviado = (wh.headers && (wh.headers['x-tp-token'] || wh.headers['X-TP-Token'])) || body.token;
if (cfg.token && enviado !== cfg.token) {
  throw new Error('token inválido ou ausente (header x-tp-token)');
}
"""

# ==========================================================================
# 1. mb-touchpoint-week — o contrato da semana, somente leitura
# ==========================================================================

CODE_SEMANA = (
    GUARDA_TOKEN
    + """
// ─────────────────────────────────────────────────────────────────────────
// Porte de fn_mb_touchpoint_week. Colado de live/src/contrato.js — validado
// contra ref_contract.py: 44/44 clientes idênticos em 16 campos, nas semanas
// de 10/08 e 17/08. Se precisar mexer, mexa no arquivo e rode build.py de
// novo; editar aqui cria a segunda versão que a gente não quer.
// ─────────────────────────────────────────────────────────────────────────
"""
    + CONTRATO_INLINE
    + """

/* ───────────────────────────── execução ───────────────────────────── */

const H = { apikey: cfg.supabase_key, Authorization: 'Bearer ' + cfg.supabase_key,
            Accept: 'application/json' };

// O nome do helper de HTTP mudou de lugar entre versões do n8n, e o Code node
// não deixa testar isso sem rodar. Em vez de apostar numa forma, tenta as três
// e guarda a que funcionou — assim um upgrade do n8n não derruba a banca.
let _http = null;
async function http(url) {
  const req = { method: 'GET', url, headers: H, json: true };
  if (_http) return _http(req);
  const tentativas = [
    ['$helpers.httpRequest',     () => typeof $helpers !== 'undefined' && $helpers && $helpers.httpRequest
                                        ? $helpers.httpRequest.bind($helpers) : null],
    ['this.helpers.httpRequest', () => (typeof this !== 'undefined' && this && this.helpers && this.helpers.httpRequest)
                                        ? this.helpers.httpRequest.bind(this.helpers) : null],
    ['fetch',                    () => typeof fetch === 'function'
                                        ? async (o) => {
                                            const r = await fetch(o.url, { headers: o.headers });
                                            if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
                                            return r.json();
                                          }
                                        : null],
  ];
  const erros = [];
  for (const [nome, pegar] of tentativas) {
    let fn = null;
    try { fn = pegar(); } catch (e) { erros.push(nome + ': ' + e.message); continue; }
    if (!fn) { erros.push(nome + ': indisponível'); continue; }
    try {
      const r = await fn(req);
      _http = fn;
      return r;
    } catch (e) {
      // Erro do Supabase (404, 401) não é "helper ausente" — não adianta trocar.
      if (/\\b(400|401|403|404|409|5\\d\\d)\\b/.test(String(e.message || ''))) throw e;
      erros.push(nome + ': ' + String(e.message || e).slice(0, 120));
    }
  }
  throw new Error('nenhum cliente HTTP disponível no Code node — ' + erros.join(' | '));
}

const semana = body.week_start;
if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(semana || ''))) {
  throw new Error('week_start ausente ou fora do formato YYYY-MM-DD');
}
// A semana do contrato começa na SEGUNDA. Aceitar outro dia geraria um bloco
// silenciosamente deslocado — o tipo de erro que ninguém vê no texto final.
if (new Date(semana + 'T00:00:00Z').getUTCDay() !== 1) {
  throw new Error('week_start tem de ser uma segunda-feira: ' + semana);
}

const params = {
  week_start: semana,
  tz: body.tz || 'America/New_York',
  gestor: body.gestor || null,
  client_ids: Array.isArray(body.client_ids) ? body.client_ids : null,
  render_platforms: Array.isArray(body.render_platforms) && body.render_platforms.length
    ? body.render_platforms : ['meta'],
};

const t0 = Date.now();
const dados = await carregar(http, cfg.supabase_url, H, params);
const linhas = construir(dados, params);

return [{ json: {
  ok: true,
  week_start: semana,
  gerado_em: new Date().toISOString(),
  motor: 'n8n mb-touchpoint-week',
  leitura: {
    clientes: dados.clients.length,
    ad_insights: dados.insights.length,
    agendamentos: dados.appts.length,
    otimizacoes: dados.opts.length,
    ms: Date.now() - t0,
  },
  total: linhas.length,
  linhas,
} }];
"""
)

WF_SEMANA = {
    "name": "MB TouchPoint — semana (live, somente leitura)",
    "settings": {"executionOrder": "v1", "saveManualExecutions": True},
    "nodes": [
        webhook("mb-touchpoint-week", (-260, 0)),
        config(
            {"supabase_url": SUPABASE_URL, "supabase_key": SUPABASE_KEY, "token": TOKEN},
            (-40, 0),
        ),
        node("Contrato", "n8n-nodes-base.code", 2, {"jsCode": CODE_SEMANA}, [180, 0]),
        responder((400, 0)),
    ],
    "connections": liga("Webhook", "Config", "Contrato", "Responder"),
}

# ==========================================================================
# 2. mb-touchpoint-redacao — a redação, SEM modelo de linguagem
#
# Este é o caminho padrão desde 30/08/2026. A régua dos cenários A–H virou
# tabela e template em live/src/redacao.js; o custo por semana caiu de
# ~$0,50 para zero e o texto deixou de depender de saldo em conta.
#
# O que a máquina NÃO escreve continua não sendo escrito: o motivo de uma
# pausa não está em tabela nenhuma, então vira LACUNA — uma pergunta de
# lista fechada que o gestor responde em um clique na tela.
#
# A versão que chama a Anthropic continua montada (WF_REDACAO_IA, mais
# abaixo), num path próprio e sem publicar por padrão.
# ==========================================================================

CODE_REDACAO = (
    GUARDA_TOKEN
    + """
// ─────────────────────────────────────────────────────────────────────────
// Colado de live/src/redacao.js. Mexer aqui cria a segunda versão que a
// gente não quer: mexa no arquivo e rode build.py de novo.
// NENHUM global de Node é usado (sem Intl, sem toLocaleString) — o sandbox
// do task-runner já derrubou um deploy por causa disso.
// ─────────────────────────────────────────────────────────────────────────
"""
    + REDACAO_INLINE
    + """

/* ───────────────────────────── execução ───────────────────────────── */

const c = body.contrato;
if (!c) throw new Error('payload sem "contrato"');

// `escolhas` são as respostas das lacunas, vindas da tela. Lista fechada:
// qualquer valor fora do vocabulário é ignorado em silêncio pelo redator
// (cai de volta no marcador), então não há como injetar texto por aqui.
const escolhas = body.escolhas || {};

const out = redigir(c, escolhas);
return [{ json: out }];
"""
)

WF_REDACAO = {
    "name": "MB TouchPoint — redação (live)",
    "settings": {"executionOrder": "v1", "saveManualExecutions": True},
    "nodes": [
        webhook("mb-touchpoint-redacao", (-260, 0)),
        config({"token": TOKEN}, (-40, 0)),
        node("Redigir", "n8n-nodes-base.code", 2, {"jsCode": CODE_REDACAO}, [180, 0]),
        responder((400, 0)),
    ],
    "connections": liga("Webhook", "Config", "Redigir", "Responder"),
}

# ==========================================================================
# 2b. mb-touchpoint-redacao-ia — a versão com a Messages API (reserva)
#
# Fica montada e gravada em disco, mas NÃO é publicada por `--publicar`:
# use `--com-ia` se algum dia houver saldo e você quiser comparar os dois
# textos lado a lado. O path é outro de propósito — a tela continua
# apontando para `mb-touchpoint-redacao`.
# ==========================================================================

FASE3 = json.load(
    io.open(os.path.join(LIVE, "..", "fase3", "n8n", "mb-touchpoint-redacao.json"), encoding="utf-8")
)
_montar = next(n for n in FASE3["nodes"] if n["name"] == "Montar prompt")["parameters"]["jsCode"]
_validar = next(n for n in FASE3["nodes"] if n["name"] == "Validar")["parameters"]["jsCode"]

# O node da Fase 3 lia `$json.body`; agora vem depois do Config, então o corpo
# tem de ser buscado no Webhook. Uma linha, e a régua toda continua a mesma.
# A chave da Anthropic: o handover diz que `ANTHROPIC_API_KEY` está setada nos 3
# services do n8n, e a do config.env respondeu "credit balance is too low".
# Prefere a do ambiente e cai para a do Config. Mora no Code node porque só ele
# tem try/catch — com `N8N_BLOCK_ENV_ACCESS_IN_NODE` ligado, ler $env lança.
_CHAVE = """
// ── qual chave da Anthropic usar ──────────────────────────────────────────
let _key = null, _origem = 'config.env';
try {
  if (typeof $env !== 'undefined' && $env && $env.ANTHROPIC_API_KEY) {
    _key = $env.ANTHROPIC_API_KEY;
    _origem = 'env do n8n';
  }
} catch (e) { /* acesso a $env bloqueado: segue com a do Config */ }
if (!_key) { _key = cfg.anthropic_key; _origem = 'config.env'; }
if (!_key) throw new Error('sem chave da Anthropic: nem $env.ANTHROPIC_API_KEY nem o node Config');
"""

_montar_live = (
    GUARDA_TOKEN
    + _CHAVE
    + "\n"
    + _montar.replace(
        "const body = $json.body || $json;",
        "// (corpo vem do Webhook: o Config está no meio do caminho)",
    )
)

# O node da Fase 3 é a régua revisada — não quero reescrevê-lo. Só capturo o
# retorno dele para acrescentar a chave escolhida ao item.
_ANTES, _DEPOIS = "\nreturn [{\n  json: {\n    cliente:", "\nconst _out = {\n  json: {\n    cliente:"
if _ANTES not in _montar_live:
    raise SystemExit("o `return` final de 'Montar prompt' mudou — ajuste o patch da chave")
_montar_live = _montar_live.replace(_ANTES, _DEPOIS, 1)
_FIM = "  }\n}];"
if not _montar_live.rstrip().endswith(_FIM):
    raise SystemExit("o fim de 'Montar prompt' mudou — ajuste o patch da chave")
_montar_live = _montar_live.rstrip()[: -len(_FIM)] + (
    "  }\n};\n_out.json._key = _key;\n_out.json._origem_key = _origem;\nreturn [_out];\n"
)

# Traduz o erro da API antes da guarda de saída da Fase 3. Sem isto o gestor vê
# "Workflow execution failed" e não tem como saber que o problema é saldo.
_ERRO_API = """
// ── o node da Anthropic deixou passar um erro em vez da resposta? ─────────
{
  const _r = $json || {};
  const _e = _r.error || (_r.body && _r.body.error) || null;
  if (_e || _r.status >= 400) {
    // O n8n embrulha o corpo do erro numa string tipo: 400 - "{...json...}".
    // Sem desembrulhar, o gestor lê barra invertida em vez de frase.
    let bruto = (_e && _e.message) || (typeof _e === 'string' ? _e : null) ||
                _r.message || 'a Anthropic recusou a requisição';
    let msg = String(bruto), tipo = (_e && _e.type) || null;
    const m = msg.match(/\\{[\\s\\S]*\\}/);
    if (m) {
      try {
        const dentro = JSON.parse(m[0].replace(/\\\\"/g, '"'));
        if (dentro && dentro.error) { msg = dentro.error.message || msg; tipo = dentro.error.type || tipo; }
      } catch (e) { /* fica com a string crua, que ainda diz o essencial */ }
    }
    let dica = null;
    if (/credit balance is too low/i.test(msg)) {
      dica = 'a conta da Anthropic está sem saldo — console.anthropic.com → Plans & Billing. ' +
             'A chave é válida e enxerga claude-opus-5; falta crédito.';
    } else if (/authentication|invalid x-api-key/i.test(msg)) {
      dica = 'chave recusada: confira anthropic_key no node Config (ou ANTHROPIC_API_KEY no n8n).';
    } else if (/rate_limit/i.test(msg)) {
      dica = 'limite de taxa: espere alguns segundos e gere de novo.';
    }
    return [{ json: { ok: false, erro: msg, tipo, dica,
                      cliente: ($('Montar prompt').first().json || {}).cliente || null } }];
  }
}
"""

WF_REDACAO_IA = {
    "name": "MB TouchPoint — redação por IA (live, reserva)",
    "settings": {"executionOrder": "v1", "saveManualExecutions": True},
    "nodes": [
        webhook("mb-touchpoint-redacao-ia", (-260, 0)),
        config({"token": TOKEN, "anthropic_key": ANTHROPIC_KEY}, (-40, 0)),
        node("Montar prompt", "n8n-nodes-base.code", 2, {"jsCode": _montar_live}, [180, 0]),
        node(
            "Anthropic",
            "n8n-nodes-base.httpRequest",
            4.2,
            {
                "method": "POST",
                "url": "https://api.anthropic.com/v1/messages",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "content-type", "value": "application/json"},
                        {"name": "anthropic-version", "value": "2023-06-01"},
                        # fallbacks: 'default' exige este beta. Sem ele, uma
                        # recusa do classificador vira erro em vez de rota.
                        {"name": "anthropic-beta", "value": "server-side-fallback-2026-07-01"},
                        # a escolha da chave é feita no Code node (ver _CHAVE)
                        {"name": "x-api-key", "value": "={{ $json._key }}"},
                    ]
                },
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify($json.req) }}",
                "options": {"timeout": 180000},
            },
            [400, 0],
            # Sem isto, um 400 da Anthropic vira "Workflow execution failed" na
            # tela — opaco. Deixando o corpo do erro passar, o Validar traduz.
            onError="continueRegularOutput",
            alwaysOutputData=True,
        ),
        node("Validar", "n8n-nodes-base.code", 2, {"jsCode": _ERRO_API + _validar}, [620, 0]),
        responder((840, 0)),
    ],
    "connections": liga("Webhook", "Config", "Montar prompt", "Anthropic", "Validar", "Responder"),
}

# ==========================================================================
# 3. mb-touchpoint-envio — monta a mensagem do canal. DRY-RUN por padrão.
# ==========================================================================

CODE_ENVIO = (
    GUARDA_TOKEN
    + """
// Monta UMA mensagem por gestor, no formato que o canal já usa há 16 semanas.
// Manter o formato é de propósito: quem lê não deve perceber troca de
// ferramenta, só que os números passaram a estar certos.
//
// DOIS CADEADOS antes de publicar de verdade:
//   1. o payload precisa trazer  confirmar: true
//   2. o Config precisa ter      envio_real_liberado: true   (hoje: false)
// Faltando qualquer um, o workflow devolve a prévia e NÃO chama o ClickUp.
// O segundo cadeado existe porque o primeiro viaja no navegador.

const blocos  = body.blocos || [];
const gestor  = body.gestor || 'Media Buyer';
const periodo = body.periodo;
const canal   = body.channel_id || cfg.clickup_canal;

if (!blocos.length) throw new Error('nada para enviar: blocos vazio');
if (!periodo)       throw new Error('payload sem "periodo"');
if (!canal)         throw new Error('sem channel_id e sem canal no Config');

for (const b of blocos) {
  if (!b.client_id || !b.cliente || !b.message_text) {
    throw new Error('bloco incompleto para ' + (b.cliente || '(sem nome)'));
  }
  // A tela já barra, mas o servidor não confia na tela: um `[MB: ...]` que
  // escapa vira uma pergunta interna publicada para o cliente.
  const resto = String(b.message_text).match(/\\[[^\\]]+\\]/g);
  if (resto) throw new Error('bloco de ' + b.cliente + ' ainda tem marcador: ' + resto[0]);
}

const partes = ['**@' + gestor + '**', '📋 **Weekly Touchpoints — ' + periodo + '**'];
for (const b of blocos) {
  partes.push('---');
  partes.push('**Cliente: ' + b.cliente + '**');
  partes.push(b.message_text);
}
const conteudo = partes.join('\\n\\n');

const liberado = cfg.envio_real_liberado === true || cfg.envio_real_liberado === 'true';
const pedido   = body.confirmar === true;
const publicar = liberado && pedido;

return [{ json: {
  ok: true,
  publicar,
  dry_run: !publicar,
  motivo_dry_run: publicar ? null
    : (!liberado ? 'envio_real_liberado=false no Config do workflow'
                 : 'payload sem confirmar:true'),
  gestor, periodo,
  week_start: body.week_start || null,
  channel_id: canal,
  clientes: blocos.length,
  client_ids: blocos.map(b => b.client_id),
  caracteres: conteudo.length,
  mensagem: conteudo,
  payload: { content: conteudo, content_format: 'text/md' },
} }];
"""
)

CODE_RESULTADO = """
// Só roda no ramo publicado. Devolve o id da mensagem para quem quiser
// registrar o envio depois — hoje ninguém registra: mb_touchpoints não existe
// no banco, e criá-la é decisão do Lucas.
const m = $('Montar bloco').first().json;
const r = $json || {};
return [{ json: {
  ok: true,
  publicar: true,
  dry_run: false,
  gestor: m.gestor,
  periodo: m.periodo,
  channel_id: m.channel_id,
  client_ids: m.client_ids,
  clickup_message_id: r.id || (r.data && r.data.id) || null,
  mensagem: m.mensagem,
  resposta_clickup: r,
} }];
"""

WF_ENVIO = {
    "name": "MB TouchPoint — envio ao ClickUp (live, dry-run)",
    "settings": {"executionOrder": "v1", "saveManualExecutions": True},
    "nodes": [
        webhook("mb-touchpoint-envio", (-320, 0)),
        config(
            {
                "token": TOKEN,
                "clickup_token": CLICKUP_TOKEN,
                "clickup_canal": CLICKUP_CANAL,
                # workspace RUCHE DIGITAL; canal 8cdt0k7-57414 = "Touchpoints"
                "clickup_workspace": "9007039079",
                # ── O CADEADO. Trocar para true só quando for publicar de verdade.
                "envio_real_liberado": False,
            },
            (-100, 0),
        ),
        node("Montar bloco", "n8n-nodes-base.code", 2, {"jsCode": CODE_ENVIO}, [120, 0]),
        node(
            "Publicar?",
            "n8n-nodes-base.if",
            2,
            {
                "conditions": {
                    "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                    "conditions": [
                        {
                            "id": "publicar",
                            "leftValue": "={{ $json.publicar }}",
                            "rightValue": True,
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                        }
                    ],
                    "combinator": "and",
                },
                "options": {},
            },
            [340, 0],
        ),
        node(
            "ClickUp",
            "n8n-nodes-base.httpRequest",
            4.2,
            {
                "method": "POST",
                "url": "=https://api.clickup.com/api/v3/workspaces/"
                       "{{ $('Config').first().json.clickup_workspace }}"
                       "/chat/channels/{{ $json.channel_id }}/messages",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "Authorization", "value": "={{ $('Config').first().json.clickup_token }}"},
                        {"name": "Content-Type", "value": "application/json"},
                    ]
                },
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify($json.payload) }}",
                "options": {"timeout": 60000},
            },
            [560, -110],
        ),
        node("Resultado", "n8n-nodes-base.code", 2, {"jsCode": CODE_RESULTADO}, [780, -110]),
        responder((1000, 0)),
    ],
    "connections": {
        "Webhook": {"main": [[{"node": "Config", "type": "main", "index": 0}]]},
        "Config": {"main": [[{"node": "Montar bloco", "type": "main", "index": 0}]]},
        "Montar bloco": {"main": [[{"node": "Publicar?", "type": "main", "index": 0}]]},
        "Publicar?": {
            "main": [
                [{"node": "ClickUp", "type": "main", "index": 0}],
                [{"node": "Responder", "type": "main", "index": 0}],
            ]
        },
        "ClickUp": {"main": [[{"node": "Resultado", "type": "main", "index": 0}]]},
        "Resultado": {"main": [[{"node": "Responder", "type": "main", "index": 0}]]},
    },
}

TODOS = [
    ("01_mb-touchpoint-week.json", WF_SEMANA),
    ("02_mb-touchpoint-redacao.json", WF_REDACAO),
    ("03_mb-touchpoint-envio.json", WF_ENVIO),
]

# Gravado sempre, publicado só com `--com-ia`. Manter fora do TODOS é o que
# garante que um `--publicar` distraído não religue a rota que gasta API.
RESERVA = [("02b_mb-touchpoint-redacao-ia.json", WF_REDACAO_IA)]


def gravar():
    # A tela não carrega mais o token embutido (app.js é versionado). Imprimir
    # aqui é o caminho mais curto entre "publiquei" e "a tela funciona".
    print("token dos webhooks (cole em Ajustes na tela): %s" % TOKEN)
    for nome, wf in TODOS + RESERVA:
        p = os.path.join(AQUI, nome)
        io.open(p, "w", encoding="utf-8").write(json.dumps(wf, ensure_ascii=False, indent=2))
        print("escrito: %-34s  %6.1f KB" % (nome, os.path.getsize(p) / 1024))


def publicar():
    import requests

    H = {"X-N8N-API-KEY": N8N_KEY, "Content-Type": "application/json"}
    existentes = {}
    r = requests.get(N8N_BASE + "/workflows", headers=H, params={"limit": 250}, timeout=90)
    r.raise_for_status()
    for w in r.json()["data"]:
        existentes[w["name"]] = w["id"]

    fila = TODOS + (RESERVA if "--com-ia" in sys.argv else [])
    for nome, wf in fila:
        corpo = {
            "name": wf["name"],
            "nodes": wf["nodes"],
            "connections": wf["connections"],
            "settings": wf["settings"],
        }
        wid = existentes.get(wf["name"])
        if wid:
            rr = requests.put(N8N_BASE + "/workflows/" + wid, headers=H,
                              data=json.dumps(corpo), timeout=90)
            acao = "atualizado"
        else:
            rr = requests.post(N8N_BASE + "/workflows", headers=H,
                               data=json.dumps(corpo), timeout=90)
            acao = "criado"
        if not rr.ok:
            print("ERRO %s: %s %s" % (wf["name"], rr.status_code, rr.text[:400]))
            continue
        wid = rr.json()["id"]
        ra = requests.post(N8N_BASE + "/workflows/%s/activate" % wid, headers=H, timeout=60)
        print("%-12s %s  id=%s  ativar=%s" % (acao, wf["name"], wid, ra.status_code))
        print("             %s/%s" % (WEBHOOK_BASE, wf["nodes"][0]["parameters"]["path"]))


if __name__ == "__main__":
    gravar()
    if "--publicar" in sys.argv:
        publicar()
