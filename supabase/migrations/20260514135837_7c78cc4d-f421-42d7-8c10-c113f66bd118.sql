UPDATE public.token_usage
SET total_tokens = prompt_tokens + completion_tokens
WHERE total_tokens <> prompt_tokens + completion_tokens;

ALTER TABLE public.token_usage
ADD CONSTRAINT token_usage_total_equals_sum_check
CHECK (total_tokens = prompt_tokens + completion_tokens);