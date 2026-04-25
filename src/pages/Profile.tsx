import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { User, Briefcase, Building2, Save, Loader2, Camera } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile, ProfileData } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Profile = () => {
  const { user } = useAuth();
  const { profile, isLoading, updateProfile, isSaving } = useProfile();

  const [form, setForm] = useState<Partial<ProfileData>>({
    display_name: "",
    role_title: "",
    department: "",
    bio: "",
    norman_context: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name ?? "",
        role_title: profile.role_title ?? "",
        department: profile.department ?? "",
        bio: profile.bio ?? "",
        norman_context: profile.norman_context ?? "",
      });
    }
  }, [profile]);

  const handleSave = () => updateProfile(form);

  const set = (key: keyof ProfileData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  if (isLoading) {
    return (
      <AppLayout>
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />

        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-2xl">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-1">Your Profile</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mb-8">
              Help Duncan understand who you are so it can personalise responses.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-6 rounded-xl border border-border bg-card p-4 sm:p-6"
          >
            {/* Name */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <User className="h-4 w-4 text-primary" /> Display Name
              </Label>
              <Input
                value={form.display_name ?? ""}
                onChange={(e) => set("display_name", e.target.value)}
                placeholder="e.g. Nimesh Patel"
              />
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <Briefcase className="h-4 w-4 text-primary" /> Role / Title
              </Label>
              <Input
                value={form.role_title ?? ""}
                onChange={(e) => set("role_title", e.target.value)}
                placeholder="e.g. Head of Operations"
              />
            </div>

            {/* Department */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <Building2 className="h-4 w-4 text-primary" /> Department
              </Label>
              <Input
                value={form.department ?? ""}
                onChange={(e) => set("department", e.target.value)}
                placeholder="e.g. Operations"
              />
            </div>

            {/* Bio */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <User className="h-4 w-4 text-primary" /> About You
              </Label>
              <Textarea
                value={form.bio ?? ""}
                onChange={(e) => set("bio", e.target.value)}
                placeholder="A brief description of what you do, your responsibilities, and what matters to you at work…"
                className="min-h-[100px]"
              />
            </div>

            {/* Duncan context */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-foreground">
                <img src={duncanAvatar} alt="Duncan" className="h-4 w-4 rounded-sm object-cover object-[50%_30%] scale-150" /> Duncan Personalisation
              </Label>
              <p className="text-xs text-muted-foreground">
                Anything else Duncan should know — communication style, priorities, projects you're focused on.
              </p>
              <Textarea
                value={form.norman_context ?? ""}
                onChange={(e) => set("norman_context", e.target.value)}
                placeholder="e.g. I prefer concise bullet-point answers. I'm currently focused on Q1 hiring plan and the product launch in March."
                className="min-h-[120px]"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Profile
              </Button>
            </div>
          </motion.div>

          <p className="text-xs text-muted-foreground mt-4">
            Signed in as <span className="font-mono text-foreground">{user?.email}</span>
          </p>
        </div>
      </main>
    </AppLayout>
  );
};

export default Profile;
