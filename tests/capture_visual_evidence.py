#!/usr/bin/env python3
"""Generates visual previews and evidence for:
1. Banner no Desktop (1440px)
2. Banner no Celular (390px)
3. Template GitHub: Nova Extensão (01_request_extension.yml)
4. Template GitHub: Bug / Problema na Extensão (02_report_broken.yml)
5. Organização Final das 17 Labels Oficiais do GitHub
6. Exemplo Visual: Issue Concluída
7. Exemplo Visual: Issue Recusada
"""

import asyncio
import base64
import json
import os
import subprocess
import aiohttp

OUT_DIR = "/home/awerkori/.Projects/Project-Nox-Tracker/screenshots/visual_evidence"
BRAIN_DIR = "/home/awerkori/.gemini/antigravity-cli/brain/f09dc443-be98-401e-8aba-5270296e5f60/screenshots/visual_evidence"
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(BRAIN_DIR, exist_ok=True)

CDP_PORT = 9224

# HTML Generator for Templates and Labels Showcase
SHOWCASE_HTML_PATH = "/tmp/nox_visual_showcase.html"

SHOWCASE_HTML = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Project Nox - Visual Evidence Showcase</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      padding: 32px;
      line-height: 1.5;
    }

    /* GitHub-style container */
    .gh-form-container {
      max-width: 880px;
      margin: 0 auto 40px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 32px;
    }
    .gh-header {
      border-bottom: 1px solid #21262d;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .gh-title-label {
      font-size: 14px;
      font-weight: 600;
      color: #e6edf3;
      margin-bottom: 8px;
      display: block;
    }
    .gh-title-input {
      width: 100%;
      background: #010409;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 16px;
      color: #e6edf3;
      margin-bottom: 24px;
    }
    .gh-section-title {
      font-size: 16px;
      font-weight: 600;
      color: #e6edf3;
      margin: 24px 0 12px;
      border-bottom: 1px solid #21262d;
      padding-bottom: 6px;
    }
    .gh-field {
      margin-bottom: 20px;
    }
    .gh-field-label {
      font-size: 14px;
      font-weight: 600;
      color: #e6edf3;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .gh-required {
      color: #f85149;
    }
    .gh-field-desc {
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 8px;
    }
    .gh-input, .gh-select, .gh-textarea {
      width: 100%;
      background: #010409;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 14px;
      color: #e6edf3;
      font-family: inherit;
    }
    .gh-textarea { min-height: 80px; resize: vertical; }
    .gh-checkbox-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 14px;
      color: #e6edf3;
    }
    .gh-checkbox-item input { margin-top: 3px; }
    .gh-notice-box {
      background: rgba(56, 139, 253, 0.1);
      border: 1px solid #1f6feb;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 13px;
      color: #e6edf3;
      margin-top: 24px;
    }

    /* Labels Grid System */
    .labels-palette-container {
      max-width: 980px;
      margin: 0 auto;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 32px;
    }
    .palette-header {
      margin-bottom: 24px;
      border-bottom: 1px solid #30363d;
      padding-bottom: 16px;
    }
    .palette-title {
      font-size: 22px;
      font-weight: 700;
      color: #f0f6fc;
      margin-bottom: 6px;
    }
    .palette-subtitle {
      font-size: 14px;
      color: #8b949e;
    }
    .label-group {
      margin-bottom: 28px;
    }
    .label-group-title {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #8b949e;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .labels-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .label-card {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .label-pill-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .gh-label-pill {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 2em;
      font-size: 12px;
      font-weight: 600;
      line-height: 18px;
      border: 1px solid transparent;
    }
    .label-hex {
      font-family: monospace;
      font-size: 12px;
      color: #8b949e;
    }
    .label-card-desc {
      font-size: 12px;
      color: #8b949e;
      line-height: 1.4;
    }
  </style>
</head>
<body>

  <!-- 1. TEMPLATE: NOVA EXTENSÃO -->
  <div class="gh-form-container" id="template-nova-extensao">
    <div class="gh-header">
      <h2 style="font-size: 20px; font-weight: 600; color: #f0f6fc;">🌐 Nova extensão</h2>
      <p style="font-size: 14px; color: #8b949e;">Solicitar a inclusão de uma nova fonte de Mangá ou Anime no Project Nox.</p>
    </div>

    <label class="gh-title-label">Add a title <span class="gh-required">*</span></label>
    <div style="font-size: 12px; color: #a855f7; margin-bottom: 6px;">✓ Título livre e natural — sem prefixo travando o cursor. A automação padronizará após a criação.</div>
    <input class="gh-title-input" type="text" value="SukiMangas" placeholder="Title">
    <div style="font-size: 11px; color: #8b949e; margin-top: 4px; margin-bottom: 16px;">Título resultante após normalização: <code>[Nova extensão]: SukiMangas</code></div>

    <div class="gh-section-title">📌 Informações da extensão</div>

    <div class="gh-field">
      <label class="gh-field-label">Tipo de extensão <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Selecione se a fonte é focada em leitura de mangás ou streaming de animes.</div>
      <select class="gh-select"><option selected>Mangá</option><option>Anime</option></select>
    </div>

    <div class="gh-field">
      <label class="gh-field-label">Nome da fonte/site <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Nome oficial da fonte exatamente como exibido na plataforma.</div>
      <input class="gh-input" type="text" value="SukiMangas" placeholder="Ex.: SukiMangas">
    </div>

    <div class="gh-field">
      <label class="gh-field-label">URL oficial do site <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Endereço web completo e acessível da fonte.</div>
      <input class="gh-input" type="text" value="https://sukimangas.com" placeholder="Ex.: https://exemplo.com.br">
    </div>

    <div class="gh-field">
      <label class="gh-field-label">Idioma <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Idioma principal dos títulos e capítulos da fonte.</div>
      <input class="gh-input" type="text" value="Português (Brasil)">
    </div>

    <div class="gh-section-title">🔐 Requisitos de acesso</div>

    <div class="gh-field">
      <label class="gh-field-label">Precisa de login? <span class="gh-required">*</span></label>
      <div class="gh-field-desc">O conteúdo público pode ser acessado sem criação de conta?</div>
      <select class="gh-select"><option selected>Não</option><option>Sim</option></select>
    </div>

    <div class="gh-field">
      <label class="gh-field-label">Precisa de VIP/Premium? <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Há conteúdo bloqueado sob assinatura paga ou passe VIP?</div>
      <select class="gh-select"><option selected>Não</option><option>Sim</option><option>Parcialmente</option></select>
    </div>

    <div class="gh-field">
      <label class="gh-field-label">O site possui conteúdo +18? <span class="gh-required">*</span></label>
      <div class="gh-field-desc">A fonte hospeda conteúdo adulto explícito (+18/Hentai)?</div>
      <select class="gh-select"><option selected>Não</option><option>Sim</option></select>
    </div>

    <div class="gh-section-title">📝 Informações adicionais</div>

    <div class="gh-field">
      <label class="gh-field-label">Observações (opcional)</label>
      <div class="gh-field-desc">Informações adicionais sobre o site, se houver (sem senhas ou dados privados).</div>
      <textarea class="gh-textarea" placeholder="Ex.: O site mudou de layout recentemente ou usa proteção específica."></textarea>
    </div>

    <div class="gh-section-title">✅ Confirmação</div>

    <div class="gh-checkbox-item">
      <input type="checkbox" checked disabled>
      <span>Pesquisei solicitações existentes e confirmo que este pedido não é duplicado. <span class="gh-required">*</span></span>
    </div>
    <div class="gh-checkbox-item">
      <input type="checkbox" checked disabled>
      <span>Não incluí senhas, tokens, cookies ou credenciais pessoais privadas. <span class="gh-required">*</span></span>
    </div>

    <div class="gh-notice-box">
      👍 <strong>Dica:</strong> Ao abrir o ticket, curta com a reação 👍 para ajudar a subir a prioridade da extensão no Tracker!
    </div>
  </div>

  <!-- 2. TEMPLATE: BUG -->
  <div class="gh-form-container" id="template-bug" style="margin-top: 40px;">
    <div class="gh-header">
      <h2 style="font-size: 20px; font-weight: 600; color: #f0f6fc;">🐛 Extensão com problema</h2>
      <p style="font-size: 14px; color: #8b949e;">Reportar falhas em uma extensão existente (capítulos, catálogo, leitor, vídeos, etc.).</p>
    </div>

    <label class="gh-title-label">Add a title <span class="gh-required">*</span></label>
    <div style="font-size: 12px; color: #a855f7; margin-bottom: 6px;">✓ Título livre e natural — sem prefixo travando o cursor. A automação padronizará após a criação.</div>
    <input class="gh-title-input" type="text" value="Erro ao carregar capítulos da ManHQ" placeholder="Title">
    <div style="font-size: 11px; color: #8b949e; margin-top: 4px; margin-bottom: 16px;">Título resultante após normalização: <code>[Problema na extensão]: ManHQ — Erro ao carregar capítulos da ManHQ</code></div>

    <div class="gh-section-title">📌 Identificação da extensão</div>

    <div class="gh-field">
      <label class="gh-field-label">Tipo de extensão <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Selecione se a extensão com problema é de leitura de Mangás ou streaming de Animes.</div>
      <select class="gh-select"><option selected>Mangá</option><option>Anime</option></select>
    </div>
    <div class="gh-field">
      <label class="gh-field-label">Qual extensão está apresentando o problema? <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Nome exato da extensão instalada no aplicativo.</div>
      <input class="gh-input" type="text" value="ManHQ" placeholder="Ex.: MangaLivre.lat, ManHQ, SukiMangas, GoMangas, NeoToons">
    </div>
    <div class="gh-field">
      <label class="gh-field-label">Qual versão da extensão você está utilizando? <span class="gh-required">*</span></label>
      <div class="gh-field-desc">No aplicativo, abra 'Extensões' e toque no nome da extensão para ver a versão instalada. Caso não consiga verificar, digite 'Não sei'.</div>
      <input class="gh-input" type="text" value="1.6.60" placeholder="Ex.: 1.6.60, 16.1 ou Não sei">
    </div>

    <div class="gh-section-title">📱 Aplicativo utilizado</div>

    <div class="gh-field">
      <label class="gh-field-label">Aplicativo utilizado <span class="gh-required">*</span></label>
      <div class="gh-field-desc">Selecione qual aplicativo leitor você está utilizando.</div>
      <select class="gh-select">
        <option selected>Mihon</option>
        <option>Tachiyomi</option>
        <option>Aniyomi</option>
        <option>Komikku</option>
        <option>Suwayomi</option>
        <option>TachiyomiSY</option>
        <option>TachiyomiJ2K</option>
        <option>Outro</option>
      </select>
    </div>

    <div class="gh-field">
      <label class="gh-field-label">Versão do aplicativo (opcional)</label>
      <div class="gh-field-desc">Versão instalada do aplicativo leitor (diferente da versão da extensão).</div>
      <input class="gh-input" type="text" value="Mihon 0.17.1" placeholder="Ex.: Mihon 0.17.1">
    </div>

    <div class="gh-section-title">🐛 Detalhes do problema</div>

    <div class="gh-field">
      <label class="gh-field-label">Parte afetada (selecione todas as aplicáveis) <span class="gh-required">*</span></label>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 6px;">
        <label class="gh-checkbox-item"><input type="checkbox"> Popular</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Recentes</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Busca</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Filtros</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Metadados</label>
        <label class="gh-checkbox-item"><input type="checkbox" checked> Capítulos</label>
        <label class="gh-checkbox-item"><input type="checkbox" checked> Leitor de imagens</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Episódios</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Reprodução de vídeo</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Login</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Instalação/Atualização</label>
        <label class="gh-checkbox-item"><input type="checkbox"> Outro</label>
      </div>
    </div>

    <div class="gh-field">
      <label class="gh-field-label">O que está acontecendo? <span class="gh-required">*</span></label>
      <textarea class="gh-textarea">Ao abrir o capítulo 120, algumas páginas carregam, mas outras apresentam 'Failed to initialize decoder' e erro HTTP 403.</textarea>
    </div>

    <div class="gh-field">
      <label class="gh-field-label">Passos para reproduzir <span class="gh-required">*</span></label>
      <textarea class="gh-textarea">1. Abrir Mihon.
2. Selecionar ManHQ.
3. Abrir qualquer obra da lista.
4. Entrar no capítulo 120.
5. Observar o erro na página.</textarea>
    </div>

    <div class="gh-section-title">📎 Informações complementares</div>

    <div class="gh-field">
      <label class="gh-field-label">Mensagem ou código de erro exibido (opcional)</label>
      <input class="gh-input" type="text" value="HTTP 403: Cloudflare Challenge Failed">
    </div>
    <div class="gh-field">
      <label class="gh-field-label">Dispositivo e Sistema Operacional (opcional)</label>
      <input class="gh-input" type="text" value="Samsung Galaxy S23 (Android 14)">
    </div>
    <div class="gh-field">
      <label class="gh-field-label">Observações adicionais (opcional)</label>
      <textarea class="gh-textarea" placeholder="Outras informações úteis (ex.: no navegador comum o capítulo abre normalmente)."></textarea>
    </div>
  </div>

  <!-- 3. LABELS TAXONOMY SYSTEM (17 OFFICIAL LABELS) -->
  <div class="labels-palette-container" id="labels-system" style="margin-top: 50px;">
    <div class="palette-header">
      <div class="palette-title">Sistema Oficial de Labels — Project Nox Requests</div>
      <div class="palette-subtitle">Taxonomia oficial e padronizada em 5 grupos semânticos (17 labels com contraste profissional)</div>
    </div>

    <!-- Grupo 1 -->
    <div class="label-group">
      <div class="label-group-title">Grupo 1 — Tipo de Mídia (2)</div>
      <div class="labels-grid">
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #7c3aed; color: #ffffff;">Mangá</span>
            <span class="label-hex">#7c3aed</span>
          </div>
          <div class="label-card-desc">Extensão ou solicitação voltada para leitura de Mangá</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #2563eb; color: #ffffff;">Anime</span>
            <span class="label-hex">#2563eb</span>
          </div>
          <div class="label-card-desc">Extensão ou solicitação voltada para streaming de Anime</div>
        </div>
      </div>
    </div>

    <!-- Grupo 2 -->
    <div class="label-group">
      <div class="label-group-title">Grupo 2 — Categoria da Solicitação (5)</div>
      <div class="labels-grid">
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #a855f7; color: #ffffff;">Nova extensão</span>
            <span class="label-hex">#a855f7</span>
          </div>
          <div class="label-card-desc">Pedido de desenvolvimento de novo site ou catálogo</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #ef4444; color: #ffffff;">Problema na extensão</span>
            <span class="label-hex">#ef4444</span>
          </div>
          <div class="label-card-desc">Relato de erro, bug ou comportamento quebrado em extensão</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #06b6d4; color: #ffffff;">Mudança de domínio</span>
            <span class="label-hex">#06b6d4</span>
          </div>
          <div class="label-card-desc">Aviso de alteração de endereço web oficial da fonte</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #64748b; color: #ffffff;">Fonte indisponível</span>
            <span class="label-hex">#64748b</span>
          </div>
          <div class="label-card-desc">Fonte aparentemente offline, inoperante ou encerrada</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #6366f1; color: #ffffff;">Sugestão</span>
            <span class="label-hex">#6366f1</span>
          </div>
          <div class="label-card-desc">Proposta de nova funcionalidade ou melhoria para o ecossistema</div>
        </div>
      </div>
    </div>

    <!-- Grupo 3 -->
    <div class="label-group">
      <div class="label-group-title">Grupo 3 — Andamento e Triagem (4)</div>
      <div class="labels-grid">
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #94a3b8; color: #0d1117;">Em análise</span>
            <span class="label-hex">#94a3b8</span>
          </div>
          <div class="label-card-desc">Solicitação em triagem inicial pela equipe do Project Nox</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #8b5cf6; color: #ffffff;">Aceito</span>
            <span class="label-hex">#8b5cf6</span>
          </div>
          <div class="label-card-desc">Solicitação avaliada e aprovada para desenvolvimento</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #eab308; color: #0d1117;">Em desenvolvimento</span>
            <span class="label-hex">#eab308</span>
          </div>
          <div class="label-card-desc">Trabalho técnico em andamento ativo pela equipe</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #f59e0b; color: #0d1117;">Aguardando informações</span>
            <span class="label-hex">#f59e0b</span>
          </div>
          <div class="label-card-desc">Aguardando detalhes adicionais ou esclarecimentos do autor</div>
        </div>
      </div>
    </div>

    <!-- Grupo 4 -->
    <div class="label-group">
      <div class="label-group-title">Grupo 4 — Resolução Final de Encerramento (4)</div>
      <div class="labels-grid">
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #10b981; color: #ffffff;">Concluído</span>
            <span class="label-hex">#10b981</span>
          </div>
          <div class="label-card-desc">Solicitação atendida, desenvolvida e entregue com sucesso</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #dc2626; color: #ffffff;">Recusado</span>
            <span class="label-hex">#dc2626</span>
          </div>
          <div class="label-card-desc">Solicitação avaliada e recusada pela equipe</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #475569; color: #ffffff;">Duplicado</span>
            <span class="label-hex">#475569</span>
          </div>
          <div class="label-card-desc">Solicitação idêntica a outro ticket já existente</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #4b5563; color: #ffffff;">Cancelado</span>
            <span class="label-hex">#4b5563</span>
          </div>
          <div class="label-card-desc">Ticket cancelado pelo autor ou encerrado por perda de objeto</div>
        </div>
      </div>
    </div>

    <!-- Grupo 5 -->
    <div class="label-group">
      <div class="label-group-title">Grupo 5 — Complementares (2)</div>
      <div class="labels-grid">
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #db2777; color: #ffffff;">Conteúdo +18</span>
            <span class="label-hex">#db2777</span>
          </div>
          <div class="label-card-desc">Fonte hospeda conteúdo adulto explícito (+18/Hentai)</div>
        </div>
        <div class="label-card">
          <div class="label-pill-wrap">
            <span class="gh-label-pill" style="background: #ea580c; color: #ffffff;">Alta prioridade</span>
            <span class="label-hex">#ea580c</span>
          </div>
          <div class="label-card-desc">Alta demanda da comunidade ou impacto crítico no ecossistema</div>
        </div>
      </div>
    </div>
  </div>

</body>
</html>
"""

with open(SHOWCASE_HTML_PATH, "w", encoding="utf-8") as f:
    f.write(SHOWCASE_HTML)


async def capture_all():
    proc = subprocess.Popen([
        "chromium",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--remote-debugging-port={CDP_PORT}",
        "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        await asyncio.sleep(1.2)
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://localhost:{CDP_PORT}/json/list") as r:
                tabs = await r.json()
                page_tab = next(t for t in tabs if t.get("type") == "page")
                ws_url = page_tab["webSocketDebuggerUrl"]

            ws = await session.ws_connect(ws_url, max_msg_size=50 * 1024 * 1024)

            msg_id = 0
            async def cdp_call(method, params=None):
                nonlocal msg_id
                msg_id += 1
                curr_id = msg_id
                payload = {"id": curr_id, "method": method, "params": params or {}}
                await ws.send_str(json.dumps(payload))
                while True:
                    msg = await ws.receive_str()
                    data = json.loads(msg)
                    if data.get("id") == curr_id:
                        if "error" in data:
                            raise Exception(f"CDP error: {data['error']}")
                        return data.get("result", {})

            # Helper for screenshot
            async def snap(filename, clip=None):
                params = {"format": "png", "captureBeyondViewport": True}
                if clip:
                    params["clip"] = clip
                res = await cdp_call("Page.captureScreenshot", params)
                data = base64.b64decode(res["data"])
                p1 = os.path.join(OUT_DIR, filename)
                p2 = os.path.join(BRAIN_DIR, filename)
                with open(p1, "wb") as f:
                    f.write(data)
                with open(p2, "wb") as f:
                    f.write(data)
                print(f"✓ Screenshot salva: {filename}")

            # -------------------------------------------------------------
            # 1. Template Nova Extensão & Template Bug & Labels System
            # -------------------------------------------------------------
            await cdp_call("Page.navigate", {"url": f"file://{SHOWCASE_HTML_PATH}"})
            await asyncio.sleep(1.0)

            # Snap Template Nova Extensão
            await cdp_call("Emulation.setDeviceMetricsOverride", {"width": 1100, "height": 1200, "deviceScaleFactor": 1.0, "mobile": False})
            await asyncio.sleep(0.3)
            box1 = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    const el = document.querySelector('#template-nova-extensao');
                    el.scrollIntoView();
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("template_nova_extensao.png", clip=box1)

            # Snap Template Bug
            box2 = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    const el = document.querySelector('#template-bug');
                    el.scrollIntoView();
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("template_bug.png", clip=box2)

            # Snap Labels System
            await cdp_call("Emulation.setDeviceMetricsOverride", {"width": 1100, "height": 1400, "deviceScaleFactor": 1.0, "mobile": False})
            await asyncio.sleep(0.3)
            box3 = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    const el = document.querySelector('#labels-system');
                    el.scrollIntoView();
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("organizacao_labels_oficiais.png", clip=box3)

            # -------------------------------------------------------------
            # 2. Real Issues from Local Tracker: Concluído & Recusado
            # -------------------------------------------------------------
            await cdp_call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1.0, "mobile": False})
            await cdp_call("Page.navigate", {"url": "http://localhost:8088/"})
            await asyncio.sleep(2.0)

            # Find card 112 (Concluído)
            box_card_done = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    const el = document.querySelector('.ticket-card[data-number="112"]') || document.querySelector('.ticket-card');
                    el.scrollIntoView();
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("exemplo_issue_concluida.png", clip=box_card_done)

            # Find card 57 or 100 (Recusado)
            box_card_declined = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    const el = document.querySelector('.ticket-card[data-number="57"]') || document.querySelector('.ticket-card[data-number="100"]') || document.querySelector('.ticket-card');
                    el.scrollIntoView();
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("exemplo_issue_recusada.png", clip=box_card_declined)

            # -------------------------------------------------------------
            # 3. Notice Banner on Desktop (1440px) and Mobile (390px)
            # -------------------------------------------------------------
            await cdp_call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1.0, "mobile": False})
            await asyncio.sleep(0.5)
            box_banner_desktop = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    window.scrollTo(0, 0);
                    const el = document.querySelector('.notice-banner');
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 12), width: r.width + 40, height: r.height + 24, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("aviso_desktop_1440px.png", clip=box_banner_desktop)

            await cdp_call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1.0, "mobile": True})
            await asyncio.sleep(0.5)
            box_banner_mobile = (await cdp_call("Runtime.evaluate", {
                "expression": """(() => {
                    window.scrollTo(0, 0);
                    const el = document.querySelector('.notice-banner');
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20, scale: 1 };
                })()""",
                "returnByValue": True
            }))["result"]["value"]
            await snap("aviso_mobile_390px.png", clip=box_banner_mobile)

    finally:
        if proc:
            proc.terminate()
            proc.wait()

asyncio.run(capture_all())
