import type { CSSProperties } from "react";
import Link from "next/link";
import { AmbientWallpaper } from "@/components/ambient-wallpaper";
import { LogoutButton } from "@/components/logout-button";
import { PublicFooter } from "@/components/public-footer";
import { StartClient } from "@/components/start/start-client";
import { requirePageAccess } from "@/lib/settings/require-page-access";
import { getNavigationTree } from "@/lib/navigation/repository";

import { themeClass } from "@/lib/settings/theme";

export const runtime = "nodejs";

export default async function StartPage() {
  const { settings, user } = await requirePageAccess("/start", "/start");

  const authenticated = Boolean(user);
  const tree = getNavigationTree(authenticated);
  const startStyle = {
    "--start-card-alpha": String(settings.startCardOpacity / 100),
    "--start-card-radius": settings.startCardRadius + "px",
    "--wallpaper-dim": String(settings.startBackgroundDim / 100)
  } as CSSProperties;

  return (
    <main className={"immersive-page start-page " + themeClass(settings)} style={startStyle}>
      <AmbientWallpaper url={settings.startBackgroundUrl} />
      <StartClient
        initialTree={tree}
        defaultEngine={settings.defaultSearchEngine}
        authenticated={authenticated}
        density={settings.startDensity}
        rememberLastTab={settings.startRememberLastTab}
        wheelSwitchTabs={settings.startWheelSwitchTabs}
      />
      <div className="start-logout">
        {authenticated ? <LogoutButton compact /> : <Link className="public-login-chip" href="/login?next=%2Fstart">登录</Link>}
      </div>
      <PublicFooter settings={settings} />
    </main>
  );
}
