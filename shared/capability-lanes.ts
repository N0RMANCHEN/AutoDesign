export const CAPABILITY_LANE_IDS = [
  "code_to_design",
  "figma_design",
  "design_to_code",
] as const;

export type CapabilityLaneId = (typeof CAPABILITY_LANE_IDS)[number];
export type CapabilityLaneSurfaceClass = "formal_support" | "experimental" | "future_target";

export type CapabilityLaneDescriptor = {
  id: CapabilityLaneId;
  label: string;
  description: string;
  input: string;
  output: string;
  defaultSurfaceClass: CapabilityLaneSurfaceClass;
};

export const CAPABILITY_LANES: CapabilityLaneDescriptor[] = [
  {
    id: "code_to_design",
    label: "Code -> Design",
    description: "从前端代码或运行态页面抓取设计事实，并把页面重建成可编辑 Figma 结果。",
    input: "frontend_code_or_runtime_page",
    output: "editable_figma_scene",
    defaultSurfaceClass: "experimental",
  },
  {
    id: "figma_design",
    label: "Direct Figma Design",
    description: "在 Figma 内直接读取、检查、修改和生成设计节点。",
    input: "figma_scene",
    output: "figma_scene",
    defaultSurfaceClass: "formal_support",
  },
  {
    id: "design_to_code",
    label: "Design -> Code",
    description: "把 Figma 里的设计事实整理成稳定的前端改造输入或实现上下文。",
    input: "figma_design_facts",
    output: "frontend_implementation_input",
    defaultSurfaceClass: "formal_support",
  },
];

export function getCapabilityLaneDescriptor(laneId: CapabilityLaneId) {
  return CAPABILITY_LANES.find((lane) => lane.id === laneId) || null;
}

export function isCapabilityLaneId(value: string): value is CapabilityLaneId {
  return CAPABILITY_LANE_IDS.includes(value as CapabilityLaneId);
}
