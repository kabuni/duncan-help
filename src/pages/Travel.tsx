import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Plane, Clock, Settings } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useUserRoles";
import TravelForm from "@/components/travel/TravelForm";
import TravelList from "@/components/travel/TravelList";
import TravelApproverSetting from "@/components/travel/TravelApproverSetting";

export default function Travel() {
  const [showForm, setShowForm] = useState(false);
  const { isAdmin } = useIsAdmin();

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />
        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-6xl">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
                  Approvals
                </p>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                  <span className="text-primary glow-text">Travel</span>
                </h2>
              </div>
              <Button onClick={() => setShowForm(true)} className="gap-2">
                <Plus className="h-4 w-4" /> New Travel Request
              </Button>
            </div>
          </motion.div>

          <Tabs defaultValue="mine" className="space-y-6">
            <TabsList className="bg-secondary/50 w-full sm:w-auto overflow-x-auto flex-nowrap justify-start">
              <TabsTrigger value="mine" className="gap-2 whitespace-nowrap">
                <Plane className="h-3.5 w-3.5" /> My Requests
              </TabsTrigger>
              <TabsTrigger value="approvals" className="gap-2 whitespace-nowrap">
                <Clock className="h-3.5 w-3.5" /> Awaiting Me
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="admin" className="gap-2 whitespace-nowrap">
                  <Settings className="h-3.5 w-3.5" /> Admin
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="mine">
              <TravelList scope="mine" />
            </TabsContent>
            <TabsContent value="approvals">
              <TravelList scope="approver" />
            </TabsContent>
            {isAdmin && (
              <TabsContent value="admin" className="space-y-6">
                <TravelApproverSetting />
              </TabsContent>
            )}
          </Tabs>

          {showForm && <TravelForm onClose={() => setShowForm(false)} />}
        </div>
      </main>
    </AppLayout>
  );
}
