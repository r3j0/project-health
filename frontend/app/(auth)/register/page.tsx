import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "회원가입" };
export default function Page() {
  return <AuthForm mode="register" />;
}
