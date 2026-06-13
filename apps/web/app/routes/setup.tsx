import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { EnrollForm } from "@/app/components/EnrollForm";

export const Route = createFileRoute("/setup")({
  validateSearch: z.object({ token: z.coerce.string().optional() }),
  component: SetupPage,
});

function SetupPage() {
  const { token } = Route.useSearch();
  return (
    <EnrollForm
      headline="OPENACME · CLAIM INSTANCE"
      blurb="First run — create the operator account, then choose an email and password."
      initialToken={token ?? ""}
      tokenHelp="Run `openacme claim` on the server (or check `openacme logs`) to print a setup link with this token filled in."
    />
  );
}
