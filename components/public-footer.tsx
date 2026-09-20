import type { SiteSettings } from "@/lib/settings/repository";

function safeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  return "";
}

function external(value: string) {
  return /^https?:\/\//i.test(value);
}

export function PublicFooter({ settings }: { settings: SiteSettings }) {
  const friends = settings.friendLinks
    .filter((item) => item.visible)
    .map((item) => ({ ...item, href: safeHref(item.url) }))
    .filter((item) => item.name && item.href);

  const icpHref = safeHref(settings.icpUrl);
  const policeHref = safeHref(settings.policeUrl);

  return (
    <footer className="public-footer">
      <div className="public-footer-main">
        <strong>{settings.profileName || "Know Me"}</strong>
        {settings.footerText.trim() ? <span>{settings.footerText}</span> : null}
      </div>

      <div className="public-footer-meta">
        {settings.showIcp && settings.icpNumber.trim() ? (
          icpHref ? <a href={icpHref} target={external(icpHref) ? "_blank" : undefined} rel={external(icpHref) ? "noreferrer" : undefined}>{settings.icpNumber}</a> : <span>{settings.icpNumber}</span>
        ) : null}
        {settings.showPolice && settings.policeNumber.trim() ? (
          policeHref ? <a href={policeHref} target={external(policeHref) ? "_blank" : undefined} rel={external(policeHref) ? "noreferrer" : undefined}>{settings.policeNumber}</a> : <span>{settings.policeNumber}</span>
        ) : null}
        {settings.showFriendLinks && friends.length ? (
          <nav aria-label="友情链接">
            <b>友情链接</b>
            {friends.map((item) => (
              <a key={item.id} href={item.href} target={external(item.href) ? "_blank" : undefined} rel={external(item.href) ? "noreferrer" : undefined}>
                {item.name}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
