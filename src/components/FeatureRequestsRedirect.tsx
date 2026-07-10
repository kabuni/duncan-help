import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useSettingsPanel } from "@/hooks/SettingsPanelContext";

export default function FeatureRequestsRedirect() {
  const { openSettings } = useSettingsPanel();
  useEffect(() => {
    openSettings("request_feature");
  }, [openSettings]);
  return <Navigate to="/" replace />;
}
