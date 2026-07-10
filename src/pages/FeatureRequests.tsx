import { Navigate } from "react-router-dom";

// Legacy route — Feature Requests now live inside Settings.
export default function FeatureRequests() {
  return <Navigate to="/settings#feature-requests" replace />;
}
