# -*- coding: utf-8 -*-
"""Roda ref_contract.py (implementacao de referencia, somente leitura) e grava o
gabarito da semana pedida. Serve de alvo para validar o porte JS do n8n."""
import sys, os, io, json
sys.stdout.reconfigure(encoding="utf-8")
SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)

import creds

os.environ["RUCHE_SUPABASE_KEY"] = creds.SUPABASE_SERVICE_KEY
os.environ["RUCHE_SUPABASE_URL"] = creds.SUPABASE_URL + "/rest/v1"

FASE1 = r"C:\Users\zuque\OneDrive\Área de Trabalho\Ruche\touchpoint-generator\fase1"
sys.path.insert(0, FASE1)

from datetime import date
import ref_contract as rc

WEEK = date.fromisoformat(sys.argv[1] if len(sys.argv) > 1 else "2026-08-17")
print("carregando semana", WEEK, "...", file=sys.stderr)
cl, ins, ap, bm, opt = rc.load(WEEK)
print("clientes elegiveis=%d ad_insights=%d appts=%d benchmarks=%d opts=%d"
      % (len(cl), len(ins), len(ap), len(bm), len(opt)), file=sys.stderr)
out = rc.build(WEEK, cl, ins, ap, bm, opt)
out.sort(key=lambda r: r["client_id"])
dest = os.path.join(SCRATCH, "gabarito_%s.json" % WEEK)
io.open(dest, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1, default=str))
print("blocos=%d -> %s" % (len(out), dest), file=sys.stderr)

sem = {}
cen = {}
for r in out:
    sem[r["qualidade"]["semaforo"]] = sem.get(r["qualidade"]["semaforo"], 0) + 1
    cen[r["cenario"]["codigo"]] = cen.get(r["cenario"]["codigo"], 0) + 1
print("semaforo:", sem)
print("cenario :", dict(sorted(cen.items())))
print("pode_gerar:", sum(1 for r in out if r["qualidade"]["pode_gerar"]), "/", len(out))
