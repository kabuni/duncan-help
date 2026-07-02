
CREATE OR REPLACE FUNCTION public.get_token_leaderboard()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  total_tokens bigint,
  request_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tu.user_id,
    COALESCE(p.display_name, 'Unknown') AS display_name,
    p.avatar_url,
    COALESCE(SUM(tu.total_tokens), 0)::bigint AS total_tokens,
    COALESCE(SUM(tu.request_count), 0)::bigint AS request_count
  FROM public.token_usage tu
  LEFT JOIN public.profiles p ON p.user_id = tu.user_id
  GROUP BY tu.user_id, p.display_name, p.avatar_url
  ORDER BY SUM(tu.total_tokens) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_token_leaderboard() TO authenticated;
