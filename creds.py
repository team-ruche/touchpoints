# -*- coding: utf-8 -*-
"""Credenciais lidas dos arquivos que já existem no workspace.

Nada é digitado em linha de comando e nada é gravado aqui: este módulo só
aponta para o HANDOVER_RUCHE_OS.md e o config.env que já estão na máquina.
Usado por gabarito.py e por n8n/build.py.
"""
import io
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HANDOVER = os.path.join(RAIZ, "stripe-conciliacao", "HANDOVER_RUCHE_OS.md")
CONFIG_ENV = os.path.join(RAIZ, "config.env")
N8N_SRC = os.path.join(RAIZ, "n8n-backups", "update_workflows.py")

_h = io.open(HANDOVER, encoding="utf-8").read()
_c = io.open(CONFIG_ENV, encoding="utf-8").read()
_n = io.open(N8N_SRC, encoding="utf-8").read()


def _tabela(rotulo):
    m = re.search(r"\|\s*" + re.escape(rotulo) + r"\s*\|\s*`([^`]+)`", _h)
    return m.group(1) if m else None


def _env(k):
    m = re.search(r"^%s=(.+)$" % re.escape(k), _c, re.M)
    return m.group(1).strip() if m else None


SUPABASE_URL = "https://api.ruchedigital.com"
SUPABASE_SERVICE_KEY = _tabela("SERVICE_ROLE_KEY")
ANTHROPIC_API_KEY = _env("ANTHROPIC_API_KEY")
CLICKUP_TOKEN = _env("CLICKUP_TOKEN")
CLICKUP_CHANNEL_ID = _env("CLICKUP_CHANNEL_ID")

N8N_KEY = re.search(r'API_KEY\s*=\s*"([^"]+)"', _n).group(1)
N8N_BASE = "https://workflows.ruchedigital.online/api/v1"
N8N_WEBHOOK_BASE = "https://webhook.ruchedigital.online/webhook"

SB_HEADERS = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": "Bearer %s" % SUPABASE_SERVICE_KEY}
N8N_HEADERS = {"X-N8N-API-KEY": N8N_KEY, "Content-Type": "application/json"}
