import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { useCopySanitizer } from "@/hooks/useCopySanitizer";
import { useAuthSync } from "@/hooks/useAuthSync";
import { ThemeProvider } from "@/components/ThemeProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import { GeneralChatsProvider } from "@/hooks/GeneralChatsContext";
import Index from "./pages/Index";
import Onboarding from "./pages/Onboarding";

import Integrations from "./pages/Integrations";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";


import Recruitment from "./pages/Recruitment";
import Operations from "./pages/Operations";
import FeedbackIssues from "./pages/FeedbackIssues";
import Projects from "./pages/Projects";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import Workstreams from "./pages/Workstreams";
import Gmail from "./pages/Gmail";
import ReleaseManager from "./pages/ReleaseManager";
import WhatsNew from "./pages/WhatsNew";
import CEOBriefing from "./pages/CEOBriefing";
import KeyEventsDiary from "./pages/KeyEventsDiary";
import Approvals from "./pages/Approvals";
import PurchaseOrders from "./pages/PurchaseOrders";

import SlackCallback from "./pages/SlackCallback";
import KnowledgeBase from "./pages/KnowledgeBase";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Shared shell: mounts ProtectedRoute + GeneralChatsProvider + AppLayout once
// and keeps Sidebar / chat state alive across navigations between authed pages.
const ProtectedShell = () => (
  <ProtectedRoute>
    <GeneralChatsProvider>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </GeneralChatsProvider>
  </ProtectedRoute>
);

const AppContent = () => {
  useCopySanitizer();
  useAuthSync();
  return (
    <>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public / standalone routes */}
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/auth/slack/callback" element={<ProtectedRoute><SlackCallback /></ProtectedRoute>} />

          {/* Shared layout for all authenticated app routes */}
          <Route element={<ProtectedShell />}>
            <Route path="/" element={<Index />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/recruitment" element={<Recruitment />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/feedback" element={<FeedbackIssues />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId" element={<ProjectWorkspace />} />
            <Route path="/workstreams" element={<Workstreams />} />
            <Route path="/gmail" element={<Gmail />} />
            <Route path="/releases" element={<ReleaseManager />} />
            <Route path="/whats-new" element={<WhatsNew />} />
            <Route path="/team-briefing" element={<CEOBriefing />} />
            <Route path="/diary" element={<KeyEventsDiary />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/purchase-orders" element={<PurchaseOrders />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/travel" element={<Navigate to="/purchase-orders?tab=travel" replace />} />
            <Route path="/ceo" element={<Navigate to="/team-briefing" replace />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <AppContent />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
