import { SignIn } from "../../components/SignIn.tsx";
import { getServices } from "../../server/services.ts";
export const dynamic = "force-dynamic";
export default async function SignInPage() {
  const services = await getServices();
  return (
    <SignIn
      preview={services.environment.preview}
      google={Boolean(services.environment.googleClientId)}
    />
  );
}
