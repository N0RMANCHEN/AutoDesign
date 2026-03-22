import type {
  ReconstructionAssetCandidate,
  ReconstructionBounds,
  ReconstructionOcrBlock,
  ReconstructionRegion,
  ReconstructionTextCandidate,
  ReconstructionTextStyleHint,
} from "../shared/reconstruction.js";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.AUTODESIGN_OCR_MODEL || "gpt-4.1-mini";

type OpenAiAnalysisPayload = {
  dominantColors: string[];
  layoutRegions: ReconstructionRegion[];
  textCandidates: ReconstructionTextCandidate[];
  ocrBlocks: ReconstructionOcrBlock[];
  textStyleHints: ReconstructionTextStyleHint[];
  assetCandidates: ReconstructionAssetCandidate[];
  styleHints: {
    theme: "light" | "dark";
    cornerRadiusHint: number;
    shadowHint: "none" | "soft";
    primaryColorHex: string | null;
    accentColorHex: string | null;
  };
  uncertainties: string[];
};

function schemaBounds() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["x", "y", "width", "height"],
  };
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      dominantColors: {
        type: "array",
        items: { type: "string" },
      },
      layoutRegions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["surface", "text-band", "emphasis", "unknown"] },
            confidence: { type: "number" },
            bounds: schemaBounds(),
            fillHex: { type: ["string", "null"] },
          },
          required: ["id", "kind", "confidence", "bounds", "fillHex"],
        },
      },
      textCandidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            confidence: { type: "number" },
            bounds: schemaBounds(),
            estimatedRole: { type: "string", enum: ["headline", "body", "metric", "label", "unknown"] },
          },
          required: ["id", "confidence", "bounds", "estimatedRole"],
        },
      },
      ocrBlocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            text: { type: ["string", "null"] },
            confidence: { type: "number" },
            bounds: schemaBounds(),
            lineCount: { type: "number" },
            language: { type: ["string", "null"] },
            source: { type: "string", enum: ["heuristic", "ocr"] },
          },
          required: ["id", "text", "confidence", "bounds", "lineCount", "language", "source"],
        },
      },
      textStyleHints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            textCandidateId: { type: "string" },
            role: { type: "string", enum: ["headline", "body", "metric", "label", "unknown"] },
            fontCategory: { type: "string", enum: ["display", "text", "mono", "unknown"] },
            fontWeightGuess: { type: ["number", "null"] },
            fontSizeEstimate: { type: ["number", "null"] },
            colorHex: { type: ["string", "null"] },
            alignmentGuess: { type: "string", enum: ["left", "center", "right", "justified", "unknown"] },
            lineHeightEstimate: { type: ["number", "null"] },
            letterSpacingEstimate: { type: ["number", "null"] },
            confidence: { type: "number" },
          },
          required: [
            "textCandidateId",
            "role",
            "fontCategory",
            "fontWeightGuess",
            "fontSizeEstimate",
            "colorHex",
            "alignmentGuess",
            "lineHeightEstimate",
            "letterSpacingEstimate",
            "confidence",
          ],
        },
      },
      assetCandidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["photo", "illustration", "icon-like", "texture", "background-slice"] },
            bounds: schemaBounds(),
            confidence: { type: "number" },
            extractMode: { type: "string", enum: ["crop", "trace", "outpaint", "ignore"] },
            needsOutpainting: { type: "boolean" },
          },
          required: ["id", "kind", "bounds", "confidence", "extractMode", "needsOutpainting"],
        },
      },
      styleHints: {
        type: "object",
        additionalProperties: false,
        properties: {
          theme: { type: "string", enum: ["light", "dark"] },
          cornerRadiusHint: { type: "number" },
          shadowHint: { type: "string", enum: ["none", "soft"] },
          primaryColorHex: { type: ["string", "null"] },
          accentColorHex: { type: ["string", "null"] },
        },
        required: ["theme", "cornerRadiusHint", "shadowHint", "primaryColorHex", "accentColorHex"],
      },
      uncertainties: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "dominantColors",
      "layoutRegions",
      "textCandidates",
      "ocrBlocks",
      "textStyleHints",
      "assetCandidates",
      "styleHints",
      "uncertainties",
    ],
  };
}

function parseOutputText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part?.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  throw new Error("OpenAI response did not include output_text.");
}

export async function analyzeWithOpenAI(previewDataUrl: string): Promise<{
  model: string;
  payload: OpenAiAnalysisPayload;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analyze this UI reference image for Figma reconstruction. Only describe visible UI structure. Return normalized bounds in 0..1 relative coordinates. Do not invent missing text. If text is unreadable, use null text with low confidence. Prefer conservative output.",
            },
            {
              type: "input_image",
              image_url: previewDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "reconstruction_analysis",
          strict: true,
          schema: buildSchema(),
        },
      },
      max_output_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI analysis failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return {
    model: DEFAULT_MODEL,
    payload: JSON.parse(parseOutputText(payload)) as OpenAiAnalysisPayload,
  };
}
