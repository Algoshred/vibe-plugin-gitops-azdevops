/**
 * GitOpsProvider contract — copy of the source of truth in
 * `@vibecontrols/vibe-plugin-gitops/src/types.ts`. Duplicated here so the
 * provider can build before the meta plugin is published to npm. The two
 * MUST stay in sync; CI will fail-build any drift detectable by the
 * provider catalog tests.
 */

export type GitVisibility = "public" | "private" | "internal";
export type RepoFqn = string;

export interface NormalisedRepo {
  fqn: RepoFqn;
  provider: string;
  visibility: GitVisibility;
  defaultBranch: string;
  description?: string;
  language?: string;
  topics?: string[];
  isArchived: boolean;
  isFork: boolean;
  size?: number;
  stars?: number;
  forks?: number;
  watchers?: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  pushedAt?: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  author: string;
  reviewers: string[];
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
  mergeState?: "clean" | "dirty" | "blocked" | "unstable" | "behind";
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  durationOpenSeconds?: number;
  url: string;
  labels: string[];
}

export interface Pipeline {
  id: string;
  name: string;
  state: "active" | "disabled";
  path?: string;
}

export interface PipelineJob {
  id: string;
  name: string;
  status: string;
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
}

export interface PipelineRun {
  id: string;
  pipelineName: string;
  branch: string;
  status: "queued" | "running" | "completed" | "waiting";
  conclusion?:
    | "success"
    | "failure"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "neutral";
  event?: string;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  url: string;
  actor: string;
  jobs?: PipelineJob[];
  commitSha?: string;
  commitMessage?: string;
}

export interface SecurityAlert {
  id: string;
  type: "code-scan" | "secret-scan" | "dependency" | "advisory";
  severity: "critical" | "high" | "medium" | "low" | "info";
  state: "open" | "dismissed" | "fixed";
  title: string;
  url: string;
  ruleId?: string;
  ecosystem?: string;
  cve?: string;
  createdAt: string;
}

export interface OrgRollup {
  totalRepos: number;
  byVisibility: Record<GitVisibility, number>;
  byLanguage: Record<string, number>;
  archived: number;
  stale30d: number;
  totalOpenPRs: number;
  totalOpenIssues: number;
}

export interface AuthInput {
  kind: "pat" | "oauth" | "app";
  token: string;
  meta?: Record<string, string>;
}

export interface AuthValidation {
  ok: boolean;
  account?: string;
  scopes?: string[];
  expiresAt?: string;
  message?: string;
}

export interface HealthSnapshot {
  ok: boolean;
  rateLimit?: { remaining: number; resetAt: string };
  message?: string;
}

export interface Branch {
  name: string;
  isProtected: boolean;
  lastCommitSha: string;
}

export interface Contributor {
  login: string;
  contributions: number;
  avatarUrl?: string;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  createdAt: string;
}

export interface RepoPage {
  items: NormalisedRepo[];
  nextCursor?: string;
}

export interface PullRequestAnalytics {
  slowest: PullRequest[];
  fastest: PullRequest[];
  medianAgeHours: number;
  awaitingReview: PullRequest[];
  awaitingApproval: PullRequest[];
}

export interface PipelineAnalytics {
  successRate: number;
  durationP50: number;
  durationP95: number;
  slowest: PipelineRun[];
  fastest: PipelineRun[];
  running: PipelineRun[];
  queued: PipelineRun[];
  pendingApproval: PipelineRun[];
  totalRunsLast30Days: number;
}

export interface Environment {
  name: string;
  state: string;
  lastDeployedAt?: string;
  url?: string;
}

export interface Deployment {
  id: string;
  env: string;
  ref: string;
  state: string;
  createdAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

export interface GitOpsProvider {
  readonly name: "github" | "gitlab" | "bitbucket" | "azdevops";
  saveCredentials(input: AuthInput): Promise<void>;
  validateCredentials(): Promise<AuthValidation>;
  rotateCredentials(input: AuthInput): Promise<AuthValidation>;
  revokeCredentials(): Promise<void>;
  healthCheck(): Promise<HealthSnapshot>;
  listRepos(opts: {
    org?: string;
    limit?: number;
    cursor?: string;
  }): Promise<RepoPage>;
  getRepo(fqn: RepoFqn): Promise<NormalisedRepo>;
  listBranches(fqn: RepoFqn): Promise<Branch[]>;
  listLanguages(fqn: RepoFqn): Promise<Record<string, number>>;
  listContributors(
    fqn: RepoFqn,
    opts?: { limit?: number },
  ): Promise<Contributor[]>;
  listPullRequests(
    fqn: RepoFqn,
    opts?: { state?: "open" | "closed" | "all"; limit?: number },
  ): Promise<PullRequest[]>;
  getPullRequest(fqn: RepoFqn, id: number): Promise<PullRequest>;
  pullRequestAnalytics(fqn: RepoFqn): Promise<PullRequestAnalytics>;
  listIssues(
    fqn: RepoFqn,
    opts?: { state?: "open" | "closed"; limit?: number },
  ): Promise<IssueSummary[]>;
  labelStats(fqn: RepoFqn): Promise<Record<string, number>>;
  listPipelines(fqn: RepoFqn): Promise<Pipeline[]>;
  listRecentRuns(
    fqn: RepoFqn,
    opts?: { limit?: number; branch?: string },
  ): Promise<PipelineRun[]>;
  getRun(fqn: RepoFqn, runId: string): Promise<PipelineRun>;
  pipelineAnalytics(fqn: RepoFqn): Promise<PipelineAnalytics>;
  listEnvironments?(fqn: RepoFqn): Promise<Environment[]>;
  listDeployments?(fqn: RepoFqn, env?: string): Promise<Deployment[]>;
  listSecurityAlerts(
    fqn: RepoFqn,
    opts?: { kind?: SecurityAlert["type"] },
  ): Promise<SecurityAlert[]>;
  orgRollup(org: string): Promise<OrgRollup>;
  listWebhooks?(fqn: RepoFqn): Promise<Webhook[]>;
}

export type GitOpsErrorCode =
  | "AUTH"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "UPSTREAM"
  | "INVALID";

export class GitOpsError extends Error {
  readonly code: GitOpsErrorCode;
  readonly upstreamStatus?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: GitOpsErrorCode,
    message: string,
    opts?: { upstreamStatus?: number; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "GitOpsError";
    this.code = code;
    this.upstreamStatus = opts?.upstreamStatus;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
  }
}
