import { AudioLines } from "lucide-react";

interface Props {
  onClick: () => void;
  active?: boolean;
}

export default function VoiceModeButton({ onClick, active }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Voice mode — talk with Duncan"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
      }`}
    >
      <AudioLines className="h-3.5 w-3.5" />
    </button>
  );
}
