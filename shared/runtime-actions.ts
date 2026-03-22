import type { ContextPack, RuntimeEnvelope } from "./types.js";
import { hashFromText } from "./utils.js";

function branchNodeId(primaryId: string, index: number) {
  return `ai_branch_${hashFromText(primaryId)}_${index + 1}`;
}

export function runRuntimeAction(contextPack: ContextPack): RuntimeEnvelope {
  if (contextPack.selectionIds.length === 0 || contextPack.nodes.length === 0) {
    return {
      explanation: "缺少选中对象，无法生成建议。",
      patch: { ops: [] },
      risks: ["调用方没有传入足够的 selectionIds。"],
      questions: ["请至少选择一个设计源、页面、组件映射或评审项。"],
    };
  }

  const primary = contextPack.nodes[0];
  const primaryHash = hashFromText(primary.id);

  switch (contextPack.action) {
    case "codegraph/summarize":
      return {
        explanation: "为当前选中内容生成一个摘要节点，便于快速回顾设计和实现约束。",
        patch: {
          ops: [
            {
              op: "upsertNode",
              node: {
                id: `ai_summarize_${primaryHash}_1`,
                kind: "note",
                title: "Summary",
                text: contextPack.nodes
                  .map((node) => `${node.title}：${node.summary}`)
                  .join("\n"),
                position: {
                  x: primary.position.x + 360,
                  y: primary.position.y,
                },
              },
            },
            {
              op: "upsertEdge",
              edge: {
                id: `ai_e_summarize_${primaryHash}_1`,
                source: primary.id,
                target: `ai_summarize_${primaryHash}_1`,
              },
            },
          ],
        },
        risks: ["摘要结果依赖当前上下文密度，未替代人工设计判断。"],
        questions: [],
      };

    case "codegraph/branch":
      return {
        explanation: "从当前主节点拆出三条可执行分支，帮助继续推进联调。",
        patch: {
          ops: new Array(3).fill(null).flatMap((_, index) => {
            const id = branchNodeId(primary.id, index);
            return [
              {
                op: "upsertNode",
                node: {
                  id,
                  kind: "note",
                  title: `Next Step ${index + 1}`,
                  text: [
                    "补齐设计状态命名。",
                    "确认 React 组件接口。",
                    "验证 Runtime Context Pack 字段。",
                  ][index],
                  position: {
                    x: primary.position.x + 360,
                    y: primary.position.y + index * 160,
                  },
                },
              },
              {
                op: "upsertEdge",
                edge: {
                  id: `ai_e_branch_${primaryHash}_${index + 1}`,
                  source: primary.id,
                  target: id,
                },
              },
            ];
          }),
        },
        risks: ["这是通用分支建议，后续接 Figma MCP 后应根据真实上下文动态生成。"],
        questions: [],
      };

    case "codegraph/reorganize_to_frame": {
      const minX = Math.min(...contextPack.nodes.map((node) => node.position.x));
      const minY = Math.min(...contextPack.nodes.map((node) => node.position.y));
      return {
        explanation: "为当前选中节点生成一个新的 frame 建议，用于整理结构。",
        patch: {
          ops: [
            {
              op: "upsertNode",
              node: {
                id: `ai_frame_${primaryHash}_1`,
                kind: "frame",
                title: "Figma Review Frame",
                position: {
                  x: minX - 80,
                  y: minY - 80,
                },
                width: 720,
                height: Math.max(320, contextPack.nodes.length * 170),
              },
            },
            ...contextPack.nodes.map((node, index) => ({
              op: "moveNode",
              nodeId: node.id,
              position: {
                x: minX + 40,
                y: minY + index * 140,
              },
            })),
          ],
        },
        risks: ["当前 frame 尺寸是固定建议值，真实画布接入后应根据 bbox 计算。"],
        questions: [],
      };
    }

    case "knowledge/summarize":
      return {
        explanation: "生成知识摘要节点，方便在评审或复盘中快速回顾。",
        patch: {
          ops: [
            {
              op: "upsertSummary",
              targetId: primary.id,
              summary: contextPack.nodes.map((node) => node.summary).join(" / "),
            },
          ],
        },
        risks: ["如果知识模型不支持 summary 字段，需要由调用方转成新节点。"],
        questions: [],
      };

    case "knowledge/branch":
      return {
        explanation: "提出三个知识分支，用于继续扩展设计与实现讨论。",
        patch: {
          ops: new Array(3).fill(null).map((_, index) => ({
            op: "appendBranch",
            targetId: primary.id,
            branch: {
              id: `knowledge_branch_${primaryHash}_${index + 1}`,
              title: ["设计状态差异", "React 接口清单", "联调验证顺序"][index],
              text: [
                "列出 Figma 中已经确认和仍待确认的状态。",
                "把关键 props、events 和空状态统一成接口草案。",
                "决定测试 Figma MCP 时先验哪些上下文字段。",
              ][index],
            },
          })),
        },
        risks: ["知识分支使用的是通用模板，需要结合真实项目继续细化。"],
        questions: [],
      };

    case "knowledge/learning_path":
      return {
        explanation: "生成一条四步学习路径，帮助从设计理解推进到联调验证。",
        patch: {
          ops: [
            "梳理 Figma 文件结构和命名。",
            "抽取组件状态与 props。",
            "落 React 原型并做最小验证。",
            "接入 Runtime Context Pack 与 MCP 测试。",
          ].map((title, index) => ({
            op: "appendStep",
            targetId: primary.id,
            step: {
              id: `learning_step_${primaryHash}_${index + 1}`,
              order: index + 1,
              title,
            },
          })),
        },
        risks: ["学习路径默认按 MVP 顺序生成，不代表唯一实施路径。"],
        questions: [],
      };
  }
}
