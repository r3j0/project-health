"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, UserRound } from "lucide-react";

export function BottomNavigation() {
  const pathname = usePathname();
  if (pathname === "/onboarding") return null;
  const theme = pathname.startsWith("/onboarding/")
    ? " kspo-sky-theme"
    : pathname === "/account" || pathname === "/account/preferences"
      ? " kspo-orange-theme"
      : "";
  const tabs = [
    { href: "/", label: "메인", icon: House, active: pathname === "/" },
    {
      href: "/account",
      label: "내 프로필",
      icon: UserRound,
      active:
        pathname === "/account" ||
        pathname.startsWith("/account/") ||
        pathname.startsWith("/measurements"),
    },
  ];

  return (
    <nav className={`bottom-navigation${theme}`} aria-label="하단 메뉴">
      {tabs.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          className="bottom-tab"
          aria-current={
            active ? (pathname === href ? "page" : "location") : undefined
          }
        >
          <Icon size={22} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
