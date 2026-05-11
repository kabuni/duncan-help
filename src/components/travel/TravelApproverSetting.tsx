import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTravelApproverSetting } from "@/hooks/useTravelRequests";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface ApproverOption {
  user_id: string;
  display_name: string;
  role_title: string | null;
}

export default function TravelApproverSetting() {
  const { data, save } = useTravelApproverSetting();
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, role_title")
        .eq("approval_status", "approved")
        .order("display_name");
      setApprovers(((profs || []) as any[]).filter(p => p.user_id));
    })();
  }, []);

  useEffect(() => {
    const current = (data?.value as any)?.travel_approver_user_id || "";
    setSelected(current);
  }, [data]);

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Travel approver</p>
        <p className="text-xs text-muted-foreground">All new travel requests are routed to this person.</p>
      </div>
      <div className="flex gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Select approver" />
          </SelectTrigger>
          <SelectContent>
            {approvers.map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.display_name}{a.role_title ? ` — ${a.role_title}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!selected || save.isPending}
          onClick={() => save.mutate(selected)}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
