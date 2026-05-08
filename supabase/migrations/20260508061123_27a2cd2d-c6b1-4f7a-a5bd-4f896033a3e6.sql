CREATE POLICY "Requester or admin can delete POs"
ON public.purchase_orders
FOR DELETE
TO authenticated
USING (auth.uid() = requester_id OR has_role(auth.uid(), 'admin'::app_role));