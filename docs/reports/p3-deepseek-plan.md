做了什么
- --profile deepseek/环境profile用于冒烟与离线计划；以下是实际命令 pnpm p3:smoke --plan --profile deepseek --max-usd 1.2 的输出。
测试结果
- 默认/DeepSeek双profile完整计划零provider/fetch；faux录制/replay、输入上界等12条冒烟测试通过；lint/typecheck通过。
```text
P3 PLAN max-usd=1.2; profile=deepseek; config/models.deepseek.json; local demo replies; provider calls=0
01 conversation/chuangyi-xietiaoyuan deepseek-flash in<=31736 out<=8192 USD<=0.0195416160 cumulative<=0.0195416160 RUN
02 communication_gate/chuangyi-xietiaoyuan deepseek-flash in<=32096 out<=8192 USD<=0.0196517760 cumulative<=0.0391933920 RUN
03 downstream_preview/gushi-gousishi deepseek-v4-pro in<=30132 out<=32768 USD<=0.1708613280 cumulative<=0.2100547200 RUN
04 compilation/zhangjie-qingjing-bianyiyuan deepseek-v4-pro in<=32619 out<=16384 USD<=0.1093729560 cumulative<=0.3194276760 RUN
05 chapter/xiaoshuo-zuozhe deepseek-v4-pro in<=4969 out<=65536 USD<=0.2663002760 cumulative<=0.5857279521 RUN
06 chapter/qinggan-duzhe deepseek-flash in<=5603 out<=8192 USD<=0.0115449180 cumulative<=0.5972728701 RUN
07 chapter/wenxue-bianji deepseek-v4-pro in<=20818 out<=32768 USD<=0.1581570320 cumulative<=0.7554299021 RUN
08 chapter/qingjie-heyanyuan deepseek-flash in<=17754 out<=8192 USD<=0.0152631240 cumulative<=0.7706930261 RUN
09 chapter/xianshi-heyanyuan deepseek-flash in<=18167 out<=8192 USD<=0.0153895020 cumulative<=0.7860825281 RUN
10 memory_preview/jiyi-weihuyuan deepseek-flash in<=22854 out<=24576 USD<=0.0364845240 cumulative<=0.8225670521 RUN
11 memory_preview/jiyi-weihuyuan deepseek-flash in<=24330 out<=24576 USD<=0.0369361800 cumulative<=0.8595032321 RUN
Demo can finish: YES; first blocked step: none; total USD<=0.8595032321
Scope: fixed demo transcript, including its tool turns; live outputs/corrections change later requests and are rechecked before dispatch.
```
未完成与风险
- 1.2美元容纳固定演示轨迹；真实输出、纠正和工具选择会改变后续请求，发送前重新计量，不保证真实流程跑完。
- 未运行live；不自动提高上限。预算以安装目录费率为准，不替代服务商账户账单限制。
需要人类决定的事
- 无；保留1.2美元硬上限，随后提供人类运行文档。
