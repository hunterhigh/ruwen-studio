"use client";
import { createContext, type ReactNode, useContext } from "react";
import { useProjectDecisions } from "./useProjectDecisions.ts";

const ProjectDecisions = createContext<ReturnType<
  typeof useProjectDecisions
> | null>(null);

export function ProjectDecisionsProvider({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const decisions = useProjectDecisions(id);
  return (
    <ProjectDecisions.Provider value={decisions}>
      {children}
    </ProjectDecisions.Provider>
  );
}

export function useProjectDecisionContext() {
  const decisions = useContext(ProjectDecisions);
  if (!decisions) throw new Error("Project decisions require a project layout");
  return decisions;
}
