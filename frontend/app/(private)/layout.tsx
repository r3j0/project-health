import { RequireSession } from "@/components/session-provider";
import { BottomNavigation } from "@/components/bottom-navigation";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <div className="authenticated-app">
        {children}
        <BottomNavigation />
      </div>
    </RequireSession>
  );
}
