import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsAdmin } from "@/hooks/useUserRoles";
import SettingsFeatureRequest from "./SettingsFeatureRequest";
import MyFeatureRequests from "./MyFeatureRequests";
import FeatureRequestsAdmin from "./FeatureRequestsAdmin";

export default function SettingsRequestFeature() {
  const { isAdmin } = useIsAdmin();

  return (
    <div className="space-y-6">
      <Tabs defaultValue="submit" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-sm">
          <TabsTrigger value="submit">Submit Request</TabsTrigger>
          <TabsTrigger value="mine">My Requests</TabsTrigger>
        </TabsList>
        <TabsContent value="submit" className="mt-4">
          <SettingsFeatureRequest />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <MyFeatureRequests />
        </TabsContent>
      </Tabs>

      {isAdmin && (
        <div className="pt-6 border-t border-border space-y-3">
          <h4 className="text-sm font-semibold text-foreground">All Feature Requests (Admin)</h4>
          <FeatureRequestsAdmin />
        </div>
      )}
    </div>
  );
}
