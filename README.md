# Project Nox · Tracker

Painel web interativo e público do **Project Nox** para acompanhar em tempo real o andamento de pedidos, status de correções e demanda por extensões de Mangá e Anime para **Mihon e forks** e **Aniyomi e forks**.

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
- 📦 [**Project Nox · Extensões de Mangá**](https://github.com/Awerkori/manga-extensoes) — Distribuição de fontes de leitura para Mihon e forks.
- 💻 [**Project Nox · Código-fonte das Extensões de Mangá**](https://github.com/Awerkori/manga-fonte-extensoes) — Código em Kotlin das extensões de mangá.
- 🎬 [**Project Nox · Extensões de Anime**](https://github.com/Awerkori/anime-extensoes) — Catálogo de extensões de vídeo para Aniyomi e forks.
- 💻 [**Project Nox · Código-fonte das Extensões de Anime**](https://github.com/Awerkori/anime-fonte-extensoes) — Extractors e fontes de anime.
- 🌐 [**Project Nox · Plataforma Web de Mangá**](https://github.com/Awerkori/project-nox-manga) — Plataforma web oficial de leitura.

---

## 🌟 Créditos

- **Project Nox**: Concepção visual, pipeline de dados e interface estática interativa.
- Comunidade participante da Central de Pedidos.

---

## ⚖️ Licença

Este projeto é software livre licenciado sob os termos da **GNU General Public License versão 3.0** (`GPL-3.0-only`). Consulte o arquivo [LICENSE](LICENSE) para obter o texto integral inalterado da licença e o arquivo [NOTICE](NOTICE) para informações detalhadas de autoria, termos de marca e governança.

```
Copyright (C) 2026 Project Nox Contributors & Awerkori

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, version 3 of the License.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.
```

### 📌 Nota sobre GPL-3.0 e AGPL-3.0
O Project Nox adota oficialmente a licença **GNU GPL versão 3.0**. Diferentemente da licença GNU AGPLv3, a GPLv3 não contém a cláusula de interação remota por rede (Seção 13 da AGPL). 

### 🛡️ Autenticidade e Marca
A concessão da licença GPL 3.0 refere-se estritamente aos direitos autorais do software. Ela **não concede** autorização ou licença para uso de marcas, logotipos oficiais ou da denominação "Project Nox" para insinuar homologação, endosso ou representação oficial do projeto.
