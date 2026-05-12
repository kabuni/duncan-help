import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function adoFetch(url: string, authHeader: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      Authorization: authHeader,
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

    // Trusted internal calls (e.g. ceo-briefing) authenticate with the service role key.
    // Accept either an exact match against SUPABASE_SERVICE_ROLE_KEY (legacy) OR a JWT
    // whose role claim is "service_role" (new signing-keys system, where the env var
    // value may not exactly match the JWT used by other functions).
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    let isTrustedInternalCall = !!bearerToken && bearerToken === supabaseServiceKey;
    if (!isTrustedInternalCall && bearerToken) {
      try {
        const parts = bearerToken.split(".");
        if (parts.length === 3) {
          const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const padding = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
          const claims = JSON.parse(atob(padded + padding));
          if (claims?.role === "service_role") {
            isTrustedInternalCall = true;
          }
        }
      } catch (_e) {
        // ignore — fall through to user-JWT validation
      }
    }

    if (!isTrustedInternalCall) {
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
    }

    // Prefer PAT if configured; otherwise fall back to stored OAuth token
    const pat = Deno.env.get("AZURE_DEVOPS_PAT");
    let accessToken: string;
    let orgUrl: string;

    if (pat) {
      accessToken = `Basic ${btoa(":" + pat)}`;
      orgUrl = (Deno.env.get("AZURE_DEVOPS_ORG_URL") || "").replace(/\/+$/, "");
      if (!orgUrl) {
        return new Response(JSON.stringify({ error: "AZURE_DEVOPS_ORG_URL not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
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
      accessToken = `Bearer ${tokenRow.access_token}`;
      orgUrl = (tokenRow.org_url || Deno.env.get("AZURE_DEVOPS_ORG_URL") || "").replace(/\/+$/, "");
    }

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

      // ---------------- Briefing summary (Team Briefing engineering signal) ----------------
      case "briefing_summary": {
        const verifiedAt = new Date().toISOString();

        // Discover repos org-wide (cap to keep latency reasonable).
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
            console.warn(`briefing_summary: list repos failed for ${p.name}`, e);
          }
        }

        // ---- Commit metrics for current (last 7d) and previous (8-14d) windows ----
        const nowMs = Date.now();
        const sevenDaysAgoIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
        const fourteenDaysAgoIso = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString();
        let commitMetricsPartial = false;

        type AuthorAgg = {
          author: string;
          email?: string;
          commits: number;
          files_added: number;
          files_edited: number;
          files_removed: number;
          repos: Set<string>;
        };
        const mkAgg = (author: string, email?: string): AuthorAgg => ({
          author, email,
          commits: 0, files_added: 0, files_edited: 0, files_removed: 0,
          repos: new Set<string>(),
        });

        const curByAuthor = new Map<string, AuthorAgg>();
        const prevByAuthor = new Map<string, number>(); // key -> commits

        let commits7d = 0, filesAdded7d = 0, filesRemoved7d = 0, filesEdited7d = 0;
        let commitsPrev7d = 0, filesAddedPrev7d = 0, filesRemovedPrev7d = 0;
        const contributors7d = new Set<string>();
        const contributorsPrev7d = new Set<string>();

        const fetchCommits = async (r: { project: string; id: string; name: string }, fromIso: string, toIso?: string) => {
          let url =
            `${orgUrl}/${encodeURIComponent(r.project)}/_apis/git/repositories/${r.id}/commits` +
            `?searchCriteria.fromDate=${encodeURIComponent(fromIso)}` +
            `&searchCriteria.includeLinks=false` +
            `&searchCriteria.$top=1000` +
            `&api-version=7.1`;
          if (toIso) url += `&searchCriteria.toDate=${encodeURIComponent(toIso)}`;
          const cRes = await adoFetch(url, accessToken);
          return cRes.value || [];
        };

        // Limit concurrency to avoid hammering ADO and reduce overall latency.
        const runWithConcurrency = async <T,>(items: T[], limit: number, fn: (item: T) => Promise<void>) => {
          let i = 0;
          const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (i < items.length) {
              const idx = i++;
              try { await fn(items[idx]); } catch (_) { /* per-item handlers already guard */ }
            }
          });
          await Promise.all(workers);
        };

        await runWithConcurrency(repoList, 8, async (r) => {
          const repoLabel = `${r.project}/${r.name}`;

          // Current window first; only scan previous window if this repo had recent activity.
          let curCommits: any[] = [];
          try {
            curCommits = await fetchCommits(r, sevenDaysAgoIso);
          } catch (e) {
            commitMetricsPartial = true;
            console.warn(`briefing_summary: current commits scan failed for ${repoLabel}`, e);
            return;
          }

          for (const c of curCommits) {
            commits7d += 1;
            const email = c.author?.email ? String(c.author.email).toLowerCase() : undefined;
            const name = c.author?.name || c.author?.email || "unknown";
            const key = email || name.toLowerCase();
            if (email || name) contributors7d.add(key);
            const cc = c.changeCounts || {};
            const add = Number(cc.Add || 0), edit = Number(cc.Edit || 0), del = Number(cc.Delete || 0);
            filesAdded7d += add;
            filesRemoved7d += del;
            filesEdited7d += edit;
            let agg = curByAuthor.get(key);
            if (!agg) { agg = mkAgg(name, email); curByAuthor.set(key, agg); }
            agg.commits += 1;
            agg.files_added += add;
            agg.files_edited += edit;
            agg.files_removed += del;
            agg.repos.add(repoLabel);
          }

          // Skip previous-window scan entirely for repos with no current activity —
          // they cannot affect WoW deltas in a meaningful way and add a lot of latency.
          if (curCommits.length === 0) return;

          try {
            const prevCommits = await fetchCommits(r, fourteenDaysAgoIso, sevenDaysAgoIso);
            for (const c of prevCommits) {
              commitsPrev7d += 1;
              const email = c.author?.email ? String(c.author.email).toLowerCase() : undefined;
              const name = c.author?.name || c.author?.email || "unknown";
              const key = email || name.toLowerCase();
              if (email || name) contributorsPrev7d.add(key);
              const cc = c.changeCounts || {};
              filesAddedPrev7d += Number(cc.Add || 0);
              filesRemovedPrev7d += Number(cc.Delete || 0);
              prevByAuthor.set(key, (prevByAuthor.get(key) || 0) + 1);
            }
          } catch (e) {
            commitMetricsPartial = true;
            console.warn(`briefing_summary: previous commits scan failed for ${repoLabel}`, e);
          }
        });

        // Build contributor list with WoW deltas + per-author trend.
        const trendOf = (cur: number, prev: number): "up" | "down" | "flat" => {
          if (cur === prev) return "flat";
          if (prev === 0) return cur > 0 ? "up" : "flat";
          const pct = ((cur - prev) / prev) * 100;
          if (pct >= 5) return "up";
          if (pct <= -5) return "down";
          return "flat";
        };

        const contributors_7d = Array.from(curByAuthor.entries()).map(([key, a]) => {
          const prevCommits = prevByAuthor.get(key) || 0;
          const lines_changed = a.files_added + a.files_edited + a.files_removed;
          return {
            author: a.author,
            email: a.email,
            commits: a.commits,
            files_added: a.files_added,
            files_edited: a.files_edited,
            files_removed: a.files_removed,
            lines_changed,
            repos: Array.from(a.repos).sort(),
            commits_prev_7d: prevCommits,
            trend: trendOf(a.commits, prevCommits),
          };
        }).sort((x, y) => y.commits - x.commits || y.lines_changed - x.lines_changed);

        const top_contributor = contributors_7d.length > 0
          ? { author: contributors_7d[0].author, commits: contributors_7d[0].commits, lines_changed: contributors_7d[0].lines_changed }
          : null;

        const pct = (cur: number, prev: number) =>
          prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;

        const wow = {
          commits_delta: commits7d - commitsPrev7d,
          commits_pct: pct(commits7d, commitsPrev7d),
          files_added_delta: filesAdded7d - filesAddedPrev7d,
          files_added_pct: pct(filesAdded7d, filesAddedPrev7d),
          files_removed_delta: filesRemoved7d - filesRemovedPrev7d,
          files_removed_pct: pct(filesRemoved7d, filesRemovedPrev7d),
          contributors_delta: contributors7d.size - contributorsPrev7d.size,
          trend: trendOf(commits7d, commitsPrev7d),
        };

        const prev_window = {
          commits_7d: commitsPrev7d,
          files_added_7d: filesAddedPrev7d,
          files_removed_7d: filesRemovedPrev7d,
          active_contributors_7d: contributorsPrev7d.size,
          since: fourteenDaysAgoIso,
          until: sevenDaysAgoIso,
        };

        // Org-wide active PRs (single call instead of per-repo).
        let openPrs = 0;
        let blockedPrs = 0;
        let stalePrs = 0;
        const signals: Array<Record<string, unknown>> = [];
        let partialFailure = false;

        try {
          const prRes = await adoFetch(
            `${orgUrl}/_apis/git/pullrequests?searchCriteria.status=active&$top=200&api-version=7.1`,
            accessToken,
          );
          const prs = prRes.value || [];
          openPrs = prs.length;
          const staleThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
          for (const pr of prs) {
            const repoLabel = `${pr.repository?.project?.name || "?"}/${pr.repository?.name || "?"}`;
            const updatedAt = Date.parse(pr.creationDate || "");
            const isStale = Number.isFinite(updatedAt) && updatedAt < staleThreshold;
            if (pr.isDraft) blockedPrs += 1;
            if (isStale) stalePrs += 1;
            if ((pr.isDraft || isStale) && signals.length < 6) {
              signals.push({
                type: pr.isDraft ? "blocked_pr" : "stale_pr",
                repo: repoLabel,
                label: pr.title || "Untitled PR",
              });
            }
          }
        } catch (e) {
          partialFailure = true;
          console.warn("briefing_summary: PR scan failed", e);
        }

        const reposScanned = repoList.length;
        const projectNames = Array.from(new Set(repoList.map((r) => r.project))).sort();
        const repoFullNames = repoList.map((r) => `${r.project}/${r.name}`).sort();
        console.log(
          `briefing_summary: scanned ${projectNames.length} projects, ${reposScanned} repos`,
          { projects: projectNames, repos: repoFullNames },
        );

        const summary = reposScanned === 0
          ? "Azure Repos connected but no repositories were available to scan."
          : `${openPrs} open PRs, ${blockedPrs} blocked drafts, and ${stalePrs} stale PRs across ${reposScanned} repositories.`;

        result = {
          connected: true,
          status: (partialFailure || commitMetricsPartial) ? "degraded" : "connected",
          credential_source: "stored_token",
          verification_path: "/_apis/git/pullrequests",
          last_verified_at: verifiedAt,
          last_sync_at: verifiedAt,
          error_code: partialFailure
            ? "pr_scan_partial_failure"
            : commitMetricsPartial
            ? "commit_scan_partial_failure"
            : null,
          error_message: partialFailure
            ? "Some pull requests could not be scanned fully"
            : commitMetricsPartial
            ? "Some repository commit history could not be scanned fully"
            : null,
          repos_scanned: reposScanned,
          open_prs: openPrs,
          blocked_prs: blockedPrs,
          stale_prs: stalePrs,
          release_risks: blockedPrs + stalePrs,
          commits_7d: commits7d,
          files_added_7d: filesAdded7d,
          files_removed_7d: filesRemoved7d,
          active_contributors_7d: contributors7d.size,
          scanned_projects: projectNames,
          scanned_repos: repoFullNames,
          signals,
          summary,
          metrics_summary: summary,
          contributors_7d,
          top_contributor,
          prev_window,
          wow,
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
