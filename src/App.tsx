import { WorkspaceShell } from "./components/workspace/workspace-shell";

function capabilityCards() {
  return [
    {
      kicker: "Figma to React",
      title: "把设计上下文整理成 React 实现约束",
      copy: "工作台负责同步设计摘要、维护组件映射、生成 Runtime Context Pack，并为后续代码生成链路提供统一上下文。",
    },
    {
      kicker: "Codex to Figma",
      title: "用独立插件执行颜色、样式和变量操作",
      copy: "Figma 插件和工作台分离，插件只负责在 Figma 文件里读取选择并执行可审计命令，不承担 React 工作台逻辑。",
    },
    {
      kicker: "Shared Contracts",
      title: "共享类型、JSON 协议和本地项目数据",
      copy: "两条链路共享领域模型与命令协议，但运行时隔离，避免把设计执行器和实现工作台耦合在一起。",
    },
  ];
}

export default function App() {
  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="eyebrow">Figmatest / Vite + React Workspace</div>
        <h1>同一个仓库，承载两条清晰分离的链路。</h1>
        <p className="hero-copy">
          `workspace` 负责 Figma 到 React 的映射与 AI 上下文，`figma-plugin`
          负责把 Codex 生成的命令执行到 Figma 里。两者共享协议，不共享运行时。
        </p>
        <div className="hero-actions">
          <a className="button-primary" href="#workspace">
            打开工作台
          </a>
          <a className="button-secondary" href="/api/health">
            查看 API 健康状态
          </a>
        </div>
      </section>

      <section className="landing-grid">
        {capabilityCards().map((card) => (
          <article className="landing-card" key={card.title}>
            <span className="card-kicker">{card.kicker}</span>
            <h2>{card.title}</h2>
            <p>{card.copy}</p>
          </article>
        ))}
      </section>

      <section className="workspace-anchor" id="workspace">
        <WorkspaceShell />
      </section>
    </main>
  );
}
