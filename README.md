# Project Nox · Tracker

Painel web operacional e público do **Project Nox** para acompanhar solicitações, correções e melhorias das extensões de Mangá e Anime (**Mihon e forks** e **Aniyomi e forks**).

🌐 **Acesse online:** [projectnox-org.github.io/project-nox-tracker](https://projectnox-org.github.io/project-nox-tracker/)

---

## 🎯 Finalidade e Fonte de Verdade

O **Project Nox Tracker** é uma ferramenta operacional para a comunidade encontrar solicitações, verificar seu estado atual e participar no GitHub em poucos segundos.

- **Fonte oficial das solicitações:** [ProjectNox-org/project-nox-requests](https://github.com/ProjectNox-org/project-nox-requests).
- **Estados oficiais (`state`):** Apenas `ABERTA` (`open`) e `FECHADA` (`closed`), obtidos diretamente do campo oficial `state` da issue no GitHub.
- **Independência de labels de andamento:** O Project Nox não utiliza regularmente labels de andamento ou resolução (como "Em análise", "Concluído" ou "Recusado"). O Tracker não infere essas classificações nem substitui o estado oficial do GitHub por labels.
- **Resumo de Demandas:** Exibe exatamente três indicadores dinâmicos (`Total`, `Abertas`, `Fechadas`) com garantia matemática `Total = Abertas + Fechadas` (pull requests são excluídos).

---

## 🔍 Funcionalidades da Interface

- **Indicadores Interativos:** Clique em `Total`, `Abertas` ou `Fechadas` para alternar o estado exibido (inicia em `Abertas` por padrão).
- **Pesquisa:** Busca por título, extensão, autor ou número exato da issue (`#152` ou `152`), com normalização de acentos e atalho `/`.
- **Filtros e Ordenação:**
  - Tipo: `Todos | Mangás | Animes` (escopando também os números do resumo).
  - Categoria: `Nova extensão`, `Problema na extensão`, `Mudança de domínio`, `Fonte indisponível`, `Sugestão`.
  - Ordenação: `Mais recentes` (padrão, com desempate determinístico por número), `Atualizados recentemente`, `Mais votados` (reações `👍` / `+1`) e `Mais antigos`.
- **Votos Positivos:** Exibe a contagem real de reações `+1` (`👍`) do GitHub e direciona para a issue oficial para reagir (requer conta gratuita no GitHub).
- **Listagem Progressiva:** Renderiza 24 solicitações por vez com botão `Mostrar mais`, mantendo busca, filtros, ordenação e contagens sobre todo o inventário.
- **Controle de Movimento:** Respeita `prefers-reduced-motion` e oferece botão `Pausar animações` / `Retomar animações`.

---

## ⚙️ Sincronização, Cache e Limites da API

O Tracker é uma SPA estática hospedada no GitHub Pages:

1. **Snapshot Estático (`data/issues.json`):** Gerado pelo script `scripts/update_issues.py` via workflow `.github/workflows/update-data.yml` (agendado a cada ~15 minutos, `workflow_dispatch` e `repository_dispatch: issues-updated`). O script é idempotente: preserva `generated_at` quando não há mudanças reais e aborta se atingir o limite de paginação com inventário incompleto.
2. **Ciclo de Verificação de 10 segundos (`CHECK_INTERVAL = 10000ms`):** Enquanto a aba está visível, o navegador verifica a cada ~10 segundos se há novo snapshot publicado em `data/issues.json` (usando `If-None-Match`/ETag, sem consumir cota da API REST do GitHub).
3. **Consultas à API REST do GitHub:** Como a API pública não autenticada do GitHub limita requisições a **60 por hora por IP**, o Tracker aplica intervalo mínimo adaptativo entre consultas diretas à API (`65s` em uso normal, `180s` quando `X-RateLimit-Remaining < 15`), além de `ETag`/`If-None-Match`, paginação completa via header `Link` e suspensão automática até `X-RateLimit-Reset` / `Retry-After` em respostas `403`/`429`.
4. **Sincronização entre Abas & Fallback:** Compartilha atualizações entre abas via `BroadcastChannel` e `localStorage`, preservando o último catálogo válido em modo offline ou sob rate limit.
5. **Segurança:** Construção de cards e chips via DOM (`textContent`, `createElement`) sem interpolação de HTML não confiável e validação estrita das URLs das issues.

> **Nota sobre latência:** O ciclo de verificação no navegador roda a cada ~10 segundos, mas a visibilidade de mudanças feitas diretamente no GitHub depende da atualização do snapshot publicado ou da janela segura da API pública do GitHub (sem expor credenciais no cliente).

---

## 💻 Execução Local e Testes

```bash
# 1. Atualizar os dados de issues localmente (opcional: export GITHUB_TOKEN=...)
python3 scripts/update_issues.py

# 2. Iniciar servidor estático local
python3 -m http.server 8000

# 3. Executar testes unitários
python3 -m pytest tests/test_tracker.py
```

---

## ⚖️ Licença e Copyright

Licenciado sob **GNU Affero General Public License v3.0 (`AGPL-3.0-only`)**. Consulte [LICENSE](LICENSE) e [NOTICE](NOTICE).
