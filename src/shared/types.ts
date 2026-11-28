import type { TFunction } from 'i18next';
import type { CSSProperties } from 'react';
import type { NavigateFunction } from 'react-router-dom';

//----------------- LLM PROVIDER MODEL CATALOG ------------

/** Identifies which coding-agent CLI backs a session, project selection or model list. */
export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode';

/** One selectable model in a provider's model menu, including its optional reasoning-effort choices. */
export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  recordId?: number;
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
 * The full model catalog for one provider: every option plus the value used when the user has not chosen one.
 * `EFFORT_LEVELS` lists, weakest first, the reasoning-effort levels a custom model may declare in the model
 * library; the server derives it from the provider, not from the options, and it is empty without effort support.
 * `CUSTOM_MODELS_ONLY` is the user's "use only my models" flag: while it is on and a custom model exists, the
 * server lists only custom models and the first is `DEFAULT`. Older servers omit it, which means off.
 */
export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
  EFFORT_LEVELS?: string[];
  CUSTOM_MODELS_ONLY?: boolean;
};

/**
 * User-supplied fields for creating or editing a custom provider model entry.
 * `effort` lists the reasoning-effort levels the model accepts; omit it to keep
 * the stored levels on edit, send `null` to clear them.
 */
export type CustomProviderModelInput = {
  model: string;
  id: string;
  effort?: {
    values: string[];
    default?: string;
  } | null;
};

/** Mutation callbacks a model menu calls to persist custom provider models. */
export type ProviderModelActions = {
  create(provider: LLMProvider, input: CustomProviderModelInput): Promise<void>;
  update(
    provider: LLMProvider,
    existing: ProviderModelOption,
    input: CustomProviderModelInput,
  ): Promise<void>;
  remove(provider: LLMProvider, existing: ProviderModelOption): Promise<void>;
  /** Turns the provider's "use only my models" flag on or off. */
  setCustomModelsOnly(provider: LLMProvider, enabled: boolean): Promise<void>;
};

// ---------------------------

//----------------- PROJECTS AND SESSIONS ------------

/** Identifies the workspace pane the user is looking at; plugin panes are namespaced by plugin id. */
export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'browser' | `plugin:${string}`;

/** A message queued to be sent to a session at a future time. */
export type ScheduledMessage = {
  id: string;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
  /** ISO instant, so the schedule does not move when the user changes time zone. */
  scheduledFor: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  /** Why it did not go, when `status` is `failed`. */
  failureReason: string | null;
  createdAt: string;
};

/** A single conversation inside a project, as returned by the sessions API and rendered in the sidebar and chat. */
export type ProjectSession = {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  provider?: LLMProvider;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
};

/** Pagination metadata returned alongside a project's session page. */
type ProjectSessionMeta = {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
};

/** Task Master provisioning state for a project, used to decide whether the tasks tab is available. */
type ProjectTaskmasterInfo = {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
/** A workspace project as the UI knows it: identity, path, star state and its loaded sessions. */
export type Project = {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
};

/** Progress payload streamed while the backend enumerates projects, used to drive the sidebar loading bar. */
export type LoadingProgress = {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
};

// ---------------------------

//----------------- RELEASES ------------

/** The latest GitHub release for the app, rendered by the update prompt and the About tab. */
export type ReleaseInfo = {
  title: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
};

/** How this RemoteCLI install was obtained; decides whether the UI offers a self-update action. */
export type InstallMode = 'git' | 'npm';

// ---------------------------

//----------------- SESSION PROCESSING STATE ------------

/**
 * One background task — a spawned agent, a workflow run or a backgrounded
 * command — that a session still has running after its turn ended. Listed by
 * the running-sessions poll and derived from the transcript between polls;
 * `taskId` is what `chat.stop-task` addresses.
 */
export type BackgroundTaskSummary = {
  taskId: string;
  toolUseId: string;
  /** The SDK's kind: `local_agent`, `local_workflow` or `local_bash`. */
  taskType: string;
  description: string;
  workflowName?: string;
  /** When the task started (epoch ms). The activity indicator counts from the earliest. */
  startedAt: number;
  /**
   * The task was launched by a subagent or workflow agent, not by the
   * session's own turn: its `toolUseId` names a call in that agent's
   * transcript, so no card in this session's transcript matches it. Listed so
   * it can still be stopped; not counted as the session's own work.
   */
  nested?: boolean;
};

/** What a busy session is doing, as shown by the activity indicator: producing a response, or only running background tasks. */
export type SessionActivity = {
  /** Provider-supplied status line; null renders the default activity label. */
  statusText: string | null;
  canInterrupt: boolean;
  /**
   * When this request was first marked as processing (client clock). Drives
   * the elapsed-time display and the stale `chat_subscribed` idle-ack guard.
   * For background-only work it is the earliest task's start.
   */
  startedAt: number;
  /**
   * Set when no response is being produced and only background tasks keep
   * the session busy. The composer stays usable: the CLI accepts a new turn
   * while they run.
   */
  background?: boolean;
  /** The background tasks the session still has running, with or without a response in flight. */
  tasks?: BackgroundTaskSummary[];
};

/** Every busy session, keyed by session id. Read it to tell whether a session is busy; check `background` to tell how. */
export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;

/** Marks a session as producing a response; call it as soon as a send is dispatched so the UI reacts immediately. */
export type MarkSessionProcessing = (
  sessionId?: string | null,
  activity?: { statusText?: string | null; canInterrupt?: boolean },
) => void;

/** Marks a session's response as finished; `ifStartedBefore` lets a late acknowledgement clear only a stale run. Leaves background-only work alone, which it says nothing about. */
export type MarkSessionIdle = (
  sessionId?: string | null,
  opts?: { ifStartedBefore?: number },
) => void;

/** Records the background tasks a session still has once its turn ended; an empty list marks it idle. */
export type MarkSessionBackground = (
  sessionId: string,
  tasks: BackgroundTaskSummary[],
) => void;

/** Reads one session's current activity without subscribing to the map, for logic that runs on a websocket frame. */
export type GetSessionActivity = (sessionId: string) => SessionActivity | undefined;

/** Replaces the whole processing map with the server's view, used by the periodic running-sessions poll. */
export type SyncProcessingSessions = (
  sessions: readonly SessionActivitySnapshot[],
) => void;

/** Reports whether one session is currently producing a response; false for one that only has background tasks running. */
export type IsSessionProcessing = (sessionId?: string | null) => boolean;

/** One running session as reported by the server, before it is folded into the client-side activity map. */
export type SessionActivitySnapshot = {
  sessionId: string;
  statusText?: string | null;
  canInterrupt?: boolean;
  startedAt?: number;
  /** True when the server lists the session for its background tasks alone, with no chat run. */
  background?: boolean;
  tasks?: BackgroundTaskSummary[];
};

// ---------------------------

//----------------- REALTIME TRANSPORT ------------

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`). The synthetic `websocket_reconnected` kind is injected
 * client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};


// ---------------------------

//----------------- SHARED UI PRIMITIVES ------------

/** Progress state of a single queue row, driving the indicator the Queue primitive renders. */
export type QueueItemStatus = 'completed' | 'in_progress' | 'pending';

// ---------------------------

//----------------- AUTH ------------


// ---------------------------

//----------------- CHAT MESSAGES AND PERMISSIONS ------------

/** Permission preset a provider runs a turn under ('default', 'acceptEdits', 'auto', 'bypassPermissions' or 'plan'), chosen in the composer and sent with each message; the backend capability matrix decides which values a given provider accepts. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';

/** A non-image file attached to a chat message, described by its path in the server-managed attachment store plus display metadata so it can be listed and downloaded. */
export type ChatAttachment = {
  /** Absolute path inside the server-managed chat attachment store. */
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

/** A chat attachment that is an image, extending ChatAttachment with the inline base64 data URL that Claude history uses when no stored path is available. */
export type ChatImage = {
  /** Inline data URL (Claude history stores image attachments as base64). */
  data?: string;
} & ChatAttachment;

/** One stored memory an assistant reply drew on, naming the file and line range read plus what was taken from it, shown as a footnote under the reply so a memory-derived claim stays traceable. */
export type MemoryCitation = {
  /** File and line range that was read, e.g. `MEMORY.md:137-142`. */
  source: string;
  /** What the reply took from that range, when the provider states it. */
  note?: string;
};

/** One entry in a subagent's recorded timeline, normalized by the backend from either provider's transcript; `kind` decides whether the tool fields or `content` carry the entry, so read only the set that matches. */
export type SubagentActivity = {
  kind: 'tool' | 'text' | 'thinking';
  timestamp?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  content?: string;
};

/** Identity and lifecycle of one spawned subagent as the backend reports it; present on the tool call that spawned the agent and used to draw its container header. */
/**
 * A compaction, as the transcript records it.
 *
 * `running` is the status the CLI sends when it starts compacting, `done` the
 * boundary it sends when it has, `failed` a compaction that did not finish.
 * The token counts and duration only come with a boundary.
 */
export type CompactionInfo = {
  phase: 'running' | 'done' | 'failed';
  trigger?: 'manual' | 'auto';
  preTokens?: number;
  postTokens?: number;
  durationMs?: number;
  error?: string | null;
};

/** Where a background task — a spawned agent, a workflow run or a backgrounded command — stands: `stopped` is one whose session process ended before it reported, so no outcome exists and none is coming. */
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type SubagentInfo = {
  id: string;
  name?: string;
  type?: string;
  description?: string;
  /** `stopped` is a background agent whose session process ended before it reported: no outcome exists and none is coming. */
  status: BackgroundTaskStatus;
  model?: string;
  /** Total entries the agent recorded, which exceeds the received timeline when a long run was truncated for transport. */
  activityCount?: number;
};

/** One rendered entry in a chat transcript — user turn, assistant turn, tool call and result, local command output, or subagent container — and the shape the chat message list and message components consume. */
export type ChatMessage = {
  type: string;
  content?: string;
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  files?: ChatAttachment[];
  reasoning?: string;
  /**
   * The provider's identifier for the transcript row behind this message, when
   * the provider has stable per-row identity. Present on user turns from
   * Claude; it is the anchor "edit this message" and "fork from here" send back.
   */
  transcriptAnchorId?: string;
  /**
   * Set on the optimistic echo of a message being sent as a replacement for an
   * already-sent one, naming the anchor it replaces. Local to this client.
   */
  replacesAnchorId?: string;
  /**
   * The model that produced this assistant turn, as the provider reported it
   * on the transcript row. Absent on user turns and on rows the provider
   * fabricated locally, so the footer shows nothing rather than guessing.
   */
  model?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  /** Set on the row that stands in for a compaction, so it is drawn as one. */
  compact?: CompactionInfo;
  /** The summary that compaction produced, folded into the row above rather than left loose. */
  compactSummary?: string;
  isSubagentContainer?: boolean;
  /** The agent this row spawned, when it spawned one. Its presence is what makes a row a subagent container. */
  subagent?: SubagentInfo;
  /** What that agent did, in order. Empty while the agent is still starting up. */
  subagentActivity?: SubagentActivity[];
  /** The workflow run this row launched, as the backend read it on the last history load. */
  workflow?: WorkflowInfo;
  /** The latest live word on the background task this row launched, while the run is in flight. */
  taskStatus?: LiveTaskStatus;
  /** Set on the row that stands for a background task's completion report, with the status it reported. */
  isTaskNotification?: boolean;
  taskNotificationStatus?: string;
  /** Stored memory this reply drew on, shown as a footnote beneath it. */
  memoryCitations?: MemoryCitation[];
  /** Lifecycle the provider reported for this tool call, when it reports one; otherwise the status is inferred from whether a result has arrived. */
  toolStatus?: string;
  [key: string]: unknown;
};

/** The user's locally persisted Claude preferences (allowed and disallowed tool lists, permission skipping and project sort order) read from and written back to browser storage. */
export type ClaudeSettings = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
};

/** A proposed Claude tool-permission rule derived from a denied tool call, offered to the user so that tool can be added to the stored allow list in one click. */
export type ClaudePermissionSuggestion = {
  toolName: string;
  entry: string;
  isAllowed: boolean;
};

/** Outcome of writing a tool-permission rule into the stored Claude settings, reporting whether it succeeded, whether the rule was already allowed, and the resulting settings. */
export type PermissionGrantResult = {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ClaudeSettings;
};

/** A tool-permission request awaiting the user's decision, identified by its requestId and carrying the tool name, input and context needed to render the prompt and reply to the backend. */
export type PendingPermissionRequest = {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
};

/** One question asked by the AskUserQuestion tool, with its answer options, whether more than one option may be selected, and whether a typed answer is offered (`custom: false` hides it; OpenCode's questions can set it). */
export type Question = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
  custom?: boolean;
};

/** Options for a programmatic session navigation, currently only whether the route change should replace the current history entry instead of pushing a new one. */
export type SessionNavigationOptions = {
  replace?: boolean;
};

/** Context handed to the workspace when a chat run creates a session, naming the provider that created it, the owning project and the session summary, so the session can be selected and labelled. */
export type SessionEstablishedContext = {
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

/** The result returned for a tool call, carrying its content, error flag, timestamp and any provider-specific extras that the tool renderers read. */
export type ToolResult = {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
};

/** One selectable answer for a Question, with the label shown to the user and an optional explanatory description. */
type QuestionOption = {
  label: string;
  description?: string;
};

// ---------------------------

//----------------- CHAT SESSION STORE ------------

/** A provider-agnostic transcript event as normalized by the backend adapters, with all kind-specific fields kept flat; it is the shape the session store holds and that chat converts into ChatMessage for rendering, so treat it as the wire contract rather than a view model. */
export type NormalizedMessage = {
  id: string;
  /**
   * The provider's own id for the transcript row behind this message, when the
   * provider has stable per-row identity (today: Claude). Sent back as the
   * anchor for "edit this message" and "fork from here".
   */
  transcriptAnchorId?: string;
  /**
   * Set only on the client-side optimistic echo of an edited message, naming
   * the anchor that echo replaces. Never sent by the backend.
   *
   * The truncation that follows an edit clears every live row, because they
   * belonged to the turn being replaced. This tag is what tells the store the
   * replacement itself is not one of them.
   */
  replacesAnchorId?: string;
  /**
   * How many persisted rows survived the cut this echo was sent for, stamped
   * when the truncation is applied.
   *
   * The echo is retired once the provider persists it, and that is decided by
   * matching text and attachments inside a time window. That is enough until a
   * rewind re-stamps the surviving turns — a provider that has to branch
   * writes the copy with the timestamps of the copy — because an earlier turn
   * with the same words then sits inside the window and retires the message
   * the user just sent. The replacement can only be a row that was not there
   * when the cut was made, so this is where those rows begin.
   */
  replacesAfterRowCount?: number;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;
  /**
   * Per-run monotonic sequence number assigned by the backend to live
   * websocket events. Used to compute `lastSeq` for `chat.subscribe` replay;
   * REST history messages do not carry it.
   */
  seq?: number;

  // kind-specific fields (flat for simplicity)
  role?: 'user' | 'assistant';
  content?: string;
  /**
   * The model that answered this turn, as the backend read it off the
   * provider's own record of the row (today: Claude's `message.model`). Never
   * set on a user turn — no provider records which model a request went out
   * with — and never a placeholder the provider synthesized.
   */
  model?: string;
  /**
   * Mirrors optional transcript metadata from the server.
   *
   * These fields are currently used by Claude history normalization so local
   * slash commands, local stdout, and compact summaries do not disappear when
   * the session store hydrates from REST history.
   */
  displayText?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  /** Set by the provider on the row that stands in for a compaction. */
  compact?: CompactionInfo;
  images?: Array<{ path?: string; data?: string; name?: string }>;
  files?: Array<{ path?: string; name?: string; mimeType?: string; size?: number }>;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: { content: string; isError: boolean; toolUseResult?: unknown } | null;
  /** A `tool_result` row's structured output — a launch acknowledgement's task id and metadata, a search's file list. */
  toolUseResult?: unknown;
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  newSessionId?: string;
  status?: string;
  summary?: string;
  exitCode?: number;
  actualSessionId?: string;
  parentToolUseId?: string;
  /** Timeline of a spawned subagent's work, attached by the backend to the tool call that spawned it. */
  subagentTools?: SubagentActivity[];
  /** Identity and lifecycle of that subagent. */
  subagent?: SubagentInfo;
  /** The workflow run a `Workflow` call launched, attached by the backend from the run's journal. */
  workflow?: WorkflowInfo;
  /** Stored memory this reply drew on, when the provider reports it. */
  memoryCitations?: MemoryCitation[];
  isFinal?: boolean;
  // Cursor-specific ordering
  sequence?: number;
  rowid?: number;
  /**
   * `task_status` fields: one live lifecycle event of a background task.
   * `toolUseId` names the call that launched it and is absent on `updated`,
   * which is keyed by `taskId` alone; `status` and `summary` above carry the
   * event's own.
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
};

/** What a background task has spent so far — tokens, tool calls and wall time — as the CLI reports it while the task runs and when it ends. */
export type TaskUsage = {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
};

/** One agent a workflow run spawned, as its journal records it: the label and phase the script gave it (older scripts gave neither) and whether it has finished. */
export type WorkflowAgentInfo = {
  id: string;
  label?: string;
  phase?: string;
  /** `stopped` is an agent the journal never settled although the run itself has — abandoned by a stop or a resume that re-ran the step. */
  status: 'running' | 'completed' | 'failed' | 'stopped';
};

/** A `Workflow` call's run as the backend read it from disk; `stopped` is a run whose session process ended before it reported, and an empty agent list is a run that left no journal behind. */
export type WorkflowInfo = {
  runId: string;
  name: string;
  description?: string;
  status: BackgroundTaskStatus;
  agents: WorkflowAgentInfo[];
  agentCounts: { total: number; completed: number; failed: number; running: number; stopped: number };
  scriptPath?: string;
};

/**
 * The latest live word on a background task, folded from the session's
 * `task_status` events onto the tool call that launched it. It is what a card
 * reads while the run is in flight; on a history reload the backend's
 * `subagent` or `workflow` carries the settled outcome instead.
 */
export type LiveTaskStatus = {
  status: BackgroundTaskStatus;
  /** The id the events name the task by, which is what stopping it addresses. */
  taskId?: string;
  taskType?: string;
  workflowName?: string;
  description?: string;
  summary?: string;
  usage?: TaskUsage;
  /** A workflow's only: where each agent the run spawned stands, from its latest progress event. */
  agents?: WorkflowAgentProgress[];
};

/**
 * Where one agent of a running workflow stands, as the SDK reports it on the
 * run's progress events. An entry with no `agentId` is a slot the script has
 * queued but not yet started, identified by `index` alone; `lastToolName` and
 * `lastToolSummary` are the agent's own latest tool call.
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

/** Discriminator on NormalizedMessage naming which kind of transcript event it carries — plain text, tool use or result, thinking, stream delta or end, error, completion, status, permission request/resolution/cancellation, session creation, interactive prompt, or task notification. */
type MessageKind =
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

// ---------------------------

//----------------- CHAT COMPOSER ------------

/** Result payload of the chat `/model` slash command, describing the session's current provider and model plus the model catalog it may switch to, used to populate the command modal's model picker. */
export type ModelCommandData = {
  current?: {
    provider?: string;
    providerLabel?: string;
    model?: string;
  };
  available?: Partial<Record<LLMProvider, string[]>>;
  availableModels?: string[];
  availableOptions?: ProviderModelOption[];
  defaultModel?: string;
};

/** Result payload of the chat `/cost` slash command, carrying the session's token usage totals and input/output breakdown for the command modal's usage view. */
export type CostCommandData = {
  tokenUsage?: {
    used?: number;
    total?: number;
  };
  tokenBreakdown?: {
    input?: number;
    output?: number;
  };
  provider?: string;
  model?: string;
};

/** Result payload of the chat `/status` slash command, carrying server version, uptime, provider/model and process telemetry for the command modal's status view. */
export type StatusCommandData = {
  version?: string;
  packageName?: string;
  uptime?: string;
  model?: string;
  provider?: string;
  nodeVersion?: string;
  platform?: string;
  pid?: number;
  memoryUsage?: {
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
  };
};

/** Result payload of the chat `/help` slash command, carrying either pre-rendered help content or the list of available commands for the command modal's help view. */
export type HelpCommandData = {
  content?: string;
  format?: string;
  commands?: Array<{
    name: string;
    description?: string;
    namespace?: string;
  }>;
};

/** Wrapper pairing a CommandModalKind with its matching command result data; pass it as the single payload prop that tells the chat command modal which slash-command result to render, or null to close it. */
export type CommandModalPayload = {
  kind: CommandModalKind;
  data: HelpCommandData | ModelCommandData | CostCommandData | StatusCommandData;
};

/** A composer message queued while its session is still busy, holding the text, the in-memory and already-uploaded attachments and the send options snapshotted at queue time so it can be auto-sent unchanged once the session goes idle. */
export type QueuedDraft = {
  /** Last startup failure retained by the server while this message waits for retry. */
  failure?: string;
  content: string;
  /** Browser files retained while this composer stays mounted, for editing. */
  attachments: File[];
  /** JSON-safe descriptors uploaded when the message is queued. */
  uploadedAttachments?: unknown[];
  /**
   * Send options snapshotted at queue time. Persisted with the draft so the
   * app-level auto-send can dispatch the message with the right model and
   * permission settings while another session is being viewed.
   */
  options?: QueuedSendOptions;
};

/** The answer to the prompt shown when sending over a session's background work: send now (stopping that work), queue the message until the work finishes, or do nothing. */
export type BackgroundSendChoice = 'send' | 'queue' | 'cancel';

/** An open background-work send prompt, listing the session's own background tasks as display strings. */
export type BackgroundSendPrompt = {
  work: string[];
};

/** Viewport-relative placement box (right/bottom offsets plus max height and width) computed for a composer popover so the model and permission menus stay inside the window. */
export type ComposerMenuAnchor = {
  /** Exactly one of `left` (menu grows rightward from a trigger in the left half) or `right` (grows leftward from a trigger in the right half) is set. */
  left?: number;
  right?: number;
  bottom: number;
  maxHeight: number;
  maxWidth: number;
};

/** One selectable slash command — built-in, user-defined or skill-backed — as listed in the chat composer's command menu and executed when the user picks it. */
export type SlashCommand = {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: 'built-in' | 'custom' | 'skill' | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Discriminator naming which slash-command result the chat command modal is showing: 'help', 'models', 'cost' or 'status'. */
type CommandModalKind = 'help' | 'models' | 'cost' | 'status';

// ---------------------------

//----------------- CHAT VOICE ------------

/** Lifecycle state of the composer's push-to-talk microphone: 'idle', 'recording' or 'transcribing'. */
export type VoiceInputState = 'idle' | 'recording' | 'transcribing';

/** Immutable snapshot of the app-level text-to-speech player for one utterance — its play state plus any error message — read by components so read-aloud state survives re-renders and chat switches. */
export type VoiceSnapshot = { state: VoicePlayState; error: string | null };

/** Playback state of a text-to-speech utterance: 'idle', 'loading' or 'playing'. */
export type VoicePlayState = 'idle' | 'loading' | 'playing';

// ---------------------------

//----------------- CHAT STORAGE ------------

/**
 * Composer options captured when a message is queued, so the message can be
 * sent later with the exact settings (model, permission mode, tools) the
 * session's composer had at queue time — even from outside the composer,
 * e.g. the app-level auto-send that fires while another session is viewed.
 */
export type QueuedSendOptions = Record<string, unknown>;

// ---------------------------

//----------------- CHAT MESSAGE RENDERING ------------

/** Function that turns an old/new string pair into rendered diff lines; the chat session state supplies one memoized, caching instance so each file diff is computed only once. */
export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

/** A synthetic transcript entry standing for a run of consecutive calls to the same tool, produced by the message grouping pass and identified by its `_isGroup` flag so the message list can collapse the run into one expandable block. */
export type ToolGroupItem = {
  _isGroup: true;
  toolName: string;
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
  /**
   * Summary line for the collapsed group, built while grouping so the tool-input
   * JSON parsing it needs never runs during render.
   */
  preview: string;
};

/** One line of a rendered file diff, marked 'added' or 'removed', with its text and line number. */
export type DiffLine = {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
};

/** How many lines one file edit added and removed, for the `+12 -3` badge on a diff's header. */
export type DiffStats = {
  added: number;
  removed: number;
};

// ---------------------------

//----------------- CHAT TOOL RENDERING ------------

/** One entry of an agent todo list as produced by the TodoWrite/TodoRead tools, rendered as a single status row in the tool todo-list view. */
export type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
};

/** Display state of a tool call — 'running', 'completed', 'error' or 'denied' — used to choose the status badge and styling shown beside it in the transcript. */
export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

/** Props contract that every interactive permission panel implements, giving the panel the pending request, the name of the agent asking (for its header) and the callback it calls to allow or deny that request; use it when registering a panel in the permission panel registry. */
export type PermissionPanelProps = {
  request: PendingPermissionRequest;
  agentLabel?: string;
  onDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; updatedInput?: unknown },
  ) => void;
};

// ---------------------------

//----------------- CODE EDITOR ------------

/** The before/after strings of a pending edit attached to a file opened in the code editor, used to drive the editor's inline merge/diff view; extra keys are tolerated because it comes straight from tool payloads. */
export type CodeEditorDiffInfo = {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
};

/** A file handed to the code editor for viewing or editing, carrying its display name, workspace-relative path, owning DB projectId for read/save requests and any diff to highlight. */
export type CodeEditorFile = {
  name: string;
  path: string;
  // DB projectId; used by the editor to build `/api/file-tree/projects/:projectId/file`
  // URLs for reading and saving content.
  projectId?: string;
  diffInfo?: CodeEditorDiffInfo | null;
  // 1-based line to reveal when the file opens (from a `path:line` reference).
  line?: number | null;
  [key: string]: unknown;
};

/** One request to reveal a line in the editor. The code editor builds a new object per opened file so the surface can tell a fresh request apart from a re-render, and jump only once per request. */
export type CodeEditorGotoTarget = {
  // 1-based, clamped to the document by the editor surface.
  line: number;
};

/** The category of browser-renderable media a file maps to, used by the code editor to decide whether to show an inline image, PDF, video or audio preview instead of a text buffer. */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio';

// ---------------------------

//----------------- FILE TREE ------------

/** Progress, completion or failure state of one in-flight file-tree upload, produced by the upload hook and rendered by the file tree's progress banner. */
export type FileTreeUploadProgressState = {
  status: 'uploading' | 'complete' | 'error';
  progress: number;
  fileCount: number;
  uploadedCount?: number;
  fileName?: string;
  targetPath?: string;
  error?: string;
};

/** Which density the file tree renders its rows at (simple, compact or detailed), chosen in the file tree header and persisted in local storage. */
export type FileTreeViewMode = 'simple' | 'compact' | 'detailed';

/** One request to reveal a directory in the file tree, coming from a `path/` reference in a chat message. The workspace builds a new object per click so the tree re-reveals a folder the user collapsed again in the meantime. */
export type DirectoryRevealRequest = {
  // As written in the message: relative to the project root, or absolute.
  path: string;
};

/** One file or directory entry in a project's file listing, with directories carrying their loaded `children`; used across the file tree for rendering, searching and filtering. */
export type FileTreeNode = {
  name: string;
  type: FileTreeItemType;
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileTreeNode[];
  /** Folder the server did not (completely) list; its contents are fetched when the user opens it. */
  partial?: boolean;
  /** Set on a `partial` folder whose last fetch failed, until the user tries again. */
  loadError?: boolean;
  [key: string]: unknown;
};

/** The image the file tree asked to preview, carrying the path plus the DB `projectId` the image viewer needs to build its raw content URL. */
export type FileTreeImageSelection = {
  name: string;
  path: string;
  projectPath?: string;
  // DB projectId; used by ImageViewer to build the raw content URL.
  projectId: string;
};


/** Whether a file tree entry is a file or a directory; use it instead of repeating the string union wherever `FileTreeNode`-shaped data is handled. */
type FileTreeItemType = 'file' | 'directory';

// ---------------------------

//----------------- GIT PANEL ------------

/** The old/new text of a single edit, handed to the code editor so it can open a file focused on that change. */
type FileDiffInfo = {
  old_string: string;
  new_string: string;
};

/** Callback the git panel calls to open a file in the code editor, optionally focused on one edit. */
export type FileOpenHandler = (filePath: string, diffInfo?: FileDiffInfo) => void;


/** Which tab the git panel is showing (changes, compare, history, branches or worktrees), driving both the tab bar and which data its controller loads. */
export type GitPanelView = 'changes' | 'compare' | 'history' | 'branches' | 'worktrees';

/** Single-letter git status of a changed file (M, A, D, R or U), used to pick its label and badge styling; the Changes tab groups only M/A/D/U, while R (renamed) appears in the Compare tab. */
export type FileStatusCode = 'M' | 'A' | 'D' | 'R' | 'U';

/** The git action a confirmation dialog is guarding, selecting that dialog's title, action label and colour scheme. */
export type ConfirmActionType = 'discard' | 'delete' | 'commit' | 'pull' | 'push' | 'publish' | 'revertLocalCommit' | 'deleteBranch';

/** Payload of the git status endpoint: the current branch plus working-tree paths grouped by status, or the error and `notGitRepository` fields when the project has no usable repository. */
export type GitStatusResponse = {
  branch?: string;
  hasCommits?: boolean;
  modified?: string[];
  added?: string[];
  deleted?: string[];
  untracked?: string[];
  /** Paths with index-side changes — mirrors the real git index. */
  staged?: string[];
  error?: string;
  details?: string;
  /** True when the project directory is not a git repository — the UI offers `git init`. */
  notGitRepository?: boolean;
};

/** Upstream state of the current branch (remote name, ahead/behind counts, up-to-date flag) that the git panel header and branches view use to enable fetch, pull, push and publish. */
export type GitRemoteStatus = {
  hasRemote?: boolean;
  hasUpstream?: boolean;
  branch?: string;
  remoteBranch?: string;
  remoteName?: string | null;
  ahead?: number;
  behind?: number;
  isUpToDate?: boolean;
  message?: string;
  error?: string;
};

/** One commit in the history list, including the parent hashes and ref decorations the commit graph needs to lay out lanes. */
export type GitCommitSummary = {
  hash: string;
  author: string;
  email?: string;
  date: string;
  message: string;
  stats?: string;
  /** Parent commit hashes — drives the History view commit graph. */
  parents?: string[];
  /** Ref decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0". */
  refs?: string[];
};

/** Unified diff text keyed by file path, used both for working-tree diffs and for the per-file diffs of an expanded commit. */
export type GitDiffMap = Record<string, string>;

/** A pending confirmation dialog — its message, confirm handler and optional escalated alternative — raised by git panel actions and rendered by the shared Confirmation UI. */
export type ConfirmationRequest = {
  type: ConfirmActionType;
  message: string;
  onConfirm: () => Promise<void> | void;
  alternateConfirmation?: {
    label: string;
    description: string;
    actionLabel: string;
    onConfirm: () => Promise<void> | void;
  };
};

/** The `error` and `details` fields any git API response may carry; intersect it with a route's own payload type instead of redeclaring them. */
export type GitApiErrorResponse = {
  error?: string;
  details?: string;
};

/** Response of a git write endpoint such as commit, pull, push or revert: the shared error fields plus `success` and the raw git `output`. */
export type GitOperationResponse = GitApiErrorResponse & {
  success?: boolean;
  output?: string;
};

/** Response of the single-file diff endpoints (`/diff`, `/branch-diff/file`): the shared error fields plus the unified `diff` text with its headers stripped. */
export type GitFileDiffResponse = GitApiErrorResponse & {
  diff?: string;
};

/** One file the working copy changed relative to the compare base's merge base, as listed by the branch-diff endpoint; `oldPath` is only set for renames. */
export type GitBranchDiffFile = {
  path: string;
  oldPath?: string;
  status: FileStatusCode;
};

/** Payload of the branch-diff endpoint: the requested `base`, the merge-base sha it resolved to and the changed `files`, or the shared error fields plus a stable `code` (e.g. `GIT_NO_MERGE_BASE`) when the base cannot be compared. */
export type GitBranchDiffResponse = GitApiErrorResponse & {
  base?: string;
  mergeBase?: string;
  files?: GitBranchDiffFile[];
  code?: string;
};

/** One git worktree as reported by the worktrees API, including its branch, ahead/behind counts and the linked project used to open it. */
export type WorktreeInfo = {
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

/** Choices made in the merge-worktree dialog (squash, commit message and whether to remove the worktree afterwards), passed straight to the merge request. */
export type MergeWorktreeOptions = {
  squash: boolean;
  message: string;
  removeAfterMerge: boolean;
};

/** Choices made in the remove-worktree dialog (force removal and whether to delete the worktree's branch), passed straight to the remove request. */
export type RemoveWorktreeOptions = {
  force: boolean;
  deleteBranch: boolean;
};

/** Pre-computed lane geometry for one row of the history commit graph, telling the graph strip which rails to draw above, through and below that commit's dot. */
export type CommitGraphRow = {
  /** Lane the commit dot sits in. */
  nodeLane: number;
  /** Total lanes visible in this row — determines the strip width. */
  laneCount: number;
  /** A line arrives at the node from the row above (some child expects this commit). */
  hasTopContinuation: boolean;
  /** The node's own lane continues below toward its first parent. */
  hasParentContinuation: boolean;
  /** Extra top lanes that merge into the node (multiple children / branch tips joining). */
  inbound: number[];
  /** Bottom lanes branching out of the node toward its extra parents (merge commits). */
  outbound: number[];
  /** Lanes whose lines pass straight through this row untouched. */
  passThrough: number[];
  /** Every lane still active below this row — rails continue through expanded content. */
  bottomLanes: number[];
};

// ---------------------------

//----------------- MCP SERVERS ------------

/** The LLM provider whose MCP server configuration is being read or written; use it to key provider-specific MCP capabilities such as supported scopes and transports. */
export type McpProvider = LLMProvider;

/** Where an MCP server definition is stored - the user's global provider config, Claude's project-local config, or a project workspace config - and therefore which config file a read or write targets. */
export type McpScope = 'user' | 'local' | 'project';

/** How a client connects to an MCP server (a stdio subprocess, streamable HTTP, or SSE); use it to decide which connection fields of a server or form apply. */
export type McpTransport = 'stdio' | 'http' | 'sse';

/** A plain string-to-string map used for the MCP environment variables and HTTP headers that are edited as `KEY=value` lines and sent as objects. */
export type KeyValueMap = Record<string, string>;

// Internal MCP shape; `projectId` replaces the legacy `name` field from the
// projectName → projectId migration.
export type McpProject = {
  projectId: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

/** One MCP server as it is currently configured for a provider, as returned by the MCP API and rendered in the settings server list. */
export type ProviderMcpServer = {
  provider: McpProvider;
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: KeyValueMap;
  cwd?: string;
  url?: string;
  headers?: KeyValueMap;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: KeyValueMap;
  workspacePath?: string;
  projectName?: string;
  projectDisplayName?: string;
};

/** The complete editable state of the MCP server form, covering the structured connection fields and the raw JSON import text; convert it with createMcpPayloadFromForm before sending it to the API. */
export type McpFormState = {
  name: string;
  scope: McpScope;
  workspacePath: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: KeyValueMap;
  cwd: string;
  url: string;
  headers: KeyValueMap;
  envVars: string[];
  bearerTokenEnvVar: string;
  envHttpHeaders: KeyValueMap;
  importMode: McpImportMode;
  jsonInput: string;
};

/** The request body sent when creating or updating a provider's MCP server, built from McpFormState so only the fields valid for the chosen transport are included. */
export type UpsertProviderMcpServerPayload = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  workspacePath?: string;
  command?: string;
  args?: string[];
  env?: KeyValueMap;
  cwd?: string;
  url?: string;
  headers?: KeyValueMap;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: KeyValueMap;
};

/** Whether the MCP server form is being filled in field by field or pasted in as raw JSON, which selects the form's input mode. */
type McpImportMode = 'form' | 'json';

// ---------------------------

//----------------- PLUGINS ------------

/** An installed RemoteCLI plugin's manifest and runtime status (entry point, slot, permissions, enabled and server-running flags); always import this type explicitly from `@/shared/types`, because `Plugin` is also a DOM global and an unimported reference silently resolves to that instead. */
export type Plugin = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: 'react' | 'module';
  slot: 'tab';
  entry: string;
  server: string | null;
  permissions: string[];
  enabled: boolean;
  serverRunning: boolean;
  dirName: string;
  repoUrl: string | null;
};

// ---------------------------

//----------------- PRD EDITOR ------------

/** The PRD document the PRD editor should open, describing either an existing file to load (by path or inline content) or a blank draft to start from. */
export type PrdEditorFile = {
  name?: string;
  path?: string;
  // DB projectId used to resolve the project path when fetching file content.
  projectId?: string;
  content?: string;
  isExisting?: boolean;
};

/** A PRD already stored in a project's TaskMaster docs folder, used to detect filename collisions before saving and to load a previously written PRD. */
export type ExistingPrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  [key: string]: unknown;
};

// ---------------------------

//----------------- PROJECT CREATION WIZARD ------------

/** The one-based index of the step currently shown by the project-creation wizard: 1 configures the workspace, 2 reviews it before creation. */
export type WizardStep = 1 | 2;

/** How the project-creation wizard authenticates a GitHub clone: reuse a 'stored' credential, enter a 'new' token, or use 'none' and rely on public access or an SSH key. */
export type TokenMode = 'stored' | 'new' | 'none';

/** One filesystem directory returned by the browse-filesystem endpoint, used to populate workspace-path autocomplete and the folder browser. */
export type FolderSuggestion = {
  name: string;
  path: string;
  type?: string;
};

/** A stored GitHub token credential as returned by the credentials endpoint, listed so the user can pick which token authenticates a clone. */
export type GithubTokenCredential = {
  id: number;
  credential_name: string;
  is_active: boolean;
};

/** The full set of user-entered values carried across the project-creation wizard's steps, owned by ProjectCreationWizard and passed down to each step. */
export type WizardFormState = {
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
};

// ---------------------------

//----------------- PROJECT WORKSPACE ------------

/** The shared WebSocket connection and its send function, threaded through the workspace tree so descendants can exchange live session messages. */
export type RealtimeProps = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
};

/** Everything the project workspace shell and its regions need from the route: the realtime connection plus the current viewport mode and the router's navigate function. */
export type ProjectWorkspaceShellProps = RealtimeProps & {
  isMobile: boolean;
  navigate: NavigateFunction;
};

// ---------------------------

//----------------- PROVIDER AUTHENTICATION ------------

/** Reported by the server when an ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is taking precedence over a still-valid `claude /login` subscription, so every request is billed pay-as-you-go to the key; says which variable won, where it was found (the fix differs: restart after unsetting a process env var, or edit the `env` block of ~/.claude/settings.json) and the bypassed account's email when the credentials file records one. Rendered as a warning by the settings account view. */
export type ProviderAuthSubscriptionOverride = {
  variable: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN';
  source: 'process_env' | 'settings_file';
  subscriptionEmail: string | null;
};

/** Sign-in state of one LLM provider CLI - whether it is authenticated, the account email and method, plus in-flight loading and error state - polled by the provider-auth module and rendered by the settings and onboarding account views. `subscriptionOverride` is only present when an API key is bypassing a valid subscription login. */
export type ProviderAuthStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
  loading: boolean;
  subscriptionOverride?: ProviderAuthSubscriptionOverride;
  /** Version the provider's CLI printed for `--version`; null when unknown, absent until the server has answered. */
  installedVersion?: string | null;
};

/** The authentication state of every CLI provider at once, keyed by LLMProvider, so onboarding and settings can render each provider's connected, loading and error state from one object returned by useProviderAuthStatus. */
export type ProviderAuthStatusMap = Record<LLMProvider, ProviderAuthStatus>;

// ---------------------------

//----------------- PROVIDER CLI VERSION ------------

/** One provider CLI's version state from `GET /api/providers/:provider/cli`: the installed version, the newest npm release (null when the CLI is not on npm or the registry did not answer), the command the update action runs, or why there is none ('bundled': it ships with RemoteCLI; 'platform': the hosting platform manages it), whether an update run is going on, and the most recent finished run since the server started. A page that sees `updateInProgress` polls until it turns false and then shows `lastUpdate` as that run's result. Loaded by useProviderCliVersion and rendered by the settings account view. */
export type ProviderCliStatus = {
  provider: LLMProvider;
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string | null;
  updateUnavailableReason: 'bundled' | 'platform' | null;
  updateInProgress: boolean;
  lastUpdate: ProviderCliUpdateResult | null;
};

/** What one run of a CLI's own updater did, from `POST /api/providers/:provider/cli/update`: the command, its exit code (null when it could not start or timed out), the tail of its output, the version before and after, and why it failed (null when neither the exit code nor the output reports a failure). Returned by useProviderCliVersion and rendered by the settings account view. */
export type ProviderCliUpdateResult = {
  provider: LLMProvider;
  command: string;
  exitCode: number | null;
  output: string;
  previousVersion: string | null;
  installedVersion: string | null;
  failure: 'permission_denied' | 'timed_out' | 'failed' | null;
};

// ---------------------------

//----------------- QUICK SETTINGS PANEL ------------

/** Identifier of a boolean user preference exposed in the quick settings panel; use it as the key when reading or writing one preference. */
export type PreferenceToggleKey =
  | 'showRawParameters'
  | 'showThinking'
  | 'sendByCtrlEnter'
  | 'voiceEnabled';

/** The full set of quick settings booleans keyed by PreferenceToggleKey, held together so the panel can read every toggle from one object. */
export type QuickSettingsPreferences = Record<PreferenceToggleKey, boolean>;

/** Which content area the quick settings panel is showing: 'settings' (preference toggles) or 'commands' (slash-command list); persisted with the pin state and used by the tab bar and the panel view. */
export type QuickSettingsTab = 'settings' | 'commands';

/** Inline style for the quick settings drag handle, produced by the drag hook from the stored handle position and applied by the handle component. */
export type QuickSettingsHandleStyle = CSSProperties;

// ---------------------------

//----------------- SETTINGS ------------

/** The per-provider agent context the agents settings tab builds once and hands to each of its sections. */
export type AgentContextByProvider = Record<AgentProvider, AgentContext>;

/** The per-provider data the agents settings tab hands to its sections: that provider's auth status and the callback that starts its login flow. */
export type AgentContext = {
  authStatus: ProviderAuthStatus;
  onLogin: () => void;
};

/** Identifier of a top-level section in the settings dialog; use it whenever a tab is stored, compared or requested so deep links, the sidebar and the command palette all agree on the same set of names. */
export type SettingsMainTab = 'agents' | 'agentProfiles' | 'models' | 'appearance' | 'git' | 'api' | 'voice' | 'tasks' | 'browser' | 'notifications' | 'plugins' | 'remote' | 'sessions' | 'about';

/** The coding-agent CLI a settings screen is configuring, aliasing LLMProvider so agent-scoped settings read as being about an agent rather than a chat model. */
export type AgentProvider = LLMProvider;

/** One category of per-agent configuration in the agents settings tab (account, permissions, MCP servers or skills); use it to key which panel the tab renders. */
export type AgentCategory = 'account' | 'permissions' | 'mcp' | 'skills';

/** How much Codex may do without asking, from prompting on every edit to bypassing permission checks entirely; persisted as the Codex agent's permission setting. */
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** A project as the settings dialog needs it - a required identifier in `name` plus optional display name and paths - passed down to the MCP and skills panels so they can scope configuration to a project. */
export type AgentSettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

/** Claude's persisted permission settings: the allowed and disallowed tool patterns and whether permission prompts are skipped; read and written as one unit by the settings controller. */
export type ClaudePermissionsState = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
};

/** One of the Claude CLI's own settings files (the user's ~/.claude/settings.json or the administrator-managed file) and the permission rules it adds on top of ClaudePermissionsState; served read-only by the server, never edited in the app. `missing` and `invalid` files carry empty rule lists. */
export type ClaudeSettingsPermissionSource = {
  scope: 'user' | 'managed';
  path: string;
  status: 'ok' | 'missing' | 'invalid';
  allow: string[];
  deny: string[];
  ask: string[];
};

/** The user's notification settings, grouped into delivery channels (in-app, web push, desktop, sound) and the events that trigger them; mirrors the payload of the notification preferences API. */
export type NotificationPreferencesState = {
  channels: {
    inApp: boolean;
    webPush: boolean;
    desktop: boolean;
    sound: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
  };
};

/** Cursor's persisted permission settings: the allowed and disallowed command patterns and whether permission prompts are skipped; read and written as one unit by the settings controller. */
export type CursorPermissionsState = {
  allowedCommands: string[];
  disallowedCommands: string[];
  skipPermissions: boolean;
};

/** The code editor display preferences shown in the appearance tab (word wrap, minimap, line numbers and font size), stored together as one server-backed `codeEditorSettings` preference. */
export type CodeEditorSettingsState = {
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  fontSize: string;
};

// ---------------------------

//----------------- SETTINGS CREDENTIALS ------------

/** One stored RemoteCLI API key as the server returns it, in snake_case, including its masked key, creation and last-used timestamps and active flag; render it, do not rebuild it. */
export type ApiKeyItem = {
  id: string;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used?: string | null;
  is_active: boolean;
};

/** A freshly issued API key in camelCase, the only time the full secret is available; show it once and then fall back to the stored ApiKeyItem. */
export type CreatedApiKey = {
  id: string;
  keyName: string;
  apiKey: string;
  createdAt?: string;
};

/** One stored GitHub credential as the server returns it, in snake_case, carrying its name, optional description, creation timestamp and active flag - never the token itself. */
export type GithubCredentialItem = {
  id: string;
  credential_name: string;
  description?: string | null;
  created_at: string;
  is_active: boolean;
};

// ---------------------------

//----------------- SHELL ------------

/** Handle returned when touch text-selection is installed on an xterm terminal; call updateHandles after the terminal reflows and dispose when tearing the terminal down. */
export type MobileTerminalSelectionManager = {
  dispose: () => void;
  updateHandles: () => void;
};

// ---------------------------

//----------------- SIDEBAR ------------

/** The complete project-list state and callback bundle the sidebar assembles once and threads down through its project list, project rows and session rows. */
/**
 * What a session row needs to draw its state and act on the session, named once
 * so the two lists that render a row — Projects and Conversations — cannot fall
 * out of step, and so a call site passes one prop instead of nine.
 *
 * SidebarProjectListProps composes it rather than restating it; it was already
 * carrying every member.
 */
export type SessionRowActions = {
  /** The rename currently open anywhere in the sidebar, or null. */
  activeRename: ActiveSidebarRename | null;
  /** Sessions with a run in flight or background work: they count as running; the former also show a spinner and hide destructive actions. */
  activeSessions: ReadonlySet<string>;
  /** The subset of `activeSessions` that only has background tasks running, which show the purple dot instead of the spinner. */
  backgroundSessionIds: ReadonlySet<string>;
  /** Sessions waiting on the user, which show the amber dot. */
  attentionSessionIds: ReadonlySet<string>;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectId: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  /** Branches a session into an independent one. Rows hide it for providers that cannot. */
  onForkSession?: (session: SessionWithProvider) => void;
};

export type SidebarProjectListProps = SessionRowActions & {
  /** Search and Running views must never hide matching projects. */
  showAllProjects?: boolean;
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  isProjectExpanded: (projectId: string) => boolean;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  onLoadMoreSessions: (projectId: string) => void;
  loadingMoreProjects: Set<string>;
  isProjectStarred: (projectId: string) => boolean;
  onToggleProject: (projectId: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectId: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectId: string, nextName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onNewSession: (project: Project) => void;
  /** The project whose session list is in bulk-selection mode and the rows ticked in it, or null while no list is selecting. */
  sessionSelection: SidebarSessionSelection | null;
  /** Enters bulk-selection mode for one project, or replaces its ticked rows (used by "Select all" and "Clear"). */
  onSetSessionSelection: (selection: SidebarSessionSelection) => void;
  /** Ticks or unticks one row; takes the owning projectId so a memoized row can bind itself without a per-row closure. */
  onToggleSessionSelected: (projectId: string, sessionId: string) => void;
  /** Leaves bulk-selection mode, discarding the ticked rows. */
  onCancelSessionSelection: () => void;
  /** Opens the bulk delete confirmation for the ids the list resolved as still deletable. */
  onDeleteSelectedSessions: (sessionIds: string[]) => void;
  t: TFunction;
};

/**
 * The colour theme the user selected, persisted as the `theme` preference.
 *
 * `light` and `dark` pin the appearance; `system` follows the operating
 * system's light/dark setting and keeps following it while the app is open.
 * `system` is the default, and is also what an unrecognised stored value
 * resolves to.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** The ordering applied to the project list, either alphabetically by name or by most recent activity, persisted alongside the user's appearance settings. */
export type ProjectSortOrder = 'name' | 'date';

/** Which list the sidebar is currently showing: projects, conversation search results, running sessions or archived items. */
export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'archived';

/** A Project narrowed to the archived state so archived entries can be listed and restored without being mistaken for active projects. */
export type ArchivedProjectListItem = Project & { isArchived: true };

/** A ProjectSession whose LLM provider has been resolved into the required __provider field, so list rendering never has to re-derive it. */
export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

/** One archived session as returned by the archive API, carrying its own project identity because the owning project may itself be archived. */
export type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

/** The subset of archived-session fields needed to render a recent-conversations row and reopen the session it points at. */
export type RecentConversationListItem = Pick<
  ArchivedSessionListItem,
  'sessionId' | 'provider' | 'projectId' | 'projectDisplayName' | 'sessionTitle' | 'lastActivity'
>;

/**
 * The rename the sidebar currently has open, if any.
 *
 * One value rather than two id/draft pairs, so a project and a session cannot
 * both be mid-rename, and rows can be handed a resolved `isEditing` instead of
 * the raw id — a keystroke then only invalidates the row being renamed.
 *
 * A session rename carries the project that owns it so SidebarProjectList can
 * decide in O(1) which project row the draft belongs to. Without it every row
 * has to be handed the whole value and a keystroke invalidates all of them.
 */
export type ActiveSidebarRename =
  | { target: 'project'; id: string; draft: string }
  | { target: 'session'; id: string; projectId: string; draft: string };

/**
 * The sidebar's pending delete confirmation. One value rather than a pair of
 * nullable states, so a project dialog and a session dialog cannot both be
 * open — they are portalled at the same z-index and would stack. The project
 * variant carries the session count the dialog warns with, and the `sessions`
 * variant the ids of a bulk delete, resolved when the dialog was opened.
 */
export type PendingSidebarDeletion =
  | { kind: 'project'; project: Project; sessionCount: number }
  | { kind: 'session'; sessionId: string; sessionTitle: string; isArchived: boolean }
  | { kind: 'sessions'; sessionIds: string[] };

/**
 * The sessions ticked for a bulk action, scoped to the one project whose list
 * is in selection mode. Scoping it keeps a delete from mixing rows of two
 * projects, and lets every other project row be handed a constant `null`.
 */
export type SidebarSessionSelection = {
  projectId: string;
  sessionIds: ReadonlySet<string>;
};

/** Whether a TaskMaster MCP server is present and configured for a project, or null while that status is still unknown. */
export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

// Retained as `name` for backwards compatibility with existing settings
// consumers; the value is populated from `projectId` by normalizeProjectForSettings.
export type SettingsProject = {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
};

// ---------------------------

//----------------- SIDEBAR SEARCH ------------

/** Full result set of a conversation search, combining per-project message matches, session-title matches, the total match count and the query that produced them. */
export type ConversationSearchResults = {
  results: ConversationProjectResult[];
  titleResults: SessionTitleSearchResult[];
  totalMatches: number;
  query: string;
};

/** Progress of an in-flight conversation search, reported as the number of projects scanned out of the total so the UI can show how far the scan has got. */
export type SearchProgress = {
  scannedProjects: number;
  totalProjects: number;
};

/** One session whose title matched a conversation search, carrying enough project and session identity to open that session directly. */
export type SessionTitleSearchResult = {
  sessionId: string;
  provider: string;
  projectId: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  lastActivity: string | null;
};

/** All conversation matches found inside a single project during a search, grouped so the results can be rendered under one project heading. */
export type ConversationProjectResult = {
  // Emitted by the provider search service so the sidebar can map a
  // match back to the Project in its current state by projectId.
  projectId: string | null;
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSession[];
};

/** One session within a ConversationProjectResult, pairing the session's summary with the individual message matches found in it. */
type ConversationSession = {
  sessionId: string;
  sessionSummary: string;
  provider?: string;
  matches: ConversationMatch[];
};

/** A single matching message from a conversation search, holding the author role, the surrounding snippet and the ranges to highlight inside that snippet. */
type ConversationMatch = {
  role: string;
  snippet: string;
  highlights: SnippetHighlight[];
  timestamp: string | null;
  provider?: string;
  messageUuid?: string | null;
};

/** A start/end character range within a search-result snippet that should be visually marked as the matched text. */
type SnippetHighlight = {
  start: number;
  end: number;
};

// ---------------------------

//----------------- PROVIDER SKILLS ------------

/** The LLM provider whose skills are being listed, uploaded or deleted; use it to target the provider-specific skills endpoints. */
export type SkillsProvider = LLMProvider;

/** Where a skill was discovered - the user's home directory, a project, a plugin, the repository, an admin location, or the built-in system set - used to group, order and label skills and to decide whether one can be deleted. */
export type SkillsScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

/** A project workspace whose skills can be listed or added to, identified by `projectId` with optional display name and path; passed into the skills settings UI as the list of selectable project scopes. */
export type SkillsProject = {
  projectId: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

/** One skill available to a provider, carrying its slash command, description, originating scope and source path plus the owning plugin or project when it came from one. */
export type ProviderSkill = {
  provider: SkillsProvider;
  name: string;
  description: string;
  command: string;
  scope: SkillsScope;
  sourcePath: string;
  pluginName?: string;
  pluginId?: string;
  projectDisplayName?: string;
  projectPath?: string;
};

/** One skill to upload, holding its SKILL.md content, the directory and file names to write it under, and any accompanying base64-encoded support files. */
export type ProviderSkillCreateEntryPayload = {
  content: string;
  directoryName?: string;
  fileName?: string;
  files?: Array<{
    relativePath: string;
    content: string;
    encoding: 'base64';
  }>;
};

// ---------------------------

//----------------- TASK MASTER ------------

/** Identifier of a TaskMaster task or subtask, which TaskMaster may emit as either a number or a string. */
export type TaskId = string | number;

/** One task as returned by TaskMaster, including its status, priority, dependencies, implementation details and nested subtasks. */
export type TaskMasterTask = {
  id: TaskId;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  details?: string;
  testStrategy?: string;
  parentId?: TaskId;
  dependencies?: TaskId[];
  subtasks?: TaskMasterTask[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

/** A minimal pointer to a task, used by callbacks that only need its id and title rather than the full task record. */
export type TaskReference = {
  id: TaskId;
  title?: string;
  [key: string]: unknown;
};

/** A task handed to a click handler, which may be either a complete TaskMasterTask or a lightweight TaskReference. */
export type TaskSelection = TaskMasterTask | TaskReference;

/** A product-requirements document in a project's TaskMaster directory, used both for listing PRDs and for editing their content. */
export type PrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  modified?: string;
  created?: string;
  path?: string;
  size?: number;
  [key: string]: unknown;
};

/** The TaskMaster section of a project record, describing whether the project has been initialised and the status metadata TaskMaster reports for it. */
export type TaskMasterProjectInfo = {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

/** A Project augmented with the flattened TaskMaster fields (configured flag, status and task counts) that the task board and its callers read directly. */
export type TaskMasterProject = Project & {
  taskMasterConfigured?: boolean;
  taskMasterStatus?: string;
  taskCount?: number;
  completedCount?: number;
  taskmaster?: TaskMasterProjectInfo;
};




/** The layout the task board is currently rendering: kanban columns, a flat list, or a grid. */
export type TaskBoardView = 'kanban' | 'list' | 'grid';

/** The task field the board is currently sorted by. */
export type TaskBoardSortField = 'id' | 'title' | 'status' | 'priority' | 'updated';

/** The direction of the task board's current sort, ascending or descending. */
export type TaskBoardSortOrder = 'asc' | 'desc';

/** One column of the kanban board, pairing its status and display colours with the tasks that belong to it. */
export type TaskKanbanColumn = {
  id: string;
  title: string;
  status: string;
  color: string;
  headerColor: string;
  tasks: TaskMasterTask[];
};

/** A TaskMaster task's lifecycle state; the known values are enumerated and the string fallback tolerates statuses added by newer TaskMaster releases. */
type TaskStatus =
  | 'pending'
  | 'in-progress'
  | 'done'
  | 'review'
  | 'blocked'
  | 'deferred'
  | 'cancelled'
  | string;

/** A TaskMaster task's priority; high, medium and low are the known values and the string fallback tolerates anything else TaskMaster emits. */
type TaskPriority = 'high' | 'medium' | 'low' | string;

// ---------------------------

//----------------- REMOTE WORK (CONTROLLER TABS) ------------

/** Link state of one paired Host as the Controller reports it (contracts.md `PeerState`); decides whether a Remote tab may load its frame and what status it shows. */
export type RemotePeerState =
  | 'connecting'
  | 'online'
  | 'offline'
  | 'locked'
  | 'replaced'
  | 'revoked'
  | 'expired';

/** One paired Host as listed by `GET /api/remote/peers`; the Remote tab bar renders one tab per entry and `peerId` is the only identifier that ever reaches the tab's frame. */
export type RemotePeer = {
  peerId: string;
  /** The device name the Host declared when it was paired (unverified). */
  name: string;
  /** The name the user gave this Host on this Controller; shown instead of `name` when set. */
  alias: string | null;
  state: RemotePeerState;
  lastConnectedAt: string | number | null;
};

/** The short-lived tab token returned by `POST /api/remote/peers/:peerId/tab-token`; handed to a Remote tab's frame over its MessagePort and never persisted. */
export type RemoteTabTokenGrant = {
  tabToken: string;
  expiresAt: string | number;
};

/** Which storage object a Remote tab's in-memory shim stands in for; the Controller keeps the two apart under `remote:<peerId>:<area>:<key>`. */
export type TabStorageArea = 'local' | 'session';

/** The stored entries of both shimmed storage areas for one Remote tab, sent in `init` so the tab starts from where it left off after a reload. */
export type TabStorageSnapshot = Record<TabStorageArea, Record<string, string>>;

/** Messages exchanged over the MessagePort between the Controller page and a Remote tab's frame (contracts.md §3); `init` and `token` flow to the frame, the rest flow to the page. */
export type TabPortMessage =
  | { type: 'init'; peerId: string; tabToken: string; storageSnapshot: TabStorageSnapshot }
  | { type: 'token'; token: string }
  | { type: 'token-expired' }
  | { type: 'pending'; count: number }
  | { type: 'storage-set'; area: TabStorageArea; key: string | null; value: string | null };

//----------------- REMOTE WORK (MANAGEMENT UI) ------------

/** Where the Host keeps its remote master key (contracts.md section 8); `file` means the key was generated into a local file and the settings UI warns about it. */
export type RemoteMasterKeySource = 'env' | 'file';

/** `GET /api/remote/relay-config`; the relay secret is never sent back, only whether one is stored, so the settings form can never prefill it. */
export type RemoteRelayConfig = {
  url: string;
  hasSecret: boolean;
  masterKeySource: RemoteMasterKeySource;
};

/** One Controller paired with this Host as listed in `GET /api/remote/host/status`; `name` is the device name the Controller chose itself, so it is always shown as unverified, and `connected` is false for a pairing that is not linked right now (it can still be revoked). */
export type RemoteHostController = {
  pairingId: string;
  name: string;
  connected: boolean;
  connectedAt: string | number | null;
  streams: number;
  /** Set while the Host keeps this Controller disconnected for too many refused requests (epoch ms or ISO text); absent or null otherwise. */
  suspendedUntil?: string | number | null;
};

/** `GET /api/remote/host/status`; drives the Accept switch, the Controllers panel, the Local indicator and the approval-timeout warning (`approvalTimeoutMs` is null when the server did not report it). */
export type RemoteHostStatus = {
  acceptEnabled: boolean;
  autoOffHours: number;
  autoOffAt: string | number | null;
  relayState: string;
  approvalTimeoutMs: number | null;
  controllers: RemoteHostController[];
};

/** A failed `/api/remote/*` call; `status` 0 means the request never got an answer, `code` is the server's machine-readable error code (contracts.md section 9 and the auth errors) when it sent one. */
export type RemoteApiFailure = {
  ok: false;
  status: number;
  code: string | null;
  message: string | null;
};

/** What every `/api/remote/*` helper returns instead of throwing, so a screen can branch on a wrong password, a lockout or a refused action without try/catch. */
export type RemoteApiResult<T> = { ok: true; data: T } | RemoteApiFailure;

/** What the single status poll last saw (host status and the Controller's peers); `available` is false when the server has no Remote module (404) and polling idles, `failure` is the latest failed poll. */
export type RemoteStatusSnapshot = {
  loaded: boolean;
  available: boolean;
  host: RemoteHostStatus | null;
  peers: RemotePeer[];
  failure: { status: number; code: string | null } | null;
};

/** `POST /api/remote/host/pairings/start`; `code` is shown on the Host and typed on the Controller, `expiresAt` drives the five-minute countdown. */
export type RemoteHostPairingStart = {
  pairingId: string;
  code: string;
  expiresAt: string | number;
};

/** Where a Host-side pairing stands (`GET /api/remote/host/pairings/:pairingId`); the Host never learns the SAS, it only types the one the Controller shows. */
export type RemoteHostPairing = {
  state: 'waiting-controller' | 'awaiting-sas' | 'done' | 'failed';
  controllerName: string | null;
  attemptsLeft: number | null;
  lockedUntil: string | number | null;
};

/** Answer to typing the SAS on the Host: `ok: false` carries the attempts that remain (0 means the pairing was cancelled and new pairings are locked). */
export type RemoteSasConfirmation = {
  ok: boolean;
  attemptsLeft: number | null;
  lockedUntil: string | number | null;
};

/** One line of the Host's audit log (`GET /api/remote/host/audit`), newest first. `controller` is the device label the Controller chose itself (unverified) and every string may come from a hostile Controller, so all of them are shown as plain text; `detail` is a small server-sanitized object. */
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

/** A Controller that appears in the audit, for the filter dropdown. */
export type RemoteAuditController = { pairingId: string; label: string };

/** One page of the audit log; `nextBefore` is the cursor for the next (older) page, null when there is none. */
export type RemoteAuditPage = {
  entries: RemoteAuditEntry[];
  nextBefore: number | null;
  controllers: RemoteAuditController[];
};

/** Query of `GET /api/remote/host/audit`: page size (1 to 200), the cursor of the older page, and a pairing id to filter by. */
export type RemoteAuditQuery = { limit?: number; before?: number; controller?: string };

/** `GET /api/remote/peers/join/:joinId`; `sas` is what the Controller shows for the user to type on the Host, `failure` is the server's reason when the join failed. */
export type RemoteJoinProgress = {
  state: string;
  sas: string | null;
  peerId: string | null;
  failure: string | null;
};

// ---------------------------
//----------------- AGENT PROFILES (templates, Generate, Claude agent files) ------------

/** Role family of an agent template: an `orchestrator` becomes the main chat agent and delegates; a `worker` is a sub-agent the orchestrator can call. Mirrors the server's `AgentProfileFamily`. */
export type AgentProfileFamily = 'orchestrator' | 'worker';

/** Kind of value a template parameter takes (`text`, `dir`, `file`, `url`); only a hint for the input, the server stores plain text. */
export type AgentProfileParamType = 'text' | 'dir' | 'file' | 'url';

/** One fill-in field of a template; `key` is what `{{key}}` in the instructions refers to. A `required` parameter needs a value typed at Generate time or a `default`. */
export type AgentProfileParam = {
  key: string;
  type: AgentProfileParamType;
  title: string;
  description: string;
  required: boolean;
  default?: string;
};

/** Parameter values keyed by parameter key (plain text): what the Generate form sends and what the server remembers per folder. */
export type AgentProfileValues = Record<string, string>;

/** Bookkeeping of every stored record: `rev` must be sent back unchanged on a PUT, a stale `rev` is refused with HTTP 409 (`PROFILE_STALE`). */
export type AgentProfileMeta = {
  id: string;
  rev: number;
  updatedAt: string;
};

/** Claude Code agent `memory:` scopes a template may ask for: `project` (`.claude/agent-memory/`), `user` (`~/.claude/agent-memory/`), `local` (`.claude/agent-memory-local/`). Mirrors the server's `AgentProfileMemoryScope`. */
export type AgentProfileMemoryScope = 'project' | 'user' | 'local';

/** The reusable recipe agent files are generated from. `instructions` may hold `{{key}}` placeholders. `memory` is optional (absent = no agent memory). */
export type AgentProfileTemplate = AgentProfileMeta & {
  slug: string;
  family: AgentProfileFamily;
  name: string;
  description: string;
  instructions: string;
  params: AgentProfileParam[];
  bindings: { project: boolean; knowledge: boolean };
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: string[];
  skills?: string[];
  model?: string;
  memory?: AgentProfileMemoryScope;
  /** Absent = false. When true, Generate adds the `mcp__blocks__*` tools (if `tools:` is restricted) and a short instruction paragraph. Mirrors the server's `usesBlocks`. */
  usesBlocks?: boolean;
  /** Heading of the new-chat main-agent dropdown the agents of this template are listed under (at most 40 characters); absent = "System". Mirrors the server's `group`. */
  group?: string;
};

/** Editable part of a template: the body of a create request (plus `rev` on update). */
export type AgentProfileTemplateInput = Omit<AgentProfileTemplate, keyof AgentProfileMeta>;

/** `read-only`: agents cannot write the block (only the user can); `writable`: agents may replace or append. Mirrors the server's `MemoryBlockMode`. */
export type MemoryBlockMode = 'read-only' | 'writable';

/** Where a block applies: every run (`global`) or per project folder (`project`, one content file per folder). Mirrors the server's `MemoryBlockScope`. */
export type MemoryBlockScope = { kind: 'global' } | { kind: 'project' };

/** Who wrote the content last: the user, an agent (`agent:<main agent name>`) or nobody yet. Mirrors the server's `MemoryBlockWriter`. */
export type MemoryBlockWriter = 'user' | `agent:${string}` | null;

/**
 * App-owned memory block definition (`/api/agent-profiles/memory-blocks`). `rev` is sent back as `expectedRev` on update. A project
 * block holds no content here; see `MemoryBlockProjectContent`. `needsAttention` is the reason an older block could not be moved
 * to per-folder content. Mirrors the server's `MemoryBlockDefinition`.
 */
export type MemoryBlock = AgentProfileMeta & {
  name: string;
  description: string;
  mode: MemoryBlockMode;
  scope: MemoryBlockScope;
  content: string;
  maxChars: number;
  lastWriter: MemoryBlockWriter;
  needsAttention?: string;
};

/** Content of a project block in one folder. Mirrors the server's `MemoryBlockProjectContent`. */
export type MemoryBlockProjectContent = {
  directory: string;
  content: string;
  rev: number;
  lastWriter: MemoryBlockWriter;
  updatedAt: string;
};

/**
 * Body of a block create request (an update adds `expectedRev`). A project block's text lives per folder, so its body carries no
 * `content`. Mirrors the server's `MemoryBlockInput`.
 */
export type MemoryBlockInput = Omit<MemoryBlock, keyof AgentProfileMeta | 'lastWriter' | 'needsAttention' | 'content'> & { content?: string };

/** A stored file the server could not read as a profile; listed so the user can find and fix it. */
export type AgentProfileCorruptEntry = { id: string; error: string };

/** Listing of one collection: the readable records plus the files that were skipped. */
export type AgentProfileList<T> = { items: T[]; corrupt: AgentProfileCorruptEntry[] };

/** Where a Claude-provided agent comes from: shipped in Claude Code (`builtin`, no prompt known), `~/.claude/agents` (`user`) or `<project>/.claude/agents` (`project`). */
export type ClaudeAgentSource = 'builtin' | 'user' | 'project';

/**
 * Entry of the Agents list (`GET /claude-agents?directory=`); `error` is set when its file could not be parsed (the entry still
 * lists so the file can be found). File sources carry `path` and `generated`: true when the file holds RemoteCLI's marker
 * (rendered from the template whose slug is `generatedFrom`), false for a handmade file. Built-ins are never generated and have no path.
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

/** The tool/MCP/skill/model choices of a template as the editor edits them: an empty list or empty model means "not set". */
export type AgentProfileCapabilities = {
  tools: string[];
  disallowedTools: string[];
  mcpServers: string[];
  skills: string[];
  model: string;
};

/** Option lists of the template pickers that come from the server (MCP servers configured in the app, Claude skills, Claude model ids); all may be empty. */
export type ProfileCatalogs = { mcpServers: string[]; skills: string[]; models: string[] };

/** Answer of `GET /claude-agents`: entries, the hide list as stored (names no listed agent has included) with its revision (send it back on change) and where the built-in list came from. */
export type ClaudeAgentListing = {
  items: ClaudeAgentEntry[];
  hiddenNames: string[];
  hiddenRev: number;
  /** Main agents allowed to use the `profiles` tools, as stored; shares `hiddenRev` (one settings revision), so send that rev with a change. */
  managerNames: string[];
  builtinSource: 'sdk' | 'fallback';
};

/**
 * One agent file Generate would write. `name` is the template slug (the file is `<name>.md`); `status`: `new` (file will be
 * created), `duplicate` (a file RemoteCLI generated earlier: applying regenerates it), `missing-values` (`missing` lists the
 * required keys with no value), `invalid-name` (the slug is not a valid agent name), `handmade-exists` (a file without the marker
 * has this name; never overwritten), `write-failed` (only after Apply: the file system refused this one file; the others were still
 * written). Only `new` and `duplicate` write a file. Mirrors the server's `GeneratedAgentPlan`.
 */
export type GeneratedAgentPlan = {
  templateId: string;
  name: string;
  description: string;
  path: string;
  status: 'new' | 'duplicate' | 'missing-values' | 'invalid-name' | 'handmade-exists' | 'write-failed';
  missing?: string[];
};

/** Body of the Generate preview and apply requests: `directory` is the sidebar project's absolute folder (null or absent = global `~/.claude/agents`), `projectName` fills `{{project_name}}`, `values` are sent in full every time (the server does not merge remembered values). */
export type GenerateAgentsRequest = {
  directory?: string | null;
  projectName?: string;
  templateIds: string[];
  values?: AgentProfileValues;
};

/** Where Generate writes: the project folder's `.claude/agents` or the user-wide `~/.claude/agents`. */
export type GenerateScope = 'project' | 'user';

/** Answer of the Generate preview: the target folder and one plan per chosen template (request order). Writes nothing. */
export type GenerateAgentsPreview = {
  scope: GenerateScope;
  agentsDirectory: string;
  plans: GeneratedAgentPlan[];
};

/** Answer of the Generate apply: `created` and `regenerated` were written, `skipped` were not; `gitExclude.file` is the repository's `info/exclude` when the project is in a git repo (null otherwise) and `added` the lines newly appended to it. */
export type GenerateAgentsResult = {
  scope: GenerateScope;
  agentsDirectory: string;
  created: GeneratedAgentPlan[];
  regenerated: GeneratedAgentPlan[];
  skipped: GeneratedAgentPlan[];
  gitExclude: { file: string | null; added: string[] };
};

/** Answer of `GET /generate/values`: the normalized folder (null = global) and the values remembered for it, used only to pre-fill the Generate form. */
export type GenerateRememberedValues = { directory: string | null; values: AgentProfileValues };

/** A sidebar project as the Generate form targets it: its id, display name and absolute folder. */
export type GenerateTargetProject = { projectId: string; name: string; directory: string };

//----------------- AGENT BUNDLE TYPES (import / export of templates and memory blocks) ------------

/** Revision a preview saw of an import target (template `rev`, block definition `rev`, folder content `rev`), or `absent`. Apply sends it back so a target changed since the preview is refused. */
export type ImportBasis = number | 'absent';

/** One problem found in a bundle; `level: 'warning'` never blocks the item. `line`/`column` are set when the position in the source text is known. */
export type ImportProblem = { level: 'error' | 'warning'; code: string; message: string; path?: string; line?: number; column?: number };

/** How an item or folder entry compares with the store: `new`, `identical`, `conflict` (exists and differs), `invalid` (cannot be imported), `skipped` (no target folder). */
export type ImportStatus = 'new' | 'identical' | 'conflict' | 'invalid' | 'skipped';

/** One folder-text entry of a project block in a preview. `sourceKey` keys `projectMap`; `key` is what to tick in `overwrite` and to index `basis`. `overwritable` is false for a conflict that can never be overwritten. */
export type ImportFolderRow = {
  key: string;
  sourceDirectory: string;
  sourceKey: string;
  status: ImportStatus;
  code?: string;
  reason?: string;
  overwritable: boolean;
  basis: ImportBasis;
};

/** One template or block of a bundle in an import preview. `key` is `template:<slug>` / `block:<name>`. `overwritable` is false for a conflict that can never be overwritten (other scope kind, ambiguous name, block not backed up). `sensitive` lists why the item needs its own tick (`mcpServers`, `no-tools`, `skills`, `tool:<name>`). */
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

/** Result of an import preview (dry run, nothing written). `hasFolderText`: the bundle carries folder text, so source folders must be mapped to sidebar projects. */
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

/** Result of applying an import or restore. `partial`: at least one item or folder entry was not applied. `snapshot`: file name of the backup taken before overwriting, or null. */
export type ImportResult = { items: ImportItemResult[]; partial: boolean; snapshot: string | null };

/** The user's choices sent with an import; keys are `template:<slug>`, `block:<name>`, `block:<name>#<sourceKey>`. `projectMap` maps a source folder key to a sidebar project id; `basis` is what the preview saw of each ticked key (required for every overwrite). */
export type ImportOptions = {
  overwrite?: string[];
  acceptSensitive?: string[];
  projectMap?: Record<string, string>;
  basis?: Record<string, ImportBasis>;
};

/** What an export includes: the chosen templates and blocks (ids), whether block text travels, and the file format. */
export type ExportBundleRequest = {
  templateIds: string[];
  blockIds: string[];
  includeBlockContent: boolean;
  format: 'yaml' | 'json';
};

/** A problem found while exporting (a block that cannot be exported completely); the export still succeeds. */
export type ExportProblem = { key: string; code: string; message: string };

/** The answer of an export: the file name to save under, the file text, and any problems. */
export type ExportBundleResult = { filename: string; text: string; problems: ExportProblem[] };

/** One server-written snapshot (backup) listed for restore. */
export type AgentBundleSnapshot = { name: string; createdAt: string; templates: number; blocks: number; folders: number; bytes: number };

//----------------- PENDING PROPOSALS (changes an agent staged for the Host user to confirm) ------------

/** What a proposed item does to the store: `refused` when it can never be applied (see the item's `refusal`), `identical` when nothing would change. */
export type ChangesetAction = 'create' | 'overwrite' | 'delete' | 'identical' | 'refused';

/** One changed field of an overwrite as text (long text is cut by the server); `null` = absent. Shown as before and after. */
export type ChangesetFieldChange = { field: string; before: string | null; after: string | null };

/**
 * One proposed item as the review shows it: what happens, why it is refused, which sensitive powers it grants and what
 * changes. `needsTick`: an overwrite or delete applies only when its key is ticked at confirm. `basis` is the revision of the
 * target now (`absent` for a create); confirm sends it back so a tick applies to what was shown.
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
  /** Readable summary lines built by the server (what is created, which fields change, what a delete loses). */
  lines: string[];
  changes: ChangesetFieldChange[];
};

/** A waiting proposal as `GET /pending` returns it: a fresh review against the store now and the `basis` map to send back at confirm. Never the raw changeset. */
export type PendingProposalView = {
  id: string;
  createdAt: string;
  expiresAt: string;
  agentName: string;
  items: ChangesetReviewItem[];
  basis: Record<string, ImportBasis>;
};

/** The choices sent to confirm a pending proposal: `overwrite` also carries the keys of ticked deletes. */
export type PendingConfirmRequest = {
  overwrite: string[];
  acceptSensitive: string[];
  basis: Record<string, ImportBasis>;
};

//----------------- MAIN AGENT OF A CHAT (new-chat picker, session badge) ------------

/** What a chat is opened with, as the server takes it in `createSession`: `agentName` = the native agent file the chat runs as, `null` = a scoped chat without a main agent (the hide list still applies). A chat without a scope sends no `scope` key at all (the server refuses `scope: null`). */
export type AgentSessionScopePayload = { agentName: string | null };

/** One main agent a new chat can start as: a file of the project's `.claude/agents` (`project`) or of `~/.claude/agents` (`user`). `isOrchestrator` = the file is named `orchestrator`. */
export type AgentScopeOption = { name: string; source: 'project' | 'user'; isOrchestrator: boolean; group?: string };

/** `GET /api/agent-profiles/scope-options?projectId=` answer (open to Remote): names only, hidden agents already left out. */
export type AgentScopeOptions = { agents: AgentScopeOption[] };

/** What the new-chat composer needs from the picker at send time: the scope to send (undefined = no scope, key omitted). */
export type NewChatScopeRequest = {
  scope?: AgentSessionScopePayload;
};

/** Main agent a session was opened with, as `GET /api/providers/sessions/:id` reports it in `agentScope`: `agentName` null = scoped chat without a main agent. */
export type SessionAgentScopeInfo = { agentName: string | null };

// ---------------------------------------------------------------------------
// Agent Monitor ("Mission Control"): the live picture of what the agents are doing, and the kill of one of its boxes.
// Mirror of the server's `AgentMonitor*` types in `server/shared/types.ts`: change them together.
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
   * unknown or the sampler has no sample yet; show "—" then, never 0. Optional so a client reading an older server still works.
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
