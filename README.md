# SkillCheck · AI 任务评测台

用同一批样例检查AI任务的提示词版本：保留输入、输出、规则、失败与人工意见，让迭代有可追溯的依据。

![SkillCheck界面](product/assets/desktop.jpg)

## 快速开始

Python 3.11+，无第三方运行依赖。

```powershell
python server.py --port 8766
```

打开 `http://127.0.0.1:8766`，运行V1，再切换V2运行，查看同条件逐例对比。所有默认样例均为人工编写的合成数据。

**默认是确定性规则演示，不是模型测评成绩。**V1特意模拟“填补日期等事实”的错误，V2按规则标记缺失／冲突，以演示检查和归因流程。修改提示词只在真实模式影响模型，演示模式由单独标注的演示策略控制。

## 已实现

- 提示词版本及不可变运行快照，标记提示词和样本内容指纹。
- 12条合成用例，包含完整、缺失、冲突、空输入及夹带指令的资料。
- 批量逐例运行、停止、错误保留、历史记录；用例JSON导入／导出和新增。
- 标题与三段结构、facts四字段、missing和conflicts检查。
- 人工“可采用／需修改”及理由，与自动验收独立保存。
- 同样本、规则、模式、模型且完整运行的结果才能配对比较。
- 导出JSON完整报告与Markdown摘要。

“自动通过”只表示预定义检查通过，不代表文案质量、自由文本事实或业务结果。两个必填项为空的用例预期被拦截，验收通过数包含这两条；这不是模型回答成功数。

## 接入真实模型

```powershell
$env:AI_BASE_URL = "https://你的服务地址/v1"
$env:AI_MODEL = "模型标识"
$env:AI_API_KEY = "在当前终端设置你的密钥"
python server.py --port 8766
```

刷新网页并切换真实模式，才会使用提示词调用模型。代理支持Chat Completions文本协议，密钥仅从环境读取；`.env.example`不自动加载。模型的JSON和业务字段分别检查，错误不计为通过。真实调用的token仅保留接口实际返回值，不估算价格。当前只完成本机模拟服务契约验证，外部模型效果未实测。

每次完整批量最多调用有效输入用例的次数，默认12条中2条预先拦截，实际最多10次；没有自动重试。取消可停止等待及后续用例，但不能保证上游已取消生成和计费。

## 测试、样例和发布

Node 20+执行业务测试，Python执行代理契约，无需npm依赖。

```powershell
node --test tests/core.test.mjs
python -m unittest discover -s tests -p test_server.py -v
node scripts/export-demo.mjs
```

`examples/`报告可由脚本重现。初始规则演示V1验收5/12、V2验收12/12，差异来自显式设置的演示行为，不代表真实模型或提示词的效果提升。

GitHub Pages：仓库Settings → Pages → Deploy from a branch → main → /docs。静态站可以运行离线规则流程；真实模型代理须在本机运行。服务只监听127.0.0.1，不是已具备认证和配额的公网服务。

## 产品文档

- [PRD与验收](product/PRD.md)
- [规则口径与设计取舍](product/DECISIONS.md)
- [两分钟操作演示](product/DEMO.md)
- [测试记录与限制](product/TEST_REPORT.md)

技术：原生网页、localStorage、Python标准库、Node内置测试。采用产品设计与AI辅助实现，包含GitHub Actions检查。MIT License。

参考：[Chat Completions接口说明](https://developers.openai.com/api/reference/resources/chat)、[GitHub Pages官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。
