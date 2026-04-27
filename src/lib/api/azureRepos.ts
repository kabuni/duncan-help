import { supabase } from "@/integrations/supabase/client";

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("azure-repos-api", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || "azure-repos-api failed");
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export type AzureRepo = {
  id: string;
  name: string;
  project: string;
  project_id: string;
  default_branch: string;
  size: number;
  web_url: string;
};

export type AzureCommit = {
  commit_id: string;
  short_id: string;
  project: string;
  repository: string;
  author: string;
  author_email: string;
  date: string;
  comment: string;
  url: string;
  changes?: { Add: number; Edit: number; Delete: number };
};

export type AzurePullRequest = {
  id: number;
  title: string;
  status: string;
  merge_status: string;
  is_draft: boolean;
  created_by: string;
  created_by_email: string;
  creation_date: string;
  closed_date?: string;
  source_branch: string;
  target_branch: string;
  repository: string;
  project: string;
  repository_id: string;
  reviewers: { name: string; vote: number; is_required: boolean }[];
  url: string;
};

export type TeamActivitySummary = {
  since: string;
  days: number;
  repos_total: number;
  commits_total: number;
  commits_by_author: Record<string, number>;
  commits_by_repo: Record<string, number>;
  recent_commits: { project: string; repository: string; author: string; date: string; message: string }[];
  active_prs_total: number;
  active_prs: {
    id: number;
    title: string;
    project: string;
    repository: string;
    created_by: string;
    creation_date: string;
    is_draft: boolean;
    target_branch: string;
    reviewers_pending: number;
  }[];
};

export const azureReposApi = {
  listRepos: () => call<{ repos: AzureRepo[]; count: number }>("list_repos"),
  listBranches: (project: string, repository_id: string) =>
    call<{ branches: { name: string; object_id: string; creator?: string }[] }>("list_branches", { project, repository_id }),
  getRecentCommits: (opts: { days?: number; top?: number; project?: string; repository_id?: string; author?: string } = {}) =>
    call<{ commits: AzureCommit[]; count: number; since: string }>("get_recent_commits", opts),
  listPullRequests: (opts: { status?: "active" | "completed" | "abandoned" | "all"; top?: number; project?: string; repository_id?: string } = {}) =>
    call<{ pull_requests: AzurePullRequest[]; count: number }>("list_pull_requests", opts),
  getPRThreads: (project: string, repository_id: string, pull_request_id: number) =>
    call<{ threads: any[]; count: number }>("get_pr_threads", { project, repository_id, pull_request_id }),
  teamActivitySummary: (days = 7) =>
    call<TeamActivitySummary>("team_activity_summary", { days }),
};
