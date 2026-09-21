import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "로그인" };
export default function Page() {
  return <AuthForm mode="login" />;
}
