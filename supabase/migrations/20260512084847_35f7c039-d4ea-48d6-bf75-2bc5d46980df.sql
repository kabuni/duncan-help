CREATE OR REPLACE FUNCTION public.generate_po_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  next_num INTEGER;
BEGIN
  -- Serialise PO number generation across concurrent inserts to avoid duplicate keys
  PERFORM pg_advisory_xact_lock(hashtext('purchase_orders_po_number'));

  SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM 'PO-(\d+)') AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.purchase_orders;

  NEW.po_number := 'PO-' || LPAD(next_num::TEXT, 5, '0');
  RETURN NEW;
END;
$function$;