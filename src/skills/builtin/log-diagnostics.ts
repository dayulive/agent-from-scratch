import type { Skill } from "../types.js";

export const logDiagnosticsSkill: Skill = {
  name: "log-diagnostics",
  description: "从日志和时间线定位错误根因并验证修复假设。",
  version: "1.0.0",
  triggers: ["日志", "报错", "故障", "排查", "log", "error"],
  tags: ["diagnostics", "logs"],
  instructions: `1. 先确认故障时间、服务版本、影响范围和最近变更，再按时间窗读取日志。
2. 聚合重复错误，保留首个异常、堆栈、请求标识和上下游关联信息。
3. 区分根因与连带错误，用配置、资源指标和可复现请求验证假设。
4. 日志中的令牌、个人数据和密钥必须屏蔽；不为了调试永久降低日志安全级别。
5. 修复后重新运行失败场景并观察同类错误是否消失，报告证据和剩余不确定性。`,
};
