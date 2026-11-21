# Desenvolvimento · Project Nox Tracker

[← Voltar ao README principal](../README.md)

Este guia reúne os requisitos, procedimentos locais, testes, estrutura técnica e fluxos de automação para manter e validar o **Project Nox Tracker**.

## Requisitos do ambiente

Verificado diretamente nos scripts, testes e workflows do repositório:

- **Git:** para clonar o repositório e inspecionar alterações locais.
- **Python >= 3.11:** exigido por `scripts/update_issues.py` (uso de `datetime.UTC`). Tanto `scripts/update_issues.py` quanto `scripts/dev_server.py` usam apenas a biblioteca padrão do Python.
- **`pytest`:** necessário apenas para executar `tests/test_tracker.py` (utiliza a fixture `tmp_path`). O repositório não possui `requirements.txt` nem `pyproject.toml`; no GitHub Actions a dependência é instalada com `python3 -m pip install pytest`.
- **Node.js:** necessário para checagem de sintaxe (`node --check`) e para a suíte E2E (`tests/e2e_comprehensive.mjs`, que utiliza módulos ES com *top-level `await`* e `node:assert/strict`). O repositório não define `package.json`; nos workflows oficiais a execução ocorre no ambiente `ubuntu-latest`.
- **Playwright + Chromium e Firefox:** necessários apenas para a suíte E2E em `tests/e2e_comprehensive.mjs`.

## Estrutura técnica relevante

```text
.
├── index.html                        # Página principal da interface
├── styles.css                        # Estilos e responsividade
├── app.js                            # Lógica de busca, filtros, paginação e sincronização
├── particles.js                      # Fundo em Canvas (3 camadas) e controle de movimento
├── favicon.ico                       # Ícone do site
├── assets/                           # Imagens e favicons servidos pelo site
├── data/
│   ├── config.json                   # Configuração auxiliar do projeto
│   └── issues.json                   # Snapshot versionado das Issues oficiais
├── scripts/
│   ├── dev_server.py                 # Servidor HTTP local (porta 8088, sem cache)
│   └── update_issues.py              # Gerador e validador do snapshot data/issues.json
├── tests/
│   ├── test_tracker.py               # Suíte unitária e de consistência em Python/pytest
│   └── e2e_comprehensive.mjs         # Suíte E2E em Node.js + Playwright (Chromium e Firefox)
└── .github/workflows/
    ├── deploy-pages.yml              # Validação, testes e deploy no GitHub Pages
    └── update-data.yml               # Atualização agendada do snapshot e republicação
```

### Detalhes internos da aplicação e sincronização

- **Geração do snapshot (`scripts/update_issues.py`):** consulta até `100` páginas (`per_page=100`) em `ProjectNox-org/project-nox-requests`, ignora Pull Requests, remove duplicatas da paginação, ordena por `created_at` decrescente (desempate por `number` decrescente), preserva `generated_at` quando não há mudança nas *Issues* e aborta a escrita se houver queda superior a `50%` no volume ou se o limite de `100` páginas for atingido.
- **Ciclo no navegador (`app.js`):** verifica `data/issues.json` a cada `10s` (`CHECK_INTERVAL`) usando `If-None-Match` (ETag) apenas com a aba visível (sem consumir cota da API REST do GitHub). Também realiza checagens na API REST respeitando intervalo adaptativo (`65s` normal via `GITHUB_API_MIN_INTERVAL`, `180s` via `THROTTLED_API_INTERVAL` quando `X-RateLimit-Remaining < 15`), reconciliação periódica (`RECONCILE_INTERVAL` de 10 minutos, teto `MAX_SAFE_PAGES = 100`) e pausa automática até `X-RateLimit-Reset` / `Retry-After` em respostas `403`/`429`.
- **Consistência entre abas e validação:** `mergeRawIssues` evita regressões temporais comparando `updated_at`, `closed_at` e `created_at`; ETags só são persistidas após validar que `state` é estritamente `"open"` ou `"closed"`; a coordenação entre abas ocorre via `BroadcastChannel` e `localStorage` (lock `FETCH_LOCK_TTL` de `15s`).
- **Interface, segurança e acessibilidade (`index.html`, `styles.css`, `particles.js`):** listagem progressiva de `24` cartões por bloco (`PAGE_SIZE`), renderização segura via `createElement` e `textContent` com validação estrita de URLs, preservação de foco e de títulos expandidos durante atualizações em segundo plano, detecção de truncamento com `ResizeObserver`, animações em Canvas com suporte a `prefers-reduced-motion` e suspensão automática com aba oculta, além de bloco `<noscript>` apontando para as *Issues* no GitHub.

## Obtenção do código-fonte

```bash
git clone https://github.com/ProjectNox-org/project-nox-tracker.git
cd project-nox-tracker
```

> [!NOTE]
> Execute todos os comandos deste guia a partir da **raiz do repositório** (`project-nox-tracker/`). Em especial, `scripts/update_issues.py` grava em `Path("data/issues.json")` relativo ao diretório atual.

## Execução local do Tracker

Para testar o site localmente sem interferir no GitHub Pages:

```bash
python3 scripts/dev_server.py
```

- **Endereço local:** abra `http://localhost:8088` no navegador.
- **Comportamento:** o servidor serve os arquivos da raiz do repositório na porta `8088` com cabeçalhos `Cache-Control: no-store, no-cache, must-revalidate, max-age=0, post-check=0, pre-check=0`, `Pragma: no-cache` e `Expires: 0`.
- **Como encerrar:** pressione `Ctrl+C` no terminal onde o servidor está em execução.

> [!IMPORTANT]
> Executar `scripts/dev_server.py` serve apenas para testes e desenvolvimento local; esse processo não altera nem publica nada no GitHub Pages.

## Atualização local das solicitações (`data/issues.json`)

Para regenerar o snapshot local a partir das *Issues* oficiais de `ProjectNox-org/project-nox-requests`:

```bash
python3 scripts/update_issues.py
```

Opcionalmente, para evitar o limite de `60 req/h` por IP da API pública do GitHub:

```bash
export GITHUB_TOKEN="seu_token_com_acesso_de_leitura"
python3 scripts/update_issues.py
```

### Cuidados obrigatórios com dados e credenciais

- **Arquivo versionado:** `data/issues.json` é rastreado pelo Git. Se existirem mudanças na Central de Pedidos, executar `scripts/update_issues.py` modificará `data/issues.json` localmente (gravado atomicamente via `data/issues.tmp`). Se nenhuma *Issue* tiver mudado, o timestamp `generated_at` é mantido intacto.
- **Risco de publicação acidental:** não inclua alterações locais de `data/issues.json` em commits de código ou documentação; a atualização oficial dos dados é feita automaticamente pelo workflow `update-data.yml`. Sempre confira `git status --short` e `git diff -- data/issues.json` antes de preparar um commit.
- **Como testar sem poluir seu ramo principal:** os testes unitários em `tests/test_tracker.py` já testam `scripts/update_issues.py` em diretório temporário isolado (`tmp_path`). Se precisar testar o script completo contra a API real do GitHub, utilize um clone ou branch separado de desenvolvimento e inspecione `git diff -- data/issues.json` antes de decidir o que fazer com as alterações locais.
- **Segurança de tokens:** nunca salve `GITHUB_TOKEN` em arquivos do repositório (`.gitignore` ignora apenas `.env`, mas mantenha tokens apenas em variáveis de ambiente temporárias da sessão).

## Validação de sintaxe e testes unitários

Execute a partir da raiz do repositório:

```bash
# Validação de sintaxe JavaScript (sem dependências externas, offline)
node --check app.js
node --check particles.js

# Compilação/sintaxe Python (sem dependências externas, offline)
python3 -m py_compile scripts/update_issues.py scripts/dev_server.py

# Suíte completa de testes unitários e consistência do snapshot (requer pytest, offline)
python3 -m pytest tests/test_tracker.py
```

- **Condições e efeitos colaterais:** esses comandos rodam totalmente **offline**, não dependem de `dev_server.py` rodando, não modificam `data/issues.json` (os testes que escrevem arquivos usam `tmp_path` do `pytest`) e encerram com código `0` quando todas as verificações passam.
- **Detalhe sobre `pytest`:** `python3 -m pytest tests/test_tracker.py` executa os `7` testes da suíte (incluindo os testes de deduplicação, idempotência e limite de 100 páginas em `update_issues.py`). Executar `python3 tests/test_tracker.py` diretamente sem `pytest` roda apenas os `5` testes básicos do bloco `if __name__ == "__main__"`.

## Testes E2E com Playwright (`tests/e2e_comprehensive.mjs`)

O workflow oficial executa a suíte em **Chromium** e **Firefox** instalando o Playwright em um diretório temporário fora do repositório e informando `NODE_PATH`:

```bash
npm install --prefix /tmp/pw-runner --no-save playwright
/tmp/pw-runner/node_modules/.bin/playwright install chromium firefox
NODE_PATH=/tmp/pw-runner/node_modules node tests/e2e_comprehensive.mjs --no-screenshots
```

> [!NOTE]
> Em máquinas Linux que ainda não possuem as bibliotecas de sistema necessárias para Chromium e Firefox, execute também `/tmp/pw-runner/node_modules/.bin/playwright install-deps chromium firefox` (pode exigir privilégios elevados conforme o sistema).

### Como a suíte funciona

- **Servidor próprio:** `tests/e2e_comprehensive.mjs` inicia um servidor HTTP estático próprio em `127.0.0.1` (porta efêmera) servindo a raiz do repositório; não é necessário iniciar `scripts/dev_server.py`.
- **Rede e resultados:** as chamadas a `https://api.github.com/**` e `**/data/issues.json*` são interceptadas e simuladas pelo Playwright; o progresso e o resultado final aparecem diretamente no terminal (`stdout`), retornando código `0` em caso de sucesso.
- **Screenshots:** a flag `--no-screenshots` pula a etapa final `captureRealDataScreenshots`, evitando geração de imagens. Sem essa flag, a suíte captura screenshots em múltiplos viewports nos dois navegadores.

### Limitações atuais de portabilidade do script E2E

Sem modificar `tests/e2e_comprehensive.mjs`, observe duas limitações do script existente:

1. **Resolução do módulo `playwright`:** como não existe `package.json` na raiz do projeto, `require("playwright")` precisa encontrar o pacote via `NODE_PATH` (como no exemplo oficial acima) ou em um `node_modules` pai; caso contrário, o script recorre a um fallback com caminho absoluto específico do ambiente de desenvolvimento original e falhará em outros computadores.
2. **Criação automática de diretório no `$HOME`:** mesmo quando `--no-screenshots` é usado, o script executa `fs.mkdirSync(...)` na inicialização para garantir um diretório de auditoria visual dentro de `$HOME/.local/share/antigravity/Nox-Workspace/documentacao/tracker-redesign-audit`.

## Workflows oficiais e publicação no GitHub Pages

O repositório utiliza dois workflows em `.github/workflows/`:

- **`.github/workflows/deploy-pages.yml` (`Publicar no GitHub Pages`):**
  - **Gatilhos:** `push` na branch `main` (exceto alterações exclusivas em `data/issues.json`) e `workflow_dispatch`.
  - **Etapas:** executa `node --check app.js`, `node --check particles.js`, `python3 -m py_compile scripts/update_issues.py`, instala e roda `pytest tests/test_tracker.py`, instala Playwright + Chromium/Firefox em `/tmp/pw-runner` e roda `tests/e2e_comprehensive.mjs --no-screenshots`.
  - **Saída publicada (`_site/`):** copia **somente** `index.html`, `styles.css`, `app.js`, `particles.js`, `favicon.ico`, `assets/` e `data/` para `_site/` e publica via GitHub Pages. Arquivos como `README.md`, `docs/`, `scripts/`, `tests/` e `.github/` não são copiados para o site público.
- **`.github/workflows/update-data.yml` (`Atualizar dados do tracker`):**
  - **Gatilhos:** `schedule` (`cron: "7,22,37,52 * * * *"`), `workflow_dispatch` e `repository_dispatch: [issues-updated]` (atualmente `ProjectNox-org/project-nox-requests` não dispara esse evento).
  - **Etapas:** executa `python3 scripts/update_issues.py` usando `secrets.GITHUB_TOKEN`, valida com `pytest tests/test_tracker.py` e, apenas quando `data/issues.json` muda, realiza commit como `github-actions[bot]` (`chore: update tracker data`) e republica `_site/` no GitHub Pages.
