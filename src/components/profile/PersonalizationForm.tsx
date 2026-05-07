import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, ProfileData } from "@/hooks/useProfile";
import { useDepartments } from "@/hooks/useDepartments";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Save, User, Briefcase, Building2, Camera } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ROLE_TITLES = [
  "Developer", "Designer", "Project Manager", "Operations Manager",
  "HR Manager", "Finance Manager", "Marketing Manager", "Sales Manager",
  "Business Analyst", "Data Analyst", "QA Engineer", "DevOps Engineer",
  "Product Manager", "Content Strategist", "Executive", "Other",
];

interface PersonalizationFormProps {
  /** Hide the heading (e.g. when used inside an onboarding step that has its own title) */
  hideHeader?: boolean;
  /** Custom save button label */
  saveLabel?: string;
  /** Called after a successful save */
  onSaved?: () => void;
  /** Render the save button as full-width primary (onboarding) */
  primarySave?: boolean;
}

export default function PersonalizationForm({
  hideHeader = false,
  saveLabel = "Save",
  onSaved,
  primarySave = false,
}: PersonalizationFormProps) {
  const { user } = useAuth();
  const { profile, isLoading, updateProfile, isSaving } = useProfile();
  const { data: departments = [], isLoading: departmentsLoading } = useDepartments();

  const [form, setForm] = useState<Partial<ProfileData>>({
    display_name: "",
    role_title: "",
    department: "",
    bio: "",
    norman_context: "",
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name ?? "",
        role_title: profile.role_title ?? "",
        department: profile.department ?? "",
        bio: profile.bio ?? "",
        norman_context: profile.norman_context ?? "",
      });
      setDirty(false);
    }
  }, [profile]);

  const set = (key: keyof ProfileData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    if (!form.display_name?.trim()) {
      toast.error("Display name is required");
      return;
    }
    updateProfile(form, {
      onSuccess: () => {
        setDirty(false);
        onSaved?.();
      },
    } as any);
  };

  const handleCancel = () => {
    if (profile) {
      setForm({
        display_name: profile.display_name ?? "",
        role_title: profile.role_title ?? "",
        department: profile.department ?? "",
        bio: profile.bio ?? "",
        norman_context: profile.norman_context ?? "",
      });
      setDirty(false);
    }
  };

  const roleOptions = form.role_title && !ROLE_TITLES.includes(form.role_title)
    ? [form.role_title, ...ROLE_TITLES] : ROLE_TITLES;

  const departmentNames = departments.map((d) => d.name);
  const departmentOptions = form.department && !departmentNames.includes(form.department)
    ? [form.department, ...departmentNames] : departmentNames;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      updateProfile({ avatar_url: publicUrl });
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const initials = (form.display_name || user?.email || "U")
    .split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Profile</h3>
          <p className="text-xs text-muted-foreground">Help Duncan understand who you are</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14 border border-border">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt="Profile" />
            <AvatarFallback className="text-sm">{initials}</AvatarFallback>
          </Avatar>
          <div className="space-y-1.5">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50 transition-colors">
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {isUploading ? "Uploading…" : "Change photo"}
            </button>
            <p className="text-[11px] text-muted-foreground/70">PNG or JPG, up to 5MB.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> Display Name
          </Label>
          <Input value={form.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)}
            placeholder="e.g. Nimesh Patel" className="h-9" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" /> Role / Title
          </Label>
          <Select value={form.role_title ?? undefined} onValueChange={(v) => set("role_title", v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select role / title" /></SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (<SelectItem key={role} value={role}>{role}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Department
          </Label>
          <Select value={form.department ?? undefined} onValueChange={(v) => set("department", v)}
            disabled={departmentsLoading || departmentOptions.length === 0}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select department" /></SelectTrigger>
            <SelectContent>
              {departmentsLoading ? (
                <SelectItem value="__loading" disabled>Loading departments…</SelectItem>
              ) : departmentOptions.length > 0 ? (
                departmentOptions.map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))
              ) : (
                <SelectItem value="__empty" disabled>No departments available</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">About You</Label>
          <Textarea value={form.bio ?? ""} onChange={(e) => set("bio", e.target.value)}
            placeholder="A brief description of what you do…" className="min-h-[80px]" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <img src={duncanAvatar} alt="" className="h-3.5 w-3.5 rounded-sm object-cover object-[50%_30%] scale-150" />
            Duncan Personalisation
          </Label>
          <p className="text-[11px] text-muted-foreground/60">
            Communication style, priorities, projects you're focused on.
          </p>
          <Textarea value={form.norman_context ?? ""} onChange={(e) => set("norman_context", e.target.value)}
            placeholder="e.g. I prefer concise bullet-point answers…" className="min-h-[80px]" />
        </div>
      </div>

      {primarySave ? (
        <button onClick={handleSave} disabled={isSaving || !form.display_name?.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saveLabel}
        </button>
      ) : (
        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-muted-foreground">{user?.email}</p>
          <div className="flex gap-2">
            {dirty && (
              <button onClick={handleCancel}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors">
                Cancel
              </button>
            )}
            <button onClick={handleSave} disabled={isSaving || !dirty}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saveLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
