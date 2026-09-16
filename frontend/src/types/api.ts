/** Types mirroring the FastAPI contract. */

export type SemanticType =
  | 'integer' | 'float' | 'currency' | 'percentage' | 'boolean' | 'datetime'
  | 'categorical' | 'text' | 'identifier' | 'geo' | 'email' | 'url';

export type ColumnRole = 'metric' | 'dimension' | 'temporal' | 'identity' | 'free_text';

export type ChartType =
  | 'line' | 'area' | 'bar' | 'bar_horizontal' | 'stacked_bar' | 'scatter'
  | 'donut' | 'pie' | 'histogram' | 'box_plot' | 'heatmap' | 'treemap'
  | 'radar' | 'funnel' | 'kpi' | 'table' | 'map' | 'narrative' | 'insights'
  | 'text' | 'image' | 'scene3d';

export type Aggregation =
  | 'sum' | 'mean' | 'median' | 'count' | 'min' | 'max' | 'nunique' | 'std';

export type TimeGrain = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface User {
  id: string;
  email: string;
  full_name: string;
  company: string;
  onboarding_completed: boolean;
  preferred_theme: string;
  locale: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface OutlierStats {
  count: number;
  ratio: number;
  lower_bound: number | null;
  upper_bound: number | null;
  extreme_count?: number;
  zscore_count?: number;
  examples: number[];
}

export interface HistogramBin {
  bin_start: number | null;
  bin_end: number | null;
  label: string;
  count: number;
}

export interface ColumnStats {
  count?: number;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  min?: number | null;
  max?: number | null;
  sum?: number | null;
  q1?: number | null;
  q3?: number | null;
  iqr?: number | null;
  p05?: number | null;
  p95?: number | null;
  cv?: number | null;
  zeros?: number;
  negatives?: number;
  skewness?: number | null;
  kurtosis?: number | null;
  outliers?: OutlierStats;
  histogram?: HistogramBin[];
  unique?: number;
  mode?: string;
  mode_ratio?: number;
  entropy?: number;
  balance?: number;
  top_values?: { value: string; count: number; ratio: number }[];
  rare_values?: number;
  true_count?: number;
  false_count?: number;
  true_ratio?: number;
  span_days?: number;
  unique_days?: number;
  suggested_grain?: TimeGrain;
  avg_length?: number | null;
  max_length?: number;
}

export interface ColumnProfile {
  name: string;
  semantic_type: SemanticType;
  role: ColumnRole;
  pandas_dtype: string;
  unique_count: number;
  missing_count: number;
  missing_ratio: number;
  cardinality_ratio: number;
  is_aggregatable: boolean;
  sample_values: unknown[];
  detail: Record<string, unknown> & {
    additive?: boolean;
    default_agg?: Aggregation;
    geo_kind?: string;
    top_values?: { value: string; count: number; ratio: number }[];
  };
  stats?: ColumnStats;
}

export interface DatasetOverview {
  row_count: number;
  original_row_count: number;
  column_count: number;
  total_cells: number;
  memory_bytes: number;
  missing_cells: number;
  missing_ratio: number;
  duplicate_rows: number;
  duplicate_ratio: number;
  complete_rows: number;
  encoding: string;
  delimiter: string;
  constant_columns: string[];
  high_missing_columns: string[];
  sampled_for_stats?: boolean;
}

export interface DatasetProfile {
  overview: DatasetOverview;
  columns: ColumnProfile[];
  type_summary: Record<string, number>;
}

export interface QualityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  recommendation: string;
  columns: string[];
  impact: number;
}

export interface QualityReport {
  score: number;
  grade: string;
  label: string;
  dimensions: {
    key: string;
    label: string;
    score: number;
    weight: number;
    description: string;
  }[];
  issues: QualityIssue[];
  issue_counts: Record<string, number>;
}

export interface Insight {
  kind:
    | 'trend' | 'anomaly' | 'concentration' | 'correlation'
    | 'quality' | 'distribution' | 'composition' | 'ranking';
  title: string;
  description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  importance: number;
  evidence: Record<string, unknown>;
  columns: string[];
}

export interface TrendPoint {
  period: string;
  label: string;
  value: number | null;
}

export interface Trend {
  date_column: string;
  metric_column: string;
  grain: TimeGrain;
  agg: Aggregation;
  points: TrendPoint[];
  change_pct: number | null;
  change_absolute: number | null;
  direction: 'up' | 'down' | 'flat';
  slope: number | null;
  r_squared: number | null;
  first_value: number | null;
  last_value: number | null;
  periods: number;
  best_period: { label: string; value: number | null } | null;
  worst_period: { label: string; value: number | null } | null;
  volatility: number | null;
  notes: string[];
}

export interface CorrelationPair {
  x: string;
  y: string;
  pearson: number | null;
  spearman: number | null;
  abs: number;
  coefficient: number;
  method: 'pearson' | 'spearman';
  sample_size: number;
  strength: string;
  direction: 'positive' | 'negative';
  non_linear: boolean;
  outlier_sensitive: boolean;
}

export interface Kpi {
  id: string;
  label: string;
  value: number;
  format: 'currency' | 'percent' | 'integer' | 'decimal';
  column: string | null;
  agg: Aggregation;
  delta: {
    value: number;
    direction: 'up' | 'down' | 'flat';
    label: string;
    current_period: string;
    previous_period: string;
    current_value: number;
    previous_value: number;
  } | null;
  rationale: string;
}

export interface Recommendation {
  chart_type: ChartType;
  title: string;
  subtitle: string;
  encoding: ChartEncoding;
  rationale: string;
  principle: string;
  score: number;
  columns: string[];
  options: Record<string, unknown>;
  size: { w: number; h: number };
}

export interface DomainInfo {
  key: string;
  label: string;
  description: string;
  confidence: number;
  suggested_questions: string[];
  candidates: { key: string; label: string; score: number; matched_keywords: string[] }[];
}

export interface DatasetAnalysis {
  domain: DomainInfo;
  correlations: { columns: string[]; matrix: (number | null)[][]; pairs: CorrelationPair[] };
  trends: Trend[];
  anomalies: {
    period: string;
    previous_period: string;
    value: number | null;
    previous_value: number | null;
    change_pct: number;
    z_score: number;
    direction: string;
    metric_column: string;
    date_column: string;
  }[];
  breakdowns: {
    dimension: string;
    metric: string | null;
    agg: Aggregation;
    items: { label: string; value: number | null; ratio: number | null }[];
    total: number | null;
    distinct: number;
    top3_share: number;
    pareto_share: number;
    leader: { label: string; value: number | null; ratio: number | null } | null;
  }[];
  columns: {
    metrics: string[];
    dimensions: string[];
    temporal: string[];
    identifiers: string[];
  };
  quality: QualityReport;
  insights: Insight[];
  recommendations: Recommendation[];
  kpis: Kpi[];
  warnings: string[];
  meta: { sampled: boolean; analysed_rows: number; duration_ms: number };
}

export interface DatasetSummary {
  id: string;
  name: string;
  original_filename: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  row_count: number;
  column_count: number;
  size_bytes: number;
  quality_score: number;
  domain: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatasetDetail extends DatasetSummary {
  profile: DatasetProfile;
  semantics: { columns: ColumnProfile[]; domain: DomainInfo };
  analysis: DatasetAnalysis;
}

export interface UploadResponse {
  dataset: DatasetDetail;
  dashboard_id: string | null;
  warnings: string[];
}

export interface ChartEncoding {
  /** Widgets may carry renderer-specific keys such as `normalize`. */
  [key: string]: unknown;
  x?: string | null;
  y?: string | null;
  y2?: string | null;
  series?: string | null;
  agg?: Aggregation | 'none';
  agg2?: Aggregation;
  time_grain?: TimeGrain | null;
  limit?: number;
  sort?: 'asc' | 'desc';
  matrix?: 'correlation' | 'cross';
  geo_kind?: string;
  columns?: string[];
  offset?: number;
  bins?: number;
}

export interface WidgetStyle {
  accent: string;
  background: string;
  border: boolean;
  shadow: 'none' | 'sm' | 'md' | 'lg';
  radius: 'sm' | 'md' | 'lg' | 'xl';
  padding: 'sm' | 'md' | 'lg';
  showLegend: boolean;
  showGrid: boolean;
  showDataLabels: boolean;
  titleSize: 'sm' | 'md' | 'lg';
  fontFamily: 'sans' | 'mono' | 'display';
  colorScheme: string;
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget {
  id: string;
  type: 'kpi' | 'chart' | 'table' | 'narrative' | 'insights' | 'text' | 'image' | 'scene3d';
  title: string;
  subtitle: string;
  layout: WidgetLayout;
  config: {
    chart_type: ChartType;
    encoding: ChartEncoding;
    options?: Record<string, unknown>;
    style: WidgetStyle;
    kpi?: Kpi & { icon?: string };
    narrative?: {
      summary: string;
      sections: { heading: string; body: string }[];
      watch_items: string[];
      source: string;
    };
    insights?: Insight[];
    table?: { pageSize: number; virtualized: boolean };
    text?: { content: string; align: 'left' | 'center' | 'right' };
    image?: { url: string; alt: string; fit: 'cover' | 'contain' };
    scene?: { variant: 'sphere' | 'particles' | 'clusters'; intensity: number };
  };
  rationale: string;
  principle: string;
  locked: boolean;
}

export interface DashboardFilter {
  id: string;
  column: string;
  label: string;
  kind: 'date_range' | 'multi_select' | 'range';
  value: unknown;
  options?: string[];
  min?: string | number | null;
  max?: string | number | null;
}

export interface DashboardSpec {
  version: number;
  title: string;
  subtitle: string;
  theme: string;
  grid: { columns: number; rowHeight: number; gap: number };
  filters: DashboardFilter[];
  widgets: Widget[];
  narrative?: {
    headline: string;
    summary: string;
    sections: { heading: string; body: string }[];
    watch_items: string[];
    source: string;
  };
  meta: Record<string, unknown>;
}

export interface Dashboard {
  id: string;
  dataset_id: string;
  name: string;
  description: string;
  theme: string;
  is_primary: boolean;
  spec: DashboardSpec;
  created_at: string;
  updated_at: string;
}

export interface DashboardVersion {
  id: string;
  version: number;
  label: string;
  created_at: string;
}

export type DataRow = Record<string, string | number | boolean | null>;

export interface WidgetDataResponse {
  columns: string[];
  rows: DataRow[];
  row_count: number;
  truncated: boolean;
  notes: string[];
  meta: {
    chart_type?: string;
    temporal?: boolean;
    agg?: string;
    column?: string;
    axis_labels?: string[];
    regression?: { slope: number; intercept: number; x_min: number; x_max: number } | null;
    [key: string]: unknown;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  payload?: {
    intent?: string;
    chart?: AnalystChart | null;
    plan?: Record<string, unknown>;
    result?: Record<string, unknown> | null;
    follow_ups?: string[];
    source?: string;
    notes?: string[];
  } | null;
  created_at: string;
}

export interface AnalystChart {
  chart_type: ChartType;
  title: string;
  subtitle: string;
  encoding: ChartEncoding;
  inline_data?: { columns: string[]; rows: DataRow[] };
  options?: Record<string, unknown>;
  source: string;
}

export interface AskResponse {
  conversation_id: string;
  message: ChatMessage;
  answer: string;
  intent: string;
  chart: AnalystChart | null;
  result: Record<string, unknown> | null;
  plan: Record<string, unknown>;
  follow_ups: string[];
  source: string;
}

export interface Conversation {
  id: string;
  dataset_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: ChatMessage[];
}

export interface ExploreField {
  name: string;
  label: string;
  semantic_type: SemanticType;
  role: ColumnRole;
  unique_count: number;
  missing_ratio: number;
  is_aggregatable: boolean;
  default_agg?: Aggregation;
  additive?: boolean;
  options: string[];
}

export interface ExploreFieldsResponse {
  columns: ExploreField[];
  metrics: string[];
  dimensions: string[];
  temporal: string[];
  chart_types: ChartType[];
  aggregations: Aggregation[];
}

export interface ExploreResponse extends WidgetDataResponse {
  suggested_chart: ChartType;
  rationale: string;
}

export interface WorkspaceStats {
  datasets: number;
  dashboards: number;
  total_rows: number;
  average_quality: number;
}

export interface AiStatus {
  provider: string;
  model: string;
  available: boolean;
  mode: 'llm' | 'deterministic';
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
