import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

import type { WebSocket } from 'ws';

//----------------- HTTP RESPONSE SHAPES ------------
/**
 * Canonical success envelope used by backend APIs that return a structured payload.
 *
 * Use this for route handlers that need a stable `success/data` shape so frontend
 * consumers can parse responses consistently across endpoints.
 */
export type ApiSuccessShape<TData = unknown> = {
  success: true;
  data: TData;
};

/**
 * Generic plain-object record used when parsing loosely typed JSON payloads.
 *
 * Use this only after runtime shape checks, not as a replacement for validated
 * domain models.
 */
export type AnyRecord = Record<string, any>;

// ---------------------------
//----------------- WEBSOCKET TRANSPORT TYPES ------------
/**
 * Minimal websocket client contract used by backend broadcaster services.
 *
 * Any transport object added to `connectedClients` must implement these two
 * members so shared services can safely send JSON strings and check whether the
 * socket is still open before broadcasting.
 */
export type RealtimeClientConnection = {
  readyState: number;
  send(data: string): void;
};

/**
 * Authenticated user payload attached to websocket upgrade requests.
 *
 * Platform and OSS auth flows currently use either `id` or `userId`; both are
 * represented here so websocket handlers can resolve a stable writer user id.
 */
export type AuthenticatedWebSocketUser = {
  id?: string | number;
  userId?: string | number;
  username?: string;
  [key: string]: unknown;
};

/**
 * HTTP upgrade request shape after websocket authentication succeeds.
 *
 * `verifyClient` populates `request.user` with the authenticated payload, and
 * downstream websocket handlers rely on this extended request type.
 */
export type AuthenticatedWebSocketRequest = IncomingMessage & {
  user?: AuthenticatedWebSocketUser;
};

// ---------------------------
//----------------- PROVIDER MESSAGE MODEL ------------
/**
 * Providers supported by the unified server runtime.
 *
 * Use this as the source of truth whenever a function or payload needs to identify
 * a specific LLM integration.
 */
export type LLMProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

/**
 * One selectable model row in a provider model catalog.
 */
export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  /** Stable SQLite row id used only by model-management actions. */
  recordId?: number;
  /** True for user-created rows; false for immutable CloudCLI defaults. */
  isCustom?: boolean;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

/**
 * Provider model catalog returned by `GET /api/providers/:provider/models`.
 */
export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
  /**
   * Reasoning-effort levels a custom entry of this catalog may declare, weakest
   * first; empty for providers without effort support. The Providers service
   * sets it on merged catalogs from the capability matrix, so the model
   * library offers the same levels on every machine. Adapter catalogs omit it.
   */
  EFFORT_LEVELS?: string[];
  /**
   * The user's "use only my models" flag for this provider, set by the
   * Providers service on merged catalogs. While it is true and at least one
   * custom model exists, `OPTIONS` holds only custom models and `DEFAULT` is
   * the first of them; with no custom models the built-ins are listed anyway.
   * Adapter catalogs omit it.
   */
  CUSTOM_MODELS_ONLY?: boolean;
};

/**
 * One persisted custom-model row in the provider model library.
 *
 * Provider modules use this shape at the database boundary. Predefined models
 * never use this type because they remain source-controlled in provider
 * adapters. `modelId` is sent to the provider runtime, while `model` is the
 * user-supplied display name shown in pickers.
 */
export type CustomProviderModelRecord = {
  recordId: number;
  provider: LLMProvider;
  modelId: string;
  model: string;
  sortOrder: number;
  /** NULL for rows that never declared effort levels, including pre-existing rows. */
  effort: CustomProviderModelEffort | null;
};

/**
 * Reasoning-effort levels a user declared for one custom model.
 *
 * `values` holds unique, non-empty level ids drawn from the levels the
 * provider's predefined models declare, and is never empty (an empty
 * declaration is stored as NULL). `default`, when present, is one of `values`
 * and documents the level the provider applies when the composer sends
 * `Default`, mirroring `ProviderModelOption['effort'].default`.
 */
export type CustomProviderModelEffort = {
  values: string[];
  default?: string;
};

/**
 * User-editable values accepted when creating or changing a custom model.
 *
 * `id` must be the exact provider-facing model identifier and cannot contain
 * whitespace. `model` is a concise display name. The provider is supplied by
 * the route path so a row can never be moved across providers accidentally.
 */
export type CustomProviderModelInput = {
  id: string;
  model: string;
  /**
   * Optional reasoning-effort declaration. `undefined` leaves stored metadata
   * untouched on update (and stores none on create) so clients that predate
   * effort metadata keep working; `null` clears it.
   */
  effort?: CustomProviderModelEffort | null;
};

// ---------------------------
//----------------- PROVIDER ACTIVE MODEL TYPES ------------
/**
 * Provider-neutral result for the model that is actively driving a session or
 * provider runtime at the time of lookup.
 *
 * `model` must always be populated. Provider adapters should use the
 * provider-specific lookup method requested by the caller, and only fall back
 * to the provider catalog `DEFAULT` value when the active model cannot be read.
 */
export type ProviderCurrentActiveModel = {
  model: string;
};

/**
 * Where a resolved session model came from.
 *
 * `session` means the app has recorded a model for this session (the user
 * picked one, or the session has been sent on at least once) and that value is
 * authoritative. `provider` means the session predates any app-recorded model
 * and the value was read back from the provider's own session state — the case
 * for sessions started directly in a provider CLI. `default` means neither was
 * available and the catalog default is standing in.
 *
 * Routes surface this so the frontend can tell a real selection apart from a
 * placeholder without re-deriving the precedence chain.
 */
export type ProviderSessionModelSource = 'session' | 'provider' | 'default';

/**
 * The model one session runs with, its persisted reasoning effort when one has
 * been recorded, and where the model answer came from.
 *
 * Returned by `providerModelsService.resolveSessionModel` and used by the
 * `/models`, `/cost` and `/status` commands, the active-model route, and the
 * composer's model picker so every surface agrees on one answer.
 */
export type ProviderSessionModel = {
  provider: LLMProvider;
  sessionId: string | null;
  model: string;
  /** NULL means this session has not recorded an effort choice yet. */
  effort: string | null;
  source: ProviderSessionModelSource;
};

/**
 * Message/event variants emitted by provider adapters and normalized transports.
 *
 * Keep this union in sync with event kinds produced by provider session adapters.
 */
export type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_resolved'
  | 'permission_cancelled'
  | 'session_created'
  | 'history_truncated'
  | 'task_notification'
  | 'task_status';

/**
 * Event kinds added by the chat gateway layer on top of provider message kinds.
 *
 * These are app-level realtime events (subscription acks, sidebar deltas,
 * project loading progress, protocol failures, scheduled-message changes) that
 * are not produced by any provider adapter. Together with `MessageKind` they
 * form the complete set of `kind` values a websocket client can receive, so
 * the frontend only ever needs one kind-based switch.
 */
export type GatewayEventKind =
  | 'chat_subscribed'
  | 'session_upserted'
  | 'loading_progress'
  | 'protocol_error'
  | 'scheduled_messages_changed';

/**
 * Complete set of `kind` values emitted to websocket clients.
 *
 * Every server-to-client websocket frame carries a `kind` from this union.
 * Provider runtimes emit `MessageKind` values; gateway services emit
 * `GatewayEventKind` values.
 */
export type ServerEventKind = MessageKind | GatewayEventKind;

/** The owning project as it appears inside a `session_upserted` delta. */
export type SessionUpsertedProject = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  isStarred: boolean;
};

/**
 * The `session_upserted` sidebar delta, built only by
 * `modules/websocket/services/session-upsert-broadcast.service.ts`.
 *
 * Typed rather than assembled as an untyped object literal because the payload
 * used to be built in two places and silently drifted apart: one copy set
 * `providerSessionId` and the other did not, and nothing could detect it.
 *
 * `providerSessionId` is how a client recognises that a row it is currently
 * showing has been merged into its canonical app-session row, so it is always
 * present — `null` only while the provider has not reported an id yet.
 */
export type SessionUpsertedEvent = {
  kind: 'session_upserted';
  sessionId: string;
  providerSessionId: string | null;
  provider: LLMProvider;
  session: {
    id: string;
    summary: string;
    messageCount: number;
    lastActivity: string;
  };
  project: SessionUpsertedProject | null;
  timestamp: string;
};

/**
 * Provider-neutral message envelope used in REST responses and realtime channels.
 *
 * Every provider-specific message must be converted into this shape before being
 * emitted outside provider-specific modules.
 */
/**
 * A compaction, as the transcript records it.
 *
 * `running` is the status the CLI sends when it starts compacting, `done` the
 * boundary it sends when it has, `failed` a compaction that did not finish.
 * The token counts and duration only come with a boundary.
 */
export type CompactionInfo = {
  phase: 'running' | 'done' | 'failed';
  /** Whether the user asked for it or the context window did. */
  trigger?: 'manual' | 'auto';
  /** Tokens the conversation held before and after, when the boundary reports them. */
  preTokens?: number;
  postTokens?: number;
  durationMs?: number;
  error?: string | null;
};

export type NormalizedMessage = {
  id: string;
  /**
   * The provider's own identifier for the transcript row this message came
   * from, when the provider has stable per-row identity (today: Claude's
   * `uuid`). It is what "edit this message" and "fork from here" address, so it
   * has to survive a reload — never a value this app synthesized.
   */
  transcriptAnchorId?: string;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;
  /**
   * Monotonic per-run sequence number assigned by the chat run registry when a
   * live event is forwarded to the websocket. History messages loaded over
   * REST do not carry it. Clients use it with `chat.subscribe` to replay only
   * the live events they missed across websocket reconnects.
   */
  seq?: number;
  role?: 'user' | 'assistant';
  content?: string;
  /**
   * The model that produced this assistant message, as the provider reported
   * it on the transcript row (today: Claude's `message.model`, e.g.
   * `claude-opus-5`). Absent on user turns — no provider records which model a
   * request went out with — and absent when the provider named a placeholder
   * such as `<synthetic>`, so a locally-fabricated notice is never labelled
   * with a model it did not run on.
   */
  model?: string;
  /**
   * Optional display-oriented metadata used by providers that need to expose
   * richer transcript artifacts without introducing a brand-new message kind.
   *
   * Current Claude usage:
   * - local slash commands expose parsed command fields
   * - compact summaries are flagged so the UI can treat them differently later
   */
  displayText?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  /** Set on the row that stands in for a compaction, so the UI can draw it as one. */
  compact?: CompactionInfo;
  images?: unknown;
  /** Non-image files attached to a user turn after provider history normalization. */
  files?: unknown;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: {
    content?: string;
    isError?: boolean;
    toolUseResult?: unknown;
  };
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  reason?: string;
  newSessionId?: string;
  status?: string;
  summary?: string;
  tokenBudget?: unknown;
  /**
   * Timeline of everything a subagent did, attached to the `tool_use` that
   * spawned it. Present for Claude `Agent`/`Task` calls and Codex
   * `spawn_agent` calls; absent for every other tool.
   */
  subagentTools?: SubagentActivity[];
  /** Identity and lifecycle of the subagent this `tool_use` spawned. */
  subagent?: SubagentInfo;
  /** The workflow run this `tool_use` launched, read from its journal on disk. */
  workflow?: WorkflowInfo;
  /** Stored memory the reply drew on, when the provider reports it. */
  memoryCitations?: MemoryCitation[];
  toolUseResult?: unknown;
  sequence?: number;
  rowid?: number;
  /**
   * `task_status` fields: one lifecycle event of a background task the live
   * run is tracking. `taskId` is the provider's task handle; `toolUseId` names
   * the call that launched it and is absent on `updated`, which the SDK keys by
   * task id alone. `status` and `summary` above carry the event's own.
   */
  event?: 'started' | 'progress' | 'updated' | 'notification';
  taskId?: string;
  toolUseId?: string;
  taskType?: string;
  workflowName?: string;
  description?: string;
  usage?: TaskUsage;
  outputFile?: string;
  /** A workflow's `progress` only: where each agent the run spawned stands. */
  agents?: WorkflowAgentProgress[];
  [key: string]: unknown;
};

/**
 * What a background task has spent so far, as the CLI reports it on
 * `task_progress` and `task_notification`.
 */
export type TaskUsage = {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
};

/**
 * One background task a live session still has outstanding — a spawned
 * agent, a workflow run or a backgrounded command — as the runtime tracks it
 * from the stream's `task_started` until the event that settles it.
 *
 * `taskId` is the handle a stop request names; `toolUseId` is the call that
 * launched it, which is how the client pairs the task with its card.
 * `startedAt` is the server clock at `task_started`, so a session whose turn
 * has ended can still report how long its work has been going.
 */
export type BackgroundTaskSummary = {
  taskId: string;
  toolUseId: string;
  taskType: string;
  description: string;
  workflowName?: string;
  startedAt: number;
  /**
   * The task was launched by a subagent or workflow agent, not by the
   * session's own turn: its `toolUseId` names a call in that agent's
   * transcript, so no card in this session's transcript matches it. Listed so
   * it can still be stopped; not counted as the session's own work.
   */
  nested?: boolean;
};

/**
 * Where one agent of a running workflow stands, as the SDK reports it on the
 * run's `task_progress` events.
 *
 * An entry the script has queued but not yet started has no `agentId` and is
 * identified by `index` alone; once the agent runs, `agentId` names the
 * transcript it writes. `lastToolName` and `lastToolSummary` are the agent's
 * own latest tool call — unlike the event's task-level `last_tool_name`, which
 * for a workflow is the current agent's label.
 */
export type WorkflowAgentProgress = {
  index: number;
  label?: string;
  /** The title of the script phase the agent runs under, when it has one. */
  phase?: string;
  agentId?: string;
  model?: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  startedAt?: number;
  lastToolName?: string;
  lastToolSummary?: string;
  promptPreview?: string;
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
  resultPreview?: string;
};

/**
 * One workflow agent's recorded timeline, read from its transcript on demand
 * when the card is opened — the SDK never streams an agent's own rows to the
 * parent session, so this is the only way to see what it did.
 *
 * `activityCount` is the full length of the timeline; `activity` is capped
 * for transport like a subagent's `subagentTools`.
 */
export type WorkflowAgentActivity = {
  agent: {
    id: string;
    label?: string;
    model?: string;
    status: 'running' | 'completed' | 'failed' | 'stopped';
  };
  activity: SubagentActivity[];
  activityCount: number;
};

/**
 * One agent a workflow run spawned, as its journal records it.
 *
 * `label` and `phase` are whatever the script passed when it spawned the
 * agent; older scripts passed neither. An agent with a `started` record and no
 * `result` or `failed` one is still running as far as the journal knows.
 */
export type WorkflowAgentInfo = {
  id: string;
  label?: string;
  phase?: string;
  /** `stopped` is an agent the journal never settled although the run itself has — abandoned by a stop or a resume that re-ran the step. */
  status: 'running' | 'completed' | 'failed' | 'stopped';
};

/**
 * A `Workflow` tool call's run, attached to the `tool_use` that launched it.
 *
 * `status` follows the same rule as a background agent's: the task
 * notification's word when one exists, else `running` only while the process
 * that launched it is still up, else `stopped`. The agent list and counts come
 * from `<transcriptDir>/journal.jsonl`; both are empty when the run left no
 * journal behind (a fork copies only the parent's transcript).
 */
export type WorkflowInfo = {
  runId: string;
  name: string;
  description?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  agents: WorkflowAgentInfo[];
  agentCounts: { total: number; completed: number; failed: number; running: number; stopped: number };
  scriptPath?: string;
};

/**
 * One stored memory an assistant reply drew on.
 *
 * Codex appends these to a reply that used its memory files, naming the file
 * and line range it read plus a short note on what it took from there. The
 * transcript shows them as a footnote so a memory-derived claim is traceable
 * rather than arriving as an unattributed assertion.
 */
export type MemoryCitation = {
  /** File and line range that was read, e.g. `MEMORY.md:137-142`. */
  source: string;
  /** What the reply took from that range, when the provider states it. */
  note?: string;
};

/**
 * One entry in a subagent's recorded timeline.
 *
 * Providers store a subagent's work in a separate transcript (Claude:
 * `<session>/subagents/agent-<id>.jsonl`; Codex: a sibling rollout keyed by
 * `agent_thread_id`). Both are flattened into this shape so the transcript can
 * replay a subagent's run with the same renderers the main thread uses.
 *
 * `kind` decides which fields matter: `tool` uses the tool fields, `text` and
 * `thinking` use `content`. Consumers must not assume tool fields exist on the
 * text kinds.
 */
export type SubagentActivity = {
  kind: 'tool' | 'text' | 'thinking';
  timestamp?: string;
  /** Tool-call identity; only set when `kind` is `tool`. */
  toolId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: { content?: string; isError?: boolean } | null;
  /** Message body; only set when `kind` is `text` or `thinking`. */
  content?: string;
};

/**
 * Identity and lifecycle of one spawned subagent, normalized across providers.
 *
 * `status` is `running` until the call that spawned the agent resolves. After
 * that it is whatever the provider reported — Claude's task notification
 * carries one — and `completed` when the provider reported nothing. A failed
 * tool call *inside* the agent is not a failed agent, so it is never inferred
 * from the transcript. A background agent whose session process ended before
 * it reported is `stopped`: no outcome exists and none is coming.
 */
export type SubagentInfo = {
  /** Provider-native agent id — Claude `agentId`, Codex `agent_thread_id`. */
  id: string;
  /** Human-facing label: Claude's agent type, or Codex's assigned nickname. */
  name?: string;
  /** Agent type/preset when the provider records one (Claude `agentType`). */
  type?: string;
  /** One-line task summary shown in the collapsed header. */
  description?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  /** Model the subagent ran on, when the provider records it. */
  model?: string;
  /**
   * How many activities the agent actually recorded. It exceeds
   * `subagentTools.length` when a long run was truncated for transport, which
   * lets the UI say so instead of silently showing a partial timeline.
   */
  activityCount?: number;
};

/**
 * Output gateway shared by WebSocket and SSE provider runs.
 *
 * Runtime adapters only depend on this structural surface, which keeps them
 * independent from the transport that ultimately delivers normalized events.
 */
export type ProviderRuntimeWriter = {
  send(data: unknown): void;
  setSessionId?(sessionId: string): void;
  userId?: string | number | null;
  isWebSocketWriter?: boolean;
};

export type ProviderPermissionDecision = {
  allow: boolean;
  updatedInput?: unknown;
  message?: string;
  rememberEntry?: unknown;
};

export type ProviderRuntimePermissionGateway = {
  resolve(requestId: string, decision: ProviderPermissionDecision): void;
  listPending(sessionId: string): unknown[];
};

/**
 * Provider-scoped application capabilities supplied to a runtime for one run.
 *
 * Keeping these lookups outside concrete SDK/CLI adapters prevents the
 * adapters from importing services that resolve back through providerRegistry.
 */
export type ProviderRuntimeContext = {
  resolveProviderSessionId(sessionId: string | null | undefined): string | null;
  resolveResumeModel(
    sessionId: string | undefined,
    requestedModel?: string | null,
  ): Promise<string | undefined>;
  getProviderModels(): Promise<ProviderModelsDefinition>;
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  isProviderInstalled(): Promise<boolean>;
  /**
   * Builds the SDK query for a run. Production leaves this unset and the
   * runtime uses the SDK's own; tests supply a scripted stream so the hold
   * and background-work paths can be driven without a CLI process.
   */
  createQuery?: (input: { prompt: AsyncIterable<unknown>; options: AnyRecord }) => AsyncIterable<unknown> & {
    interrupt(): Promise<void>;
    stopTask?(taskId: string): Promise<void>;
  };
};

export type ProviderRunFunction = (
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
) => Promise<unknown>;

/**
 * Shared options used to fetch historical provider messages.
 *
 * Consumers should pass provider-specific lookup hints (`projectPath`) only
 * when the selected provider requires them.
 *
 * `providerSessionId` is the provider-native session id from the sessions
 * index (transcript file name / provider database key). Provider adapters
 * must use it — never the app-facing session id they were called with — when
 * matching transcript rows on disk, because app-created sessions use an
 * app-allocated id that the provider has never seen.
 */
export type FetchHistoryOptions = {
  projectPath?: string;
  limit?: number | null;
  offset?: number;
  providerSessionId?: string;
};

/**
 * Standardized response payload returned from provider history readers.
 *
 * Use this as the contract for APIs that return paginated conversation history.
 */
export type FetchHistoryResult = {
  messages: NormalizedMessage[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number | null;
  tokenUsage?: unknown;
};

// ---------------------------
//----------------- PROVIDER SKILL TYPES ------------
/**
 * Scope where a provider skill definition was discovered.
 *
 * Provider skill adapters should use this to describe the origin of each
 * skill markdown file without leaking provider-specific folder names into route
 * contracts. `repo` is used for Codex repository lookup locations, while
 * `project` is used for providers that treat workspace-local skills as project
 * scoped.
 */
export type ProviderSkillScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

/**
 * Shared input accepted by provider skill listing operations.
 *
 * Routes pass `workspacePath` when a caller wants project/repository skills for
 * a specific folder. Providers should fall back to the backend process cwd when
 * this option is omitted.
 */
export type ProviderSkillListOptions = {
  workspacePath?: string;
};

/**
 * One supporting file bundled with an uploaded provider skill.
 *
 * `relativePath` is resolved below the installed skill directory and must never
 * be absolute or contain traversal segments. Text files may use `utf8`; binary
 * scripts and assets should use `base64` so JSON transport does not corrupt
 * their bytes.
 */
export type ProviderSkillCreateFile = {
  relativePath: string;
  content: string;
  encoding: 'utf8' | 'base64';
};

/**
 * One skill markdown payload submitted for provider-managed installation.
 *
 * `content` is the raw markdown body that will be written to `SKILL.md`.
 * `directoryName` lets callers control the target folder name explicitly when
 * they want stable filesystem paths that differ from the markdown front matter
 * `name` field. `fileName` is optional upload metadata used only as a final
 * fallback when no directory name or front matter name is present. `files`
 * carries scripts, references, and other files from a complete skill folder.
 */
export type ProviderSkillCreateEntry = {
  content: string;
  directoryName?: string;
  fileName?: string;
  files?: ProviderSkillCreateFile[];
};

/**
 * Shared input accepted by provider skill creation operations.
 *
 * The service layer batches multiple skill definitions in one request. Each
 * entry can contain only markdown or a complete skill folder.
 */
export type ProviderSkillCreateInput = {
  entries: ProviderSkillCreateEntry[];
};

export type ProviderSkillRemoveInput = {
  directoryName: string;
};

/**
 * Normalized skill record returned by provider skill adapters.
 *
 * The `command` value is the exact invocation text the selected provider expects
 * for this skill. Claude plugin skills use a namespaced command such as
 * `/plugin-name:skill-name`, while Codex skills use the `$skill-name` form.
 * `sourcePath` points to the skill markdown file that produced the record so
 * callers can distinguish duplicate skill names across scopes.
 */
export type ProviderSkill = {
  provider: LLMProvider;
  name: string;
  description: string;
  command: string;
  scope: ProviderSkillScope;
  sourcePath: string;
  pluginName?: string;
  pluginId?: string;
};

/**
 * Internal source descriptor consumed by shared provider skill discovery logic.
 *
 * Concrete provider adapters build these records from their native lookup rules.
 * The shared skills provider then scans `rootDir` for child skill markdown files
 * and uses `commandForSkill` or `commandPrefix` to produce the provider-specific
 * invocation command. Set `recursive` only when a provider stores skills under
 * arbitrary nested folders below the source root.
 */
export type ProviderSkillSource = {
  scope: ProviderSkillScope;
  rootDir: string;
  recursive?: boolean;
  commandPrefix?: '/' | '$';
  commandForSkill?: (skillName: string) => string;
  pluginName?: string;
  pluginId?: string;
};

// ---------------------------
//----------------- SHARED ERROR TYPES ------------
/**
 * Optional metadata used when constructing application-level errors.
 *
 * `statusCode` should reflect the HTTP response status, while `code` identifies
 * the stable machine-readable error category.
 */
export type AppErrorOptions = {
  code?: string;
  statusCode?: number;
  details?: unknown;
};

// ---------------------------
//----------------- MCP TYPES ------------
/**
 * Scope where an MCP server definition is stored and resolved.
 *
 * `user` is global for a user account, `local` is provider-local, and `project`
 * is tied to a specific project path.
 */
export type McpScope = 'user' | 'local' | 'project';

/**
 * Transport protocol used by an MCP server definition.
 */
export type McpTransport = 'stdio' | 'http' | 'sse';

/**
 * Normalized MCP server model exposed to frontend and route handlers.
 *
 * Provider adapters should map provider-native config to this structure before
 * returning results.
 */
export type ProviderMcpServer = {
  provider: LLMProvider;
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

/**
 * Payload for create/update MCP server operations.
 *
 * Routes and services should accept this type, validate it, and then persist it
 * through provider-specific MCP repositories.
 */
export type UpsertProviderMcpServerInput = {
  name: string;
  scope?: McpScope;
  transport: McpTransport;
  workspacePath?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

// ---------------------------
//----------------- PROVIDER AUTH TYPES ------------
/**
 * Records that an API-key style credential is taking precedence over a
 * still-valid subscription login in `~/.claude/.credentials.json`.
 *
 * Claude Code always prefers `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` over
 * the OAuth login written by `claude /login`, so when both exist every request
 * is billed to the key (pay-as-you-go) rather than the subscription — usually
 * without the user realising it. The Claude auth provider fills this in so the
 * settings UI can say which variable won and where it was found; the fix
 * differs per source (unset the variable and restart the server for
 * `process_env`, edit the `env` block of `~/.claude/settings.json` for
 * `settings_file`). It is never set when the login in the credentials file is
 * missing or expired, because then nothing is being bypassed.
 */
export type ProviderAuthSubscriptionOverride = {
  /** The environment variable Claude Code is using instead of the login. */
  variable: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN';
  /** Where that variable was found: the server process env or the settings.json env block. */
  source: 'process_env' | 'settings_file';
  /** Email recorded in the credentials file for the bypassed login, when known. */
  subscriptionEmail: string | null;
};

/**
 * Authentication status result returned by provider health checks.
 *
 * This shape is consumed by settings/status endpoints to report installation and
 * credential state for each provider.
 */
export type ProviderAuthStatus = {
  installed: boolean;
  provider: LLMProvider;
  /**
   * Version of the CLI the provider runs, as its `--version` printed it
   * (`2.1.295`, `2026.07.20-8cc9c0b`), or null when it is not installed or
   * printed no version.
   */
  installedVersion: string | null;
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
  /**
   * Present only when `method` is `api_key` and a valid subscription login is
   * being bypassed; see ProviderAuthSubscriptionOverride. Omitted otherwise so
   * existing consumers that never look for it are unaffected.
   */
  subscriptionOverride?: ProviderAuthSubscriptionOverride;
};

/**
 * What running a CLI's `--version` revealed, as returned by `probeCliVersion`.
 *
 * `installed` says only that the command could be started (or started and was
 * too slow to answer); it ignores the exit code, which is reported separately
 * for callers that also require a clean exit. `version` is null whenever the
 * command did not exit 0 or printed nothing that looks like a version.
 */
export type CliVersionProbe = {
  installed: boolean;
  exitCode: number | null;
  version: string | null;
};

// ---------------------------
//----------------- SHARED DATABASE CREDENTIAL TYPES ------------
/**
 * Safe credential view returned by credential listing APIs.
 *
 * This intentionally excludes the raw credential secret while still exposing
 * metadata needed for UI rendering and management operations.
 */
export type CredentialPublicRow = {
  id: number;
  credential_name: string;
  credential_type: string;
  description: string | null;
  created_at: string;
  is_active: number;
};

/**
 * Result returned after creating a credential record.
 *
 * Use this return shape when callers need the created id and display metadata,
 * but must never receive the stored secret value.
 */
export type CreateCredentialResult = {
  id: number | bigint;
  credentialName: string;
  credentialType: string;
};

// ---------------------------
//----------------- CHAT DRAFT QUEUE TYPES ------------
/**
 * A chat message queued to be sent when its session is next idle, in the shape
 * the composer submits it and `session_drafts.queued_message` stores it.
 *
 * `content` is the message text, `attachments` the JSON-safe descriptors
 * returned by POST /api/assets/files, and `options` the composer's send options
 * (model, effort, permission mode, ...) captured when it was queued. A session
 * has at most one: a message queued while another is waiting is merged into it
 * by the drafts repository. The User module accepts it, the Database module
 * stores and merges it, and the Scheduled Messages dispatcher sends it (read
 * through `readQueuedChatMessage`).
 */
export type QueuedChatMessage = {
  content: string;
  /** Last startup failure, retained with the queued message until retry or edit. */
  failure?: string;
  options?: Record<string, unknown>;
  attachments: unknown[];
};

// ---------------------------
//----------------- RUN ORIGIN ------------
/**
 * Where the request that started a provider run came from, carried on the run
 * options as `origin`.
 *
 * `local` is set only by the Host's own authenticated non-bridge path (a browser
 * session or the platform auth of the Host itself). `remote` is a connection the
 * Host bridged from a Remote Controller (loopback token), and also every path
 * that cannot prove otherwise: a missing or unknown value is read as `remote`
 * (fail closed). The value never comes from a client message, header, query or
 * `options`; it is derived on the Host from how the request was authenticated.
 * It is containment against accidents and prompt injection that arrives through a
 * Controller chat, not a boundary against a hostile paired Controller (a paired
 * Controller is a full-trust grant). Read it with `readRunOrigin`.
 */
export type RunOrigin = 'local' | 'remote';

// ---------------------------
//----------------- PROJECT PERSISTENCE TYPES ------------
/**
 * Canonical project row shape returned by the projects repository.
 *
 * Use this type whenever backend services need to pass around one database
 * project record without leaking raw SQL row typing across modules.
 */
export type ProjectRepositoryRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
  isArchived: number;
};

/**
 * Result category returned by `projectsDb.createProjectPath`.
 *
 * `created` means a fresh row was inserted, `reactivated_archived` means an
 * existing archived path was accepted and updated, and `active_conflict` means
 * an already-active path blocked project creation.
 */
export type CreateProjectPathOutcome =
  | 'created'
  | 'reactivated_archived'
  | 'active_conflict';

/**
 * Structured result returned by project-path upsert operations.
 *
 * Services should use this result to decide whether a request succeeded,
 * should return a conflict, or needs follow-up retrieval of row metadata.
 */
export type CreateProjectPathResult = {
  outcome: CreateProjectPathOutcome;
  project: ProjectRepositoryRow | null;
};

/**
 * Validation result for user-supplied workspace/project paths.
 *
 * `resolvedPath` is present only when validation succeeds. `error` is present
 * only when validation fails and is suitable for user-facing diagnostics.
 */
export type WorkspacePathValidationResult = {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
};

// ---------------------------
//----------------- GIT COMMAND EXECUTION AND WORKTREE MANAGEMENT ------------
/**
 * Captured output of one completed `git` invocation.
 *
 * Returned by `GitCommandRunner` and `GitProcessRunner` implementations so the
 * git and worktree services can read both streams without caring about
 * process plumbing.
 */
export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

/**
 * Executes `git <args>` inside `cwd` and resolves with the captured output.
 *
 * All worktree services receive their git access through this contract so
 * tests can inject a fake runner instead of spawning real processes. The
 * promise must reject (with `stderr` attached when available) on a non-zero
 * exit code.
 */
export type GitCommandRunner = (args: string[], cwd: string) => Promise<GitCommandResult>;

/**
 * Executes `command args...` inside `options.cwd` and resolves with the captured output.
 *
 * This is the `spawnAsync` shape the Git routes module injects into its typed
 * services (branch deletion, branch compare) so their tests can substitute a
 * fake runner. Like `GitCommandRunner`, the promise must reject on a non-zero
 * exit code, with `stderr` attached to the error when available.
 */
export type GitProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<GitCommandResult>;

/**
 * One entry parsed from `git worktree list --porcelain`.
 *
 * This is the raw repository-level view (path/HEAD/branch/flags) before any
 * enrichment with project links or ahead/behind counts. `branch` is null for
 * detached-HEAD worktrees.
 */
export type WorktreePorcelainEntry = {
  path: string;
  headSha: string | null;
  branch: string | null;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
};

/**
 * Fully enriched worktree row served to the UI.
 *
 * Extends the porcelain entry with everything the Worktrees panel renders:
 * dirty-file count, ahead/behind relative to the base branch (the branch
 * checked out in the main worktree), last-commit metadata, and the CloudCLI
 * project row linked to the worktree directory (if one was registered).
 */
export type WorktreeDescriptor = {
  path: string;
  branch: string | null;
  headSha: string | null;
  isMain: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  isDetached: boolean;
  changedFileCount: number;
  ahead: number;
  behind: number;
  lastCommitSubject: string | null;
  lastCommitDate: string | null;
  linkedProjectId: string | null;
  linkedProjectArchived: boolean;
};

/**
 * Response payload of `GET /api/worktrees`.
 *
 * `baseBranch` is the branch checked out in the main worktree — the merge
 * target offered by the UI. `worktrees` always lists the main worktree first.
 */
export type WorktreeListResult = {
  repositoryRoot: string;
  baseBranch: string | null;
  worktrees: WorktreeDescriptor[];
};

// ---------------------------
//----------------- WORKTREE SERVICE INPUTS AND RESULTS ------------
/**
 * Input accepted by the worktree-listing workflow.
 *
 * `projectPath` may point at the main checkout or any linked worktree. The
 * service uses Git to resolve the complete repository-level worktree list.
 */
export type ListWorktreesInput = {
  projectPath: string;
};

/**
 * Input accepted when creating a linked Git worktree.
 *
 * `branch` is checked out when it already exists, otherwise it is created from
 * `baseBranch`. When `baseBranch` is omitted, the main worktree branch is used.
 */
export type CreateWorktreeInput = {
  projectPath: string;
  branch: string;
  baseBranch?: string | null;
};

/**
 * Result of successfully creating a linked Git worktree.
 *
 * `createdBranch` distinguishes a new branch from an existing branch checkout,
 * allowing API clients to accurately describe what Git changed.
 */
export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
  createdBranch: boolean;
};

/**
 * Result of atomically creating and registering a worktree for project use.
 *
 * The Worktrees application service compensates the Git creation if project
 * registration fails, so routes only receive this shape after both steps pass.
 */
export type CreateAndOpenWorktreeResult = CreateWorktreeResult & {
  project: WorktreeProjectView;
};

/**
 * Input accepted when registering an existing worktree as a CloudCLI project.
 *
 * The service verifies that `worktreePath` belongs to the repository containing
 * `projectPath` before it creates or restores any project record.
 */
export type OpenWorktreeInput = {
  projectPath: string;
  worktreePath: string;
};

/**
 * Project view returned after a worktree is opened in CloudCLI.
 *
 * This deliberately mirrors the project-selection payload used by the Projects
 * module so the frontend can switch to the worktree without another lookup.
 */
export type WorktreeProjectView = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  isStarred: boolean;
  sessions: [];
  sessionMeta: { hasMore: false; total: 0 };
};

/**
 * Input accepted when removing a linked Git worktree.
 *
 * `force` permits removal with local changes. `deleteBranch` requests
 * best-effort branch cleanup after the worktree directory is removed.
 */
export type RemoveWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
  deleteBranch?: boolean;
};

/**
 * Result of removing a linked Git worktree.
 *
 * `archivalError` reports best-effort project archival failure after Git has
 * already removed the worktree, allowing callers to represent partial success.
 */
export type RemoveWorktreeResult = {
  removedPath: string;
  branch: string | null;
  branchDeleted: boolean;
  archivedProjectId: string | null;
  archivalError: string | null;
};

/**
 * Input accepted when merging a linked worktree into the main worktree branch.
 *
 * The service verifies both worktrees are clean, supports squash and regular
 * merges, and may remove the source worktree after a successful merge.
 */
export type MergeWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  squash?: boolean;
  message?: string | null;
  removeAfterMerge?: boolean;
};

/**
 * Result of a completed worktree merge.
 *
 * `removedWorktree` is populated only when post-merge removal succeeds.
 * `cleanupError` reports failed optional removal without misrepresenting the
 * already-completed merge as a failure.
 */
export type MergeWorktreeResult = {
  mergedBranch: string;
  targetBranch: string;
  squash: boolean;
  removedWorktree: RemoveWorktreeResult | null;
  cleanupError: string | null;
};

// ---------------------------
//----------------- WORKTREE MODULE DEPENDENCY CONTRACTS ------------
/**
 * Filesystem capability required by the Worktrees module.
 *
 * Production wiring checks the real filesystem; unit tests provide a small
 * deterministic fake so worktree creation never touches developer directories.
 */
export type WorktreeFileSystem = {
  pathExists(candidatePath: string): Promise<boolean>;
};

/**
 * Project-management boundary consumed by Worktrees workflows.
 *
 * The Worktrees module uses this contract instead of importing Database or
 * Projects internals. Production adapters delegate through those modules'
 * `index.ts` barrels, while unit tests supply in-memory functions.
 */
export type WorktreeProjectGateway = {
  getProjectPathById(projectId: string): string | null;
  getProjectByPath(projectPath: string): ProjectRepositoryRow | null;
  createProject(input: {
    projectPath: string;
    customName: string;
  }): Promise<{
    outcome: 'created' | 'reactivated_archived';
    project: { projectId: string };
  }>;
  restoreProject(projectId: string): void | Promise<void>;
  archiveProject(projectId: string): void | Promise<void>;
};

/**
 * Complete application-service surface used by the Worktrees HTTP router.
 *
 * Routes parse transport values and call these functions; they do not import
 * repositories, filesystem adapters, Git runners, or individual service files.
 */
export type WorktreeServices = {
  resolveProjectPath(projectId: string): string;
  list(input: ListWorktreesInput): Promise<WorktreeListResult>;
  create(input: CreateWorktreeInput): Promise<CreateWorktreeResult>;
  createAndOpen(input: CreateWorktreeInput): Promise<CreateAndOpenWorktreeResult>;
  open(input: OpenWorktreeInput): Promise<WorktreeProjectView>;
  merge(input: MergeWorktreeInput): Promise<MergeWorktreeResult>;
  remove(input: RemoveWorktreeInput): Promise<RemoveWorktreeResult>;
};

// ---------------------------
//----------------- FILE TREE MODULE CONTRACTS ------------
/**
 * One filesystem item returned by the File Tree API.
 *
 * The service populates metadata without following symlinks and recursively
 * attaches `children` only while the requested depth permits traversal. The
 * frontend uses the absolute `path` as the stable identifier for editor and
 * file-operation requests.
 */
export type FileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string | null;
  permissions: string;
  permissionsRwx: string;
  isSymlink?: boolean;
  children?: FileTreeNode[];
  /**
   * Directory whose contents were not (completely) listed because the tree hit its entry budget or its
   * depth limit. The client asks for it again (`listProjectFiles` with `path`) when the user opens it.
   */
  partial?: boolean;
};

/**
 * Minimal directory-entry shape required during File Tree traversal.
 *
 * Production adapts Node `Dirent` objects to this structural contract. Tests
 * provide small handwritten entries and therefore never read real directories.
 */
export type FileTreeDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

/**
 * Minimal file-stat shape used for tree metadata and delete decisions.
 *
 * The numeric mode is converted to octal and rwx strings for the UI. `lstat`
 * supplies symlink state while `stat` is used when deciding file versus folder
 * deletion behavior.
 */
export type FileTreeStats = {
  size: number;
  mtime: Date;
  mode: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

/**
 * Complete filesystem capability injected into File Tree services.
 *
 * The production composition root delegates these operations to Node's fs
 * APIs. Unit tests provide deterministic path-keyed fakes so service tests
 * cannot inspect, write, rename, or delete developer files.
 */
export type FileTreeFileSystem = {
  access(candidatePath: string): Promise<void>;
  stat(candidatePath: string): Promise<FileTreeStats>;
  lstat(candidatePath: string): Promise<FileTreeStats>;
  // Streamed rather than returned as an array so a directory with millions of
  // children is abandoned at the entry limit instead of being materialized.
  openDirectory(directoryPath: string): AsyncIterable<FileTreeDirectoryEntry>;
  realpath(candidatePath: string): Promise<string>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  makeDirectory(directoryPath: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  removeDirectory(directoryPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  copyFile(sourcePath: string, destinationPath: string): Promise<void>;
  createReadStream(filePath: string): Readable;
};

/**
 * Project lookup boundary consumed by File Tree workflows.
 *
 * File Tree services resolve DB-assigned project ids through this contract and
 * never import the Database module or its repositories directly.
 */
export type FileTreeProjectGateway = {
  getProjectPathById(projectId: string): string | null | Promise<string | null>;
};

/**
 * Workspace validation boundary used by filesystem browsing and folder creation.
 *
 * The injected validator enforces the configured workspace root and resolves
 * symlinks before the File Tree service exposes or mutates paths.
 */
export type FileTreeWorkspaceGateway = {
  rootPath: string;
  validatePath(candidatePath: string): Promise<WorkspacePathValidationResult>;
  /**
   * Resolves a path readable outside the workspace root — the system temp
   * directory and the Claude projects directory — or `null` when it is not
   * one. Read-only: the write policy is `validatePath` and it does not consult
   * this.
   */
  resolveReadOnlyRootPath(candidatePath: string): Promise<string | null>;
};

/**
 * Uploaded-file record passed from the Multer transport adapter into the File
 * Tree service.
 *
 * Transport-specific field names are normalized so upload workflows do not
 * depend on Express or Multer types.
 */
export type FileTreeUploadedFile = {
  originalName: string;
  temporaryPath: string;
  size: number;
  mimeType: string;
};

/**
 * Logger boundary for expected File Tree diagnostics.
 *
 * Production delegates to the server console. Unit tests use no-op or captured
 * loggers and never patch the global console singleton.
 */
export type FileTreeLogger = {
  error(message: string, error?: unknown): void;
};

/**
 * Required production dependencies for the File Tree application service.
 *
 * Filesystem, project lookup, workspace policy, MIME detection, concurrency,
 * and logging are all explicit so service construction has no hidden process,
 * repository, or machine-wide defaults.
 */
export type FileTreeServiceDependencies = {
  fileSystem: FileTreeFileSystem;
  projects: FileTreeProjectGateway;
  workspace: FileTreeWorkspaceGateway;
  resolveMimeType(filePath: string): string;
  fileSystemConcurrency: number;
  logger: FileTreeLogger;
};

/**
 * Complete File Tree application-service surface consumed by HTTP routes.
 *
 * Routes parse transport inputs and call these methods; they never resolve
 * project repositories, validate filesystem ownership, or perform filesystem
 * mutations themselves.
 */
export type FileTreeServices = {
  browseWorkspace(inputPath: string | null): Promise<{
    path: string;
    suggestions: Array<{ path: string; name: string; type: 'directory' }>;
  }>;
  createWorkspaceFolder(folderPath: string): Promise<{ success: true; path: string }>;
  readTextFile(projectId: string, filePath: string): Promise<{ content: string; path: string }>;
  openFile(projectId: string, filePath: string): Promise<{ contentType: string; stream: Readable }>;
  /** An `.html`/`.htm` file inside the project root (never outside it), for the isolated preview. */
  openHtmlPreview(projectId: string, filePath: string, maximumBytes: number): Promise<{ stream: Readable }>;
  saveTextFile(projectId: string, filePath: string, content: string): Promise<{
    success: true;
    path: string;
    message: string;
  }>;
  listProjectFiles(
    projectId: string,
    options?: {
      respectGitignore: boolean;
      /**
       * Also list what `.gitignore` and the default folder lists hide (`node_modules`, `dist`, `build`, ...); it
       * wins over `respectGitignore`. Version-control folders (`.git`, `.svn`, `.hg`) stay out.
       */
      includeIgnored?: boolean;
      /** A directory inside the project to list instead of the project root (its `partial` folders, when opened). */
      path?: string;
    },
  ): Promise<FileTreeNode[]>;
  createEntry(input: {
    projectId: string;
    parentPath: string;
    type: 'file' | 'directory';
    name: string;
  }): Promise<{ success: true; path: string; name: string; type: 'file' | 'directory'; message: string }>;
  renameEntry(input: { projectId: string; oldPath: string; newName: string }): Promise<{
    success: true;
    oldPath: string;
    newPath: string;
    newName: string;
    message: string;
  }>;
  deleteEntry(input: { projectId: string; targetPath: string }): Promise<{
    success: true;
    path: string;
    type: 'file' | 'directory';
    message: string;
  }>;
  storeUploadedFiles(input: {
    projectId: string;
    targetPath: string;
    relativePaths: string[];
    requestedFileCount: number;
    files: FileTreeUploadedFile[];
  }): Promise<{
    success: true;
    files: Array<{ name: string; path: string; size: number; mimeType: string }>;
    uploadedCount: number;
    requestedFileCount: number;
    targetPath: string;
    message: string;
  }>;
};

// ---------------------------
//----------------- VOICE MODULE CONTRACTS ------------
/**
 * Per-request voice settings parsed from authenticated HTTP headers.
 *
 * The Voice routes create this value from the optional `x-voice-*` headers and
 * pass it to the Voice service. Empty values mean "use the server-configured
 * default"; the backend base URL is intentionally absent because clients must
 * never control the server's outbound destination.
 */
export type VoiceRequestOverrides = {
  apiKey?: string;
  sttModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsFormat?: string;
};

/**
 * Uploaded audio accepted by the Voice transcription service.
 *
 * Routes translate Multer's transport-specific file object into this minimal
 * shape so the service does not depend on Express or Multer types.
 */
export type VoiceAudioUpload = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

/**
 * Successful speech payload returned by the Voice service.
 *
 * The route copies `contentType` to the client response and pipes `body`
 * without buffering the complete synthesized audio in application memory.
 */
export type VoiceSpeechPayload = {
  contentType: string;
  body: ReadableStream<Uint8Array> | null;
};

/**
 * Explicit service result used by Voice routes instead of transport-aware
 * exceptions.
 *
 * Services return `ok: false` with the exact client status/message for expected
 * backend, validation, and timeout failures. Routes only translate the result
 * into HTTP output, while unexpected programming errors still reject normally.
 */
export type VoiceServiceResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; status: number; error: string };

/**
 * Complete application-service surface consumed by the Voice HTTP router.
 *
 * The composition root supplies a concrete implementation with environment
 * configuration and an injected outbound HTTP adapter. Unit tests use the same
 * contract with handwritten fetch fakes and never patch global state.
 */
export type VoiceService = {
  getHealth(): { configured: boolean };
  transcribe(input: {
    audio: VoiceAudioUpload;
    overrides: VoiceRequestOverrides;
  }): Promise<VoiceServiceResult<{ text: string }>>;
  synthesizeSpeech(input: {
    text: string;
    overrides: VoiceRequestOverrides;
  }): Promise<VoiceServiceResult<VoiceSpeechPayload>>;
};

// ---------------------------
//----------------- CLI MODULE CONTRACTS ------------
/**
 * Output boundary used by the CLI and Sandbox services.
 *
 * Production wiring delegates to the real console. Unit tests collect these
 * calls in arrays, which keeps command assertions deterministic and avoids
 * monkey-patching the global console singleton.
 */
export type CliOutput = {
  log(message?: string): void;
  error(message?: string): void;
};

/**
 * Minimal synchronous filesystem surface shared by CLI status reporting and
 * sandbox workspace validation.
 *
 * The production composition root adapts Node's filesystem module. Tests supply
 * path-keyed fakes, so service tests never inspect or modify the real machine.
 */
export type CliFileSystem = {
  pathExists(filePath: string): boolean;
  getFileStats(filePath: string): { size: number; modifiedAt: Date };
};

/**
 * Mutable environment view owned by the CLI application.
 *
 * CLI options update this object before the server starts. Production passes
 * `process.env`; tests pass a plain record to verify option precedence without
 * changing process-wide environment state.
 */
export type CliEnvironment = Record<string, string | undefined>;

/**
 * Package metadata displayed by CLI help, status, version, and update commands.
 *
 * The composition root reads this once from the application package file and
 * injects only the fields the service needs.
 */
export type CliPackageMetadata = {
  name?: string;
  version: string;
  homepage?: string;
  bugsUrl?: string;
};

/**
 * Executable CLI application returned by the CLI composition root.
 *
 * The thin executable entrypoint passes `process.argv` arguments to `run` and
 * copies the returned code to `process.exitCode`. Tests invoke the same method
 * directly with isolated dependencies.
 */
export type CliApplication = {
  run(argumentsList: string[]): Promise<number>;
};

/**
 * Sandbox command service consumed by the top-level CLI command dispatcher.
 *
 * Keeping this behind one required dependency lets CLI tests use a tiny fake,
 * while focused Sandbox tests exercise subprocess and filesystem behavior with
 * their own handwritten adapters.
 */
export type SandboxCommandService = {
  execute(argumentsList: string[]): Promise<number>;
};

/**
 * Relay room flavour: `link` is the long-lived room of a paired Host, `pair` is the short-lived
 * rendezvous room used only while a pairing ceremony is running.
 */
export type RemoteRelayRoomKind = 'link' | 'pair';

/**
 * Values derived from a pairing key K that the relay handshake needs.
 *
 * `hostToken` and `controllerToken` are base64url; the relay only ever stores their SHA-256.
 * `macKey` authenticates the HELLO messages and never leaves the process.
 */
export type RemoteLinkKeys = {
  roomId: string;
  hostToken: string;
  controllerToken: string;
  macKey: Buffer;
};

/**
 * Per-connection AEAD keys produced by the handshake, already oriented for the local side:
 * `sendKey` encrypts frames this side sends, `receiveKey` decrypts frames from the peer.
 * A new pair is derived on every handshake (forward secrecy).
 */
export type RemoteSessionKeys = {
  sendKey: Buffer;
  receiveKey: Buffer;
};

// ---------------------------
//----------------- REMOTE PAIRING ------------

/** Which end of a pairing a stored row or ceremony describes. */
export type RemotePairingRole = 'host' | 'controller';

/**
 * Injectable time source for the pairing services: `now()` is wall-clock milliseconds and
 * `setTimer` schedules one callback, returning a function that cancels it. Production uses the
 * real clock; tests drive a manual one so the 5-minute code lifetime and the 15-minute lock run
 * without waiting. Timers must not keep the process alive (production uses `unref`).
 */
export type RemoteClock = {
  now(): number;
  setTimer(callback: () => void, delayMs: number): () => void;
};

/**
 * Why a pairing ceremony ended without creating a pairing. Stable strings: the management API
 * (phase 08) and the UI (phase 10) show them, so never rename a value.
 *
 * - `expired` / `cancelled` / `sas-attempts-exhausted`: the Host side ended it (code lifetime, user
 *   rejection, three wrong SAS entries).
 * - `protocol-violation` / `commitment-mismatch` / `key-confirmation-failed`: a message was out of
 *   order, malformed, forged or failed a MAC; treat as an attack or a bug, never retry the same code.
 * - `peer-changed` / `peer-aborted`: the opposite side left, was replaced, or sent an abort.
 * - `code-not-found` / `code-used-or-expired` / `relay-locked` / `relay-rejected` /
 *   `relay-unavailable`: the Controller could not reach a live pairing room for that code.
 * - `limit-reached`: the Host already has the maximum number of pairings.
 * - `storage-error`: the ceremony succeeded but the pairing could not be saved; nothing was stored.
 */
export type RemotePairingFailure =
  | 'expired'
  | 'cancelled'
  | 'sas-attempts-exhausted'
  | 'protocol-violation'
  | 'commitment-mismatch'
  | 'key-confirmation-failed'
  | 'peer-changed'
  | 'peer-aborted'
  | 'code-not-found'
  | 'code-used-or-expired'
  | 'relay-locked'
  | 'relay-rejected'
  | 'relay-unavailable'
  | 'limit-reached'
  | 'storage-error';

/**
 * Secret-free view of a `remote_pairings` row (contracts section 8). Times are epoch
 * milliseconds. The pairing key K and the pending-destroy credentials are never part of it; read
 * K through the pairing store's `openPairingKey`.
 */
export type RemotePairingRecord = {
  id: string;
  role: RemotePairingRole;
  /** Display name of the other device. Self-declared by that device, so unverified. */
  peerName: string;
  /** Name the local user gave this device (a Controller's name for a Host); shown instead of `peerName` when set. */
  alias: string | null;
  /** Link room id derived from K (hex, 32 chars). */
  roomId: string;
  relayUrl: string;
  createdAt: number;
  lastConnectedAt: number | null;
  lastActivityAt: number | null;
  /** Set when a Host revoked the pairing; K is gone from the row from then on. */
  revokedAt: number | null;
  expiresAt: number | null;
  /** True while a relay DESTROY is still owed after a revoke (the relay was unreachable). */
  pendingDestroy: boolean;
};

/**
 * Raw `remote_pairings` row as stored. `k_sealed` and `pending_destroy_sealed` are secret-box
 * blobs bound to this row's id by their AAD; only the pairing store may open them. Shared by the
 * database repository and the pairing store.
 */
export type RemotePairingRow = {
  id: string;
  role: RemotePairingRole;
  peer_name: string;
  alias: string | null;
  k_sealed: Buffer | null;
  pending_destroy_sealed: Buffer | null;
  room_id: string;
  relay_url: string;
  created_at: number;
  last_connected_at: number | null;
  last_activity_at: number | null;
  revoked_at: number | null;
  expires_at: number | null;
};

/**
 * What a finished ceremony hands to the store. `k` is the 32-byte pairing key; the store seals
 * it immediately and derives `roomId` from it. `id` is generated when omitted.
 */
export type RemoteNewPairing = {
  id?: string;
  role: RemotePairingRole;
  peerName: string;
  k: Uint8Array;
  relayUrl: string;
  expiresAt?: number | null;
};

/**
 * Credentials a revoked Host pairing still needs to tell the relay to destroy its room (retried
 * until the relay confirms). Derived from K before K is erased; `hostToken` is base64url.
 */
export type RemotePendingDestroy = {
  id: string;
  roomId: string;
  hostToken: string;
};

/**
 * Persistence for pairings with K sealed at rest. Every method may throw (database errors are
 * never swallowed). Consumers: the host/controller pairing services now; relay link and the
 * management API later.
 */
export type RemotePairingStore = {
  /** Seals K, derives the room id and inserts the row; returns the secret-free record. */
  insertPairing(input: RemoteNewPairing): RemotePairingRecord;
  getPairing(id: string): RemotePairingRecord | null;
  /** All rows, newest first, optionally limited to one role (revoked rows included). */
  listPairings(role?: RemotePairingRole): RemotePairingRecord[];
  /** Rows of `role` that are not revoked; the Host's FR-7 limit counts these. */
  countActivePairings(role: RemotePairingRole): number;
  /** Decrypts K; throws for an unknown or revoked pairing and for a blob not bound to this row. */
  openPairingKey(id: string): Buffer;
  /**
   * Host revoke: stores `{roomId, hostToken}` sealed as pending-destroy, erases `k_sealed` and
   * sets `revoked_at`. Throws for a Controller row or an unknown/already revoked pairing.
   */
  revokeHostPairing(id: string): RemotePairingRecord;
  /** Removes a row outright (a Controller forgetting a Host). */
  deletePairing(id: string): void;
  /** Sets (or, with null, clears) the local alias of a pairing; throws for an unknown pairing. */
  setPairingAlias(id: string, alias: string | null): RemotePairingRecord;
  listPendingDestroy(): RemotePendingDestroy[];
  /** Call once the relay confirmed the room is destroyed. */
  clearPendingDestroy(id: string): void;
  /**
   * Records a successful link connection: `last_connected_at`, and `last_activity_at` unless
   * `renewActivity` is false (a link that a list view opened by itself is not "use" of the pairing).
   */
  markConnected(id: string, options?: { renewActivity?: boolean }): void;
  /** Records traffic on the link (`last_activity_at`). */
  touchActivity(id: string): void;
  /**
   * Idle expiry (FR-40): erases K and stamps `expires_at` with now. A Host pairing is also revoked
   * (its sealed pending-destroy record is kept so the relay room can still be destroyed); a Controller
   * pairing keeps its row so the UI can say "expired". Idempotent for an already expired row.
   */
  expirePairing(id: string): RemotePairingRecord;
};

/**
 * One relay pairing-room socket as the ceremony sees it: binary frames out, plus the relay's two
 * control texts. Implemented by the real relay link (phase 06/08) and by the in-process fake relay
 * used in tests.
 */
export type RemotePairChannel = {
  sendFrame(frame: Uint8Array): void;
  /** Sends `{"t":"destroy"}`; the pair room ends once both roles have sent it. */
  sendDestroy(): void;
  close(): void;
};

/**
 * Events from a pair-room socket. `onClose` receives the WebSocket close code (4404 no room, 4410
 * expired/used, 4429 locked, 4401 rejected, 4409 replaced, ...) or 0 when the socket never opened
 * or closed without a code. After `onClose` no other callback fires.
 */
export type RemotePairChannelHandlers = {
  /** The relay accepted the credentials (`{"t":"ready"}`). */
  onReady(): void;
  /** The opposite role connected (`up: true`) or left/was replaced (`up: false`). */
  onPeer(up: boolean): void;
  /** One binary relay frame from the opposite role. */
  onFrame(frame: Uint8Array): void;
  onClose(code: number): void;
};

/**
 * Opens a pair-room socket for `role`. The implementation owns the relay URL, the `RELAY_SECRET`
 * gate and the auth frame; the caller only supplies the room derived from the pairing code.
 * Returns immediately; results arrive through the handlers.
 */
export type RemotePairConnector = (
  target: { roomId: string; pairToken: string; role: RemotePairingRole },
  handlers: RemotePairChannelHandlers,
) => RemotePairChannel;

/** Host-side ceremony state as the management API reports it (contracts section 2). */
export type RemoteHostPairingState = 'waiting-controller' | 'awaiting-sas' | 'done' | 'failed';

/**
 * Host view of a running or finished pairing. It deliberately has no SAS field: the Host user
 * types the number shown on the Controller, the Host never displays it. `lockedUntil` (epoch ms)
 * is present while the Host may not start a new pairing.
 */
export type RemoteHostPairingStatus = {
  state: RemoteHostPairingState;
  /** Unverified device name the Controller declared; absent until a Controller joined. */
  controllerName?: string;
  /** Wrong-SAS entries still allowed (starts at 3). */
  attemptsLeft: number;
  lockedUntil?: number;
  failure?: RemotePairingFailure;
  /** Id of the stored pairing, present once `state` is `done`. */
  pairingId?: string;
};

/** Controller-side ceremony state. `showing-sas` is the only state in which `sas` is present. */
export type RemoteControllerPairingState = 'connecting' | 'exchanging' | 'showing-sas' | 'done' | 'failed';

/**
 * Controller view of a join in progress or finished. `sas` is the 6 digits the user must type at
 * the Host; `hostName` is the Host's unverified self-declared name; `peerId` is the stored
 * pairing id once `state` is `done`.
 */
export type RemoteControllerPairingStatus = {
  state: RemoteControllerPairingState;
  sas?: string;
  hostName?: string;
  peerId?: string;
  failure?: RemotePairingFailure;
};

/** What a successful ceremony yields: the 32-byte pairing key K and the other device's unverified name. */
export type RemoteCeremonyResult = { k: Buffer; peerName: string };

/**
 * Host ceremony state. `exchanging` = a Controller said hello but the Host has not yet seen its
 * nonce (so no SAS exists); `awaiting-sas` = the Host waits for the user to type the SAS;
 * `confirming` = the SAS matched and the key confirmation is in flight.
 */
export type RemoteHostCeremonyState = 'waiting-controller' | 'exchanging' | 'awaiting-sas' | 'confirming' | 'done' | 'failed';

/** Outcome of the Host user typing a SAS. `invalid` and `not-ready` consume no attempt. */
export type RemoteHostSasResult =
  | { status: 'accepted'; frames: Buffer[] }
  | { status: 'rejected'; attemptsLeft: number; frames: Buffer[] }
  | { status: 'invalid' }
  | { status: 'not-ready' };

/**
 * Host side of the pairing ceremony (a strictly ordered state machine, no I/O). Feed it relay
 * frames with `receive` and send whatever frames it returns. There is intentionally no SAS
 * accessor: the Host only compares what the user types. Any malformed, repeated or out-of-order
 * frame fails the ceremony (`failure: 'protocol-violation'`) and returns one abort frame.
 */
export type RemoteHostPairingCeremony = {
  readonly state: RemoteHostCeremonyState;
  /** Unverified device name from the Controller's hello; null before it. */
  readonly controllerName: string | null;
  /** Wrong-SAS entries still allowed; reaching 0 fails the ceremony. */
  readonly attemptsLeft: number;
  readonly failure: RemotePairingFailure | null;
  /** Handles a frame from the Controller; returns frames to send back (possibly none). */
  receive(frame: Uint8Array): Buffer[];
  /** The opposite side left or was replaced: fails the ceremony once a Controller had said hello. */
  peerLeft(): Buffer[];
  submitSas(input: string): RemoteHostSasResult;
  /** Ends the ceremony from this side (code lifetime, user rejection); returns the abort frame. */
  abort(reason: 'expired' | 'cancelled'): Buffer[];
  /** Hands out K and the peer name once, after `done`; null otherwise. */
  takeResult(): RemoteCeremonyResult | null;
};

/** Controller ceremony state; `idle` until `start()`. */
export type RemoteControllerCeremonyState = 'idle' | 'awaiting-host-key' | 'awaiting-reveal' | 'showing-sas' | 'done' | 'failed';

/**
 * Controller side of the pairing ceremony (state machine, no I/O). `start()` returns the hello
 * frame; feed relay frames to `receive`. The Controller sends its nonce only after the Host's
 * commitment arrived, and `sas` is non-null only while the Host user must be shown the number.
 */
export type RemoteControllerPairingCeremony = {
  readonly state: RemoteControllerCeremonyState;
  /** The six digits to show the user; null outside `showing-sas`. */
  readonly sas: string | null;
  /** Unverified Host name from the host-key frame. */
  readonly hostName: string | null;
  readonly failure: RemotePairingFailure | null;
  /** Creates the ephemeral key and returns the hello frame; throws if already started. */
  start(): Buffer;
  receive(frame: Uint8Array): Buffer[];
  peerLeft(): Buffer[];
  abort(reason: 'expired' | 'cancelled'): Buffer[];
  takeResult(): RemoteCeremonyResult | null;
};

// ---------------------------
//----------------- REMOTE RELAY LINK AND MUX ------------

/**
 * Error codes carried by a mux `ERROR` frame and by the JSON error bodies of the Controller proxy
 * (contracts section 9: one registry). Stable strings; never rename a value.
 */
export type RemoteErrorCode =
  | 'REMOTE_LINK_DOWN'
  | 'REMOTE_FORBIDDEN'
  | 'REMOTE_UPSTREAM_AUTH'
  | 'REMOTE_QUOTA'
  | 'REMOTE_TOO_LARGE'
  | 'REMOTE_PROTOCOL'
  | 'REMOTE_UNSUPPORTED_MODE'
  | 'REMOTE_INTERNAL';

/** HTTP-style header bag carried in mux meta (already lower-cased and filtered by the bridge). */
export type RemoteMuxHeaders = Record<string, string | string[]>;

/**
 * Meta JSON of every mux frame type (contracts section 6), keyed by frame name. The codec rejects a
 * frame whose meta does not have this shape, so consumers can read the fields without re-checking.
 * `PING`, `PONG` and `CANCEL` carry an empty object.
 */
export type RemoteMuxMeta = {
  APP_HELLO: { protocolVersion: number; appVersion: string; role: RemotePairingRole };
  PING: Record<string, never>;
  PONG: Record<string, never>;
  HTTP_REQ: { method: string; path: string; headers: RemoteMuxHeaders };
  REQ_BODY: { fin: boolean };
  HTTP_RES: { status: number; headers: RemoteMuxHeaders };
  RES_BODY: { fin: boolean };
  WS_OPEN: { path: string; protocols?: string[] };
  /** `batch = n` means the body is n items `[len u32 BE][payload]`; all share this `binary` flag. */
  WS_MSG: { binary: boolean; batch?: number };
  WS_CLOSE: { code: number; reason: string };
  CANCEL: Record<string, never>;
  ERROR: { code: RemoteErrorCode; message: string };
};

/** Name of a mux frame type. */
export type RemoteMuxFrameType = keyof RemoteMuxMeta;

/**
 * One decoded (or to-be-encoded) mux frame: the plaintext inside an encrypted DATA frame. `streamId`
 * 0 is the connection itself (`APP_HELLO`, `PING`, `PONG`, a connection-level `ERROR`); streams the
 * Controller opens have odd ids, streams the Host opens even ids. Narrow with `type`.
 */
export type RemoteMuxFrame<T extends RemoteMuxFrameType = RemoteMuxFrameType> = {
  [K in T]: { type: K; streamId: number; meta: RemoteMuxMeta[K]; body: Buffer };
}[T];

/** What a stream was opened for: an HTTP exchange (`HTTP_REQ`) or a proxied WebSocket (`WS_OPEN`). */
export type RemoteStreamOpen =
  | { kind: 'http'; meta: RemoteMuxMeta['HTTP_REQ'] }
  | { kind: 'ws'; meta: RemoteMuxMeta['WS_OPEN'] };

/**
 * Why a mux stream is gone (reported once, through `RemoteStreamHandlers.onClosed`).
 * `queue-overflow` is a server-side close (WS_CLOSE 1013 / ERROR sent to the peer) and must NOT
 * count against the per-pairing violation quota. `link-down` means the whole session ended.
 */
export type RemoteStreamEnd =
  | { cause: 'completed' }
  | { cause: 'local-cancel' }
  | { cause: 'peer-cancel' }
  | { cause: 'local-ws-close'; code: number; reason: string }
  | { cause: 'peer-ws-close'; code: number; reason: string }
  | { cause: 'error'; origin: 'local' | 'peer'; code: RemoteErrorCode; message: string }
  | { cause: 'queue-overflow' }
  | { cause: 'link-down'; reason: RemoteLinkReason };

/**
 * Callbacks of one stream. All optional; handlers must not throw (a throwing handler is reported
 * and the stream is failed with `REMOTE_INTERNAL`). For streams the peer opens, install them with
 * `setHandlers` synchronously inside the `onStream` callback: frames follow immediately.
 */
export type RemoteStreamHandlers = {
  /** HTTP initiator: the response head arrived. */
  onResponse?(meta: RemoteMuxMeta['HTTP_RES']): void;
  /** HTTP: one body chunk (request body on the responder, response body on the initiator); `fin` ends it. */
  onBody?(chunk: Buffer, fin: boolean): void;
  /** WS: one message from the peer; batched messages arrive one by one, in order. */
  onMessage?(payload: Buffer, binary: boolean): void;
  /** The stream's send queue reached the high-water mark: stop reading the data source. */
  onPause?(): void;
  /** The queue drained below the low-water mark: resume reading. */
  onResume?(): void;
  /** Called exactly once when the stream is gone; the stream accepts no more writes afterwards. */
  onClosed?(end: RemoteStreamEnd): void;
};

/**
 * One multiplexed stream. HTTP: the initiator sends `writeBody` (REQ_BODY; an empty chunk with
 * `fin` ends a body-less request) and the responder answers `sendResponse` then `writeBody`
 * (RES_BODY). WS: both sides `sendMessage` and end with `closeWebSocket`. Writes after the stream
 * closed are ignored. Write methods return `false` while the stream is paused (queue above the
 * high-water mark): wait for `onResume` before writing more, or the queue overflows and the stream
 * is closed (1013).
 */
export type RemoteMuxStream = {
  readonly id: number;
  readonly kind: 'http' | 'ws';
  readonly closed: boolean;
  /** Bytes waiting to be transmitted for this stream (scheduler queue plus the batching buffer). */
  readonly queuedBytes: number;
  readonly paused: boolean;
  setHandlers(handlers: RemoteStreamHandlers): void;
  /** HTTP responder only: sends the response head. */
  sendResponse(meta: RemoteMuxMeta['HTTP_RES']): void;
  /** HTTP: queues a body chunk (split into <= 64 KiB frames). */
  writeBody(chunk: Uint8Array, fin?: boolean): boolean;
  /** WS: queues one message (Host -> Controller messages may be batched, never reordered). */
  sendMessage(payload: Uint8Array, binary: boolean): boolean;
  /** WS: flushes pending messages, sends WS_CLOSE and closes the stream. */
  closeWebSocket(code: number, reason: string): void;
  /** Drops everything still queued for this stream, tells the peer (CANCEL) and closes it. */
  cancel(): void;
  /** Like `cancel` but tells the peer why (mux ERROR). */
  fail(code: RemoteErrorCode, message: string): void;
};

/**
 * Tunable mux limits (contracts section 6). Defaults: 8 MiB queue per stream, pause at 4 MiB and
 * resume at 1 MiB, 25 MiB request body, 50 ms WS_MSG batching window. Per-link ceilings that keep a
 * hostile (but authenticated) peer from exhausting memory or CPU: 64 concurrently open peer-opened
 * streams (excess opening frames are answered `REMOTE_QUOTA` and dropped), 32 MiB queued across all
 * streams (the stream that crosses it is failed with `REMOTE_QUOTA`; if that does not help, the
 * session is ended), 64 pending self-generated replies (ERRORs for bad ids; beyond that they are
 * dropped) and 4 PINGs answered per second (the rest are dropped).
 */
export type RemoteMuxLimits = {
  maxQueuedBytes: number;
  pauseHighWaterBytes: number;
  resumeLowWaterBytes: number;
  maxRequestBodyBytes: number;
  batchWindowMs: number;
  maxOpenStreams: number;
  maxTotalQueuedBytes: number;
  maxPendingReplies: number;
  maxPingsPerSecond: number;
};

/**
 * State of a relay link (contracts section 2). `online` means: Controller - E2E session
 * established and APP_HELLO exchanged; Host - authenticated to the relay and listening (a
 * Controller session is reported separately by `sessionActive`). `rejected` and `locked` retry
 * after 60 s; `replaced` (4409) and `revoked` (4410) never reconnect.
 */
export type RemoteLinkState = 'stopped' | 'connecting' | 'online' | 'rejected' | 'locked' | 'replaced' | 'revoked';

/** UI-facing state of a pairing (contracts section 2); `expired` is set by idle expiry, not by the link. */
export type RemotePeerState = 'connecting' | 'online' | 'offline' | 'locked' | 'replaced' | 'revoked' | 'expired';

/**
 * Why a link is not online or why a session ended. `host-absent` = relay says the Host is not
 * there (4404 or `peer up:false`); `relay-rejected` = relay refused the credentials (401/4401 or an
 * HTTP 4xx before the upgrade); `liveness-timeout` = no PONG or any frame within 10 s of a PING
 * (Controller) or no frame from the Controller for 40 s (Host); `protocol-error` = the peer sent a
 * connection-level `ERROR REMOTE_PROTOCOL` after the session was established; `quota-exceeded` = the
 * per-link byte ceiling was breached and failing the offending stream did not fix it.
 */
export type RemoteLinkReason =
  | 'relay-unreachable'
  | 'relay-rejected'
  | 'host-absent'
  | 'handshake-timeout'
  | 'liveness-timeout'
  | 'desync'
  | 'protocol-mismatch'
  | 'protocol-error'
  | 'quota-exceeded'
  | 'peer-down'
  | 'transmit-failed'
  | 'locked'
  | 'replaced'
  | 'revoked'
  | 'stopped';

/** Snapshot of a link. `retryInMs` is set while a reconnect is scheduled; `attempt` counts consecutive back-off steps. */
export type RemoteLinkStatus = {
  state: RemoteLinkState;
  peerState: RemotePeerState;
  reason: RemoteLinkReason | null;
  attempt: number;
  retryInMs: number | null;
};

/** What a relay WebSocket needs to connect (contracts section 4); the factory builds the URL. */
export type RemoteRelaySocketTarget = {
  relayUrl: string;
  kind: RemoteRelayRoomKind;
  room: string;
  role: RemotePairingRole;
  gate: string;
};

/**
 * Events of one relay socket. `onClose` gets the WebSocket close code, or 0 together with the HTTP
 * status when the upgrade was refused (401, 503, ...), or 1006 for a dropped connection. After
 * `onClose` nothing else fires. A socket the owner closed itself stays silent.
 */
export type RemoteRelaySocketHandlers = {
  onOpen(): void;
  onText(text: string): void;
  onBinary(data: Uint8Array): void;
  onClose(code: number, httpStatus?: number): void;
};

/** One relay WebSocket; `sendBinary` resolves once the frame left the process (backpressure). */
export type RemoteRelaySocket = {
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void | Promise<void>;
  close(code?: number): void;
};

/** Opens a relay socket: the real `ws` client in production, an in-process fake in tests. */
export type RemoteRelaySocketFactory = (target: RemoteRelaySocketTarget, handlers: RemoteRelaySocketHandlers) => RemoteRelaySocket;

/** Events a relay link emits (`on(event, listener)`). */
export type RemoteLinkEvents = {
  /** Any change of state or reason. */
  state: RemoteLinkStatus;
  /** An E2E session came up (peer app version) or ended (reason): close what is bound to the pairing. */
  session: { up: true; peerAppVersion: string } | { up: false; reason: RemoteLinkReason };
  /** The relay reported the opposite role connecting or leaving. */
  peer: { up: boolean };
  /** The secure channel lost sync; streams were dropped and a new handshake follows. */
  desync: { code: 'counter-mismatch' | 'too-many-bad-frames' };
  /** A handshake message was rejected (diagnostics; the handshake window keeps running). */
  'handshake-error': { code: string };
};

/**
 * A relay link for one pairing and one role (phases 07/08 consume it). `start()` connects and
 * keeps reconnecting with back-off; `close()` is final (wipes the pairing key). Streams exist only
 * while a session is established: `openStream` throws `RemoteLinkDownError` otherwise. Incoming
 * streams (Host: HTTP and WS requests) are announced to the `onStream` handler, which may return
 * an error code (for example `REMOTE_QUOTA`) to refuse the stream.
 */
export type RemoteRelayLink = {
  readonly role: RemotePairingRole;
  readonly status: RemoteLinkStatus;
  /** True while an E2E session with the peer is established (both roles). */
  readonly sessionActive: boolean;
  /** App version the peer announced in APP_HELLO; null without a session. */
  readonly peerAppVersion: string | null;
  start(): void;
  close(): void;
  openStream(open: RemoteStreamOpen, handlers: RemoteStreamHandlers): RemoteMuxStream;
  onStream(handler: (stream: RemoteMuxStream, open: RemoteStreamOpen) => RemoteErrorCode | void): () => void;
  /** Host only: asks the relay to destroy the room (revocation); the relay then closes with 4410. Returns false when not connected. */
  destroyRoom(): boolean;
  on<E extends keyof RemoteLinkEvents>(event: E, listener: (payload: RemoteLinkEvents[E]) => void): () => void;
};

// ---------------------------
//----------------- REMOTE HOST BRIDGE AND POLICY ------------

/**
 * Why a request target (path + query as the Controller wrote it) was refused by the canonicalizer.
 * Every value is a hard refusal: the Host never "repairs" a hostile target. Stable strings used in
 * tests and in policy-violation reports.
 */
export type RemoteTargetRejection =
  | 'not-origin-form'
  | 'protocol-relative'
  | 'too-long'
  | 'illegal-character'
  | 'backslash'
  | 'path-parameter'
  | 'bad-percent-encoding'
  | 'invalid-utf8'
  | 'encoded-separator'
  | 'encoded-dot-segment'
  | 'double-encoding'
  | 'control-character'
  | 'traversal-above-root'
  | 'trailing-dot'
  | 'bad-query';

/**
 * A request target after canonicalization: the ONLY thing the Host bridge may put into a loopback
 * URL. `path` is the forwardable path (percent-decoded exactly once, re-encoded per segment, case
 * preserved, no dot segments, no `//`); `segments` are the decoded segments (case preserved) that
 * the allow-list matches on after ASCII lower-casing; `query` is `''` or `'?...'` with every `token`
 * key removed (the stock WebSocket/SSE auth reads `?token` before the Authorization header).
 */
export type RemoteCanonicalTarget = {
  path: string;
  segments: readonly string[];
  query: string;
};

/** Result of canonicalizing a request target: the canonical form, or the reason it was refused. */
export type RemoteCanonicalizeResult =
  | { ok: true; canonical: RemoteCanonicalTarget }
  | { ok: false; reason: RemoteTargetRejection };

/**
 * Why the Host policy refused an HTTP request or WebSocket open. `route-denied` = an explicit deny
 * rule matched (wins over any allow rule); `route-unknown` = nothing matched (default deny);
 * `method-not-allowed` = the method is outside GET/POST/PUT/PATCH/DELETE or the matching allow rule
 * does not list it; `invalid-target` = the canonicalizer refused (`detail` says why);
 * `websocket-path` = a WebSocket open for anything other than `/ws` or `/shell`.
 */
export type RemoteDenyReason = 'method-not-allowed' | 'route-denied' | 'route-unknown' | 'invalid-target' | 'websocket-path';

/** Outcome of the route policy for one HTTP request (`rule` names the matching allow rule, for reports). */
export type RemoteRouteDecision =
  | { allowed: true; canonical: RemoteCanonicalTarget; rule: string }
  | { allowed: false; reason: RemoteDenyReason; detail?: RemoteTargetRejection };

/** The two WebSocket endpoints a Controller may reach: `/ws` is the chat socket, `/shell` the terminal. */
export type RemoteWsChannel = 'chat' | 'shell';

/** Outcome of the policy for one WebSocket open: the channel (and the only forwardable path), or the refusal. */
export type RemoteWsTargetDecision =
  | { allowed: true; channel: RemoteWsChannel; path: '/ws' | '/shell' }
  | { allowed: false; reason: RemoteDenyReason; detail?: RemoteTargetRejection };

/**
 * A Host-side policy refusal, reported to the owner of the bridge (audit, violation quota). It never
 * carries message content, headers or query strings: `target` is the request path only, cut to 200
 * characters with non-printable characters replaced.
 */
export type RemoteBridgeViolation = {
  kind: 'http-request' | 'request-headers' | 'request-body' | 'websocket-open' | 'websocket-message';
  reason: string;
  method?: string;
  target?: string;
};

// ---------------------------
//----------------- REMOTE CONTROLLER PROXY, HOST ACCEPT AND MANAGEMENT API ------------

/**
 * One browser-side connection the Controller holds open for a paired peer: a proxied HTTP request or
 * a WebSocket. The peer registry keeps the set so it can end them all when the pairing is forgotten,
 * the link drops, or the auth epoch changes ("log out everywhere"). `close` must be safe to call twice.
 */
export type RemoteBrowserConnection = {
  close(code: number, reason: string): void;
};

/** One entry of `GET /api/remote/peers` (contracts section 2). `lastConnectedAt` is epoch milliseconds. */
export type RemotePeerView = {
  peerId: string;
  /** Host's self-declared device name: unverified, shown as a label only. */
  name: string;
  /** The name the user gave this Host on this Controller, or null; the UI shows it instead of `name`. */
  alias: string | null;
  state: RemotePeerState;
  lastConnectedAt: number | null;
};

/**
 * One paired Controller as listed by `GET /api/remote/host/status` (contracts section 10). `connected`
 * is false for a Controller that is paired but has no live session; `streams` counts the streams the
 * bridge is serving for it right now.
 */
export type RemoteHostControllerView = {
  pairingId: string;
  /** Controller's self-declared device name: unverified. */
  name: string;
  connected: boolean;
  connectedAt: number | null;
  streams: number;
  /** Epoch ms until which this Controller is suspended (auto-disconnected for repeated quota violations); absent when it is not. */
  suspendedUntil?: number;
};

/**
 * Body of `GET /api/remote/host/status`. `autoOffAt` is epoch milliseconds (null when Accept is off or
 * never auto-offs). `relay.state` summarises the Host links: `stopped` (Accept off), `idle` (Accept on,
 * nothing paired), otherwise the best state among the links. `approvalTimeoutMs` is the effective
 * `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` (FR-31) so the UI can warn when it is below 300000.
 */
export type RemoteHostStatusView = {
  acceptEnabled: boolean;
  autoOffHours: number;
  autoOffAt: number | null;
  relay: { state: string };
  approvalTimeoutMs: number;
  controllers: RemoteHostControllerView[];
};

/** Verdict of authenticating a WebSocket upgrade for `/r/<peerId>/(ws|shell)`; the HTTP status becomes the upgrade refusal. */
export type RemoteUpgradeVerdict = { ok: true } | { ok: false; status: number; reason: string };

/**
 * What the WebSocket gateway needs from the Remote module for the `/r/**` paths (injected by the server
 * entrypoint so the websocket module never imports the remote module). `owns` says whether a path
 * belongs to it; `verifyUpgrade` authenticates with the tab token carried in the
 * `Sec-WebSocket-Protocol` header (never the URL) and may delay the verdict (shell throttle);
 * `selectProtocol` picks the subprotocol to echo: always the marker, never the token;
 * `handleConnection` bridges an accepted socket to a mux stream.
 */
export type RemoteWebSocketGateway = {
  owns(pathname: string): boolean;
  /** Largest WebSocket message the transport may buffer from an owned socket (the gateway's own server uses it as `maxPayload`). */
  readonly maxPayloadBytes?: number;
  verifyUpgrade(request: IncomingMessage): Promise<RemoteUpgradeVerdict>;
  selectProtocol(protocols: Set<string>): string | false;
  handleConnection(socket: WebSocket, request: IncomingMessage): void;
};

/**
 * Hook that lets the websocket gateway react to "log out everywhere": `subscribe` registers a listener
 * (returns the unsubscribe) and `closesRegularSockets` says whether the main JWT really changed, which
 * is when ordinary chat/shell sockets must be closed too (with a pinned `JWT_SECRET` only Remote ends).
 */
export type RemoteAuthEpochHook = {
  subscribe(listener: () => void): () => void;
  closesRegularSockets(): boolean;
};

// ---------------------------
//----------------- REMOTE HARDENING: QUOTAS, IDLE EXPIRY, AUDIT (phase 13) ------------

/** What a Host-side action is called in the audit (stable strings: the audit UI and API show them). */
export type RemoteAuditEventKind =
  | 'pair'
  | 'connect'
  | 'disconnect'
  | 'revoke'
  | 'expire'
  | 'tool-decision'
  | 'pty-open'
  | 'pty-close'
  | 'file-write'
  | 'host-write'
  | 'policy-deny'
  | 'quota-reject'
  | 'quota-disconnect';

export type RemoteAuditResult = 'allow' | 'deny' | 'ok' | 'refused' | 'error' | 'closed';

/**
 * What a producer reports (before sanitising): `target` is a route or tool type, `detail` holds short
 * values only. The audit service masks secrets and cuts lengths; producers never pass file contents.
 */
export type RemoteAuditEvent = {
  event: RemoteAuditEventKind;
  target: string;
  result: RemoteAuditResult;
  detail?: Record<string, unknown>;
};

/** Which Controller an audit row is about: the pairing id (null when gone/unknown) and its self-declared, unverified label. */
export type RemoteAuditSubject = { pairingId: string | null; label: string };

/** Records one event; must never throw (a failed audit write never fails the request being audited). */
export type RemoteAuditRecorder = {
  record(subject: RemoteAuditSubject, event: RemoteAuditEvent): void;
};

/** Raw `remote_audit` row. `detail` is a JSON object text of short primitive values. Times are epoch ms. */
export type RemoteAuditRow = {
  id: number;
  at: number;
  pairing_id: string | null;
  controller: string;
  event: string;
  target: string;
  result: string;
  detail: string;
};

/** One audit entry as the API returns it (`GET /api/remote/host/audit`). */
export type RemoteAuditEntry = {
  id: number;
  at: number;
  pairingId: string | null;
  controller: string;
  event: string;
  target: string;
  result: string;
  detail: Record<string, string | number | boolean>;
};

export type RemoteAuditPage = {
  entries: RemoteAuditEntry[];
  /** Pass as `before` for the next (older) page; null when there is none. */
  nextBefore: number | null;
  /** Distinct Controllers present in the audit (for the filter), whatever the current filter. */
  controllers: Array<{ pairingId: string; label: string }>;
};

export type RemoteAuditQuery = { limit: number; before?: number; controller?: string };

/** Why a stream was refused by the per-pairing quota (FR-39). */
export type RemoteQuotaReason = 'streams' | 'pty' | 'ws' | 'rate';

/** Limits of one pairing; every value has a default and an environment override. */
export type RemoteQuotaLimits = {
  /** Concurrent streams of all kinds. */
  maxStreams: number;
  /** Concurrent `/shell` (terminal) streams. */
  maxPty: number;
  /** Concurrent `/ws` (chat) streams. */
  maxWs: number;
  /** New streams per rolling second. */
  newStreamsPerSecond: number;
  /** Counted refusals per rolling minute above which the pairing is disconnected. */
  violationsPerMinute: number;
};

/** What the Host bridge asks of a pairing's quota for each new stream. */
export type RemoteStreamQuota = {
  /** Takes a slot for a stream of `kind`, or says why not (and counts the refusal as a violation). */
  admit(kind: 'http' | 'ws' | 'pty'): { ok: true; release(): void } | { ok: false; reason: RemoteQuotaReason };
  /** The server itself closed a stream (overload 1013, queue overflow): the reconnect that follows must not be counted as a violation. */
  noteServerClose(): void;
  /** Counts one violation that is not a stream refusal (a policy denial beyond the audit rate limit); too many in a minute disconnect the pairing. */
  noteViolation?(): void;
};

// ---------------------------
//----------------- AGENT PROFILE TYPES (templates) ------------
/**
 * Role family of an agent template. An `orchestrator` template becomes the main
 * thread agent of a chat session and delegates; a `worker` template becomes a
 * sub-agent the orchestrator can call. Either way Generate renders it into a
 * native Claude Code agent file (`<project>/.claude/agents/<slug>.md`).
 *
 * Used by the Agent Profiles module (store, validation, service, routes) and,
 * through its barrel, by session wiring.
 */
export type AgentProfileFamily = 'orchestrator' | 'worker';

/**
 * Kind of value a template parameter takes. Only a UI hint (folder picker, file
 * picker, link); the server stores and renders every value as text.
 */
export type AgentProfileParamType = 'text' | 'dir' | 'file' | 'url';

/**
 * One fill-in field of a template. `key` is what `{{key}}` in the template
 * instructions refers to; it must be unique inside the template and must not use
 * a reserved key (`project_name`, `project_directory`). A `required` parameter
 * needs a value typed at Generate time, or `default`.
 */
export type AgentProfileParam = {
  key: string;
  type: AgentProfileParamType;
  title: string;
  description: string;
  required: boolean;
  default?: string;
};

/**
 * Parameter values keyed by parameter key. Always plain text; rendering escapes
 * and length-caps them before they reach a prompt.
 */
export type AgentProfileValues = Record<string, string>;

/**
 * Bookkeeping every stored profile record carries. `rev` starts at 1 and grows by
 * one on every write; a `PUT` must send the `rev` it read, and a stale `rev` is
 * refused with HTTP 409 so a newer edit is never overwritten silently.
 */
export type AgentProfileMeta = {
  id: string;
  rev: number;
  /** ISO timestamp of the last write. */
  updatedAt: string;
};

/**
 * Level-1 profile: the reusable recipe an agent is built from. `instructions` may
 * hold `{{key}}` placeholders. `bindings.project` is active (the template takes
 * values from a project); `bindings.knowledge` is reserved for a later RAG
 * feature and has no effect yet. Stored files written by older versions may carry
 * `isDefaultOrchestrator` / `origin`: they are ignored and never returned.
 */
export type AgentProfileTemplate = AgentProfileMeta & {
  slug: string;
  family: AgentProfileFamily;
  name: string;
  /** When the orchestrator should pick agents made from this template. */
  description: string;
  instructions: string;
  params: AgentProfileParam[];
  bindings: { project: boolean; knowledge: boolean };
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: string[];
  skills?: string[];
  model?: string;
  /**
   * Optional Claude Code agent memory scope, written as `memory:` into the generated agent file. Off when
   * absent (no sample template sets it). A generated agent whose `tools` list is restricted gets
   * Read/Write/Edit added so it can keep its memory files.
   */
  memory?: AgentProfileMemoryScope;
  /**
   * Optional (absent = false): the generated agent works with the app-owned memory blocks (MCP server `blocks`).
   * A restricted `tools:` list then gains the three `mcp__blocks__*` tools and the agent body a short instruction
   * paragraph. Independent of the native `memory` field.
   */
  usesBlocks?: boolean;
  /**
   * Optional heading the agents made from this template are listed under in the new-chat main-agent dropdown (at most
   * 40 characters). Absent = the dropdown's built-in "System" group. Read live from the template, never written into the
   * agent file, so editing it needs no regenerate.
   */
  group?: string;
};

/** Claude Code agent `memory:` scopes: `project` (`.claude/agent-memory/`), `user` (`~/.claude/agent-memory/`), `local` (`.claude/agent-memory-local/`). */
export type AgentProfileMemoryScope = 'project' | 'user' | 'local';

/** Editable part of a template: what a create or update request carries (no id/rev bookkeeping). */
export type AgentProfileTemplateInput = Omit<AgentProfileTemplate, keyof AgentProfileMeta>;

/** Which collection a stored profile record belongs to; also its sub-directory name. */
export type AgentProfileKind = 'templates' | 'memory-blocks';

// ---------------------------
//----------------- MEMORY BLOCK TYPES (app-owned, served to agents by the `blocks` MCP server) ------------
/** `read-only`: agents cannot write the block (only the user can); `writable`: agents may replace or append to it. */
export type MemoryBlockMode = 'read-only' | 'writable';

/**
 * Where a block applies: every agent run (`global`, content in the block record) or per project folder (`project`: one
 * definition, each folder has its own content file and an agent sees the block only in a folder that has one).
 */
export type MemoryBlockScope = { kind: 'global' } | { kind: 'project' };

/** Who wrote the content last: the user (UI/API), an agent (`agent:<main agent name>`), or nobody yet. */
export type MemoryBlockWriter = 'user' | `agent:${string}` | null;

/**
 * Stored definition of a block (`memory-blocks/<id>.json`). `name` is a slug, unique across all scopes. A project block holds
 * no content here (`content` is '' and `rev` is the definition's own revision); its text lives per folder, see
 * {@link MemoryBlockProjectContent}. A global block keeps its `content` here. Content an agent wrote is untrusted data: it
 * is only ever returned inside tool results (escaped), never put in a system prompt. `maxChars` (default 2000, hard cap
 * 20000) bounds the content. `needsAttention` is set on listing for a block saved by an older version that could not be
 * moved to per-folder content (the reason, for the user); it is never stored.
 */
export type MemoryBlockDefinition = AgentProfileMeta & {
  name: string;
  description: string;
  mode: MemoryBlockMode;
  scope: MemoryBlockScope;
  content: string;
  maxChars: number;
  lastWriter: MemoryBlockWriter;
  needsAttention?: string;
};

/** Content of a project block in one folder (`memory-block-contents/<blockId>/<hash>.json`); `rev` counts this file's writes. */
export type MemoryBlockProjectContent = {
  directory: string;
  content: string;
  rev: number;
  lastWriter: MemoryBlockWriter;
  updatedAt: string;
};

/**
 * What an agent run sees: the definition with `content`, `rev`, `lastWriter` and `updatedAt` taken from the folder's content
 * file for a project block (for a global block they are the record's own). `definitionRev` is the definition's revision.
 */
export type MemoryBlock = MemoryBlockDefinition & { definitionRev: number };

/** Editable part of a block: what a create request carries (a PUT adds `expectedRev`). Project blocks ignore `content`. */
export type MemoryBlockInput = Omit<MemoryBlockDefinition, keyof AgentProfileMeta | 'lastWriter' | 'needsAttention'>;

/**
 * A stored file that could not be read as a profile (invalid JSON or wrong shape).
 * Listings skip it, report it here, and never overwrite it.
 */
export type AgentProfileCorruptEntry = { id: string; error: string };

/** Listing result of one collection: the readable records plus the files that were skipped. */
export type AgentProfileList<T> = { items: T[]; corrupt: AgentProfileCorruptEntry[] };

/**
 * Module settings stored in `settings.json`: the Claude agents the user hid (by
 * name, same for every scope) and the main agents allowed to use the `profiles` MCP tools
 * (`profileManagerAgents`, set from the Host UI; absent in older files = none). `rev`/`updatedAt` follow the same
 * stale-write rule as profile records; both lists share the one `rev`, which any change of the settings bumps.
 */
export type AgentProfileSettings = {
  rev: number;
  updatedAt: string;
  hiddenClaudeAgents: string[];
  profileManagerAgents: string[];
};

// ---------------------------
// ---------------------------
//----------------- AGENT BUNDLE TYPES (import / export of templates and memory blocks) ------------
/**
 * One memory block inside a bundle. `scope` never carries a folder. A global block carries `content`; a project block
 * carries `contents` (one entry per folder it has text for). Both are present only when the export included block text.
 * `directory` of a `contents` entry is the folder the text belonged to on the source host: it is only a mapping key on
 * import (the target folder is always the sidebar project the user maps it to). `lastWriter` is provenance and is never
 * trusted as a user claim: text an agent wrote stays labelled as agent text.
 */
export type MemoryBlockBundleEntry = {
  name: string;
  description: string;
  mode: MemoryBlockMode;
  scope: MemoryBlockScope;
  maxChars: number;
  content?: string;
  contents?: { directory: string; content: string; lastWriter?: MemoryBlockWriter }[];
  lastWriter?: MemoryBlockWriter;
};

/**
 * The portable bundle: templates and memory blocks as editable text (YAML or JSON). Hand-written and AI-written bundles
 * are accepted as input and treated as untrusted. No ids, revisions or timestamps travel in a bundle.
 */
export type AgentBundle = {
  format: 'remotecli.agent-bundle';
  version: 1;
  exportedAt: string;
  templates: AgentProfileTemplateInput[];
  memoryBlocks: MemoryBlockBundleEntry[];
};

/**
 * A bundle after its envelope was checked (format, version, array shapes, nesting depth) but before any item was
 * validated: what a person or an AI wrote. Items are validated one by one by the import plan, so one bad item never
 * rejects the others. An {@link AgentBundle} is assignable to it.
 */
export type RawAgentBundle = {
  format: AgentBundle['format'];
  version: AgentBundle['version'];
  exportedAt: string;
  templates: unknown[];
  memoryBlocks: unknown[];
};

/** Who triggers an import: the Host user (default) or an agent proposing changes; an agent cannot write `read-only` blocks and is recorded as the writer. */
export type ImportActor = { kind: 'user' } | { kind: 'agent'; name: string };

/** Revision a preview saw of an import target (template `rev`, block definition `rev`, folder content `rev`), or `absent`. Apply compares it with the live value. */
export type ImportBasis = number | 'absent';

/** One problem found in a bundle; `level: 'warning'` never blocks the item. `line`/`column` are set when the position in the source text is known. */
export type ImportProblem = { level: 'error' | 'warning'; code: string; message: string; path?: string; line?: number; column?: number };

/** How an item or folder entry compares with the store: `new`, `identical`, `conflict` (exists and differs), `invalid` (cannot be imported), `skipped` (no target folder). */
export type ImportStatus = 'new' | 'identical' | 'conflict' | 'invalid' | 'skipped';

/** One folder-text entry of a project block in a plan. `sourceKey` (= the store's folder key of `sourceDirectory`) keys `projectMap`. */
export type ImportFolderRow = {
  /** `block:<name>#<sourceKey>`: the key to tick in `overwrite` and to index `basis`. */
  key: string;
  sourceDirectory: string;
  sourceKey: string;
  status: ImportStatus;
  code?: string;
  reason?: string;
  /** False for a conflict that can never be overwritten (the block cannot be backed up). */
  overwritable: boolean;
  basis: ImportBasis;
};

/** One template or block of a bundle in an import preview. `key` is `template:<slug>` / `block:<name>`. `overwritable` is false for a conflict that can never be overwritten (other scope kind, ambiguous name, not backed-up block). */
export type ImportPlanItem = {
  key: string;
  kind: 'template' | 'block';
  label: string;
  status: ImportStatus;
  code?: string;
  overwritable: boolean;
  problems: ImportProblem[];
  sensitive: string[];
  basis: ImportBasis;
  /** Scope kind of a block the bundle describes (absent for templates and for blocks too broken to read). */
  scope?: 'global' | 'project';
  folders?: ImportFolderRow[];
};

/** Result of a dry run: nothing is written. */
export type ImportPlan = { items: ImportPlanItem[]; hasFolderText: boolean };

/** Outcome of one folder entry when applying. */
export type ImportFolderResult = { key: string; status: 'applied' | 'skipped' | 'failed'; code?: string; reason?: string };

/** Outcome of one item when applying; `skipped` with code `IDENTICAL` means nothing to do. `partial`: the item applied but a folder entry did not. */
export type ImportItemResult = {
  key: string;
  status: 'applied' | 'skipped' | 'failed';
  code?: string;
  reason?: string;
  partial?: true;
  folders?: ImportFolderResult[];
};

/** Result of applying an import or restore. `partial`: at least one item (or folder entry) was not applied (identical items do not count). `snapshot`: file name of the backup taken before overwriting, or null. */
export type ImportResult = { items: ImportItemResult[]; partial: boolean; snapshot: string | null };

/** What an import changes: the user's choices, all optional. Keys are `template:<slug>`, `block:<name>`, `block:<name>#<sourceKey>`. `projectMap` maps a source folder key to a sidebar project id (the only way a folder entry gets a target); `basis` is what the preview saw of each ticked key (required for every overwrite). */
export type ImportOptions = {
  overwrite?: string[];
  acceptSensitive?: string[];
  projectMap?: Record<string, string>;
  basis?: Record<string, ImportBasis>;
  actor?: ImportActor;
};

/** A problem found while exporting (a block that cannot be exported completely); the export still succeeds. */
export type ExportProblem = { key: string; code: string; message: string };

/** One server-written snapshot (backup) listed for restore. */
export type AgentBundleSnapshot = { name: string; createdAt: string; templates: number; blocks: number; folders: number; bytes: number };

// ---------------------------
//----------------- CLAUDE-PROVIDED AGENT TYPES ------------
/**
 * Where a Claude agent comes from: `builtin` (shipped inside Claude Code, only
 * name/description/model known), `user` (`~/.claude/agents`) or `project`
 * (`<project directory>/.claude/agents`). Both file sources expose the full prompt.
 */
export type ClaudeAgentSource = 'builtin' | 'user' | 'project';

/**
 * Listing entry of an agent Claude Code provides: the single source of the Agents
 * list. `hidden` mirrors the saved hide list; `error` is set when the source file
 * could not be parsed (the entry still appears so the user can find and fix the file).
 * File sources also carry `path` (absolute) and `generated`: true when the file holds the
 * RemoteCLI marker comment (it was rendered from a template; `generatedFrom` is that
 * template's slug), false for a handmade file. Built-ins are never generated and have no path.
 */
export type ClaudeAgentEntry = {
  source: ClaudeAgentSource;
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  prompt?: string;
  hidden: boolean;
  generated: boolean;
  generatedFrom?: string;
  path?: string;
  error?: string;
};

/**
 * Minimal shape of an agent the Claude SDK reports from `supportedAgents()`.
 * The built-in list adapter returns these; the listing service turns them into
 * `ClaudeAgentEntry` items.
 */
export type ClaudeSdkAgentInfo = {
  name: string;
  description: string;
  model?: string;
};

// ---------------------------
//----------------- AGENT PROFILE STORE, SEED AND GENERATOR CONTRACTS ------------
/**
 * Structural check of a record read from disk: returns null when `value` has the
 * shape a record of `kind` must have, otherwise a short reason. Records that fail
 * are reported as corrupt and never overwritten.
 *
 * Implemented by the validation code and handed to the file store by the module
 * wiring, so the store stays free of per-kind field knowledge.
 */
export type StoredShapeCheck = (kind: AgentProfileKind, value: unknown) => string | null;

/**
 * One agent file the generator would write. `name` is the template slug (also the file
 * name without `.md`); `path` is the absolute file. `status`: `new` (no such file; will
 * be created), `duplicate` (a file this generator wrote earlier exists, it carries the
 * marker; applying rewrites it from the current template and values), `missing-values`
 * (a required parameter has no value from the typed values or the template default;
 * `missing` lists their keys), `invalid-name` (the template slug is not a valid agent
 * name), `handmade-exists` (a file without the marker already has this name; it is
 * never overwritten, rename or delete it by hand to let Generate write there),
 * `write-failed` (set when applying: the file system refused this one file, for example
 * a permission error; the other files of the run are still written).
 * Only `new` and `duplicate` write a file.
 *
 * Produced by the generator planner; the profiles service returns it from the
 * preview and generate calls.
 */
export type GeneratedAgentPlan = {
  templateId: string;
  name: string;
  description: string;
  path: string;
  status: 'new' | 'duplicate' | 'missing-values' | 'invalid-name' | 'handmade-exists' | 'write-failed';
  missing?: string[];
};

/**
 * Body of the Generate preview and apply requests. `directory` is the absolute folder of
 * the sidebar project (agents go to `<directory>/.claude/agents/`); omitted, null or empty
 * means the global scope (`~/.claude/agents/`). `projectName` fills `{{project_name}}`
 * (default: the folder name). `values` are the parameter values typed in the form; the
 * template default is the only other layer.
 */
export type GenerateAgentsRequest = {
  directory?: string | null;
  projectName?: string;
  templateIds: string[];
  values?: AgentProfileValues;
};

/** Where Generate writes: the project folder's `.claude/agents` or the user-wide `~/.claude/agents`. */
export type GenerateScope = 'project' | 'user';

/** Answer of the Generate preview: the target folder and one plan per chosen template (request order). */
export type GenerateAgentsPreview = {
  scope: GenerateScope;
  agentsDirectory: string;
  plans: GeneratedAgentPlan[];
};

/**
 * Answer of the Generate apply: `created` (status `new`) and `regenerated` (status
 * `duplicate`) were written; `skipped` were not. `gitExclude.file` is the repository's
 * `info/exclude` file when the project is in a git repo (null otherwise: not a repo,
 * global scope, or git unavailable) and `added` the lines newly appended to it.
 */
export type GenerateAgentsResult = {
  scope: GenerateScope;
  agentsDirectory: string;
  created: GeneratedAgentPlan[];
  regenerated: GeneratedAgentPlan[];
  skipped: GeneratedAgentPlan[];
  gitExclude: { file: string | null; added: string[] };
};

/** Answer of the remembered-values lookup: the normalized folder (null = global scope) and its values. */
export type GenerateRememberedValues = { directory: string | null; values: AgentProfileValues };

/**
 * One main agent a new chat in a sidebar project can start with: an agent file the project's
 * `.claude/agents` (`source: 'project'`) or the user's `~/.claude/agents` (`'user'`) holds, not
 * hidden, readable. A project agent shadows a user agent of the same name. `isOrchestrator` is true
 * for the agent named exactly `orchestrator` (what the sample orchestrator template generates).
 * `group` is the heading of the template the file was generated from (see `AgentProfileTemplate.group`); absent for
 * handmade files and for templates without one. Carries no path, description or prompt: this is what a Remote
 * Controller may see.
 */
export type ScopeAgentOption = { name: string; source: 'project' | 'user'; isOrchestrator: boolean; group?: string };

/** Answer of `GET /api/agent-profiles/scope-options?projectId=<sidebar project id>`. */
export type ScopeOptions = { agents: ScopeAgentOption[] };

// ---------------------------
//----------------- AGENT SESSION SCOPE AND SNAPSHOT ------------
/**
 * Scope a new chat session is opened with: the name of the main agent (a file under
 * `<project>/.claude/agents/` or `~/.claude/agents/`; the session runs with
 * `sdkOptions.agent = agentName`), or `null` for no main agent (a plain Claude chat that
 * still applies the hide list). The folder comes from the request's `projectPath` (the
 * sidebar project). A session created without any scope is a plain chat and never has one.
 *
 * Used by the profiles module (scope resolution) and the sessions route that parses the
 * request body.
 */
export type SessionAgentScope = { agentName: string | null };

/**
 * What an agent-scoped session remembers, written once when the session is created and
 * replayed on every run, resume included (the agent itself is the native file, read
 * fresh by Claude Code on each run, so editing it applies to the next turn).
 *
 * - `agentName`: main agent passed as `sdkOptions.agent`, or null for none.
 * - `hiddenClaudeAgents`: Claude agents hidden at creation time; each becomes a
 *   `Task(<name>)` disallow rule.
 *
 * Stored as JSON in the `sessions.agent_profile_snapshot` column. Rows written before
 * this shape existed (`orchestratorName` + `agents`) are read as `{ agentName: null,
 * hiddenClaudeAgents }`.
 *
 * Used by the profiles module (builds it), the sessions database (stores it), the
 * chat gateway (hands it to the runtime) and the Claude runtime (maps it to SDK options).
 */
export type SessionAgentSnapshot = {
  agentName: string | null;
  hiddenClaudeAgents: string[];
};

// ---------------------------------------------------------------------------
// Agent Monitor ("Mission Control"): the live picture of what the agents are doing, and the kill of one of its boxes.
// Mirrored by `src/shared/types.ts` (the client copy); the server module builds it, the client draws it.
// ---------------------------------------------------------------------------

/** Where one monitored agent (or background task) stands. `waiting` = it is blocked on a permission answer from the user. */
export type AgentMonitorState = 'running' | 'waiting' | 'done' | 'failed' | 'stopped';

/** One level-2 node of a session: a sub-agent, a workflow run or a background command the main agent launched. */
export type AgentMonitorNode = {
  /** The tool call that launched it (stable across the stream); falls back to the task id. */
  id: string;
  /** The agent type the orchestrator picked (an app agent name such as `review-code--alpha`), else the task description. */
  name: string;
  kind: 'agent' | 'workflow' | 'command';
  description: string;
  state: AgentMonitorState;
  startedAt: number;
  endedAt: number | null;
  /** Tokens the SDK reported for this task so far (`task_progress.usage.total_tokens`). A billed total, not a context size. */
  tokens: number;
  toolCalls: number;
  /** The tool the agent is calling right now, from its streamed tool calls; null when none was seen. */
  lastToolName: string | null;
  /** Token rate over the last seconds, 0 when the agent is quiet. Drives the edge thickness. */
  tokensPerSecond: number;
  model: string | null;
};

/** One chat session of the app with its agent tree. The server and the session are the two levels above the orchestrator. */
export type AgentMonitorSession = {
  id: string;
  /** Session name, else the folder name. */
  label: string;
  projectName: string | null;
  provider: string;
  state: 'running' | 'waiting' | 'idle';
  /** When the current run started (the user's send), null when no run is known. */
  runStartedAt: number | null;
  lastEventAt: number;
  orchestrator: {
    /** The orchestrator's agent name from the session snapshot, else "Main agent". */
    name: string;
    fromProfile: boolean;
    state: AgentMonitorState;
    lastToolName: string | null;
    /** Context size now (last `token_budget`), not spend. */
    contextTokens: number | null;
    contextWindow: number | null;
  };
  agents: AgentMonitorNode[];
  /** Finished agents folded away to keep the picture small (the oldest ones). */
  foldedFinished: number;
  /** Sum of `tokens` over the agents, folded ones included. */
  agentTokens: number;
  /** Cache read share of the latest request (0..1) when the transcript could be read; null otherwise. */
  cacheHitRatio: number | null;
  /** `app` = a chat started through this app; `terminal` = a Claude CLI process the app did not start (found in `~/.claude/sessions`). */
  source: 'app' | 'terminal';
  /**
   * `live` = built from the run's event stream (exact timing). `transcript` = derived from the CLI's session registry and its
   * transcript files: coarser, may lag a few seconds, token counts are approximate, a failed agent reads as done.
   */
  detail: 'live' | 'transcript';
  /** Host folder the session runs in; null when the app does not know it. */
  projectPath: string | null;
  /** Key of the `AgentMonitorSnapshot.projects` entry this session is listed under. */
  projectKey: string;
  /** The app chat that shows this session (tap-through); null when the app has no chat for it. */
  openSessionId: string | null;
  /**
   * The child OS processes of the session's Claude process (tools, MCP servers), grouped by process name, heaviest memory
   * first. Empty when the session's pid is unknown or the sampler has no sample yet (nobody was watching a moment ago).
   * The server always sends it; it is optional so a client reading an older server still works.
   */
  processes?: AgentMonitorProcessGroup[];
  /**
   * CPU and memory of the session's whole process tree (the Claude process included). Absent when the session's pid is
   * unknown or the sampler has no sample yet; a client shows "—" then, never 0. Optional so a client reading an older
   * server still works.
   */
  usage?: AgentMonitorSessionUsage;
};

/** Numbers only (no pid, no process list): what one session's process tree uses. `cpuPercent` is % of the whole machine; null until two samples exist. */
export type AgentMonitorSessionUsage = {
  cpuPercent: number | null;
  rssBytes: number;
  processCount: number;
};

/**
 * `POST /api/agent-monitor/kill`: stop or kill one node of the graph. The client names the session and the node by the
 * ids the snapshot gave it; it never sends (and never receives) a process id.
 * `stop` asks the SDK to end one agent cooperatively; `kill` ends processes at once.
 */
export type AgentMonitorKillRequest = {
  sessionId: string;
  /** `orch:<sid>`, `agent:<sid>:<agentId>` or `proc:<sid>:<process name>`. */
  nodeId: string;
  mode: 'stop' | 'kill';
};

/** One word for every way a kill can end; the HTTP status is 403 for `refused`, 500 for `error`, 200 otherwise. */
export type AgentMonitorKillResult = 'killed' | 'stopped' | 'gone' | 'no-handle' | 'unavailable' | 'refused' | 'error';

export type AgentMonitorKillResponse = {
  result: AgentMonitorKillResult;
  /** How many processes were killed, when it applies. */
  count?: number;
};

/**
 * Descendant processes of one session that share a process name. Names, counts, memory and CPU only: never a command
 * line, argument, path or environment (a Remote controller reads the snapshot).
 */
export type AgentMonitorProcessGroup = {
  /** Executable name without path (`node`, `bash`). An empty name is the "other" group: everything past the group cap, summed. */
  name: string;
  /** Processes in the group. */
  count: number;
  /** Sum of the working sets, bytes. */
  rssBytes: number;
  /** % of the whole machine (Task Manager's scale); null until two samples exist. */
  cpuPercent: number | null;
};

/** A project (a Host folder) with the sessions running in it. A project is running only while one of its sessions is. */
export type AgentMonitorProject = {
  key: string;
  /** The app's project name, else the folder name. */
  name: string;
  /** Host folder; null for sessions with no known folder. */
  path: string | null;
  /** `waiting` when any session waits for a permission answer, else `running` when any session works, else `idle`. */
  state: 'running' | 'waiting' | 'idle';
  /** Sessions that are running or waiting. */
  runningSessions: number;
  runningAgents: number;
  /** Sum of the sessions' `agentTokens`. */
  tokens: number;
  /** Ids of its sessions in `AgentMonitorSnapshot.sessions`, busiest first. */
  sessionIds: string[];
};

/** Answer of `GET /api/agent-monitor/summary`: the few numbers the header badge needs. Cheap: no transcript is read, no sampler starts. */
export type AgentMonitorSummary = {
  generatedAt: number;
  /** Sessions running or waiting (app chats and terminal sessions). */
  runningSessions: number;
  /** Of those, the ones blocked on a permission answer. */
  waitingSessions: number;
  /** Projects with at least one running or waiting session. */
  runningProjects: number;
};

/** CPU and memory of one process tree. `cpuPercent` is % of the whole machine (all cores = 100, Task Manager's scale); null until two samples exist. */
export type AgentMonitorUsage = {
  cpuPercent: number | null;
  rssBytes: number;
  processCount: number;
  /** Heaviest member processes by memory, for the "top processes" list. */
  top: Array<{ pid: number; name: string; rssBytes: number; cpuPercent: number | null }>;
};

/** Resource use of one target: this server, a session the app runs, or a Claude process that is not run by the app. */
export type AgentMonitorResourceRow = {
  key: string;
  kind: 'server' | 'session' | 'external';
  label: string;
  pid: number;
  usage: AgentMonitorUsage;
  /** Last ~60 s, oldest first. */
  cpuSeries: Array<number | null>;
  rssSeries: number[];
};

/** Answer of `GET /api/agent-monitor/snapshot` (read-only; a Remote controller may read it too). */
export type AgentMonitorSnapshot = {
  generatedAt: number;
  kpi: {
    runningAgents: number;
    runningSessions: number;
    tokensPerMinute: number;
    /** Agent tokens reported since local midnight, counted since this server started. */
    tokensToday: number;
    /** All targets together (server + app sessions); null until the first two samples. */
    cpuPercent: number | null;
    rssBytes: number | null;
    /** Last ~60 s, oldest first. */
    tokenSeries: number[];
    cpuSeries: Array<number | null>;
    rssSeries: number[];
  };
  sessions: AgentMonitorSession[];
  /** The same sessions grouped by project, running projects first. */
  projects: AgentMonitorProject[];
  resources: {
    /** The sampler runs only while a screen is open; false right after the first request, until its first answer. */
    sampling: boolean;
    intervalMs: number;
    lastSampleAt: number | null;
    error: string | null;
    cores: number;
    /** The whole machine (not a process): what the overview shows while no session is selected. */
    machine: AgentMonitorMachineUsage;
    rows: AgentMonitorResourceRow[];
  };
};

/** CPU and memory of the whole machine. `cpuPercent` is null until two readings exist; all cores busy = 100. */
export type AgentMonitorMachineUsage = {
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

// ---------------------------
//----------------- AGENT CHANGESET AND PENDING PROPOSAL TYPES (profiles MCP server) ------------
/** One thing an agent asks to delete: a template (key = slug) or a memory block (key = name). */
export type ChangesetDelete = { kind: 'template' | 'block'; key: string };

/**
 * What an agent proposes: bundle items to create or overwrite (`upsert`, the same shape as an import bundle, never a folder
 * text or folder) and items to delete. At most 5 items and 20 KB in total; one key is never both upserted and deleted.
 * Deletes run before upserts. Parsed (and normalised) by `parseChangeset`; stored as is in a pending proposal.
 */
export type AgentChangeset = { upsert?: RawAgentBundle; delete?: ChangesetDelete[] };

/** What a changeset item does to the store: `refused` when it cannot be applied at all (see the item's `refusal`). */
export type ChangesetAction = 'create' | 'overwrite' | 'delete' | 'identical' | 'refused';

/** One changed field of an overwrite, as text for the person who confirms (long text is cut). `null` = absent. */
export type ChangesetFieldChange = { field: string; before: string | null; after: string | null };

/**
 * One item of a changeset as the Host user sees it: what happens, why it is refused, which sensitive powers it grants and
 * what changes. `needsTick`: an overwrite or delete is applied only when its key is ticked at confirm. `basis` is the
 * revision of the target now (`absent` for a create): confirm sends it back so the tick applies to what was shown.
 */
export type ChangesetReviewItem = {
  key: string;
  kind: 'template' | 'block';
  label: string;
  action: ChangesetAction;
  needsTick: boolean;
  basis: ImportBasis;
  sensitive: string[];
  refusal?: { code: string; message: string };
  /** Readable summary lines (what is created, which fields change, what a delete loses). */
  lines: string[];
  changes: ChangesetFieldChange[];
};

/** Review of a whole changeset against the live store. `refused`: at least one item can never be applied. */
export type ChangesetReview = { items: ChangesetReviewItem[]; refused: boolean };

/** `<root>/pending/<id>.json`: a changeset an agent proposed and nobody confirmed yet. `summary` is the review taken when it was staged. */
export type PendingProposal = {
  id: string;
  createdAt: string;
  expiresAt: string;
  agentName: string;
  changeset: AgentChangeset;
  summary: ChangesetReviewItem[];
};

/** A pending proposal as `GET /pending` returns it: a fresh review against the store now, and the `basis` map to send back at confirm. No raw changeset. */
export type PendingProposalView = {
  id: string;
  createdAt: string;
  expiresAt: string;
  agentName: string;
  items: ChangesetReviewItem[];
  basis: Record<string, ImportBasis>;
};

/**
 * A memory block as the changeset checks and the `profiles` tools describe it: the stored definition plus what the block
 * holds. `problem` is set when the block cannot be backed up (so never overwritten or deleted by an agent), `ambiguous`
 * when another block uses the same name. Folder facts are counts and sizes only (paths and folder text never leave the Host).
 */
export type ProfilesLiveBlock = {
  definition: MemoryBlockDefinition;
  ambiguous: boolean;
  problem: { code: string; message: string } | null;
  /** Content files of a project block (0 for a global block). */
  folders: number;
  /** Content files whose text is not empty. */
  foldersWithText: number;
  /** Total characters of all folder texts. */
  folderChars: number;
  /** Sum of the folder content revisions: moves whenever any folder text changes. */
  folderRevSum: number;
};

/** The templates (by slug) and blocks (by name, first of a name) the store holds now, as {@link ProfilesLiveBlock}. */
export type ProfilesLiveView = {
  templates: Map<string, AgentProfileTemplate>;
  blocks: Map<string, ProfilesLiveBlock>;
};
