import type { Skill } from "../types.js";

export const devopsDeploySkill: Skill = {
  name: "devops-deploy",
  description: "以可回滚、可验证的方式执行应用部署。",
  version: "1.0.0",
  triggers: ["部署", "发布", "deploy", "rollback"],
  tags: ["devops", "deployment"],
  instructions: `1. 部署前检查：确认当前分支、工作区、运行时版本、环境变量名称、端口和磁盘空间，不输出密钥值。
2. 先运行现有测试和构建，再检查目标服务当前版本与健康状态，记录回滚点。
3. 展示将执行的写操作；涉及系统配置、提权或生产变更时必须取得审批。
4. 使用项目既有部署脚本，避免覆盖未跟踪文件；迁移数据库前先备份并确认回滚方案。
5. 部署后检查进程、健康接口和关键日志。验证失败时停止继续变更，优先恢复回滚点。
6. 最终报告版本、执行命令、健康检查结果和仍需人工关注的风险。`,
};
