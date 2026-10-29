# Project Nox · Tracker

Painel web interativo e público do **Project Nox** para acompanhar em tempo real o andamento de pedidos, status de correções e demanda por extensões de Mangá e Anime para **Mihon**, **Aniyomi** e ecossistema.

---

🌐 **Acesse online:** [awerkori.github.io/project-nox-tracker](https://awerkori.github.io/project-nox-tracker/)

---

## 🎯 Sobre o Tracker

O **Project Nox Tracker** oferece uma interface visual intuitiva para a comunidade acompanhar o ciclo de vida dos tickets sem precisar navegar por listagens brutas do GitHub.

- **Filtros Ágeis:** Navegue por tipo de solicitação (Novas Fontes, Erros/Bugs, Mudanças de Domínio, Fontes Mortas e Melhorias).
- **Indicador de Demanda Popular:** Ordenação calculada a partir das reações 👍 (`+1`) dos usuários nos chamados oficiais.
- **Transparência Operacional:** Status atualizados automaticamente a cada execução do pipeline (Em análise, Aprovado, Em desenvolvimento, Concluído).

---

## ⚙️ Arquitetura e Fluxo de Dados

O Tracker é uma Single Page Application (SPA) estática e serverless:

1. **Fonte da Verdade:** Os chamados são abertos e gerenciados na [Central de Pedidos](https://github.com/Awerkori/project-nox-requests).
2. **Coleta Automatizada:** O workflow `update-data` consulta a API do GitHub a cada 15 minutos (ou sob demanda), compila os metadados e atualiza o arquivo `data/issues.json`.
3. **Publicação Contínua:** O pipeline `deploy-pages` publica os assets estáticos no GitHub Pages após qualquer atualização na branch `main`.

---

## 💻 Desenvolvimento Local

Para executar o Tracker em ambiente local:

```bash
# 1. Atualizar os dados de issues localmente
python3 scripts/update_issues.py

# 2. Iniciar servidor estático local
python3 -m http.server 8000
```

Abra `http://localhost:8000` no seu navegador.  
*(Opcional: defina a variável `GITHUB_TOKEN` no terminal para evitar limites de taxa da API pública do GitHub ao rodar o script de coleta).*

---

## 🔗 Ecossistema Project Nox

- 🎫 [**Project Nox · Central de Pedidos**](https://github.com/Awerkori/project-nox-requests) — Onde os tickets são criados e votados.
- 📦 [**Project Nox · Extensões de Mangá**](https://github.com/Awerkori/manga-extensoes) — Distribuição de fontes de leitura para Mihon.
- 💻 [**Project Nox · Código-fonte das Extensões de Mangá**](https://github.com/Awerkori/manga-fonte-extensoes) — Código em Kotlin das extensões de mangá.
- 🎬 [**Project Nox · Extensões de Anime**](https://github.com/Awerkori/anime-extensoes) — Catálogo de extensões de vídeo para Aniyomi.
- 💻 [**Project Nox · Código-fonte das Extensões de Anime**](https://github.com/Awerkori/anime-fonte-extensoes) — Extractors e fontes de anime.
- 🌐 [**Project Nox · Site**](https://manga.project-nox-awerkori.workers.dev) — Plataforma web oficial de leitura.

---

## ⚖️ Licença

Distribuído sob licença aberta para visualização pública e acompanhamento comunitário do Project Nox.
