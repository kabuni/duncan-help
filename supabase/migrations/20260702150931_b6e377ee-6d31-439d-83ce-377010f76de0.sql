
ALTER TABLE public.token_usage
  ADD COLUMN IF NOT EXISTS category_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS public.get_token_leaderboard();

CREATE OR REPLACE FUNCTION public.get_token_leaderboard()
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, total_tokens bigint, request_count bigint, minutes_saved bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH per_row AS (
    SELECT
      tu.user_id,
      tu.total_tokens,
      tu.request_count,
      COALESCE((tu.category_counts->>'summarize')::int, 0) AS c_sum,
      COALESCE((tu.category_counts->>'tasks')::int, 0)     AS c_tasks,
      COALESCE((tu.category_counts->>'meetings')::int, 0)  AS c_meet,
      COALESCE((tu.category_counts->>'email')::int, 0)     AS c_email,
      COALESCE((tu.category_counts->>'other')::int, 0)     AS c_other,
      (
        COALESCE((tu.category_counts->>'summarize')::int, 0) +
        COALESCE((tu.category_counts->>'tasks')::int, 0)     +
        COALESCE((tu.category_counts->>'meetings')::int, 0)  +
        COALESCE((tu.category_counts->>'email')::int, 0)     +
        COALESCE((tu.category_counts->>'other')::int, 0)
      ) AS c_total
    FROM public.token_usage tu
  ),
  weighted AS (
    SELECT
      user_id, total_tokens, request_count,
      CASE
        WHEN c_total > 0 THEN (c_sum * 23) + (c_tasks * 7) + (c_meet * 10) + (c_email * 8) + (c_other * 4)
        ELSE request_count * 6
      END AS minutes
    FROM per_row
  )
  SELECT
    w.user_id,
    COALESCE(p.display_name, 'Unknown') AS display_name,
    p.avatar_url,
    SUM(w.total_tokens)::bigint  AS total_tokens,
    SUM(w.request_count)::bigint AS request_count,
    SUM(w.minutes)::bigint       AS minutes_saved
  FROM weighted w
  LEFT JOIN public.profiles p ON p.user_id = w.user_id
  GROUP BY w.user_id, p.display_name, p.avatar_url
  ORDER BY SUM(w.total_tokens) DESC;
$function$;
