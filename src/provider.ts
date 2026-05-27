/**
 * AzureDevOpsProvider — implements GitOpsProvider over Azure DevOps REST 7.1.
 *
 * Auth: PAT via Basic header (empty username + PAT).
 * The organisation is part of the storage envelope so the user only types
 * once. Repo FQN format: "organization/project/repo".
 *
 * Storage namespace: `gitops-azdevops`
 */

import type { HostServices } from "@vibecontrols/plugin-sdk/contract";
import { BoundLogger } from "@vibecontrols/plugin-sdk";

import {
  GitOpsError,
  type AuthInput,
  type AuthValidation,
  type Branch,
  type Contributor,
  type Environment,
  type GitOpsProvider,
  type HealthSnapshot,
  type IssueSummary,
  type NormalisedRepo,
  type OrgRollup,
  type Pipeline,
  type PipelineAnalytics,
  type PipelineRun,
  type PullRequest,
  type PullRequestAnalytics,
  type RepoPage,
  type SecurityAlert,
  type Webhook,
} from "./types.js";

const STORAGE_NS = "gitops-azdevops";
const KEY_PAT = "pat:default";

interface StoredAuth {
  kind: "pat" | "oauth" | "app";
  token: string;
  meta?: Record<string, string>;
  savedAt: string;
}

interface CacheEntry<T> {
  ts: number;
  ttlMs: number;
  value: T;
}

interface AdoRepo {
  id: string;
  name: string;
  url: string;
  webUrl: string;
  defaultBranch?: string;
  size?: number;
  project: { id: string; name: string };
  isFork?: boolean;
  isDisabled?: boolean;
}

interface AdoPr {
  pullRequestId: number;
  title: string;
  status: string;
  isDraft?: boolean;
  createdBy?: { displayName?: string; uniqueName?: string };
  reviewers?: Array<{
    displayName?: string;
    uniqueName?: string;
    vote?: number;
  }>;
  creationDate: string;
  closedDate?: string;
  url?: string;
  _links?: { web?: { href?: string } };
}

interface AdoRun {
  id: number;
  name?: string;
  state: string;
  result?: string;
  createdDate: string;
  finishedDate?: string;
  resources?: {
    repositories?: { self?: { refName?: string; version?: string } };
  };
  pipeline?: { id: number; name?: string };
  _links?: { web?: { href?: string } };
}

export class AzureDevOpsProvider implements GitOpsProvider {
  readonly name = "azdevops" as const;
  private readonly host: HostServices;
  private readonly log: BoundLogger;
  private token: string | null = null;
  private organisation: string | null = null;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(host: HostServices) {
    this.host = host;
    this.log = new BoundLogger(host.logger, "gitops-azdevops");
  }

  async init(): Promise<void> {
    const s = await this.loadAuth();
    if (s) {
      this.token = s.token;
      this.organisation = s.meta?.["organization"] ?? null;
      this.log.info("Loaded persisted AzDO PAT");
    }
  }

  private async loadAuth(): Promise<StoredAuth | null> {
    const raw = await this.host.storage?.get<string>(STORAGE_NS, KEY_PAT);
    if (!raw) return null;
    try {
      return typeof raw === "string"
        ? (JSON.parse(raw) as StoredAuth)
        : (raw as StoredAuth);
    } catch {
      return null;
    }
  }

  private requireOrg(): string {
    if (!this.organisation)
      throw new GitOpsError(
        "INVALID",
        "meta.organization missing — call saveCredentials with org first",
      );
    return this.organisation;
  }

  private headers(): Headers {
    const h = new Headers({
      "User-Agent": "vibecontrols-gitops-azdevops/0.1",
      Accept: "application/json",
    });
    if (this.token) {
      // PAT: empty user + token (per AzDO spec).
      h.set("Authorization", "Basic " + btoa(":" + this.token));
    }
    return h;
  }

  private mapStatus(s: number, body: string): GitOpsError {
    if (s === 401 || s === 203)
      return new GitOpsError("AUTH", "AzDO: unauthorized");
    if (s === 403) return new GitOpsError("FORBIDDEN", "AzDO: forbidden");
    if (s === 404) return new GitOpsError("NOT_FOUND", "AzDO: not found");
    if (s === 429) return new GitOpsError("RATE_LIMITED", "AzDO: rate-limited");
    return new GitOpsError("UPSTREAM", "AzDO: " + s + " " + body.slice(0, 200));
  }

  private async rest<T>(path: string, project?: string): Promise<T> {
    const org = this.requireOrg();
    const url = path.startsWith("http")
      ? path
      : `https://dev.azure.com/${encodeURIComponent(org)}${project ? "/" + encodeURIComponent(project) : ""}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    // AzDO returns 203 for unauth as well as 401 sometimes
    if (res.status === 203) {
      const text = await res.text().catch(() => "");
      throw this.mapStatus(203, text);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw this.mapStatus(res.status, text);
    }
    return (await res.json()) as T;
  }

  private cached<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const e = this.cache.get(key) as CacheEntry<T> | undefined;
    if (e && Date.now() - e.ts < e.ttlMs) return Promise.resolve(e.value);
    return fn().then((v) => {
      this.cache.set(key, { ts: Date.now(), ttlMs, value: v });
      return v;
    });
  }

  /** AzDO FQN: "org/project/repo" — but org is implicit, so we parse out
   *  the last two segments. */
  private parseFqn(fqn: string): { project: string; repo: string } {
    const parts = fqn.split("/");
    if (parts.length === 3) return { project: parts[1]!, repo: parts[2]! };
    if (parts.length === 2) return { project: parts[0]!, repo: parts[1]! };
    throw new GitOpsError(
      "INVALID",
      `Invalid AzDO FQN: ${fqn} (expected org/project/repo)`,
    );
  }

  private mapRepo(r: AdoRepo): NormalisedRepo {
    const fqn = `${this.organisation}/${r.project.name}/${r.name}`;
    return {
      fqn,
      provider: "azdevops",
      visibility: "private",
      defaultBranch: (r.defaultBranch ?? "refs/heads/main").replace(
        /^refs\/heads\//,
        "",
      ),
      isArchived: !!r.isDisabled,
      isFork: !!r.isFork,
      size: r.size,
      url: r.webUrl,
      createdAt: "",
      updatedAt: "",
    };
  }

  private mapPr(p: AdoPr): PullRequest {
    const state =
      p.status === "completed"
        ? "merged"
        : p.status === "abandoned"
          ? "closed"
          : "open";
    const reviewers = (p.reviewers ?? [])
      .map((r) => r.displayName ?? r.uniqueName ?? "")
      .filter(Boolean);
    const decision = (() => {
      const votes = (p.reviewers ?? []).map((r) => r.vote ?? 0);
      if (votes.some((v) => v < 0)) return "CHANGES_REQUESTED" as const;
      if (votes.length && votes.every((v) => v >= 10))
        return "APPROVED" as const;
      return undefined;
    })();
    return {
      id: String(p.pullRequestId),
      number: p.pullRequestId,
      title: p.title,
      state,
      isDraft: !!p.isDraft,
      author: p.createdBy?.displayName ?? p.createdBy?.uniqueName ?? "unknown",
      reviewers,
      reviewDecision: decision,
      createdAt: p.creationDate,
      updatedAt: p.creationDate,
      mergedAt: p.closedDate,
      durationOpenSeconds: p.closedDate
        ? Math.floor(
            (Date.parse(p.closedDate) - Date.parse(p.creationDate)) / 1000,
          )
        : undefined,
      url: p._links?.web?.href ?? "",
      labels: [],
    };
  }

  private mapRun(r: AdoRun): PipelineRun {
    return {
      id: String(r.id),
      pipelineName: r.pipeline?.name ?? r.name ?? "pipeline",
      branch: (r.resources?.repositories?.self?.refName ?? "").replace(
        /^refs\/heads\//,
        "",
      ),
      status:
        r.state === "inProgress"
          ? "running"
          : r.state === "notStarted"
            ? "queued"
            : "completed",
      conclusion:
        r.result === "succeeded"
          ? "success"
          : r.result === "failed"
            ? "failure"
            : r.result === "canceled"
              ? "cancelled"
              : undefined,
      startedAt: r.createdDate,
      completedAt: r.finishedDate,
      durationSeconds: r.finishedDate
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(r.finishedDate) - Date.parse(r.createdDate)) / 1000,
            ),
          )
        : undefined,
      url: r._links?.web?.href ?? "",
      actor: "unknown",
      commitSha: r.resources?.repositories?.self?.version,
    };
  }

  // ── auth ────────────────────────────────────────────────────────────

  async saveCredentials(input: AuthInput): Promise<void> {
    if (!input.meta?.["organization"])
      throw new GitOpsError(
        "INVALID",
        "meta.organization is required for Azure DevOps",
      );
    const env: StoredAuth = {
      kind: input.kind,
      token: input.token,
      meta: input.meta,
      savedAt: new Date().toISOString(),
    };
    await this.host.storage?.set(STORAGE_NS, KEY_PAT, JSON.stringify(env));
    this.token = input.token;
    this.organisation = input.meta["organization"];
    this.cache.clear();
  }

  async validateCredentials(): Promise<AuthValidation> {
    if (!this.token) {
      const s = await this.loadAuth();
      if (!s) return { ok: false, message: "No PAT stored" };
      this.token = s.token;
      this.organisation = s.meta?.["organization"] ?? null;
    }
    try {
      const data = await this.rest<{
        authenticatedUser?: { providerDisplayName?: string };
      }>("/_apis/connectionData?api-version=7.1");
      return {
        ok: true,
        account:
          data.authenticatedUser?.providerDisplayName ??
          this.organisation ??
          "",
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async rotateCredentials(input: AuthInput): Promise<AuthValidation> {
    await this.saveCredentials(input);
    return this.validateCredentials();
  }

  async revokeCredentials(): Promise<void> {
    await this.host.storage?.delete(STORAGE_NS, KEY_PAT);
    this.token = null;
    this.organisation = null;
    this.cache.clear();
  }

  async healthCheck(): Promise<HealthSnapshot> {
    try {
      await this.rest("/_apis/connectionData?api-version=7.1");
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── repos ───────────────────────────────────────────────────────────

  async listRepos(opts: {
    org?: string;
    limit?: number;
    cursor?: string;
  }): Promise<RepoPage> {
    // For AzDO, opts.org is treated as project name (not org — org is in auth envelope).
    const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
    if (opts.org) {
      const data = await this.rest<{ value: AdoRepo[] }>(
        `/_apis/git/repositories?api-version=7.1`,
        opts.org,
      );
      const items = data.value.slice(0, limit).map((r) => this.mapRepo(r));
      return { items };
    }
    // No project specified — fetch all projects, then repos per project (limited).
    const projects = await this.rest<{
      value: Array<{ name: string }>;
    }>(`/_apis/projects?api-version=7.1`);
    const items: NormalisedRepo[] = [];
    for (const proj of projects.value.slice(0, 5)) {
      try {
        const data = await this.rest<{ value: AdoRepo[] }>(
          `/_apis/git/repositories?api-version=7.1`,
          proj.name,
        );
        for (const r of data.value) {
          items.push(this.mapRepo(r));
          if (items.length >= limit) break;
        }
        if (items.length >= limit) break;
      } catch {
        // skip project on failure
      }
    }
    return { items };
  }

  async getRepo(fqn: string): Promise<NormalisedRepo> {
    return this.cached(`repo:${fqn}`, 60_000, async () => {
      const { project, repo } = this.parseFqn(fqn);
      const r = await this.rest<AdoRepo>(
        `/_apis/git/repositories/${encodeURIComponent(repo)}?api-version=7.1`,
        project,
      );
      return this.mapRepo(r);
    });
  }

  async listBranches(fqn: string): Promise<Branch[]> {
    const { project, repo } = this.parseFqn(fqn);
    const data = await this.rest<{
      value: Array<{ name: string; objectId: string; isLocked?: boolean }>;
    }>(
      `/_apis/git/repositories/${encodeURIComponent(repo)}/refs?filter=heads/&api-version=7.1`,
      project,
    );
    return data.value.map((b) => ({
      name: b.name.replace(/^refs\/heads\//, ""),
      isProtected: !!b.isLocked,
      lastCommitSha: b.objectId,
    }));
  }

  async listLanguages(_fqn: string): Promise<Record<string, number>> {
    // AzDO doesn't expose language stats per-repo cheaply. Return empty.
    return {};
  }

  async listContributors(
    fqn: string,
    opts?: { limit?: number },
  ): Promise<Contributor[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 20, 100));
    const { project, repo } = this.parseFqn(fqn);
    try {
      const data = await this.rest<{
        value: Array<{ author?: { name?: string; email?: string } }>;
      }>(
        `/_apis/git/repositories/${encodeURIComponent(repo)}/commits?$top=${limit}&api-version=7.1`,
        project,
      );
      const counts = new Map<string, number>();
      for (const c of data.value) {
        const login = c.author?.name;
        if (!login) continue;
        counts.set(login, (counts.get(login) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([login, contributions]) => ({ login, contributions }));
    } catch {
      return [];
    }
  }

  // ── PRs ─────────────────────────────────────────────────────────────

  async listPullRequests(
    fqn: string,
    opts?: { state?: "open" | "closed" | "all"; limit?: number },
  ): Promise<PullRequest[]> {
    const { project, repo } = this.parseFqn(fqn);
    const statusMap: Record<string, string> = {
      open: "active",
      closed: "completed",
      all: "all",
    };
    const status = statusMap[opts?.state ?? "open"] ?? "active";
    const limit = Math.max(1, Math.min(opts?.limit ?? 30, 100));
    const data = await this.rest<{ value: AdoPr[] }>(
      `/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=${status}&$top=${limit}&api-version=7.1`,
      project,
    );
    return data.value.map((p) => this.mapPr(p));
  }

  async getPullRequest(fqn: string, id: number): Promise<PullRequest> {
    const { project, repo } = this.parseFqn(fqn);
    const p = await this.rest<AdoPr>(
      `/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${id}?api-version=7.1`,
      project,
    );
    return this.mapPr(p);
  }

  async pullRequestAnalytics(fqn: string): Promise<PullRequestAnalytics> {
    const open = await this.listPullRequests(fqn, {
      state: "open",
      limit: 100,
    });
    const closed = await this.listPullRequests(fqn, {
      state: "closed",
      limit: 100,
    });
    const merged = closed.filter((p) => p.state === "merged");
    const sorted = [...merged]
      .filter((m) => typeof m.durationOpenSeconds === "number")
      .sort(
        (a, b) => (a.durationOpenSeconds ?? 0) - (b.durationOpenSeconds ?? 0),
      );
    const median = sorted.length
      ? (sorted[Math.floor(sorted.length / 2)]?.durationOpenSeconds ?? 0) / 3600
      : 0;
    return {
      slowest: sorted.slice(-5).reverse(),
      fastest: sorted.slice(0, 5),
      medianAgeHours: Math.round(median * 10) / 10,
      awaitingReview: open.filter((p) => !p.reviewDecision),
      awaitingApproval: open.filter(
        (p) => p.reviewDecision === "REVIEW_REQUIRED",
      ),
    };
  }

  // ── issues ──────────────────────────────────────────────────────────

  async listIssues(_fqn: string): Promise<IssueSummary[]> {
    // AzDO Boards (work items) — out of scope for v1.
    return [];
  }

  async labelStats(_fqn: string): Promise<Record<string, number>> {
    return {};
  }

  // ── CI ──────────────────────────────────────────────────────────────

  async listPipelines(fqn: string): Promise<Pipeline[]> {
    const { project } = this.parseFqn(fqn);
    const data = await this.rest<{
      value: Array<{ id: number; name: string; folder?: string }>;
    }>(`/_apis/pipelines?api-version=7.1`, project);
    return data.value.map((p) => ({
      id: String(p.id),
      name: p.name,
      state: "active" as const,
      path: p.folder,
    }));
  }

  async listRecentRuns(
    fqn: string,
    opts?: { limit?: number; branch?: string },
  ): Promise<PipelineRun[]> {
    const { project } = this.parseFqn(fqn);
    const limit = Math.max(1, Math.min(opts?.limit ?? 30, 100));
    const pipelines = await this.listPipelines(fqn);
    const runs: PipelineRun[] = [];
    for (const pipe of pipelines.slice(0, 5)) {
      try {
        const data = await this.rest<{ value: AdoRun[] }>(
          `/_apis/pipelines/${pipe.id}/runs?$top=${limit}&api-version=7.1`,
          project,
        );
        for (const r of data.value) {
          const mapped = this.mapRun({
            ...r,
            pipeline: { id: Number(pipe.id), name: pipe.name },
          });
          if (opts?.branch && mapped.branch !== opts.branch) continue;
          runs.push(mapped);
          if (runs.length >= limit) break;
        }
        if (runs.length >= limit) break;
      } catch {
        // skip
      }
    }
    return runs.slice(0, limit);
  }

  async getRun(fqn: string, runId: string): Promise<PipelineRun> {
    const { project } = this.parseFqn(fqn);
    // We don't know which pipeline owns this run; query the builds endpoint instead.
    const data = await this.rest<AdoRun>(
      `/_apis/build/builds/${encodeURIComponent(runId)}?api-version=7.1`,
      project,
    );
    return this.mapRun(data);
  }

  async pipelineAnalytics(fqn: string): Promise<PipelineAnalytics> {
    const runs = await this.listRecentRuns(fqn, { limit: 100 });
    const completed = runs.filter((r) => r.status === "completed");
    const succ = completed.filter((r) => r.conclusion === "success").length;
    const durations = completed
      .map((r) => r.durationSeconds ?? 0)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    const pct = (p: number) =>
      durations.length === 0
        ? 0
        : (durations[
            Math.min(durations.length - 1, Math.floor(durations.length * p))
          ] ?? 0);
    return {
      successRate: completed.length ? succ / completed.length : 0,
      durationP50: pct(0.5),
      durationP95: pct(0.95),
      slowest: [...completed]
        .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))
        .slice(0, 5),
      fastest: [...completed]
        .filter((r) => (r.durationSeconds ?? 0) > 0)
        .sort((a, b) => (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0))
        .slice(0, 5),
      running: runs.filter((r) => r.status === "running"),
      queued: runs.filter((r) => r.status === "queued"),
      pendingApproval: [],
      totalRunsLast30Days: runs.length,
    };
  }

  async listEnvironments(_fqn: string): Promise<Environment[]> {
    return [];
  }

  async listSecurityAlerts(
    _fqn: string,
    _opts?: { kind?: SecurityAlert["type"] },
  ): Promise<SecurityAlert[]> {
    // AzDO Advanced Security alerts API is org-scoped + premium; skip v1.
    return [];
  }

  async orgRollup(_org: string): Promise<OrgRollup> {
    const first = await this.listRepos({ limit: 100 });
    const items = first.items;
    return {
      totalRepos: items.length,
      byVisibility: { public: 0, private: items.length, internal: 0 },
      byLanguage: {},
      archived: items.filter((r) => r.isArchived).length,
      stale30d: 0,
      totalOpenPRs: 0,
      totalOpenIssues: 0,
    };
  }

  async listWebhooks(_fqn: string): Promise<Webhook[]> {
    return [];
  }
}
