import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function refreshTokenIfNeeded(supabaseAdmin: any, tokenRow: any): Promise<string> {
  const expiry = new Date(tokenRow.token_expiry);
  if (expiry > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenRow.access_token;
  }

  const clientId = Deno.env.get("AZURE_DEVOPS_CLIENT_ID")!;
  const clientSecret = Deno.env.get("AZURE_DEVOPS_CLIENT_SECRET")!;
  const tenantId = Deno.env.get("AZURE_TENANT_ID") || "53e795b0-6f86-4e93-b619-32b5f5850f07";

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
      scope: "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation offline_access",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const tokens = await response.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

  await supabaseAdmin
    .from("azure_devops_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenRow.refresh_token,
      token_expiry: newExpiry.toISOString(),
    })
    .eq("id", tokenRow.id);

  return tokens.access_token;
}

async function adoFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Azure DevOps ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("azure_devops_tokens")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (tokenError || !tokenRow) {
      return new Response(JSON.stringify({ error: "Azure DevOps not connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabaseAdmin, tokenRow);
    const orgUrl = (tokenRow.org_url || Deno.env.get("AZURE_DEVOPS_ORG_URL") || "").replace(/\/+$/, "");

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    let result: any;

    switch (action) {
      // ---------------- Repos & branches ----------------
      case "list_repos": {
        // Iterate projects, then list repos per project.
        const projects = await adoFetch(`${orgUrl}/_apis/projects?api-version=7.1&$top=200`, accessToken);
        const repos: any[] = [];
        for (const project of projects.value || []) {
          try {
            const r = await adoFetch(
              `${orgUrl}/${encodeURIComponent(project.name)}/_apis/git/repositories?api-version=7.1`,
              accessToken,
            );
            for (const repo of r.value || []) {
              if (repo.isDisabled) continue;
              repos.push({
                id: repo.id,
                name: repo.name,
                project: project.name,
                project_id: project.id,
                default_branch: (repo.defaultBranch || "").replace(/^refs\/heads\//, ""),
                size: repo.size,
                web_url: repo.webUrl,
              });
            }
          } catch (e) {
            console.warn(`Failed to list repos for project ${project.name}:`, e);
          }
        }
        result = { repos, count: repos.length };
        break;
      }

      case "list_branches": {
        const { project, repository_id } = body;
        if (!project || !repository_id) throw new Error("project and repository_id required");
        const r = await adoFetch(
          `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${repository_id}/refs?filter=heads&api-version=7.1`,
          accessToken,
        );
        result = {
          branches: (r.value || []).map((b: any) => ({
            name: (b.name || "").replace(/^refs\/heads\//, ""),
            object_id: b.objectId,
            creator: b.creator?.displayName,
          })),
        };
        break;
      }

      // ---------------- Commits ----------------
      case "get_recent_commits": {
        // body: { days?: number = 7, top?: number = 50, repository_id?, project?, author? }
        const days = Math.max(1, Math.min(90, body.days ?? 7));
        const top = Math.max(1, Math.min(200, body.top ?? 50));
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // If a specific repo provided, query that one. Otherwise sweep all repos.
        let targetRepos: { project: string; id: string; name: string }[] = [];
        if (body.repository_id && body.project) {
          targetRepos = [{ project: body.project, id: body.repository_id, name: body.repository_id }];
        } else {
          const projects = await adoFetch(`${orgUrl}/_apis/projects?api-version=7.1&$top=200`, accessToken);
          for (const p of projects.value || []) {
            try {
              const r = await adoFetch(
                `${orgUrl}/${encodeURIComponent(p.name)}/_apis/git/repositories?api-version=7.1`,
                accessToken,
              );
              for (const repo of r.value || []) {
                if (repo.isDisabled) continue;
                targetRepos.push({ project: p.name, id: repo.id, name: repo.name });
              }
            } catch (e) {
              console.warn(`list repos failed for ${p.name}`, e);
            }
          }
        }

        const allCommits: any[] = [];
        for (const repo of targetRepos) {
          try {
            const params = new URLSearchParams({
              "searchCriteria.fromDate": fromDate,
              "searchCriteria.$top": String(top),
              "api-version": "7.1",
            });
            if (body.author) params.set("searchCriteria.author", body.author);
            const c = await adoFetch(
              `${orgUrl}/${encodeURIComponent(repo.project)}/_apis/git/repositories/${repo.id}/commits?${params}`,
              accessToken,
            );
            for (const commit of c.value || []) {
              allCommits.push({
                commit_id: commit.commitId,
                short_id: (commit.commitId || "").slice(0, 8),
                project: repo.project,
                repository: repo.name,
                author: commit.author?.name,
                author_email: commit.author?.email,
                date: commit.author?.date || commit.committer?.date,
                comment: (commit.comment || "").split("\n")[0].slice(0, 200),
                url: commit.remoteUrl,
                changes: commit.changeCounts,
              });
            }
          } catch (e) {
            console.warn(`commits failed for ${repo.project}/${repo.name}`, e);
          }
        }
        allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        result = { commits: allCommits.slice(0, top * 2), count: allCommits.length, since: fromDate };
        break;
      }

      // ---------------- Pull requests ----------------
      case "list_pull_requests": {
        // body: { status?: "active"|"completed"|"abandoned"|"all" = "active", top?: number = 50, project?, repository_id? }
        const status = body.status || "active";
        const top = Math.max(1, Math.min(200, body.top ?? 50));
        const params = new URLSearchParams({
          "searchCriteria.status": status,
          "$top": String(top),
          "api-version": "7.1",
        });

        let url: string;
        if (body.project && body.repository_id) {
          url = `${orgUrl}/${encodeURIComponent(body.project)}/_apis/git/repositories/${body.repository_id}/pullrequests?${params}`;
        } else if (body.project) {
          url = `${orgUrl}/${encodeURIComponent(body.project)}/_apis/git/pullrequests?${params}`;
        } else {
          // org-wide
          url = `${orgUrl}/_apis/git/pullrequests?${params}`;
        }
        const r = await adoFetch(url, accessToken);
        const prs = (r.value || []).map((pr: any) => ({
          id: pr.pullRequestId,
          title: pr.title,
          status: pr.status,
          merge_status: pr.mergeStatus,
          is_draft: pr.isDraft,
          created_by: pr.createdBy?.displayName,
          created_by_email: pr.createdBy?.uniqueName,
          creation_date: pr.creationDate,
          closed_date: pr.closedDate,
          source_branch: (pr.sourceRefName || "").replace(/^refs\/heads\//, ""),
          target_branch: (pr.targetRefName || "").replace(/^refs\/heads\//, ""),
          repository: pr.repository?.name,
          project: pr.repository?.project?.name,
          repository_id: pr.repository?.id,
          reviewers: (pr.reviewers || []).map((rv: any) => ({
            name: rv.displayName,
            vote: rv.vote, // 10 approved, 5 approved with suggestions, 0 no vote, -5 waiting, -10 rejected
            is_required: rv.isRequired,
          })),
          url: pr.url,
        }));
        result = { pull_requests: prs, count: prs.length };
        break;
      }

      case "get_pr_threads": {
        // body: { project, repository_id, pull_request_id }
        const { project, repository_id, pull_request_id } = body;
        if (!project || !repository_id || !pull_request_id) {
          throw new Error("project, repository_id, pull_request_id required");
        }
        const r = await adoFetch(
          `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${repository_id}/pullRequests/${pull_request_id}/threads?api-version=7.1`,
          accessToken,
        );
        const threads = (r.value || []).map((t: any) => ({
          id: t.id,
          status: t.status,
          published_date: t.publishedDate,
          last_updated: t.lastUpdatedDate,
          comments: (t.comments || []).map((c: any) => ({
            id: c.id,
            author: c.author?.displayName,
            content: (c.content || "").slice(0, 1000),
            published_date: c.publishedDate,
            comment_type: c.commentType,
          })),
          file_path: t.threadContext?.filePath,
        }));
        result = { threads, count: threads.length };
        break;
      }

      // ---------------- Aggregated team-briefing summary ----------------
      case "team_activity_summary": {
        // body: { days?: number = 7 }
        const days = Math.max(1, Math.min(30, body.days ?? 7));
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const projects = await adoFetch(`${orgUrl}/_apis/projects?api-version=7.1&$top=200`, accessToken);
        const repoList: { project: string; id: string; name: string }[] = [];
        for (const p of projects.value || []) {
          try {
            const r = await adoFetch(
              `${orgUrl}/${encodeURIComponent(p.name)}/_apis/git/repositories?api-version=7.1`,
              accessToken,
            );
            for (const repo of r.value || []) {
              if (repo.isDisabled) continue;
              repoList.push({ project: p.name, id: repo.id, name: repo.name });
            }
          } catch (e) {
            console.warn(`repos failed for ${p.name}`, e);
          }
        }

        let totalCommits = 0;
        const commitsByAuthor: Record<string, number> = {};
        const commitsByRepo: Record<string, number> = {};
        const recentCommits: any[] = [];

        for (const repo of repoList) {
          try {
            const params = new URLSearchParams({
              "searchCriteria.fromDate": fromDate,
              "searchCriteria.$top": "100",
              "api-version": "7.1",
            });
            const c = await adoFetch(
              `${orgUrl}/${encodeURIComponent(repo.project)}/_apis/git/repositories/${repo.id}/commits?${params}`,
              accessToken,
            );
            const list = c.value || [];
            totalCommits += list.length;
            commitsByRepo[`${repo.project}/${repo.name}`] = list.length;
            for (const commit of list) {
              const author = commit.author?.name || "unknown";
              commitsByAuthor[author] = (commitsByAuthor[author] || 0) + 1;
              recentCommits.push({
                project: repo.project,
                repository: repo.name,
                author,
                date: commit.author?.date,
                message: (commit.comment || "").split("\n")[0].slice(0, 140),
              });
            }
          } catch (e) {
            console.warn(`commits failed ${repo.project}/${repo.name}`, e);
          }
        }

        // Org-wide active PRs
        let activePRs: any[] = [];
        try {
          const r = await adoFetch(
            `${orgUrl}/_apis/git/pullrequests?searchCriteria.status=active&$top=100&api-version=7.1`,
            accessToken,
          );
          activePRs = (r.value || []).map((pr: any) => ({
            id: pr.pullRequestId,
            title: pr.title,
            project: pr.repository?.project?.name,
            repository: pr.repository?.name,
            created_by: pr.createdBy?.displayName,
            creation_date: pr.creationDate,
            is_draft: pr.isDraft,
            target_branch: (pr.targetRefName || "").replace(/^refs\/heads\//, ""),
            reviewers_pending: (pr.reviewers || []).filter((rv: any) => rv.vote === 0 || rv.vote === -5).length,
          }));
        } catch (e) {
          console.warn("org-wide PR query failed", e);
        }

        recentCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        result = {
          since: fromDate,
          days,
          repos_total: repoList.length,
          commits_total: totalCommits,
          commits_by_author: commitsByAuthor,
          commits_by_repo: commitsByRepo,
          recent_commits: recentCommits.slice(0, 20),
          active_prs_total: activePRs.length,
          active_prs: activePRs.slice(0, 20),
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("azure-repos-api error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
