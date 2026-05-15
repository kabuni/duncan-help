-- Make PO number generation collision-proof using a dedicated sequence.
-- The previous MAX()+1 approach (even with an advisory lock) could clash
-- when concurrent transactions / client retries raced or when historical
-- numbers were skipped. A sequence guarantees uniqueness.

CREATE SEQUENCE IF NOT EXISTS public.purchase_orders_po_number_seq;

-- Initialise the sequence above the highest existing PO number so we never
-- collide with an existing row.
SELECT setval(
  'public.purchase_orders_po_number_seq',
  GREATEST(
    (SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM 'PO-(\d+)') AS INTEGER)), 0) FROM public.purchase_orders),
    1
  )
);

CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  next_num INTEGER;
  candidate TEXT;
BEGIN
  -- Loop in case the sequence value happens to collide with a manually
  -- inserted PO number.
  LOOP
    next_num := nextval('public.purchase_orders_po_number_seq');
    candidate := 'PO-' || LPAD(next_num::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.purchase_orders WHERE po_number = candidate
    );
  END LOOP;
  NEW.po_number := candidate;
  RETURN NEW;
END;
$function$;