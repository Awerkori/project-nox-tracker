<p align="center">
  <img src="https://raw.githubusercontent.com/ProjectNox-org/.github/main/assets/brand/nox-emblem.webp" alt="Emblema oficial do Project Nox" width="96" />
</p>

<h1 align="center">Project Nox · Tracker</h1>

<p align="center">
  Painel público para acompanhar solicitações, correções e melhorias das extensões do <strong>Project Nox</strong>.
</p>

> [!IMPORTANT]
> [**Acessar o Project Nox Tracker**](https://projectnox-org.github.io/project-nox-tracker/)
>
> Este painel serve para **consultar e acompanhar solicitações** — ele não instala extensões diretamente nos aplicativos. Para consultar sem interagir, **não é necessário ter conta no GitHub**. Para abrir um novo pedido ou votar com `👍`, é necessário entrar com uma conta gratuita no GitHub.

## O que é o Tracker?

O **Project Nox Tracker** reúne em uma interface web simples as demandas registradas na [Central de Pedidos (`project-nox-requests`)](https://github.com/ProjectNox-org/project-nox-requests):

- **Fonte oficial:** todas as solicitações exibidas vêm das *Issues* oficiais de `ProjectNox-org/project-nox-requests` (Pull Requests são ignorados).
- **Estados oficiais:** apenas **Abertas** (`open`) e **Fechadas** (`closed`), refletindo diretamente o estado oficial no GitHub — o Tracker não inventa etiquetas próprias de andamento. Uma solicitação fechada não significa necessariamente que foi concluída; consulte a discussão da *Issue* no GitHub para ver o motivo.
- **Resumo numérico:** os indicadores **Total**, **Abertas** e **Fechadas** mantêm sempre a relação `Total = Abertas + Fechadas`.

Para instalar extensões no seu aplicativo, utilize os catálogos oficiais de distribuição: [Extensões de Mangá](https://github.com/ProjectNox-org/manga-extensoes) e [Extensões de Anime](https://github.com/ProjectNox-org/anime-extensoes).

## Como utilizar

1. Acesse [**projectnox-org.github.io/project-nox-tracker**](https://projectnox-org.github.io/project-nox-tracker/) no navegador do computador ou celular.
2. Use a barra de pesquisa para buscar por nome da extensão, título, autor ou número exato da solicitação (ex.: `#152` ou `152`; atalho `/` no teclado).
3. Se quiser, filtre por **Mangás** ou **Animes** e escolha uma categoria.
4. Clique em **Total**, **Abertas** ou **Fechadas** para alternar o estado exibido (inicia em **Abertas**).
5. Para consultar os detalhes ou votar com `👍`, utilize o botão **Ver e votar no GitHub** (ou **Ver solicitação no GitHub**, nas encerradas) disponível no cartão da solicitação.
6. Se ainda não existir pedido semelhante, clique em **Abrir Solicitação** no topo do painel ou acesse diretamente a [Central de Pedidos](https://github.com/ProjectNox-org/project-nox-requests).

## Funcionalidades

- **Indicadores interativos:** alternam entre `Total`, `Abertas` e `Fechadas` respeitando o filtro de tipo ativo.
- **Pesquisa rápida:** busca por título/extensão, autor ou número exato com normalização de acentos e botão para limpar.
- **Filtros por tipo e categoria:** `Todos | Mangás | Animes` e categorias `Nova extensão`, `Problema na extensão`, `Mudança de domínio`, `Fonte indisponível` e `Sugestão`.
- **Ordenação:** `Mais recentes` (padrão), `Atualizados recentemente`, `Mais votados` (reações `👍` / `+1` do GitHub) e `Mais antigos`.
- **Listagem progressiva:** exibe 24 solicitações por bloco com botão **Mostrar mais**, mantendo pesquisa, filtros e totais sobre todo o conjunto carregado.
- **Controle de movimento:** botão **Pausar animações** / **Retomar animações**, suporte a `prefers-reduced-motion` e suspensão automática com a aba em segundo plano.

## Como os dados são atualizados

O Tracker exibe os dados a partir de um arquivo estático atualizado periodicamente no repositório (`data/issues.json`) e também pode consultar atualizações no navegador enquanto a página está visível:

- **Atualização automática do snapshot:** um workflow agendado no GitHub Actions verifica as *Issues* da Central de Pedidos cerca de quatro vezes por hora (a cada ~15 minutos) e republica o site quando há alterações. Como a Central de Pedidos não possui disparo automático configurado para notificar o Tracker de imediato (`repository_dispatch`), a atualização automática do arquivo estático segue esse agendamento periódico.
- **Verificação no navegador:** enquanto a aba está aberta e visível, o Tracker checa periodicamente se há um novo snapshot publicado e respeita intervalos seguros para consultas à API pública do GitHub.
- **Limitações de latência:** uma edição ou voto feito no GitHub não aparece garantidamente em poucos segundos — a visibilidade depende da execução do workflow, da publicação no GitHub Pages, da disponibilidade e do limite de requisições da API pública (60 req/h por IP sem autenticação) e de a aba permanecer visível.

## Arquitetura técnica

O projeto é uma aplicação web estática hospedada no GitHub Pages:

- **Origem oficial:** todas as solicitações têm origem nas *Issues* do repositório `ProjectNox-org/project-nox-requests`.
- **Snapshot estático:** um script Python (`scripts/update_issues.py`) coleta, deduplica, valida e salva o inventário em `data/issues.json`.
- **Automação contínua:** workflows do GitHub Actions executam a sincronização agendada, as validações e a publicação automática do site.
- **Publicação no GitHub Pages:** apenas os arquivos estáticos da interface e dos dados são publicados para os visitantes.
- **Atualização no navegador:** o painel verifica atualizações publicadas e realiza consultas complementares à API do GitHub respeitando limites de requisições e pausas automáticas.
- **Segurança, consistência e acessibilidade:** a interface utiliza manipulação segura do DOM, sincronização consistente entre abas, controle de animações e aviso `<noscript>`.

## Projetos relacionados

- [**Project Nox · Central de Pedidos**](https://github.com/ProjectNox-org/project-nox-requests) — Repositório oficial para abrir solicitações e relatar problemas.
- [**Project Nox · Extensões de Mangá**](https://github.com/ProjectNox-org/manga-extensoes) — Catálogo oficial de extensões para Mihon e forks.
- [**Project Nox · Extensões de Anime**](https://github.com/ProjectNox-org/anime-extensoes) — Catálogo oficial de extensões para Aniyomi, Anikku e forks.

## Desenvolvimento

Para executar o Tracker localmente, testar atualizações de dados, rodar as validações ou consultar os detalhes técnicos internos, veja o [Guia de Desenvolvimento](docs/DEVELOPMENT.md).

## Créditos

Desenvolvido e mantido por **Project Nox Contributors & Awerkori**, com pipeline automatizado no GitHub Actions e interface em padrões web abertos (veja [`NOTICE`](NOTICE)).

## Licenciamento e informações legais

Licenciado sob a **GNU Affero General Public License v3.0** (`AGPL-3.0-only`). Consulte [`LICENSE`](LICENSE) e [`NOTICE`](NOTICE) para o texto integral da licença, cláusula de interação remota de rede (Seção 13) e proteção de identidade e marca (Seção 7(e) — sem autorização de uso dos nomes ou logotipos "Project Nox" e "Awerkori" para sugerir endosso oficial).

```text
Copyright (C) 2026 Project Nox Contributors & Awerkori
Licensed under the GNU Affero General Public License, Version 3.0 (AGPL-3.0-only).
```
