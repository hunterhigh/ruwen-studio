import type { IdeationFilePatch, IdeationPreview } from "@ruwen/pipeline";
import { useState } from "react";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { kindNames, previewStatus, roleNames } from "./copy.ts";

export function Structured({ value }: { value: unknown }) {
  return <SafeMarkdown plain content={JSON.stringify(value, null, 2)} />;
}
function Lines({ items }: { items: readonly string[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>
          <SafeMarkdown content={item} />
        </li>
      ))}
    </ul>
  );
}
function Patches({ patches }: { patches: readonly IdeationFilePatch[] }) {
  return (
    <div className="ideation-patches">
      {patches.map((patch) => {
        const path = patch.kind === "create" ? patch.path : patch.resource.path;
        return (
          <details key={path} open>
            <summary>
              <SafeMarkdown inline plain content={path} /> ·{" "}
              {patch.kind === "create" ? "新增文件" : "小节替换"}
            </summary>
            <div className="file-diff">
              <section>
                <h3>当前资料</h3>
                <SafeMarkdown
                  plain
                  content={
                    patch.kind === "create"
                      ? "目标文件尚不存在"
                      : patch.beforeText
                  }
                />
              </section>
              <section>
                <h3>批准后预览</h3>
                <SafeMarkdown
                  plain
                  content={
                    patch.kind === "create" ? patch.content : patch.afterText
                  }
                />
              </section>
            </div>
            {patch.kind === "sections" && (
              <details>
                <summary>小节与替换内容</summary>
                <Structured value={patch.sections} />
              </details>
            )}
            <p className="fine-print">
              演示目标指纹：
              <SafeMarkdown plain inline content={patch.afterSha256} />
            </p>
          </details>
        );
      })}
    </div>
  );
}
const approvalLabel = (preview: IdeationPreview) =>
  preview.kind === "handoff"
    ? "批准委托（演示）"
    : preview.kind === "learning_plan"
      ? "批准学习计划（演示）"
      : preview.kind === "expression_candidate"
        ? preview.approvalStage === "candidate"
          ? "确认为候选（演示）"
          : "激活表现资源（演示）"
        : preview.kind === "generation_field"
          ? "批准章节情境（演示）"
          : "批准文件变更（演示）";
const auditNames = {
  route: "实现路线",
  fulfillment: "兑现方式",
  mapping: "映射关系",
  anchoring: "锚定",
  density: "密度",
  proximity: "贴近程度",
};
export function PreviewCard({
  preview,
  busy,
  canRevise = true,
  onAction,
}: {
  preview: IdeationPreview;
  busy: boolean;
  canRevise?: boolean;
  onAction: (
    kind: "approve" | "reject" | "revise",
    text: string,
    trialRead: boolean,
  ) => void;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [trialRead, setTrialRead] = useState(false),
    [text, setText] = useState("");
  const activation =
    preview.kind === "expression_candidate" &&
    preview.approvalStage === "activation";
  const blocked =
    preview.kind === "expression_candidate" &&
    (preview.closureAudit.status !== "passed" ||
      (activation && (preview.trial.status !== "passed" || !trialRead)));
  return (
    <article className="ideation-preview-card" aria-label="预览详情">
      <header className="ideation-preview-heading">
        <div>
          <span className="eyebrow">
            {kindNames[preview.kind]} · {roleNames[preview.role]}
          </span>
          <h2>
            <SafeMarkdown inline plain content={preview.summary} />
          </h2>
        </div>
        <span className={`preview-state state-${preview.status}`}>
          {previewStatus[preview.status]}
        </span>
      </header>
      <p className="fine-print">
        版本 {preview.revision} · 本地演示指纹{" "}
        <SafeMarkdown inline plain content={preview.sha256.slice(0, 12)} /> ·
        批准前不提交
      </p>
      {preview.supersedesPreviewId && (
        <p className="notice">
          这是独立的新版本，旧版本与原决定保留。请重新阅读。
        </p>
      )}
      {preview.kind === "handoff" && (
        <>
          <section className="handoff-understanding">
            <h3>我理解你想保留的</h3>
            <SafeMarkdown content={preview.understanding.creativeValue} />
            <h3>固定事实</h3>
            <Lines items={preview.understanding.fixedFacts} />
            <h3>仍然开放的选择</h3>
            <Lines items={preview.understanding.openChoices} />
            <SafeMarkdown content={preview.understanding.exampleTreatment} />
          </section>
          <section className="clean-handoff">
            <span className="eyebrow">交给下游的干净委托</span>
            <p>接收岗位：{roleNames[preview.handoff.recipient]}</p>
            {preview.handoff.kind === "creative_brief" ? (
              <>
                <h3>创作价值</h3>
                <SafeMarkdown
                  content={preview.handoff.payload.creative_value}
                />
                <h3>固定事实</h3>
                <Lines items={preview.handoff.payload.fixed} />
                <h3>未解决的力量</h3>
                <Lines items={preview.handoff.payload.unresolved_forces} />
                <h3>开放的实现</h3>
                <Lines items={preview.handoff.payload.open_realization} />
                <h3>交付位置</h3>
                <SafeMarkdown
                  plain
                  content={preview.handoff.payload.destination}
                />
              </>
            ) : (
              <Structured value={preview.handoff.payload} />
            )}
            <p>批准只允许分派，不会直接更新正典。</p>
            <details>
              <summary>委托范围、资源与独立指纹</summary>
              <Structured
                value={{
                  scope: preview.handoff.scope,
                  resource_ids: preview.handoff.resource_ids,
                  payloadSha256: preview.payloadSha256,
                  approval_ref: preview.handoff.approval_ref,
                }}
              />
            </details>
          </section>
        </>
      )}
      {preview.kind === "file_patch" && (
        <>
          <SafeMarkdown content={preview.explanation} />
          <Patches patches={preview.patches} />
          <details>
            <summary>注册表变更（含前后权限与版本）</summary>
            <Structured value={preview.registryChanges} />
          </details>
        </>
      )}
      {preview.kind === "learning_plan" && (
        <>
          <div className="ideation-facts">
            <section>
              <h3>已知</h3>
              <SafeMarkdown content={preview.known} />
            </section>
            <section>
              <h3>待了解</h3>
              <SafeMarkdown content={preview.unknown} />
            </section>
          </div>
          <h3>学习计划</h3>
          {preview.plan.map((line) => (
            <SafeMarkdown key={line} content={line} />
          ))}
          <h3>搜集边界</h3>
          <SafeMarkdown content={preview.boundary} />
          <h3>潜在冲突</h3>
          <Structured value={preview.potentialConflicts} />
          <h3>结果归属</h3>
          <SafeMarkdown plain content={preview.destination} />
          <p className="notice">
            {preview.sourceMode === "existing_materials"
              ? "来源：现有授权资料。批准之后才进入调查，调查结果仍需再次批准。"
              : "来源：外部搜索。当前未配置搜索服务，计划会保留待批，不切换来源。"}
          </p>
          <details>
            <summary>调查用干净委托</summary>
            <Structured value={preview.execution} />
          </details>
        </>
      )}
      {preview.kind === "expression_candidate" && (
        <>
          <p className="notice">
            {activation
              ? "激活阶段：需审计通过、隔离试写通过，并由你确认已阅读样本。"
              : "候选阶段：本次批准最多提交 candidate，不会自动成为 active，也不会装入正式作者资料包。"}
          </p>
          <p>
            资源状态：
            <SafeMarkdown inline plain content={preview.resource.status} /> ·
            闭合审计：
            {preview.closureAudit.status === "passed"
              ? "通过"
              : preview.closureAudit.status === "failed"
                ? "未通过"
                : "待完成"}
          </p>
          <ul className="audit-checks">
            {preview.closureAudit.checks.map((check) => (
              <li key={check.category}>
                <strong>{auditNames[check.category]}</strong>
                <span>
                  {check.resolved ? "已处理" : "待处理"} ·{" "}
                  {check.risk === "low"
                    ? "低风险"
                    : check.risk === "medium"
                      ? "中风险"
                      : "高风险"}
                </span>
                <SafeMarkdown content={check.summary} />
              </li>
            ))}
          </ul>
          <h3>隔离试写 · 非正典</h3>
          <SafeMarkdown
            content={
              preview.trial.sample ??
              "本阶段尚无试写样本。候选批准不代表已经激活。"
            }
          />
          {activation && (
            <label className="confirm-check">
              <input
                disabled={busy}
                type="checkbox"
                checked={trialRead}
                onChange={(event) => setTrialRead(event.target.checked)}
              />
              我已阅读非正典试写样本
            </label>
          )}
          <Patches patches={preview.patches} />
          <details>
            <summary>注册表变更及证据引用</summary>
            <Structured
              value={{
                registryChanges: preview.registryChanges,
                closureAudit: preview.closureAudit.report,
                trial: preview.trial.report,
              }}
            />
          </details>
        </>
      )}
      {preview.kind === "generation_field" && (
        <>
          <p>
            第 <SafeMarkdown inline plain content={preview.chapter} /> 章 ·{" "}
            {preview.characterCount} / 2200 字符
          </p>
          <div className="generation-field">
            <SafeMarkdown content={preview.generationField} />
          </div>
          <h3>必须发生的事件</h3>
          <Lines items={preview.lockedEvents} />
          <h3>锁定顺序</h3>
          <Lines items={preview.lockedOrder} />
          <h3>投影目标</h3>
          <SafeMarkdown plain content={preview.projection.path} />
          <details>
            <summary>已批准来源</summary>
            <Structured value={preview.approvedSources} />
          </details>
          <p>只有独立批准后才登记章节投影；此演示不写项目文件。</p>
        </>
      )}
      <details className="preview-provenance">
        <summary>作用域与资源指纹</summary>
        <Structured
          value={{
            scope: preview.scope,
            resources: preview.resources,
            registrySha256: preview.registrySha256,
          }}
        />
      </details>
      {(preview.status === "pending" || preview.status === "stale") && (
        <section className="ideation-decision">
          {preview.status === "pending" && (
            <>
              <label className="confirm-check">
                <input
                  disabled={busy}
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已阅读此版本，确认这次模拟批准
              </label>
              <button
                className="button primary"
                type="button"
                disabled={!confirmed || busy || blocked}
                onClick={() => onAction("approve", "", trialRead)}
              >
                {approvalLabel(preview)}
              </button>
            </>
          )}
          {preview.status === "stale" && (
            <p className="notice">
              旧预览不能批准，可把修改意见交回协调员生成新版。
            </p>
          )}
          <label>
            修改意见或拒绝理由
            <textarea
              disabled={busy}
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="只留在协调员会话，不会直接交给下游。"
            />
          </label>
          <div className="decision-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || !canRevise || !text.trim()}
              onClick={() => onAction("revise", text, false)}
            >
              交回协调员修改
            </button>
            {preview.status === "pending" && (
              <button
                className="text-button danger"
                type="button"
                disabled={busy}
                onClick={() => onAction("reject", text, false)}
              >
                拒绝此预览
              </button>
            )}
          </div>
        </section>
      )}
    </article>
  );
}
