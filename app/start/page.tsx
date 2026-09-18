import Link from "next/link";
import { AmbientWallpaper } from "@/components/ambient-wallpaper";
import { LogoutButton } from "@/components/logout-button";
import { StartClient } from "@/components/start/start-client";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import { getNavigationTree } from "@/lib/navigation/repository";
import { getSiteSettings } from "@/lib/settings/repository";

export const runtime = "nodejs";

export default async function StartPage() {
  const settings = getSiteSettings();
  let user = await getSessionUser();
  if (!settings.startPublic && !user) user = await requireUser("/start");

  const authenticated = Boolean(user);
  const tree = getNavigationTree(authenticated);

  return (
    <main className={"immersive-page start-page theme-" + settings.themeMode}>
      <AmbientWallpaper url={settings.startBackgroundUrl} />
      <StartClient
        initialTree={tree}
        defaultEngine={settings.defaultSearchEngine}
        authenticated={authenticated}
      />
      <div className="start-logout">
        {authenticated ? <LogoutButton compact /> : <Link className="public-login-chip" href="/login?next=%2Fstart">登录</Link>}
      </div>
    </main>
  );
}
