import { requestMfaReauth,
  expireAuthSession,
  lockAuthSession,
  getStoredAuthToken } from '@/shared/authToken';
import { readVoiceConfig, voiceConfigHeaders } from '@/shared/voiceConfig';
import { isBlockedInTargetMode } from '@/shared/transport/target-route-policy';
import { TargetUrlError, httpUrl, isTargetMode } from '@/shared/transport/target-context';
import { handleTargetResponse } from '@/shared/transport/target-response';

// Headers are a plain record rather than the full `HeadersInit` union so the
// defaults below can be merged with a caller's headers by spreading.
export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

// What a Remote tab sees for a route its Host will never serve (or a request path
// the tab refuses to send): the same answer the Host would give, produced locally
// so nothing is sent.
const blockedInTargetResponse = (): Response =>
  new Response(
    JSON.stringify({
      success: false,
      error: { code: 'REMOTE_FORBIDDEN', message: 'This feature is not available in a Remote tab.' },
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );

// httpUrl throws for a path a tab must not send its token to; the caller gets the local 403 instead.
const targetRequestUrl = (url: string): string | null => {
  try {
    return httpUrl(url);
  } catch (error) {
    if (error instanceof TargetUrlError) return null;
    throw error;
  }
};

// Only an authentication lock should hide the application; other resources may also use 423.
async function announceSessionLock(response: Response): Promise<void> {
  if (response.status !== 423) return;
  const payload = await response.clone().json().catch(() => null);
  if ((payload?.code ?? payload?.error?.code) === 'AUTH_SESSION_LOCKED') lockAuthSession();
}

// Utility function for authenticated API calls
export const authenticatedFetch = (
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> => {
  const target = isTargetMode();
  // In a Remote tab the prefixed URL is built (and policed) before anything is sent.
  const requestUrl = target ? targetRequestUrl(url) : url;
  if (target && (requestUrl === null || isBlockedInTargetMode(url))) {
    return Promise.resolve(blockedInTargetResponse());
  }

  const token = getStoredAuthToken();

  const defaultHeaders: Record<string, string> = { 'X-RemoteCLI-Request': '1' };

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  // A tab authenticates with its tab token even in a platform build.
  if (target && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const send = () => fetch(requestUrl ?? url, {
    ...options,
    credentials: target ? 'omit' : 'same-origin',
    cache: 'no-store',
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
  return send().then(async (response) => {
    if (target) {
      handleTargetResponse(response);
      return response;
    }
    if (response.status === 403 && !url.startsWith('/api/auth/mfa/reauth')) {
      const payload = await response.clone().json().catch(() => null);
      if ((payload?.code ?? payload?.error?.code) === 'MFA_REAUTH_REQUIRED'
        && !options.signal?.aborted) {
        if (!await requestMfaReauth()) return new Response(JSON.stringify({ error: { code: 'MFA_REAUTH_CANCELLED' } }), { status: 403 });
        if (options.signal?.aborted) return response;
        const retried = await send();
        await announceSessionLock(retried);
        if (retried.status === 401 && retried.headers.get('X-Auth-Error')) expireAuthSession(retried.headers.get('X-Auth-Error'));
        return retried;
      }
    }
    await announceSessionLock(response);
    if (response.status === 401 && response.headers.get('X-Auth-Error')) {
      expireAuthSession(response.headers.get('X-Auth-Error'));
    }
    return response;
  });
};

// ─── Request helpers ────────────────────────────────────────────────────────
// Every endpoint below goes through these so verb, JSON encoding and query
// serialization stay consistent across the whole frontend.

type QueryValue = string | number | boolean | null | undefined;

// Serializes a query object into `?a=1&b=2` (or an empty string). Empty and
// `false` values are dropped so optional flags can be passed unconditionally.
const query = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

/**
 * Reads a `{ success, error, details }` envelope response, throwing the server's
 * message when the request failed.
 *
 * Endpoints return a bare Response, so call sites unwrap it themselves. Most do
 * so in ways that differ deliberately (bare casts where the caller inspects the
 * payload, abort-aware reads in the git panel); this is the shared form for
 * callers that want a failed request to throw.
 */
export class ApiRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(message: string, options: { code?: string; details?: unknown; status: number }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

/**
 * Reads a `{ success, error, details }` envelope response, throwing an
 * ApiRequestError carrying the server's machine-readable error code when one
 * is present. Accepts both legacy string envelopes (`error: 'message'`) and
 * the structured AppError envelope (`error: { code, message, details }`).
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const raw = data.error ?? data.details;
    const payload = raw && typeof raw === 'object' ? raw : {};
    const message = (typeof raw === 'string' ? raw : payload?.message) || data.details || `Request failed (${response.status})`;
    throw new ApiRequestError(message, {
      code: typeof payload?.code === 'string' ? payload.code : undefined,
      details: payload?.details ?? data.details,
      status: response.status,
    });
  }
  return data as T;
}

/**
 * Picks the server's human-readable message out of a failed response body, or
 * null when it carries none. Accepts the legacy string envelope
 * (`error: 'message'`), the structured AppError envelope
 * (`error: { code, message, details }`) and a top-level `message`.
 *
 * The non-throwing counterpart of readApiJson, used by the auth and onboarding
 * screens because they show their own localized message when the server gives
 * none, by the plugins context for failed plugin list, install, update,
 * uninstall and toggle calls, which all answer with the structured envelope,
 * and by the chat drafts store to say why the server refused a queued message.
 */
export function readApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const { error, message } = body as { error?: unknown; message?: unknown };
  const candidates = [
    error && typeof error === 'object' ? (error as { message?: unknown }).message : error,
    message,
  ];
  // The body is unchecked JSON: anything but a non-blank string is skipped, as
  // an object rendered as a React child throws and unmounts the screen.
  const readable = candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '',
  );
  return readable ?? null;
}

const get = (url: string, options: ApiRequestOptions = {}) => authenticatedFetch(url, options);

const withBody =
  (method: string) =>
    (url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      authenticatedFetch(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...options,
      });

const post = withBody('POST');
const put = withBody('PUT');
const patch = withBody('PATCH');
const del = withBody('DELETE');

// ─── URL builders ───────────────────────────────────────────────────────────
// Exported for the consumers that cannot go through `authenticatedFetch`:
// `EventSource` and `XMLHttpRequest` need a bare URL.

/**
 * Persisted messages for one session. Omitting `limit` requests the whole
 * transcript; passing one always pairs it with an explicit offset so automatic
 * refreshes can never accidentally become an unbounded transcript request.
 */
export const sessionMessagesUrl = (
  sessionId: string,
  { limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {},
): string => {
  const base = httpUrl(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`);
  return limit === null || limit === undefined
    ? base
    : `${base}${query({ limit, offset: offset ?? 0 })}`;
};

const fileContentPath = (projectId: string, filePath: string) =>
  `/api/file-tree/projects/${projectId}/files/content${query({ path: filePath })}`;

/**
 * The Local HTML preview page of a saved `.html`/`.htm` file. The preview iframe loads it by `src` (the
 * server answers it with a sandbox policy), so it is a plain same-origin path, never a Remote tab URL.
 */
export const htmlPreviewPath = (projectId: string, filePath: string) =>
  `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/html-preview${query({ path: filePath })}`;

const pluginAssetPath = (pluginName: string, assetFile: string) =>
  `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(assetFile)}`;

// ─── API endpoints ──────────────────────────────────────────────────────────
// Every `/api/...` path the frontend talks to is declared here; components
// import a named method instead of assembling URLs of their own.

export const api = {
  // Auth endpoints (no token required)
  auth: {
    sessionStatus: () => get('/api/auth/session-status'),
    lock: () => post('/api/auth/lock'),
    unlock: (code: string) => post('/api/auth/unlock', { code }),
    setAutoLock: (enabled: boolean) => put('/api/auth/auto-lock', { enabled }),
    setIdleLockHours: (idleHours: number) => put('/api/auth/auto-lock', { idleHours }),
    mfaStatus: () => get('/api/auth/mfa/status'),
    mfaVerify: (challenge: string, code: string, recovery = false) => post('/api/auth/mfa/verify', { challenge, code, recovery }),
    mfaReauth: (code: string) => post('/api/auth/mfa/reauth', { code }),
    mfaEnroll: (password: string) => post('/api/auth/mfa/enroll', { password }),
    mfaActivate: (code: string) => post('/api/auth/mfa/activate', { code }),
    mfaDisable: (password: string, code: string) => post('/api/auth/mfa/disable', { password, code }),
    mfaRecoveryCodes: (password: string, code: string) => post('/api/auth/mfa/recovery-codes', { password, code }),
    changePassword: (password: string, newPassword: string) => post('/api/auth/password', { password, newPassword }),
    status: () => get('/api/auth/status'),
    login: (username: string, password: string) => authenticatedFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    // `setupToken` is only needed when the operator pinned registration with REMOTECLI_SETUP_TOKEN (or legacy CLOUDCLI_SETUP_TOKEN).
    register: (username: string, password: string, setupToken?: string) => authenticatedFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setupToken ? { username, password, setupToken } : { username, password }),
    }),
    logout: () => post('/api/auth/logout'),
    logoutAll: (password: string) => post('/api/auth/logout-all', { password }),
    sessions: () => get('/api/auth/sessions'),
    revokeSession: (id: string) => del(`/api/auth/sessions/${encodeURIComponent(id)}`),
    user: () => get('/api/auth/user'),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => get('/api/projects'),
  archivedProjects: () => get('/api/projects/archived'),
  projectSessions: (
    projectId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ) =>
    get(
      `/api/projects/${encodeURIComponent(projectId)}/sessions${query({ limit, offset })}`,
      options,
    ),
  projectTaskmaster: (projectId: string) =>
    get(`/api/projects/${encodeURIComponent(projectId)}/taskmaster`),
  renameProject: (projectId: string, displayName: string) =>
    put(`/api/projects/${projectId}/rename`, { displayName }),
  restoreProject: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/restore`),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete = false) =>
    del(`/api/projects/${projectId}${query({ force: hardDelete })}`),
  createProject: (projectData: unknown) => post('/api/projects/create-project', projectData),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    post('/api/projects/migrate-legacy-stars', { projectIds }),
  toggleProjectStar: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`),
  // A clone is two requests: the details (GitHub token included) go in this
  // POST body, and the returned `cloneId` is all the progress stream's URL
  // carries — URLs land in access logs, proxy logs and browser history.
  startProjectClone: (cloneRequest: {
    path: string;
    githubUrl: string;
    githubTokenId: number | null;
    newGithubToken: string | null;
  }) => post('/api/projects/clone', cloneRequest),
  // A native EventSource cannot send an Authorization header, so in Local mode the
  // token rides along as a query parameter on the streaming endpoints below. A
  // Remote tab never puts its token in a URL: openEventSource streams those
  // endpoints over fetch with a header instead.
  cloneProjectProgressUrl: ({ cloneId }: { cloneId: string }) =>
    httpUrl(`/api/projects/clone-progress${query({ cloneId })}`),
  searchConversationsUrl: (searchQuery: string, limit = 50) =>
    httpUrl(`/api/providers/search/sessions${query({
      q: searchQuery,
      limit,
    })}`),

  // Session endpoints. Provider/project metadata are resolved by the backend
  // from the session id.
  // Session deletion mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete = false) =>
    del(`/api/providers/sessions/${sessionId}${query({ force: hardDelete })}`),
  getArchivedSessions: () => get('/api/providers/sessions/archived'),
  // Resolves one session (by app id or provider-native id) to its metadata and
  // owning project — used when a /session/<id> URL isn't in loaded payloads.
  sessionDetails: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}`),
  runningSessions: () => get('/api/providers/sessions/running'),
  recentConversations: ({ limit = 40, offset = 0 }: { limit?: number; offset?: number } = {}) =>
    get(`/api/providers/sessions/recent${query({ limit, offset })}`),
  providerSessionId: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/provider-id`),
  restoreSession: (sessionId: string) => post(`/api/providers/sessions/${sessionId}/restore`),
  // Creates an independent session holding this one's conversation up to
  // `upToAnchorId` (all of it when omitted). The source is left untouched.
  forkSession: (sessionId: string, body: { upToAnchorId?: string; title?: string } = {}) =>
    post(`/api/providers/sessions/${encodeURIComponent(sessionId)}/fork`, body),
  renameSession: (sessionId: string, summary: string) =>
    put(`/api/providers/sessions/${sessionId}`, { summary }),
  // What one agent of a workflow run did, read from its transcript on demand
  // when its row in the workflow card is opened.
  workflowAgentActivity: (sessionId: string, runId: string, agentId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}`),

  // Scheduled messages: send a message to a session at a future time.
  scheduledMessages: {
    list: (sessionId?: string) =>
      get(`/api/scheduled-messages${sessionId ? query({ sessionId }) : ''}`),
    create: (body: { sessionId: string; content: string; scheduledFor: string; options?: unknown }) =>
      post('/api/scheduled-messages', body),
    cancel: (id: string) => del(`/api/scheduled-messages/${encodeURIComponent(id)}`),
  },

  // Workspace file tree
  readFile: (projectId: string, filePath: string) =>
    get(`/api/file-tree/projects/${projectId}/file${query({ filePath })}`),
  // Raw bytes for a workspace file. The endpoint requires the auth header, so
  // media call sites fetch a blob through here instead of using a bare `src`.
  readFileBlob: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
    get(fileContentPath(projectId, filePath), options),
  // Whether the isolated HTML preview page can be served for this file (no session, too large, missing...).
  checkHtmlPreview: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
    get(htmlPreviewPath(projectId, filePath), options),
  saveFile: (projectId: string, filePath: string, content: string) =>
    put(`/api/file-tree/projects/${projectId}/file`, { filePath, content }),
  // Without `directoryPath` the whole project tree (within the server's entry budget); with it, one folder the
  // server had left unlisted (`partial`) listed in full. `includeIgnored` also lists what .gitignore and the
  // default folder lists hide (node_modules, dist, ...); only version-control folders stay out. The other
  // callers (mentions, command palette, file open) keep the default and never pass it.
  getFiles: (projectId: string, options: ApiRequestOptions = {}, directoryPath?: string, includeIgnored = false) =>
    get(
      `/api/file-tree/projects/${projectId}/files${query({ respectGitignore: true, path: directoryPath, includeIgnored })}`,
      options,
    ),

  // File operations
  createFile: (
    projectId: string,
    { path, type, name }: { path: string; type: string; name: string },
  ) => post(`/api/file-tree/projects/${projectId}/files/create`, { path, type, name }),

  renameFile: (projectId: string, { oldPath, newName }: { oldPath: string; newName: string }) =>
    put(`/api/file-tree/projects/${projectId}/files/rename`, { oldPath, newName }),

  deleteFile: (projectId: string, { path, type }: { path: string; type: string }) =>
    del(`/api/file-tree/projects/${projectId}/files`, { path, type }),

  // Uploads with a progress bar go through XMLHttpRequest, which needs the URL.
  uploadFilesUrl: (projectId: string) =>
    httpUrl(`/api/file-tree/projects/${encodeURIComponent(projectId)}/files/upload`),

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath: string | null = null) =>
    get(`/api/file-tree/browse-filesystem${query({ path: dirPath })}`),

  createFolder: (folderPath: string) => post('/api/file-tree/create-folder', { path: folderPath }),

  // Git endpoints. The `project` param carries the DB projectId post-migration.
  git: {
    status: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/status${query({ project: projectId })}`, options),
    diff: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/diff${query({ project: projectId, file: filePath })}`, options),
    commitDiff: (projectId: string, commit: string) =>
      get(`/api/git/commit-diff${query({ project: projectId, commit })}`),
    fileWithDiff: (projectId: string, filePath: string) =>
      get(`/api/git/file-with-diff${query({ project: projectId, file: filePath })}`),
    branches: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branches${query({ project: projectId })}`, options),
    branchDiff: (projectId: string, base: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branch-diff${query({ project: projectId, base })}`, options),
    // `oldPath` is the pre-rename path of a renamed file so the server can diff the rename itself.
    branchDiffFile: (
      projectId: string,
      base: string,
      filePath: string,
      oldPath?: string,
      options: ApiRequestOptions = {},
    ) => get(`/api/git/branch-diff/file${query({ project: projectId, base, file: filePath, oldPath })}`, options),
    remoteStatus: (projectId: string) =>
      get(`/api/git/remote-status${query({ project: projectId })}`),
    commits: (
      projectId: string,
      { limit }: { limit?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(`/api/git/commits${query({ project: projectId, limit })}`, options),
    checkout: (projectId: string, branch: string) =>
      post('/api/git/checkout', { project: projectId, branch }),
    createBranch: (projectId: string, branch: string) =>
      post('/api/git/create-branch', { project: projectId, branch }),
    deleteBranch: (projectId: string, branch: string, force = false) =>
      post('/api/git/delete-branch', { project: projectId, branch, force }),
    fetch: (projectId: string) => post('/api/git/fetch', { project: projectId }),
    pull: (projectId: string) => post('/api/git/pull', { project: projectId }),
    push: (projectId: string) => post('/api/git/push', { project: projectId }),
    publish: (projectId: string, branch: string) =>
      post('/api/git/publish', { project: projectId, branch }),
    discard: (projectId: string, file: string) =>
      post('/api/git/discard', { project: projectId, file }),
    deleteUntracked: (projectId: string, file: string) =>
      post('/api/git/delete-untracked', { project: projectId, file }),
    stage: (projectId: string, files: string[]) =>
      post('/api/git/stage', { project: projectId, files }),
    unstage: (projectId: string, files: string[]) =>
      post('/api/git/unstage', { project: projectId, files }),
    commit: (projectId: string, message: string, files: string[]) =>
      post('/api/git/commit', { project: projectId, message, files }),
    initialCommit: (projectId: string) => post('/api/git/initial-commit', { project: projectId }),
    init: (projectId: string) => post('/api/git/init', { project: projectId }),
    revertLocalCommit: (projectId: string) =>
      post('/api/git/revert-local-commit', { project: projectId }),
    generateCommitMessage: (projectId: string, files: string[], provider: string) =>
      post('/api/git/generate-commit-message', { project: projectId, files, provider }),
  },

  worktrees: {
    list: (projectId: string) => get(`/api/worktrees${query({ project: projectId })}`),
    create: (
      projectId: string,
      { branch, baseBranch }: { branch: string; baseBranch: string | null },
    ) => post('/api/worktrees/create', { project: projectId, branch, baseBranch }),
    open: (projectId: string, worktreePath: string) =>
      post('/api/worktrees/open', { project: projectId, worktreePath }),
    merge: (
      projectId: string,
      worktreePath: string,
      options: { squash?: boolean; message?: string; removeAfterMerge?: boolean },
    ) => post('/api/worktrees/merge', { project: projectId, worktreePath, ...options }),
    remove: (
      projectId: string,
      worktreePath: string,
      options: { force?: boolean; deleteBranch?: boolean },
    ) => post('/api/worktrees/remove', { project: projectId, worktreePath, ...options }),
  },

  // Provider (coding agent) endpoints — models, capabilities, sessions, MCP, skills.
  providers: {
    capabilities: () => get('/api/providers/capabilities'),
    authStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/auth/status`),
    cliStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/cli`),
    updateCli: (provider: string) =>
      post(`/api/providers/${encodeURIComponent(provider)}/cli/update`),
    claudeSettingsPermissions: () => get('/api/providers/claude/settings-permissions'),

    models: (provider: string) => get(`/api/providers/${provider}/models`),
    createModel: (provider: string, input: unknown) =>
      post(`/api/providers/${provider}/models`, input),
    updateModel: (provider: string, recordId: string | number, input: unknown) =>
      patch(`/api/providers/${provider}/models/${recordId}`, input),
    deleteModel: (provider: string, recordId: string | number) =>
      del(`/api/providers/${provider}/models/${recordId}`),
    setCustomModelsOnly: (provider: string, enabled: boolean) =>
      put(`/api/providers/${provider}/models/custom-only`, { enabled }),

    createSession: (payload: {
      provider: string;
      projectPath: string;
      initialMessage?: unknown;
    }) => post('/api/providers/sessions', payload),
    sessionMessages: (
      sessionId: string,
      pagination: { limit?: number | null; offset?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(sessionMessagesUrl(sessionId, pagination), options),
    sessionTokenUsage: (sessionId: string) =>
      get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`),
    sessionActiveModel: (provider: string, sessionId: string) =>
      get(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`),
    setSessionActiveModel: (provider: string, sessionId: string, model: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`, {
        model,
      }),
    setSessionActiveEffort: (provider: string, sessionId: string, effort: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-effort`, {
        effort,
      }),

    mcpServers: (
      provider: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) => get(`/api/providers/${provider}/mcp/servers${query({ scope, workspacePath })}`),
    saveMcpServer: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/mcp/servers`, payload),
    deleteMcpServer: (
      provider: string,
      serverName: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) =>
      del(
        `/api/providers/${provider}/mcp/servers/${encodeURIComponent(serverName)}${query({ scope, workspacePath })}`,
      ),
    saveGlobalMcpServer: (payload: unknown) => post('/api/providers/mcp/servers/global', payload),

    skills: (provider: string, { workspacePath }: { workspacePath?: string } = {}) =>
      get(`/api/providers/${encodeURIComponent(provider)}/skills${query({ workspacePath })}`),
    saveSkills: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/skills`, payload),
  },

  // Slash commands
  commands: {
    // `projectPath` stays optional: a workspace without a resolved path omits
    // the field entirely, which is what the server expects.
    list: (projectPath: string | undefined) => post('/api/commands/list', { projectPath }),
    execute: (payload: unknown) => post('/api/commands/execute', payload),
  },

  // Chat attachments, stored globally under ~/.remotecli/assets (migrated from ~/.cloudcli/assets)
  assets: {
    uploadFiles: (formData: FormData) =>
      authenticatedFetch('/api/assets/files', {
        method: 'POST',
        headers: {}, // Let browser set Content-Type for FormData
        body: formData,
      }),
    file: (storedName: string) => get(`/api/assets/files/${encodeURIComponent(storedName)}`),
    image: (filename: string, options: ApiRequestOptions = {}) =>
      get(`/api/assets/images/${encodeURIComponent(filename)}`, options),
  },

  // TaskMaster endpoints — all addressed by DB projectId post-migration.
  taskmaster: {
    // Update a task
    updateTask: (projectId: string, taskId: string | number, updates: unknown) =>
      put(`/api/taskmaster/update-task/${projectId}/${taskId}`, updates),

    tasks: (projectId: string) => get(`/api/taskmaster/tasks/${encodeURIComponent(projectId)}`),
    mcpStatus: () => get('/api/taskmaster/mcp-status'),
    installationStatus: () => get('/api/taskmaster/installation-status'),

    prdFiles: (projectId: string) => get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`),
    prdFile: (projectId: string, fileName: string) =>
      get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`),
    savePrd: (projectId: string, { fileName, content }: { fileName: string; content: string }) =>
      post(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`, { fileName, content }),
  },

  // User endpoints
  user: {
    gitConfig: () => get('/api/user/git-config'),
    updateGitConfig: (gitName: string, gitEmail: string) =>
      post('/api/user/git-config', { gitName, gitEmail }),
    onboardingStatus: () => get('/api/user/onboarding-status'),
    completeOnboarding: () => post('/api/user/complete-onboarding'),

    // Preferences and chat drafts live server-side so they follow the user
    // from one device to another. `savePreferences` is a merge-patch: only the
    // keys it is given are written.
    preferences: () => get('/api/user/preferences'),
    savePreferences: (updates: Record<string, unknown>) =>
      patch('/api/user/preferences', updates),
    drafts: () => get('/api/user/drafts'),
    // Without `queuedMessage` only the text is written; the stored queued
    // message is left as it is.
    saveDraft: (scope: string, draft: { text: string; queuedMessage?: unknown }) =>
      put('/api/user/drafts', { scope, ...draft }),
    // Appends to the scope's queued message on the server and returns the
    // message that is now queued.
    appendQueuedMessage: (scope: string, queuedMessage: unknown) =>
      post('/api/user/drafts/queued-message', { scope, queuedMessage }),
    clearQueuedMessage: (scope: string) => del('/api/user/drafts/queued-message', { scope }),
  },

  // Server-side settings: API keys, stored credentials, notifications, web push
  settings: {
    apiKeys: () => get('/api/settings/api-keys'),
    createApiKey: (keyName: string) => post('/api/settings/api-keys', { keyName }),
    deleteApiKey: (keyId: string) => del(`/api/settings/api-keys/${keyId}`),
    toggleApiKey: (keyId: string, isActive: boolean) =>
      patch(`/api/settings/api-keys/${keyId}/toggle`, { isActive }),

    credentials: (type: string) => get(`/api/settings/credentials${query({ type })}`),
    createCredential: (payload: {
      credentialName: string;
      credentialType: string;
      credentialValue: string;
      description?: string;
    }) => post('/api/settings/credentials', payload),
    deleteCredential: (credentialId: string) => del(`/api/settings/credentials/${credentialId}`),
    toggleCredential: (credentialId: string, isActive: boolean) =>
      patch(`/api/settings/credentials/${credentialId}/toggle`, { isActive }),

    notificationPreferences: () => get('/api/settings/notification-preferences'),
    saveNotificationPreferences: (preferences: unknown) =>
      put('/api/settings/notification-preferences', preferences),

    push: {
      vapidPublicKey: () => get('/api/settings/push/vapid-public-key'),
      subscribe: (subscription: { endpoint?: string; keys?: unknown }) =>
        post('/api/settings/push/subscribe', subscription),
      unsubscribe: (endpoint: string) => post('/api/settings/push/unsubscribe', { endpoint }),
    },
  },

  plugins: {
    list: () => get('/api/plugins'),
    install: (url: string) => post('/api/plugins/install', { url }),
    uninstall: (name: string) => del(`/api/plugins/${encodeURIComponent(name)}`),
    update: (name: string) => post(`/api/plugins/${encodeURIComponent(name)}/update`),
    toggle: (name: string, enabled: boolean) =>
      put(`/api/plugins/${encodeURIComponent(name)}/enable`, { enabled }),
    // Plugin bundles/icons are fetched with auth headers and handed to the
    // browser as blobs, so a bare asset URL is never requested unauthenticated.
    asset: (pluginName: string, assetFile: string) => get(pluginAssetPath(pluginName, assetFile)),
    // Exposed so the icon cache can key on the resolved asset path.
    assetUrl: pluginAssetPath,
    rpc: (pluginName: string, method: string, path: string, body?: unknown) =>
      authenticatedFetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${String(path).replace(/^\//, '')}`,
        {
          method: method || 'GET',
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      ),
  },

  browserUse: {
    status: () => get('/api/browser-use/status'),
    settings: () => get('/api/browser-use/settings'),
    saveSettings: (settings: unknown) => put('/api/browser-use/settings', settings),
    sessions: () => get('/api/browser-use/sessions'),
    stopSession: (sessionId: string) => post(`/api/browser-use/sessions/${sessionId}/stop`),
    deleteSession: (sessionId: string) => del(`/api/browser-use/sessions/${sessionId}`),
    sendInput: (sessionId: string, input: unknown) => post(`/api/browser-use/sessions/${sessionId}/input`, input),
    installRuntime: () => post('/api/browser-use/runtime/install'),
  },

  voice: {
    health: () => get('/api/voice/health'),
    transcribe: (formData: FormData, headers: Record<string, string> = {}) =>
      authenticatedFetch('/api/voice/transcribe', {
        method: 'POST',
        headers,
        body: formData,
      }),
    tts: (text: string, options: ApiRequestOptions = {}) => post('/api/voice/tts', { text }, options),
  },

  system: {
    update: () => post('/api/system/update'),
    version: (force = false) => get(`/api/system/version${force ? '?force=true' : ''}`),
  },

  // Management of Remote work, Controller and Host side (contracts.md section 2).
  // These run in the Local page with the full JWT; the Remote tab frames never call them.
  // Endpoints marked `*` in the contract take the account password in the body.
  remote: {
    peers: () => get('/api/remote/peers'),
    tabToken: (peerId: string) =>
      post(`/api/remote/peers/${encodeURIComponent(peerId)}/tab-token`),
    relayConfig: () => get('/api/remote/relay-config'),
    saveRelayConfig: (url: string, secret: string, password: string) =>
      put('/api/remote/relay-config', { url, secret, password }),
    hostStatus: () => get('/api/remote/host/status'),
    // Read-only audit of what Controllers did on this Host; `before` pages back through older entries.
    audit: (params: { limit?: number; before?: number; controller?: string } = {}) =>
      get(`/api/remote/host/audit${query(params)}`),
    setHostAccept: (enabled: boolean, autoOffHours: number | undefined, password: string) =>
      put('/api/remote/host/accept', { enabled, autoOffHours, password }),
    startHostPairing: (password: string) => post('/api/remote/host/pairings/start', { password }),
    hostPairing: (pairingId: string) =>
      get(`/api/remote/host/pairings/${encodeURIComponent(pairingId)}`),
    confirmHostPairing: (pairingId: string, sas: string) =>
      post(`/api/remote/host/pairings/${encodeURIComponent(pairingId)}/confirm`, { sas }),
    disconnectController: (pairingId: string) =>
      post(`/api/remote/host/controllers/${encodeURIComponent(pairingId)}/disconnect`),
    revokeHostPairing: (pairingId: string, password: string) =>
      del(`/api/remote/host/pairings/${encodeURIComponent(pairingId)}`, { password }),
    joinPeer: (code: string, deviceName: string) =>
      post('/api/remote/peers/join', { code, deviceName }),
    joinProgress: (joinId: string) =>
      get(`/api/remote/peers/join/${encodeURIComponent(joinId)}`),
    forgetPeer: (peerId: string) => del(`/api/remote/peers/${encodeURIComponent(peerId)}`),
    // `alias: null` (or blank text) clears the name; the label is kept on this Controller only.
    setPeerAlias: (peerId: string, alias: string | null) =>
      put(`/api/remote/peers/${encodeURIComponent(peerId)}/alias`, { alias }),
  },
};

// ---------------------------

//----------------- VOICE TRANSCRIPTION AND SPEECH ------------

/**
 * Builds a URL against the user's own OpenAI-compatible voice endpoint. Private to the
 * voice helpers below, which bypass the RemoteCLI proxy when a base URL is configured.
 */
function voiceDirectUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Serializes the active voice configuration so callers can detect a settings change and
 * drop cached synthesized audio.
 */
export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

/**
 * Transcribes recorded audio, posting directly to the user's configured OpenAI-compatible
 * endpoint when one is set and otherwise going through the RemoteCLI voice proxy.
 */
export function transcribeVoice(blob: Blob, filename: string): Promise<Response> {
  const config = readVoiceConfig();
  const body = new FormData();

  if (config.baseUrl.trim()) {
    body.append('file', blob, filename);
    body.append('model', config.sttModel || 'whisper-1');
    return fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/transcriptions'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body,
    });
  }

  body.append('audio', blob, filename);
  return api.voice.transcribe(body, voiceConfigHeaders());
}

/**
 * Synthesizes speech for the given text, using the user's configured OpenAI-compatible
 * endpoint when one is set and otherwise the RemoteCLI voice proxy.
 */
export function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  const config = readVoiceConfig();

  if (config.baseUrl.trim()) {
    return fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ttsModel || 'tts-1',
        voice: config.ttsVoice || 'alloy',
        input: text,
        ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
      }),
      signal,
    });
  }

  return api.voice.tts(text, { headers: voiceConfigHeaders(), signal });
}
