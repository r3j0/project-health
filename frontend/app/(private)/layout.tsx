import { RequireSession } from "@/components/session-provider";
import { BottomNavigation } from "@/components/bottom-navigation";
import { UserProfileProvider } from "@/components/user-profile-provider";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <UserProfileProvider>
        <div className="authenticated-app">
          {children}
          <BottomNavigation />
        </div>
      </UserProfileProvider>
    </RequireSession>
  );
}
