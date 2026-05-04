import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const PHONE_LANDSCAPE_QUERY = "(pointer: coarse) and (max-height: 520px) and (max-width: 1100px)";

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const portraitMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const landscapeMql = window.matchMedia(PHONE_LANDSCAPE_QUERY);
    const onChange = () => {
      setIsMobile(portraitMql.matches || landscapeMql.matches);
    };
    portraitMql.addEventListener("change", onChange);
    landscapeMql.addEventListener("change", onChange);
    onChange();
    return () => {
      portraitMql.removeEventListener("change", onChange);
      landscapeMql.removeEventListener("change", onChange);
    };
  }, []);

  return !!isMobile;
}
