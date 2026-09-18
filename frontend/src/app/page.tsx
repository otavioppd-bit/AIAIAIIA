'use client';

import Link from 'next/link';
import {
  ArrowRight, BarChart3, Bot, Brain, Check, Compass, Database,
  FileSpreadsheet, Gauge, Lock, Palette, Shield, Sparkles, TrendingUp, Upload, Zap,
} from 'lucide-react';
import { BackgroundField } from '@/components/background/BackgroundField';
import { LandingNav } from '@/components/landing/Nav';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { LazyDataOrb } from '@/components/three/LazyDataOrb';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/layout/Logo';
import { cn } from '@/lib/utils';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <LandingNav />

      <main id="conteudo">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden pt-28 sm:pt-36">
          <BackgroundField variant="hero" />

          {/*
            The structure stands on the field's horizon rather than beside the
            text, so the grid, the lattice and the headline read as one space.
          */}
          <div className="hero-structure pointer-events-none absolute inset-x-0 top-[42%] z-0 mx-auto h-[620px] max-w-5xl">
            <LazyDataOrb
              className="absolute inset-0"
              recordCount={48000}
              coherence={0.92}
              cameraDistance={7.2}
            />
          </div>

          <div className="relative z-10 mx-auto max-w-6xl px-5">
            <div className="mx-auto max-w-[760px] text-center animate-fade-up">
              <span className="eyebrow inline-flex items-center gap-2 rounded-pill border border-dashed border-ink/35 px-3 py-1 text-ink">
                <Sparkles className="h-2.5 w-2.5 text-primary" />
                Do CSV ao dashboard em um passo
              </span>

              <h1 className="display mt-6 text-[44px] sm:text-[64px] lg:text-[70px]">
                Seus dados,
                <br />
                compreendidos.
              </h1>

              <p className="mx-auto mt-6 max-w-[540px] text-body text-ink-muted">
                Envie um CSV. A plataforma entende cada coluna, encontra os padrões que existem de
                fato e monta a análise — sem você escolher um único gráfico.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/register">
                  <Button size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
                    Começar grátis
                  </Button>
                </Link>
                <a href="#como-funciona">
                  <Button size="lg" variant="ghost">
                    Ver como funciona
                  </Button>
                </a>
              </div>

              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-caption text-ink-subtle">
                {['Sem cartão de crédito', 'Formatos brasileiros nativos', 'Seus dados isolados'].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="mt-20 animate-fade-up pb-20 sm:mt-28">
              <DashboardPreview />
            </div>
          </div>
        </section>

        {/* ── The differentiator ─────────────────────────────────────── */}
        <section className="border-y border-line bg-surface/40 py-16">
          <div className="mx-auto max-w-4xl px-5 text-center">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-primary">
              O diferencial
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] sm:text-[32px]">
              Não é CSV → vários gráficos genéricos.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              É compreensão → análise → narrativa → visualização → decisão.
            </p>

            <ol className="mt-9 flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
              {['Compreensão', 'Análise', 'Narrativa', 'Visualização', 'Decisão'].map(
                (step, index, all) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium">
                      {step}
                    </span>
                    {index < all.length - 1 && (
                      <ArrowRight className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                    )}
                  </li>
                ),
              )}
            </ol>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────── */}
        <section id="como-funciona" className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeader
              eyebrow="Como funciona"
              title="Quatro etapas, um arquivo"
              description="Todo o trabalho analítico acontece sobre os seus dados reais. Nenhum número é estimado."
            />

            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: Upload,
                  step: '01',
                  title: 'Upload do CSV',
                  body: 'Codificação, separador e formatos brasileiros de data e moeda são detectados automaticamente. “R$ 1.234,56” vira número; “15/03/2025” vira data.',
                },
                {
                  icon: Brain,
                  step: '02',
                  title: 'A plataforma entende',
                  body: 'Cada coluna recebe um tipo semântico e um papel — métrica, dimensão, data ou identificador — além de saber se pode ou não ser somada.',
                },
                {
                  icon: BarChart3,
                  step: '03',
                  title: 'Dashboard automático',
                  body: 'As visualizações são escolhidas por regras de visualização de dados, e cada gráfico mostra a justificativa da escolha quando você pergunta.',
                },
                {
                  icon: Bot,
                  step: '04',
                  title: 'Converse e ajuste',
                  body: 'Pergunte em português, gere novos gráficos a partir das respostas e personalize cada card do dashboard.',
                },
              ].map((item) => (
                <article
                  key={item.step}
                  className="group rounded-xl border border-line bg-surface p-5 transition-all duration-300 hover:border-line-strong hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="font-mono text-2xs text-ink-subtle">{item.step}</span>
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Honesty section ────────────────────────────────────────── */}
        <section className="border-y border-line bg-surface/40 py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionHeader
                align="left"
                eyebrow="Rigor analítico"
                title="Os números vêm dos dados, sempre"
                description="Um motor determinístico em Pandas calcula tudo. O modelo de linguagem recebe apenas fatos já calculados e cuida da redação — nunca da aritmética."
              />
              <ul className="mt-6 space-y-3">
                {[
                  {
                    title: 'Períodos incompletos são excluídos',
                    body: 'Um mês pela metade não vira uma queda de 90%. A série só considera períodos com cobertura completa.',
                  },
                  {
                    title: 'Medidas não aditivas não são somadas',
                    body: 'Preço unitário, taxa e nota usam média. Somar esses valores produz um número sem significado.',
                  },
                  {
                    title: 'Correlação resistente a valores extremos',
                    body: 'Quando poucos outliers distorcem Pearson, a leitura passa para Spearman e a plataforma explica o porquê.',
                  },
                  {
                    title: 'Toda afirmação traz sua evidência',
                    body: 'Cada insight mostra as colunas usadas e o método estatístico aplicado.',
                  },
                ].map((item) => (
                  <li key={item.title} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <div>
                      <p className="text-[13.5px] font-medium">{item.title}</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-line bg-surface p-6">
              <p className="text-2xs font-semibold uppercase tracking-wide text-primary">
                Exemplo de insight
              </p>
              <p className="mt-3 flex items-center gap-2 text-[15px] font-semibold leading-snug">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-positive/10 text-positive">
                  <TrendingUp className="h-3.5 w-3.5" />
                </span>
                Receita cresceu 18,4% em 9 meses
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                Receita cresceu 18,4% ao longo de 9 meses, saindo de R$ 412.000 em jan/2025 para
                R$ 712.000 em set/2025. A tendência é consistente ao longo de todo o período.
              </p>
              <div className="mt-4 rounded-md bg-surface-sunken p-3">
                <p className="text-2xs font-medium text-ink">Como calculamos</p>
                <p className="mt-1 text-2xs leading-relaxed text-ink-muted">
                  <span className="font-medium">Método:</span> regressão linear sobre a série
                  agregada por mês
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-muted">
                  <span className="font-medium">Colunas:</span>{' '}
                  <span className="font-mono">data_pedido, valor_total</span>
                </p>
              </div>
              <p className="mt-4 text-2xs text-ink-subtle">
                Exemplo ilustrativo. Na plataforma, cada número vem do seu arquivo.
              </p>
            </div>
          </div>
        </section>

        {/* ── Features ───────────────────────────────────────────────── */}
        <section id="recursos" className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeader
              eyebrow="Recursos"
              title="Uma plataforma completa de análise"
              description="Do perfilamento dos dados à apresentação final."
            />

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Database,
                  title: 'Perfilamento de dados',
                  body: 'Tipos, cardinalidade, valores ausentes, duplicidades, quartis e outliers por coluna.',
                },
                {
                  icon: Gauge,
                  title: 'Pontuação de qualidade',
                  body: 'Nota de 0 a 100 em cinco dimensões, com os problemas encontrados e como resolver cada um.',
                },
                {
                  icon: Bot,
                  title: 'AI Data Analyst',
                  body: 'Pergunte em português. A resposta executa uma consulta real sobre o conjunto e pode virar um gráfico novo.',
                },
                {
                  icon: Compass,
                  title: 'Explore',
                  body: 'Escolha eixos, agregação e filtros. O tipo de gráfico adequado é sugerido a cada combinação.',
                },
                {
                  icon: Palette,
                  title: 'Dashboard Builder',
                  body: 'Arraste, redimensione, duplique, troque cores e fontes. Salve versões e restaure quando quiser.',
                },
                {
                  icon: Zap,
                  title: 'Pronto para volume',
                  body: 'Processamento em Parquet, tabelas virtualizadas, cache de consultas e amostragem determinística.',
                },
              ].map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-xl border border-line bg-surface p-5 transition-all duration-300 hover:border-line-strong hover:shadow-md"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <feature.icon className="h-4 w-4" />
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{feature.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Security ───────────────────────────────────────────────── */}
        <section id="seguranca" className="border-y border-line bg-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeader
              eyebrow="Segurança"
              title="Seus dados sob seu controle"
              description="Isolamento por conta, validação estrita e nenhuma execução de código vinda do arquivo."
            />

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: Lock,
                  title: 'Isolamento por conta',
                  body: 'Conjuntos de dados de outra conta retornam “não encontrado”, nunca “proibido”.',
                },
                {
                  icon: Shield,
                  title: 'Sem execução de código',
                  body: 'Nada vindo do CSV ou do modelo é avaliado. Consultas são planos declarativos validados contra o schema real.',
                },
                {
                  icon: FileSpreadsheet,
                  title: 'Exportação segura',
                  body: 'Células que começam com = ou @ são neutralizadas para não executarem fórmulas em planilhas.',
                },
                {
                  icon: Check,
                  title: 'Limites explícitos',
                  body: 'Tamanho de upload, número de linhas e de colunas verificados antes de qualquer processamento.',
                },
              ].map((item) => (
                <article key={item.title} className="rounded-xl border border-line bg-surface p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────── */}
        <section id="planos" className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeader
              eyebrow="Planos"
              title="Comece grátis, cresça quando precisar"
              description="Todos os planos incluem o motor de análise completo."
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {[
                {
                  name: 'Free',
                  price: 'R$ 0',
                  period: '/mês',
                  description: 'Para experimentar com dados reais.',
                  features: [
                    '3 conjuntos de dados',
                    'Até 50 mil linhas por arquivo',
                    'Dashboard automático',
                    'AI Data Analyst',
                    'Exportação PNG e CSV',
                  ],
                  cta: 'Começar grátis',
                  highlighted: false,
                },
                {
                  name: 'Pro',
                  price: 'R$ 89',
                  period: '/mês',
                  description: 'Para quem analisa dados toda semana.',
                  features: [
                    'Conjuntos ilimitados',
                    'Até 2 milhões de linhas',
                    'Dashboards ilimitados e versões',
                    'Todos os temas e personalização',
                    'Exportação PDF e relatórios',
                    'Histórico de conversas',
                  ],
                  cta: 'Assinar Pro',
                  highlighted: true,
                },
                {
                  name: 'Enterprise',
                  price: 'Sob consulta',
                  period: '',
                  description: 'Para times com requisitos próprios.',
                  features: [
                    'Tudo do Pro',
                    'Instalação na sua infraestrutura',
                    'Modelo de linguagem próprio',
                    'SSO e controle de acesso',
                    'Suporte dedicado',
                  ],
                  cta: 'Falar com o time',
                  highlighted: false,
                },
              ].map((plan) => (
                <article
                  key={plan.name}
                  className={cn(
                    'relative flex flex-col rounded-xl border p-6 transition-all duration-300',
                    plan.highlighted
                      ? 'border-primary bg-surface shadow-glow'
                      : 'border-line bg-surface hover:border-line-strong',
                  )}
                >
                  {plan.highlighted && (
                    <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-2xs font-semibold text-primary-ink">
                      Mais escolhido
                    </span>
                  )}

                  <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-[13px] text-ink-muted">{plan.description}</p>

                  <p className="mt-5 flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-[-0.03em]">{plan.price}</span>
                    <span className="text-[13px] text-ink-subtle">{plan.period}</span>
                  </p>

                  <ul className="mt-6 flex-1 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[13px] text-ink-muted">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link href="/register" className="mt-6">
                    <Button fullWidth variant={plan.highlighted ? 'primary' : 'secondary'}>
                      {plan.cta}
                    </Button>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────── */}
        <section className="border-t border-line bg-surface/40 py-20">
          <div className="mx-auto max-w-2xl px-5 text-center">
            <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[32px]">
              Seu próximo dashboard começa com um arquivo
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              Envie um CSV e veja o que os seus dados têm a dizer.
            </p>
            <Link href="/register" className="mt-7 inline-block">
              <Button size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
                Criar conta gratuita
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 sm:flex-row">
          <Logo />
          <p className="text-2xs text-ink-subtle">
            Análise de dados com rigor estatístico. Todo valor exibido vem do seu arquivo.
          </p>
          <nav className="flex gap-4 text-2xs text-ink-subtle">
            <Link href="/login" className="transition-colors hover:text-ink">
              Entrar
            </Link>
            <Link href="/register" className="transition-colors hover:text-ink">
              Criar conta
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  description: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] sm:text-[32px]">{title}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{description}</p>
    </div>
  );
}
