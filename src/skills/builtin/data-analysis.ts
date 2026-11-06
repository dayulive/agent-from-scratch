import type { Skill } from "../types.js";

export const dataAnalysisSkill: Skill = {
  name: "data-analysis",
  description: "检查数据质量、计算统计指标并给出可复现分析。",
  version: "1.0.0",
  triggers: ["数据分析", "统计", "csv", "dataset", "analyze"],
  tags: ["data", "analysis"],
  instructions: `1. 先识别文件格式、字段、行数、编码和缺失值，不凭列名猜测业务含义。
2. 保留原始数据，只在临时路径生成清洗结果；记录过滤、类型转换和去重规则。
3. 根据问题选择计数、分布、趋势或相关性指标，不把相关关系表述为因果关系。
4. 使用可复现脚本计算，抽样核对异常值和边界条件。
5. 输出方法、关键数字、数据质量限制和结果文件路径。`,
};
