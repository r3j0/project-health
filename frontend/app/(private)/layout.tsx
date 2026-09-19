import { RequireSession } from "@/components/session-provider";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}
