# Project Nox Tracker

Site oficial para acompanhar pedidos, correções e demanda por extensões de Mangá e Anime do Project Nox.

Os dados vêm dos [Issues de project-nox-requests](https://github.com/Awerkori/project-nox-requests), que são a fonte oficial dos tickets. O tracker não mantém um banco de dados próprio.

## Dados e demanda

O workflow `update-data` consulta todos os Issues do repositório de pedidos, ignora Pull Requests e gera `data/issues.json`. A atualização ocorre a cada 15 minutos ou manualmente pelo GitHub Actions.

A ordenação **Mais pedidos** usa exclusivamente reações 👍 (`reactions["+1"]`), com `updated_at` como desempate. Votos indicam demanda, mas não garantem prioridade de desenvolvimento.

## Desenvolvimento local

```bash
python3 scripts/update_issues.py
python3 -m http.server 8000
```

Abra `http://localhost:8000`. Para usar dados autenticados localmente, defina `GITHUB_TOKEN`; ele nunca é enviado ao site.

## Publicação

O workflow `deploy-pages` publica o conteúdo estático no GitHub Pages após pushes em `main`. Não há backend, banco de dados ou segredo no frontend.
Project Nox Tracker — acompanhe pedidos, correções e demanda por extensões de Mangá e Anime.
