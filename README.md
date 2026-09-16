# Prisma Analytics

**Transforme seus dados em decisões.** Envie um CSV e receba um dashboard
interativo: a plataforma entende cada coluna, identifica padrões reais, escolhe
as visualizações por princípios de visualização de dados e explica o que
encontrou — em português, com os números do seu arquivo.

```
CSV → compreensão → análise → narrativa → visualização → decisão
```

---

## O princípio central: a IA não produz números

Esta é a decisão de arquitetura que governa todo o resto.

Um **motor determinístico em Pandas** calcula tudo: perfilamento, estatísticas
descritivas, correlações, tendências, outliers, qualidade dos dados e a escolha
dos gráficos. A **camada de LLM** recebe apenas fatos já calculados e cuida de
três coisas — curadoria do dashboard, redação da narrativa e tradução de
pergunta em plano de consulta. Ela nunca calcula, nunca vê o dataset bruto e
nunca executa código.

Consequência prática: **sem nenhuma API key configurada a aplicação continua
100% funcional.** Perguntas em linguagem natural passam a ser interpretadas por
um parser de regras (pt-BR e en) e as respostas usam modelos de texto
determinísticos. Nada de essencial se perde.

### Rigor analítico embutido

Quatro correções que a maioria das ferramentas erra silenciosamente:

| Problema | O que a plataforma faz |
|---|---|
| Um mês pela metade no fim da série vira uma "queda de 95%" | Períodos de cobertura incompleta são excluídos da tendência e o motivo é informado |
| Somar preço unitário, taxa ou nota | Cada coluna carrega um sinal de aditividade; medidas não aditivas usam média, e o editor avisa se você tentar somar |
| Poucos outliers extremos zeram o coeficiente de Pearson | O par se qualifica pelo maior entre Pearson e Spearman; quando divergem, a leitura usa Spearman e explica por quê |
| Coluna numérica de baixa cardinalidade vira dimensão | O nome da coluna tem precedência: `receita_total` é métrica mesmo com poucos valores distintos |

Cada insight exibido traz a evidência que o produziu: as colunas usadas e o
método estatístico aplicado.

---

## Como executar localmente

Pré-requisitos: **Python 3.11+** e **Node.js 20+**.

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # ajuste SECRET_KEY antes de ir a produção
uvicorn app.main:app --reload --port 8000
```

A API sobe em `http://localhost:8000`. Documentação interativa em
`http://localhost:8000/docs`.

O banco padrão é SQLite e é criado automaticamente em `backend/storage/`.
Nenhuma configuração adicional é necessária para desenvolvimento.

Para PostgreSQL, aponte `DATABASE_URL` e aplique as migrações — o bootstrap
automático de tabelas vale apenas para SQLite, de modo que mudanças de esquema
sejam sempre versionadas:

```bash
export DATABASE_URL=postgresql+psycopg2://usuario:senha@localhost:5432/prisma
alembic upgrade head
```

Ao alterar os modelos, gere a migração correspondente:

```bash
alembic revision --autogenerate -m "descrição da mudança"
```

### 2. Frontend

Em outro terminal:

```bash
cd frontend
npm install
cp .env.example .env.local         # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

A interface sobe em `http://localhost:3000`.

### Atalho

```bash
./scripts/dev.sh                   # sobe API e web juntos
./scripts/dev.sh api               # somente a API
./scripts/dev.sh web               # somente o frontend
```

### Com Docker

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

Sobe PostgreSQL, API e frontend. A interface fica em `http://localhost:3000`.

---

## Configuração da camada de IA

A aplicação funciona sem nenhuma chave. Para habilitar um modelo de linguagem,
preencha uma das opções em `backend/.env`:

```bash
LLM_PROVIDER=auto                  # auto | anthropic | openai | heuristic

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5

# ou, para OpenAI ou qualquer endpoint compatível:
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

`auto` usa Anthropic se houver chave, senão OpenAI, senão o modo determinístico.
O endpoint `GET /api/v1/ai/status` informa qual modo está ativo, e a interface
mostra isso no painel do AI Data Analyst.

Trocar de provedor não toca em nenhuma regra de negócio: tudo passa pela
interface `LLMProvider` em `backend/app/ai/base.py`.

---

## Arquitetura

```
backend/
├── app/
│   ├── core/            configuração, segurança, banco, erros, rate limiting
│   ├── models/          entidades SQLAlchemy
│   ├── schemas/         contratos Pydantic da API
│   ├── api/v1/          rotas REST
│   ├── services/        ── o motor determinístico ──
│   │   ├── ingestion      leitura de CSV: encoding, separador, sanitização
│   │   ├── semantics      tipos semânticos, papéis e aditividade das colunas
│   │   ├── statistics     descritivas, Tukey, correlação, séries temporais
│   │   ├── profiling      documento de perfilamento do conjunto
│   │   ├── quality        pontuação de qualidade em cinco dimensões
│   │   ├── domain         detecção do domínio de negócio
│   │   ├── insights       geração de achados com evidência
│   │   ├── recommender    escolha de gráficos por princípios de visualização
│   │   ├── query_engine   execução declarativa e validada de consultas
│   │   ├── widget_data    resolução dos dados de cada widget
│   │   ├── dashboard_builder  montagem do layout
│   │   ├── analyzer       orquestração do pipeline
│   │   └── storage        persistência em Parquet com cache LRU
│   └── ai/              ── a camada de linguagem ──
│       ├── base           interface LLMProvider e validação de saída
│       ├── providers      Anthropic, OpenAI e o provedor nulo
│       ├── prompts        prompts com regras de ancoragem
│       ├── context        construção das fichas de fatos
│       ├── schemas        contratos Pydantic das respostas do modelo
│       ├── nl_query       parser determinístico pt-BR/en
│       └── analyst        orquestração pergunta → plano → execução → narração
└── tests/               59 testes

frontend/
├── src/
│   ├── app/             rotas (App Router)
│   ├── components/
│   │   ├── ui/            primitivos
│   │   ├── charts/        ECharts, KPI, tabela virtualizada, insights
│   │   ├── dashboard/     grade, editor, filtros, apresentação
│   │   ├── three/         WebGL (carregado sob demanda)
│   │   ├── analyst/       chat
│   │   ├── upload/        dropzone e progresso
│   │   └── landing/       página inicial
│   ├── lib/             cliente da API, opções de gráfico, paleta, formatação
│   ├── hooks/           dados, tema, autenticação
│   ├── store/           estado do dashboard com undo/redo
│   └── workers/         pré-validação de CSV fora da thread principal
```

### Decisões técnicas

**Por que ECharts.** Um único pacote cobre os 14 tipos exigidos — incluindo
boxplot, treemap, heatmap, radar e funil — com boa performance em canvas. O
build é tree-shaken: só os gráficos e componentes realmente usados entram no
bundle.

**Por que Parquet.** Colunar, tipado e comprimido. O CSV é convertido uma vez na
ingestão; todas as consultas seguintes leem tipos nativos, sem reparsear texto.
Um cache LRU evita releituras de disco.

**Por que um plano de consulta declarativo.** O motor nunca recebe expressões —
recebe uma estrutura (agrupamentos, métricas, filtros, granularidade) validada
contra o schema real antes de virar operações de Pandas. Nada vindo do CSV, do
usuário ou do modelo é avaliado como código.

**Por que três.js sob demanda.** O 3D complementa os dados; não é pré-requisito
para lê-los. Carregar a biblioteca só quando uma página realmente renderiza uma
cena tirou ~220 kB do carregamento inicial.

---

## Visualização de dados

A paleta categórica foi validada contra as duas superfícies reais do produto
(claro `#ffffff`, escuro `#111118`) nos seis critérios de acessibilidade: banda
de luminosidade, piso de croma, separação para daltonismo (ΔE 8,4 adjacente),
piso de visão normal (ΔE 19,3) e contraste.

Regras aplicadas em todos os gráficos:

- **Nunca dois eixos Y.** Escalas diferentes são indexadas a uma base comum
  (=100 no primeiro período) em um único eixo. Dois eixos alinham escalas de
  forma arbitrária e fabricam correlações que não existem nos dados.
- **Cor segue a entidade, não a posição no ranking.** Filtrar uma série não
  repinta as demais.
- **Sem rampa de valor em categorias nominais.** Uma série, uma cor.
- Marcas finas, extremidades arredondadas de 4 px, vão de 2 px entre
  preenchimentos, grade sólida em fio de cabelo.
- Legenda sempre presente com duas ou mais séries; rótulos diretos apenas
  seletivos.
- Alternância gráfico/tabela em todo widget, o que satisfaz a regra de alívio
  para os tons de menor contraste no tema claro.

---

## Segurança

- **Isolamento por conta.** Um conjunto de dados de outra conta responde 404,
  nunca 403 — a API não confirma a existência de recursos alheios.
- **Nenhuma execução de código.** Nada vindo do CSV ou do modelo é avaliado.
  Consultas são planos declarativos validados contra o schema real.
- **Injeção de fórmula neutralizada.** Células que começam com `=`, `+`, `-` ou
  `@` são prefixadas na ingestão e na exportação, para não executarem em
  planilhas.
- **Caminhos derivados apenas de IDs validados.** Nomes de arquivo enviados pelo
  usuário nunca compõem um caminho de disco.
- **Limites explícitos** de tamanho de upload, linhas e colunas, verificados
  antes de qualquer processamento.
- **Rate limiting** em login, cadastro, redefinição de senha, upload e chat.
- **Senhas** com bcrypt e pré-hash SHA-256 para preservar entropia acima de 72
  bytes. Tokens de redefinição são de uso único, vinculados ao hash vigente.
- **Enumeração de contas bloqueada:** login e recuperação de senha respondem de
  forma idêntica existindo ou não a conta.

---

## Testes

```bash
cd backend && ./.venv/bin/python -m pytest -q          # 59 testes
cd frontend && npm run typecheck && npm run lint       # tipos e lint
```

A suíte do backend cobre ingestão (encoding, separadores, formatos brasileiros,
injeção de fórmula), correção analítica (períodos parciais, aditividade,
robustez da correlação a outliers, coerência entre insight e dado), integridade
da especificação do dashboard, isolamento entre usuários e rate limiting.

---

## Limites conhecidos

- O upload é processado de forma síncrona. Para arquivos muito grandes em
  produção, mover a análise para uma fila (Celery ou RQ) evita segurar a
  conexão HTTP.
- O rate limiting usa memória do processo. Com múltiplos workers, aponte o
  `slowapi` para Redis via `storage_uri`.
- O mapa geográfico ainda é renderizado como ranking horizontal; a projeção
  coroplética depende de incluir os GeoJSON de UF e país.
- Exportação em PDF é uma captura do dashboard renderizado. Um relatório
  paginado com quebras controladas exigiria geração no servidor.
