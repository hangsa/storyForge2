/** 创作维度条目（subject / tone / style 共用）。 */
export interface DimensionEntry {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  family?: string;
  label_en?: string;
  order: number;
  created_at: string;
  updated_at: string;
}

export type DimensionKind = "subject" | "tone" | "style";

export interface DimensionEntryPayload {
  name: string;
  description?: string;
  status?: "active" | "inactive";
  family?: string;
  label_en?: string;
  order?: number;
}

export interface ActiveDimensions {
  subject: DimensionEntry[];
  tone: DimensionEntry[];
  style: DimensionEntry[];
}