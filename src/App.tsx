import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { useCopySanitizer } from "@/hooks/useCopySanitizer";
import { useAuthSync } from "@/hooks/useAuthSync";
import { ThemeProvider } from "@/components/ThemeProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";

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
import SlackCallback from "./pages/SlackCallback";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AppContent = () => {
  useCopySanitizer();
  useAuthSync();
  return (
    <>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/slack/callback" element={<ProtectedRoute><SlackCallback /></ProtectedRoute>} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          
          <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          
          
          <Route path="/recruitment" element={<ProtectedRoute><Recruitment /></ProtectedRoute>} />
          <Route path="/operations" element={<ProtectedRoute><Operations /></ProtectedRoute>} />
          <Route path="/feedback" element={<ProtectedRoute><FeedbackIssues /></ProtectedRoute>} />
          <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
          <Route path="/projects/:projectId" element={<ProtectedRoute><ProjectWorkspace /></ProtectedRoute>} />
          <Route path="/workstreams" element={<ProtectedRoute><Workstreams /></ProtectedRoute>} />
          <Route path="/gmail" element={<ProtectedRoute><Gmail /></ProtectedRoute>} />
          <Route path="/releases" element={<ProtectedRoute><ReleaseManager /></ProtectedRoute>} />
          <Route path="/whats-new" element={<ProtectedRoute><WhatsNew /></ProtectedRoute>} />
          <Route path="/team-briefing" element={<ProtectedRoute><CEOBriefing /></ProtectedRoute>} />
          <Route path="/ceo" element={<Navigate to="/team-briefing" replace />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
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
