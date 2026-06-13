import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { EnrollForm } from "@/app/components/EnrollForm";

export const Route = createFileRoute("/enroll")({
  validateSearch: z.object({ token: z.coerce.string().optional() }),
  component: EnrollPage,
});

function EnrollPage() {
  const { token } = Route.useSearch();
  return (
    <EnrollForm
      headline="OPENACME · JOIN"
      blurb="You've been invited. Choose an email and password to create your account."
      initialToken={token ?? ""}
      tokenHelp="Use the invite link you were given — it includes this token. Ask whoever runs the instance to send you one (`openacme invite`)."
    />
  );
}
