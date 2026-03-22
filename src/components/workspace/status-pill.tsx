type StatusTone = "green" | "amber" | "blue" | "slate";

const toneClassMap: Record<StatusTone, string> = {
  green: "status-pill tone-green",
  amber: "status-pill tone-amber",
  blue: "status-pill tone-blue",
  slate: "status-pill tone-slate",
};

export function StatusPill({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return <span className={toneClassMap[tone]}>{label}</span>;
}
