"use client";
import { useState } from "react";
import { roleName, uiCopy } from "../../copy/zh-CN.ts";
import { Button } from "../../ui/Button.tsx";
import { useConfirm } from "../../ui/ConfirmDialog.tsx";
import { KeyValueList } from "../../ui/KeyValueList.tsx";
import { RoleTag } from "../../ui/Role.tsx";
import { SealButton } from "../../ui/SealButton.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { useToast } from "../../ui/Toast.tsx";

const copy = uiCopy.gallery;
export function UiPreview() {
  const confirm = useConfirm();
  const toast = useToast();
  const [result, setResult] = useState("");
  return (
    <main className="ui-preview">
      <h1>{copy.title}</h1>
      <p>{copy.lede}</p>
      <section>
        <h2>{copy.colors}</h2>
        <div className="ui-preview-swatches">
          {Object.entries(copy.colorsList).map(([key, label]) => (
            <div key={key}>
              <i className={`ui-swatch-${key}`} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>{copy.typography}</h2>
        <h3 className="ui-type-title">{copy.serifSample}</h3>
        <p className="ui-type-prose">{copy.proseSample}</p>
        <p>{copy.sansSample}</p>
      </section>
      <section>
        <h2>{copy.buttons}</h2>
        <div className="ui-preview-row">
          <SealButton>{copy.approve}</SealButton>
          <SealButton disabled>{copy.disabledSeal}</SealButton>
          <Button variant="primary">{copy.primary}</Button>
          <Button>{copy.secondary}</Button>
          <Button variant="ghost">{copy.ghost}</Button>
          <Button variant="danger-text">{copy.danger}</Button>
          <Button disabled>{copy.disabled}</Button>
        </div>
        <div className="ui-preview-row">
          <StatusBadge tone="decide">{copy.decide}</StatusBadge>
          <StatusBadge tone="ok">{copy.ok}</StatusBadge>
          <StatusBadge tone="run">{copy.run}</StatusBadge>
          <StatusBadge tone="stop">{copy.stop}</StatusBadge>
        </div>
      </section>
      <section>
        <h2>{copy.roles}</h2>
        <div className="ui-preview-row">
          {Object.keys(roleName).map((role) => (
            <RoleTag key={role} role={role} />
          ))}
        </div>
      </section>
      <section>
        <h2>{copy.interactions}</h2>
        <div className="ui-preview-row">
          <Button
            onClick={async () =>
              setResult(
                (await confirm({
                  title: copy.confirmTitle,
                  body: copy.confirmBody,
                }))
                  ? copy.confirmed
                  : copy.cancelled,
              )
            }
          >
            {copy.openConfirm}
          </Button>
          <Button onClick={() => toast(copy.toast)}>{copy.showToast}</Button>
          <output>{result}</output>
        </div>
      </section>
      <section>
        <h2>{copy.records}</h2>
        <KeyValueList
          value={{
            title: copy.recordTitle,
            summary: copy.recordSummary,
            status: "AWAITING_CANDIDATE_APPROVAL",
            readers: ["qinggan-duzhe", "wenxue-bianji"],
            patches: [{ kind: "fact", pass: true }],
            unmapped: copy.unknownText,
          }}
        />
      </section>
    </main>
  );
}
