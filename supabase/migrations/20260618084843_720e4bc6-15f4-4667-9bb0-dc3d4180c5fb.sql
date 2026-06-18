REVOKE EXECUTE ON FUNCTION public.get_company_integrations_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_integrations_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_integrations_status() TO service_role;