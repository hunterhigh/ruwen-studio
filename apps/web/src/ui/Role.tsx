import { roleName, uiCopy } from "../copy/zh-CN.ts";

const colors: Record<string, string> = {
  "xiaoshuo-zuozhe": "author",
  "qinggan-duzhe": "reader",
  "wenxue-bianji": "editor",
  "qingjie-heyanyuan": "plot",
  "xianshi-heyanyuan": "real",
  "jiyi-weihuyuan": "memory",
};
export function RoleDot({ role }: { role: string }) {
  const color = Object.hasOwn(colors, role) ? colors[role] : "ideation";
  return <span className={`ui-role-dot ui-role-${color}`} aria-hidden="true" />;
}
export function RoleTag({ role }: { role: string }) {
  const label = Object.hasOwn(roleName, role)
    ? roleName[role as keyof typeof roleName]
    : uiCopy.unknownRole;
  return (
    <span className="ui-role-tag">
      <RoleDot role={role} />
      {label}
    </span>
  );
}
