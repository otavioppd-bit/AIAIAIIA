/**
 * Typed API client.
 *
 * Tokens live in localStorage; a 401 triggers a single refresh attempt and the
 * original request is replayed. Concurrent 401s share one refresh promise so a
 * dashboard loading twelve widgets cannot stampede the refresh endpoint.
 */
import type {
  AiStatus,
  AskResponse,
  Conversation,
  Dashboard,
  DashboardSpec,
  DashboardSummary,
  DashboardVersion,
  DatasetDetail,
  DatasetSummary,
  ExploreFieldsResponse,
  ExploreResponse,
  TokenResponse,
  UploadResponse,
  User,
  WidgetDataResponse,
  WorkspaceStats,
  ApiErrorBody,
  ChartEncoding,
  ChartType,
  DataRow,
} from '@/types/api';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const API_PREFIX = '/api/v1';

const ACCESS_KEY = 'prisma.access_token';
const REFRESH_KEY = 'prisma.refresh_token';
const USER_KEY = 'prisma.user';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || 'Erro inesperado');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code || 'error';
    this.details = body.details;
  }

  /** Flatten Pydantic-style validation details into readable lines. */
  get fieldErrors(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter((d): d is { field?: string; message?: string } => typeof d === 'object' && d !== null)
      .map((d) => (d.field ? `${d.field}: ${d.message}` : String(d.message ?? '')))
      .filter(Boolean);
  }
}

// --- Token storage --------------------------------------------------------

export const tokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  get user(): User | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  },
  set(tokens: TokenResponse): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCESS_KEY, tokens.access_token);
    window.localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
    window.dispatchEvent(new CustomEvent('prisma:auth-change'));
  },
  setUser(user: User): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('prisma:auth-change'));
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new CustomEvent('prisma:auth-change'));
  },
};

// --- Core request ---------------------------------------------------------

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  const token = tokenStore.refresh;
  if (!token) return false;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_URL}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
      });
      if (!response.ok) {
        tokenStore.clear();
        return false;
      }
      tokenStore.set((await response.json()) as TokenResponse);
      return true;
    } catch {
      return false;
    } finally {
      // Release the lock on the next tick so queued callers see the new token.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
  raw?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, raw = false, headers, ...rest } = options;

  const build = (): RequestInit => {
    const finalHeaders = new Headers(headers);
    if (auth) {
      const token = tokenStore.access;
      if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
    }
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      finalHeaders.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
    return { ...rest, headers: finalHeaders, body: payload };
  };

  let response = await fetch(`${API_URL}${API_PREFIX}${path}`, build());

  if (response.status === 401 && auth && tokenStore.refresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await fetch(`${API_URL}${API_PREFIX}${path}`, build());
    }
  }

  if (!response.ok) {
    let payload: ApiErrorBody = { code: 'error', message: `Erro ${response.status}` };
    try {
      payload = (await response.json()) as ApiErrorBody;
    } catch {
      /* response had no JSON body */
    }
    if (response.status === 401) tokenStore.clear();
    throw new ApiError(response.status, payload);
  }

  if (raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- Endpoints ------------------------------------------------------------

export const api = {
  auth: {
    register: (body: {
      email: string;
      password: string;
      full_name?: string;
      company?: string;
    }) => request<TokenResponse>('/auth/register', { method: 'POST', body, auth: false }),

    login: (body: { email: string; password: string }) =>
      request<TokenResponse>('/auth/login', { method: 'POST', body, auth: false }),

    forgotPassword: (email: string) =>
      request<{ message: string; ok: boolean }>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
        auth: false,
      }),

    resetPassword: (body: { token: string; password: string }) =>
      request<{ message: string; ok: boolean }>('/auth/reset-password', {
        method: 'POST',
        body,
        auth: false,
      }),

    me: () => request<User>('/auth/me'),

    updateProfile: (body: Partial<Pick<User, 'full_name' | 'company' | 'preferred_theme' | 'locale' | 'onboarding_completed'>>) =>
      request<User>('/auth/me', { method: 'PATCH', body }),

    changePassword: (body: { current_password: string; new_password: string }) =>
      request<{ message: string }>('/auth/change-password', { method: 'POST', body }),
  },

  datasets: {
    list: () => request<DatasetSummary[]>('/datasets'),

    get: (id: string) => request<DatasetDetail>(`/datasets/${id}`),

    upload: (file: File, onProgress?: (percent: number) => void) =>
      uploadWithProgress(file, onProgress),

    rename: (id: string, name: string) =>
      request<DatasetSummary>(`/datasets/${id}`, { method: 'PATCH', body: { name } }),

    remove: (id: string) => request<{ message: string }>(`/datasets/${id}`, { method: 'DELETE' }),

    rows: (id: string, limit = 50, offset = 0) =>
      request<{ columns: string[]; rows: DataRow[]; total: number; limit: number; offset: number }>(
        `/datasets/${id}/rows?limit=${limit}&offset=${offset}`,
      ),

    quality: (id: string) => request<DatasetDetail['analysis']['quality']>(`/datasets/${id}/quality`),

    reanalyse: (id: string) =>
      request<DatasetDetail>(`/datasets/${id}/reanalyse`, { method: 'POST' }),

    stats: () => request<WorkspaceStats>('/datasets/stats/overview'),

    widgetData: (
      datasetId: string,
      body: {
        chart_type: ChartType | string;
        encoding: ChartEncoding;
        filters?: Record<string, unknown>[];
        limit?: number;
      },
    ) => request<WidgetDataResponse>(`/datasets/${datasetId}/widget-data`, { method: 'POST', body }),

    report: (id: string) =>
      request<{ title: string; markdown: string; generated_at: string }>(`/datasets/${id}/report`),

    suggestedQuestions: (id: string) =>
      request<{ questions: string[]; domain: string }>(`/datasets/${id}/suggested-questions`),
  },

  dashboards: {
    // Returns summaries without the spec; use `get` for the full dashboard.
    list: (datasetId?: string) =>
      request<DashboardSummary[]>(`/dashboards${datasetId ? `?dataset_id=${datasetId}` : ''}`),

    get: (id: string) => request<Dashboard>(`/dashboards/${id}`),

    create: (body: { dataset_id: string; name?: string; spec?: DashboardSpec }) =>
      request<Dashboard>('/dashboards', { method: 'POST', body }),

    update: (
      id: string,
      body: {
        name?: string;
        description?: string;
        theme?: string;
        spec?: DashboardSpec;
        save_version?: boolean;
        version_label?: string;
      },
    ) => request<Dashboard>(`/dashboards/${id}`, { method: 'PATCH', body }),

    remove: (id: string) => request<{ message: string }>(`/dashboards/${id}`, { method: 'DELETE' }),

    versions: (id: string) => request<DashboardVersion[]>(`/dashboards/${id}/versions`),

    saveVersion: (id: string, label: string) =>
      request<DashboardVersion>(
        `/dashboards/${id}/versions?label=${encodeURIComponent(label)}`,
        { method: 'POST' },
      ),

    restoreVersion: (id: string, versionId: string) =>
      request<Dashboard>(`/dashboards/${id}/versions/${versionId}/restore`, { method: 'POST' }),

    regenerate: (datasetId: string) =>
      request<Dashboard>(`/datasets/${datasetId}/dashboards/generate`, { method: 'POST' }),
  },

  explore: {
    fields: (datasetId: string) =>
      request<ExploreFieldsResponse>(`/datasets/${datasetId}/explore/fields`),

    run: (
      datasetId: string,
      body: {
        x?: string | null;
        y?: string | null;
        series?: string | null;
        agg?: string;
        time_grain?: string | null;
        filters?: Record<string, unknown>[];
        sort_desc?: boolean;
        limit?: number;
        chart_type?: string;
      },
    ) => request<ExploreResponse>(`/datasets/${datasetId}/explore`, { method: 'POST', body }),
  },

  analyst: {
    status: () => request<AiStatus>('/ai/status'),

    ask: (datasetId: string, question: string, conversationId?: string | null) =>
      request<AskResponse>(`/datasets/${datasetId}/ask`, {
        method: 'POST',
        body: { question, conversation_id: conversationId ?? null },
      }),

    conversations: (datasetId: string) =>
      request<Conversation[]>(`/datasets/${datasetId}/conversations`),

    conversation: (id: string) => request<Conversation>(`/conversations/${id}`),

    deleteConversation: (id: string) =>
      request<{ message: string }>(`/conversations/${id}`, { method: 'DELETE' }),
  },

  exports: {
    csvUrl: (datasetId: string) => `${API_URL}${API_PREFIX}/datasets/${datasetId}/export/csv`,
    reportUrl: (datasetId: string) => `${API_URL}${API_PREFIX}/datasets/${datasetId}/export/report`,

    /** Downloads through fetch so the Authorization header is attached. */
    download: async (url: string, filename: string): Promise<void> => {
      const token = tokenStore.access;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        throw new ApiError(response.status, {
          code: 'export_failed',
          message: 'Não foi possível gerar o arquivo.',
        });
      }
      const blob = await response.blob();
      const { downloadBlob } = await import('@/lib/utils');
      downloadBlob(blob, filename);
    },
  },
};

/** XHR upload so real progress events are available (fetch cannot report them). */
function uploadWithProgress(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${API_PREFIX}/datasets`);
    const token = tokenStore.access;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = { code: 'error', message: 'Resposta inválida do servidor.' };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as UploadResponse);
      } else {
        reject(new ApiError(xhr.status, payload as ApiErrorBody));
      }
    };

    xhr.onerror = () =>
      reject(
        new ApiError(0, {
          code: 'network_error',
          message: 'Não foi possível conectar ao servidor. Verifique se a API está rodando.',
        }),
      );
    xhr.ontimeout = () =>
      reject(new ApiError(0, { code: 'timeout', message: 'O envio demorou demais.' }));

    xhr.timeout = 10 * 60 * 1000;
    xhr.send(form);
  });
}
