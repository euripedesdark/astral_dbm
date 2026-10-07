#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verificador do caminho completo do DBM (requisito permanente, 0.22.1).

  Dados -> Regra -> API -> Consumidor -> Tela -> Fluxo de uso

O quinto elo (fluxo) e o que ninguem checa: saber quem consome, qual API
responde e qual tela mostra ainda deixa faltar o caminho que liga os tres --
o clique que chama a API que grava a tabela.

Uma tabela pode ter MAIS DE UM fluxo: um de leitura e outro de escrita, e os
dois batem em endpoints diferentes. E por isso que a coluna de API do mapa
nao da conta sozinha: ela e a API dona, nao o conjunto de endpoints. O
verificador exige que pelo menos um fluxo cite a API dona, e que TODOS os
fluxos apontem para dentro de /api/dbm/.

Este script le o mapa da secao 0.21.2 e acusa. Nao corrige, naoSugere texto:
acusa, com linha e motivo.

Uso:
    python3 verifica_mapa.py [caminho-do-documento]
"""
import io
import re
import sys

DOC = sys.argv[1] if len(sys.argv) > 1 else \
    "/home/euripedes/BrasilCloudERP/docs/ASTRAL-DATABASE-MANAGER.md"

PREFIXO_API = "/api/dbm/"
COLUNAS = 5
SEP = "<br>"


def linhas_mapa(doc):
    ini = doc.find("#### 0.21.2")
    if ini == -1:
        return None, "secao 0.21.2 nao encontrada no documento"
    fim = None
    for marca in ("#### 0.21.3", "### 0.22", "## 1. "):
        p = doc.find(marca, ini + 10)
        if p != -1 and (fim is None or p < fim):
            fim = p
    if fim is None:
        return None, "0.21.2 nao tem fim: falta 0.21.3 ou a secao 1 depois dela"
    out = []
    for l in doc[ini:fim].split("\n"):
        t = l.strip()
        if t.startswith("|") and "`dbm_" in t and "---" not in t:
            out.append([c.strip() for c in t.strip("|").split("|")])
    return out, None


def nome_tela(celula):
    limpo = re.sub(r"\*\*(pr[oó]pria|embutida)\*\*", "", celula)
    limpo = limpo.replace("**", "")
    limpo = re.split(r"[(§\u00a7]", limpo)[0].strip()
    return limpo or None


def e_automatico(fluxo):
    return fluxo.strip().lower().startswith("automatico:") or \
           fluxo.strip().lower().startswith("automático:")


def acusa_fluxo(tabela, fluxo, tela, idx):
    p = []
    f = fluxo.strip()
    if not f:
        return ["vazio"]
    if tabela not in f:
        p.append("nao menciona a propria tabela (%s)" % tabela)
    apis = re.findall(r"/api/[a-zA-Z0-9_/{}.\-]*", f)
    if not apis and not e_automatico(f):
        # fluxo de clique SEM endpoint nao liga nada: e a forma de descrever
        # uma funcionalidade sem o caminho
        p.append("nao cita nenhum endpoint /api/")
    for a in apis:
        if not a.startswith(PREFIXO_API):
            p.append("endpoint fora do prefixo %s: %s (0.21.3)" % (PREFIXO_API, a))
    if not e_automatico(f):
        if tela is None:
            p.append("coluna de tela sem nome legivel")
        elif tela.split(">")[-1].strip() not in f:
            p.append("nao comeca pela tela da coluna 4 (%r)" % tela)
    if "retorno" not in f.lower():
        p.append("nao diz o que o usuario ve depois (falta 'retorno')")
    # automatico precisa declarar o gatilho: o que dispara a escrita
    if e_automatico(f):
        gatilho = re.split(r"→", f.split(":", 1)[1] if ":" in f else f)[0].strip()
        if len(gatilho) < 4:
            p.append("automatico sem gatilho declarado: quem dispara a escrita?")
    return p


def main():
    doc = io.open(DOC, encoding="utf-8").read()
    linhas, erro = linhas_mapa(doc)
    if erro:
        print("  ERRO: %s" % erro)
        return 1
    if not linhas:
        print("  ERRO: nenhuma linha de tabela em 0.21.2")
        return 1

    falhas = 0
    total_fluxos = 0
    total_auto = 0
    for celulas in linhas:
        tabela = celulas[0].strip("`")
        if len(celulas) < COLUNAS:
            print("  XX %-24s sem a coluna de FLUXO: o mapa tem %d colunas, e o caminho"
                  " completo exige %d" % (tabela, len(celulas), COLUNAS))
            falhas += 1
            continue
        celula = celulas[COLUNAS - 1].strip()
        tela = nome_tela(celulas[3]) if len(celulas) > 3 else None
        fluxos = [x for x in celula.split(SEP)] if celula else []
        fluxos = [x.strip() for x in fluxos if x.strip()]
        if not fluxos:
            print("  XX %-24s coluna de fluxo vazia" % tabela)
            falhas += 1
            continue
        total_fluxos += len(fluxos)
        problemas = []
        automaticos = 0
        for i, f in enumerate(fluxos, 1):
            if e_automatico(f):
                automaticos += 1
            for p in acusa_fluxo(tabela, f, tela, i):
                problemas.append("fluxo %d: %s" % (i, p))
        total_auto += automaticos
        # TABELA QUE SE ESCREVE SOZINHA E QUE NINGUEM LE E TABELA QUE NINGUEM
        # VIGIA. O fluxo automatico nao tem endpoint -- quem dispara e um
        # agendador, um interceptor ou um event trigger -- entao o que se exige
        # e que exista um caminho de leitura por algum endpoint. Sem ele, a
        # tabela aceita escrita e ninguem descobre que parou de escrever.
        if automaticos and automaticos == len(fluxos):
            problemas.append("todos os %d fluxos sao automaticos: a tabela se escreve sozinha "
                             "e nao ha caminho de leitura -- tabela que ninguem vigia" % automaticos)
        # a API dona da coluna 3 tem que aparecer em pelo menos um fluxo.
        # Comparacao por IDENTIDADE de endpoint, e nao por substring: senao
        # "/api/dbm/auditoria/outro" conta como sendo "/api/dbm/auditoria", e
        # a linha passa a prometer uma API que ninguem usa.
        api_dona = celulas[2].strip("`") if len(celulas) > 2 else ""
        if api_dona and not any(api_dona in re.findall(r"/api/[a-zA-Z0-9_/{}.\-]*", f)
                                for f in fluxos):
            problemas.append("nenhum fluxo chama a API dona da coluna 3 (%s): mapa e fluxo "
                             "discordam, e a API do mapa nao tem consumidor" % api_dona)
        if problemas:
            falhas += 1
            print("  XX %-24s %s" % (tabela, problemas[0]))
            for extra in problemas[1:]:
                print("       - %s" % extra)

    print("  --------------------------------------------------")
    print("  mapa: %d tabelas | %d fluxos (%d automaticos) | com caminho completo: %d | sem: %d"
          % (len(linhas), total_fluxos, total_auto, len(linhas) - falhas, falhas))
    if falhas:
        print("  TABELA SEM FLUXO E ERRO ARQUITETURAL (0.22.1), nao divida.")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
