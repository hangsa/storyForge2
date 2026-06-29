import type { ExemptionRequest } from "../../api/client";
import { EXEMPTION_INTENT_TRUNCATE_LEN } from "../../types/stage4";

interface ExemptionCardProps {
  item: ExemptionRequest;
  onClick: () => void;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function ExemptionCard({ item, onClick }: ExemptionCardProps) {
  const intentTruncated = truncate(item.creative_intent, EXEMPTION_INTENT_TRUNCATE_LEN);
  return (
    <button
      type="button"
      className="exemption-card"
      onClick={onClick}
      title={item.creative_intent}  // full text in tooltip
      style={{ display: "block", textAlign: "left", width: "100%", padding: 12, marginBottom: 8 }}
    >
      <div className="exemption-card__rule">{item.rule_to_break.rule_description}</div>
      <div className="exemption-card__intent">{intentTruncated}</div>
      <div className="exemption-card__effect">→ {item.expected_effect}</div>
    </button>
  );
}
