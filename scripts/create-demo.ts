import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approval,
  checks,
  initProject,
  LocalDirFS,
  type ProjectFS,
  registry,
  state,
} from "../packages/core/src/index.ts";
import { readJson, writeJson } from "../packages/core/src/runtime.ts";

// Deliberately synthetic, disposable P3 fixture. These approvals/evidence are
// authorized fixture setup, never approvals of generated chapter candidates.
const projectKey = "demo-ruwen";
const root = path.resolve(
  process.argv[2] ??
    fileURLToPath(new URL("../fixtures/demo-project", import.meta.url)),
);
const fs = new LocalDirFS(root);
const contents: Record<string, string> = {
  "xiangmu-zhangcheng":
    "# 项目章程\n\n## 项目身份\n演示用历史幻想短篇：河谷驿站。用于测试岗位边界、批准和成本，不是实际出版项目。\n\n## 创作来源权\n重大人物选择由用户决定，岗位只提交候选稿与资料变更预览。\n\n## 当前开放问题\n送信人是否继续翻越山口，暂不预定结果。\n\n## 批准状态\n演示夹具资料按实施计划预置批准；生成的章节仍须独立人工批准。\n",
  "zhujue-dangan":
    "# 主角档案\n\n## 客观存在模型\n青年送信人林川，左腿留有旧伤，站久会改变重心。他能凭行旅凭证申请换马，却没有征用驿马或命令驿吏的权力，食宿依赖随身的少量铜钱。\n\n## 内在组织模型\n他想赶在河谷封冻前把信送到，又害怕再欠下无法偿还的人情。注意常先落在别人改变日常动作的地方，犹豫时习惯检查信封，自己把这种拖延解释为谨慎。\n\n## 叙述接口模型\n叙述贴着林川的步幅、手和声音来源展开；他只能推测他人动机，不能知道未曾接触的消息。疲劳和腿痛会压缩他的注意，误听后也可能暂时没有意识到错误。\n\n## 开放未知\n信件为何赶在封路前送出，以及收信人的真正处境，尚不揭示。\n",
  "zhujue-pov-jingtou":
    "林川先注意人的手、马匹的动静和自己站立的代价。声音能引起猜测，但理解须落在实际听见或看见的范围；他看不见他人的内心。急迫与迟疑可以在同一个动作里并存，叙述不提前替他完成解释。",
  "shijie-zongbiao":
    "# 世界总表\n\n## 时代与空间\n虚构河谷诸城依靠山口和驿道往来，冬季水路逐渐停航，消息到达时间取决于脚程和换马。\n\n## 物质与技术边界\n纸、铁器、粮秣与畜力支撑日常生活，没有电信或凭空传话的能力，远处消息需要具体携带者。\n\n## 系统索引\n驿道换马制度连接凭证、地方权力和粮秣分配，详见世界系统中的驿路条目；政治全局暂不展开。\n",
  "shijie-dangqian-taishi":
    "# 当前态势\n\n## 活跃力量与各自运动\n两座河谷城镇争夺冬季粮道，商队趁最后的薄冰运粮，驿吏要在日落前清点马匹。\n\n## 可调用资源与现实限制\n可用驿马不足；林川有凭证和少量铜钱，旧伤使步行翻山变慢。\n\n## 相互认识、误读与无人介入时的下一步\n旅人只见等待变久，不知道马匹的实际去向；即使林川不开口，粮车也会先离开，平民换马会继续受限。\n",
  "shijie-hexin-xitong":
    "# 驿道与换马\n\n## 参与者与受影响者\n驿吏清点马匹，军使和商队争用粮秣，普通行旅承担延迟。\n\n## 资源流、规则、成本与限制\n凭证允许申请换马，实际放行受饲料与可用马数限制，付钱也不能制造不存在的马。\n\n## 权力或知识不对称\n驿吏能查看马册，旅人只能从院内动静推测等待时间。\n\n## 日常接触与不同身份的经验\n军使优先、商队交费，普通旅人必须等驿吏点头，不能凭个人意愿改变队列。\n\n## 自身运动、当前压力、误解与开放未知\n寒冷会消耗饲料并缩短赶路时段；粮车改道的原因尚未被旅人证实。\n",
  "gushi-dangqian-hu":
    "# 当前故事弧\n\n## 作用域\n第一卷、驿站弧、第一章。\n\n## 具体故事\n林川带着封信在河谷驿站等待换马，看见粮车改挂木牌。等待和旧伤改变他的行动成本，而关于山口的消息仍未得到确认；是否继续送信保持开放。\n",
  "biaoxian-xiangmu-shengyin":
    "演示用项目声音：叙述贴近当下可见的物质活动和人的有限判断。外界不会为人物的犹豫停下，动作先改变相处的距离，理解允许晚到。不用总结句替人物解释他尚未理解的关系。",
  "xiaoyan-yingsheding":
    "# 硬设定规则\n\n驿道没有即时远距通信；消息必须由具体携带者送达。林川无调兵或征用驿马权限。人物只能知道有来源的信息，旧伤影响行动但不赋予异能。\n",
};
await initProject(fs, projectKey);
await fs.transaction(async (tx) => {
  const data = await registry.readRegistry(tx);
  for (const [id, content] of Object.entries(contents)) {
    const resource = data.resources.find((r) => r.id === id);
    if (!resource) throw new Error(`Missing template resource ${id}`);
    if (id === "zhujue-pov-jingtou") resource.scope.povs = ["林川"];
    await tx.write(resource.path, content);
    resource.source_sha256 = await tx.sha256(resource.path);
    const event = await approval.createEvent(
      tx,
      `demo-${id}`,
      resource.type === "expression"
        ? "expression_activate"
        : "resource_activate",
      resource.path,
      true,
    );
    const eventPath = String(event.event);
    await approval.consumeEvent(
      tx,
      await readJson(tx, eventPath),
      "xiangmu-zhiliyuan",
    );
    resource.status = "active";
    resource.approval = {
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "user",
      approval_event_path: eventPath,
      approval_event_sha256: await tx.sha256(eventPath),
    };
    if (resource.type === "expression") {
      const prefix = `治理/激活证据/demo-${id}`;
      const trialText = `${prefix}-trial.md`,
        audit = `${prefix}-closure.json`,
        trial = `${prefix}-trial.json`;
      await tx.write(
        trialText,
        "非正典演示试写：林川把信封抵在胸前，院外的车轮碾碎薄冰。驿吏翻着马册，没有抬头。他把重心挪到右脚，等那页纸翻过去。\n",
      );
      const manual = {
        resource_id: id,
        resource_path: resource.path,
        resource_version: resource.version,
        resource_sha256: resource.source_sha256,
        reviewed_by: "user",
        checks: Object.fromEntries(
          checks.CHECK_NAMES.map((name) => [name, "pass"]),
        ),
      };
      // Fixture evidence must remain bound to the same logical path after copy.
      const portable = new Proxy(tx, {
        get(target, key) {
          if (key === "displayPath") return (p: string) => target.path(p);
          const member: unknown = Reflect.get(target, key);
          return typeof member === "function" ? member.bind(target) : member;
        },
      }) as ProjectFS;
      await writeJson(
        tx,
        audit,
        await checks.closureAudit(
          portable,
          resource.path,
          id,
          resource.version,
          manual,
        ),
      );
      await writeJson(tx, trial, {
        resource_id: id,
        resource_path: resource.path,
        resource_version: resource.version,
        resource_sha256: resource.source_sha256,
        output_path: trialText,
        output_sha256: await tx.sha256(trialText),
        user_accepted: true,
        canonical: false,
      });
      Object.assign(resource.approval, {
        closure_audit_path: audit,
        closure_audit_sha256: await tx.sha256(audit),
        trial_report_path: trial,
        trial_report_sha256: await tx.sha256(trial),
      });
    }
  }
  await writeJson(tx, registry.REGISTRY, data);
});
await state.initState(fs, "故事/当前故事弧.md", [
  "character=人物/主角档案.md",
  "world=世界/世界总表.md",
  "situation=世界/当前态势.md",
]);
const projection = "authoring-ruwen-v5/projections/current.md";
const scope = {
  project: projectKey,
  volume: "v1",
  arc: "station",
  chapter: "001",
  scene_type: "travel",
  pov: "林川",
};
await fs.write(
  projection,
  "冬日下午，林川在河谷驿站等换马，左腿旧伤使他不愿久站。院中粮车改挂另一座城的木牌，车夫正在装最后一袋粮。他的凭证只够申请换马，不能征用马匹。信封抵在胸前，他还没能确认山口是否封锁，日落又在缩短赶路的时间。此章锁定的可观察事件只有粮车离开驿站；林川如何回应、是否继续送信与他对局势的理解保持开放。",
);
await state.registerProjection(fs, projection, "001", scope);
const manifestPath = "authoring-ruwen-v5/manifests/author-manifest.json";
const manifest = await readJson(fs, manifestPath);
manifest.context_scope = scope;
await writeJson(fs, manifestPath, manifest);
await writeJson(fs, `${projection}.promises.json`, {
  projection_sha256: await fs.sha256(projection),
  locked_events: ["粮车离开驿站"],
  locked_order: [],
});
await fs.write(
  "DEMO.md",
  "# 演示夹具\n\n本目录是P3合成演示资料，预置批准和手写非正典试写仅用于夹具初始化，不代表真实用户对生成正文的批准或文学效果验收。候选稿与记忆预览仍分别等待人工批准。请复制到新目录运行，避免把运行产物提交为演示源。\n",
);
const ready = await checks.projectReadiness(fs);
if (!ready.ready) throw new Error(ready.errors.join("\n"));
console.log(
  JSON.stringify(
    {
      project: projectKey,
      root,
      ready: ready.ready,
      files: (await fs.list()).length,
    },
    null,
    2,
  ),
);
