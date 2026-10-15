# 测试记录

日期：2026-10-15，北京时间。环境：Windows、Node 24.19.0、Python 3.12.14。完整输出见[verification.txt](verification.txt)。

## 自动检查

- `node --test tests/core.test.mjs`：16项业务检查。
- `python -m unittest discover -s tests -p test_server.py -v`：14项HTTP与模拟上游检查。
- `node --check docs/app.js`：界面脚本语法。
- `node scripts/export-demo.mjs`：生成两份完整规则报告及比较文件。

检查包含缺失、冲突、伪造事实、结构不足、额外缺失标记、输入拦截不调用、上游和解析错误、部分运行分母、内容指纹、对比资格及逐例变化。HTTP测试与独立项目相同，在本仓库单独执行。

## 浏览器验收

实际执行V1、V2两次完整12条运行；查看C02输入、原始结果和检查项；将自动通过结果人工判为需修改并保存理由；比较得到7条预设失败转通过、0条退化；刷新后历史结果和人工意见仍在；下载完整JSON报告。

默认桌面与390像素窄屏均检查。窄屏页面宽375像素，无整页横向溢出；表格在自身容器滚动。浏览器未捕获到脚本error级日志。未进行所有浏览器和无障碍完整认证。

## 结果口径

规则演示V1验收5/12，V2验收12/12，其中2条是预期输入拦截。V1的补造事实和V2的规则处理均为预先定义的样例行为，因此这组数字不能代表真实模型提升、Prompt优劣或生产可用率。

完整记录可在examples中重现；不存在外部模型实测、真实用户或线上A/B结果。

首次源码发布提交`6366fa2`已通过[GitHub远程检查](https://github.com/TJCMYS888/skillcheck/actions/runs/38720572401)。[在线规则演示](https://tjcmys888.github.io/skillcheck/)由GitHub Pages发布；后续提交的检查状态见仓库Actions。

![桌面](assets/desktop.jpg)
