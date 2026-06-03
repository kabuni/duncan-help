import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, FileText, CheckCircle, Clock, XCircle, Upload, TrendingUp, Plane, Wallet, Megaphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsAdmin } from "@/hooks/useUserRoles";
import POForm from "@/components/po/POForm";
import POList from "@/components/po/POList";
import POApprovals from "@/components/po/POApprovals";
import BudgetOverview from "@/components/po/BudgetOverview";
import BudgetUpload from "@/components/po/BudgetUpload";
import DepartmentManager from "@/components/po/DepartmentManager";
import TravelForm from "@/components/travel/TravelForm";
import TravelList from "@/components/travel/TravelList";
import TravelApproverSetting from "@/components/travel/TravelApproverSetting";

const PurchaseOrders = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const [showForm, setShowForm] = useState<null | "budget" | "creative">(null);
  const [showTravelForm, setShowTravelForm] = useState(false);
  const { isAdmin } = useIsAdmin();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "travel" ? "travel" : "orders";

  return (
    <>
      <main className="flex-1 overflow-y-auto">
        {!embedded && <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />}

        <div className={embedded ? "relative z-10" : "relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-6xl"}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 space-y-5">
            {!embedded && (
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
                  Approvals
                </p>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                  Authorisation
                </h2>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setShowForm("budget")} variant="outline" className="gap-2">
                <Wallet className="h-4 w-4" /> Budget Authorisation
              </Button>
              <Button onClick={() => setShowForm("creative")} variant="outline" className="gap-2">
                <Megaphone className="h-4 w-4" /> Marketing & Creative
              </Button>
              <Button onClick={() => setShowTravelForm(true)} variant="outline" className="gap-2">
                <Plane className="h-4 w-4" /> Travel Request
              </Button>
            </div>
          </motion.div>


          <Tabs defaultValue={initialTab} className="space-y-6">
            <TabsList className="bg-secondary/50 w-full sm:w-auto overflow-x-auto flex-nowrap justify-start">
            <TabsTrigger value="orders" className="gap-2 whitespace-nowrap">
              <FileText className="h-3.5 w-3.5" /> My Approval Requests
            </TabsTrigger>
              <TabsTrigger value="approvals" className="gap-2 whitespace-nowrap">
                <Clock className="h-3.5 w-3.5" /> Approvals
              </TabsTrigger>
              <TabsTrigger value="travel" className="gap-2 whitespace-nowrap">
                <Plane className="h-3.5 w-3.5" /> Travel
              </TabsTrigger>
              <TabsTrigger value="budget" className="gap-2 whitespace-nowrap">
                <TrendingUp className="h-3.5 w-3.5" /> Budget
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="admin" className="gap-2 whitespace-nowrap">
                  <Upload className="h-3.5 w-3.5" /> Admin
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="orders">
              <POList />
            </TabsContent>

            <TabsContent value="approvals">
              <POApprovals />
            </TabsContent>

            <TabsContent value="travel" className="space-y-6">
              <TravelList scope="mine" />
              <TravelList scope="approver" />
            </TabsContent>

            <TabsContent value="budget">
              <BudgetOverview />
            </TabsContent>

            {isAdmin && (
              <TabsContent value="admin" className="space-y-6">
                <DepartmentManager />
                <BudgetUpload />
                <TravelApproverSetting />
              </TabsContent>
            )}
          </Tabs>

          {showForm && <POForm kind={showForm} onClose={() => setShowForm(null)} />}
          {showTravelForm && <TravelForm onClose={() => setShowTravelForm(false)} />}
        </div>
      </main>
    </>
  );
};

export default PurchaseOrders;
