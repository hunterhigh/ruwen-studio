做了什么
- 输入按实际文本请求 UTF-8 字节上界加协议余量计量；输出保持岗位 maxTokens，新增零 provider 调用的 --plan。
测试结果
- lint/typecheck、406 条受影响包测试及最终 11 条专项通过；最终全量/浏览器/容器结果见 PR CI。
- 当前 config/models.json，命令 pnpm p3:smoke --plan --max-usd 5 的实际输出：
```text
P3 PLAN max-usd=5; config/models.json; local demo replies; provider calls=0
01 conversation/chuangyi-xietiaoyuan claude-sonnet-5-5 in<=31736 out<=8192 USD<=0.2279056000 cumulative<=0.2279056000 RUN
02 communication_gate/chuangyi-xietiaoyuan claude-sonnet-5-5 in<=32096 out<=8192 USD<=0.2295616000 cumulative<=0.4574672000 RUN
03 downstream_preview/gushi-gousishi claude-opus-5-5 in<=30132 out<=32768 USD<=0.9325744000 cumulative<=1.3900416000 RUN
04 compilation/zhangjie-qingjing-bianyiyuan claude-opus-5-5 in<=32619 out<=16384 USD<=0.6277748001 cumulative<=2.0178164001 RUN
05 chapter/xiaoshuo-zuozhe claude-opus-5-5 in<=4969 out<=65536 USD<=1.3564348000 cumulative<=3.3742512001 RUN
06 chapter/qinggan-duzhe claude-haiku-5-5 in<=5603 out<=8192 USD<=0.0270635250 cumulative<=3.4013147251 RUN
07 chapter/wenxue-bianji claude-opus-5-5 in<=20818 out<=32768 USD<=0.8468856000 cumulative<=4.2482003251 RUN
08 chapter/qingjie-heyanyuan claude-haiku-5-5 in<=17754 out<=8192 USD<=0.0413409500 cumulative<=4.2895412752 RUN
09 chapter/xianshi-heyanyuan claude-haiku-5-5 in<=18167 out<=8192 USD<=0.0418262251 cumulative<=4.3313675004 RUN
10 memory_preview/jiyi-weihuyuan claude-sonnet-5-5 in<=22854 out<=24576 USD<=0.3508884001 cumulative<=4.6822559005 RUN
11 memory_preview/jiyi-weihuyuan claude-sonnet-5-5 in<=24332 out<=24576 USD<=0.3576872001 cumulative<=5.0399431007 BLOCK
Demo can finish: NO; first blocked step: 11; total USD<=5.0399431007
Scope: fixed demo transcript, including its tool turns; live outputs/corrections change later requests and are rechecked before dispatch.
```
未完成与风险
- 仅对固定演示响应轨迹预测，额外纠正/真实输出会改变后续输入；实跑逐次重算。未配置 key、未调用真实模型。
需要人类决定的事
- 无；本项合并后停下待命，不再开新功能。
