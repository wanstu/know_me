import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/request";
import { getSiteSettings } from "@/lib/settings/repository";
import { themeClass } from "@/lib/settings/theme";

export const runtime = "nodejs";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(first(params.next), "/admin");
  const user = await getSessionUser();
  if (user) redirect(nextPath);

  const error = first(params.error);
  const settings = getSiteSettings();

  return (
    <main className={"login-page " + themeClass(settings)}>
      <div className="ambient-wallpaper" aria-hidden="true" />
      <section className="glass-card login-card">
        <div className="eyebrow">Private Area</div>
        <h1>登录 know_me</h1>
        <p className="muted">登录后可以进入浏览器起始页和管理后台。</p>

        {error === "invalid_credentials" ? (
          <div className="login-error" role="alert">用户名或密码不正确。</div>
        ) : null}
        {error === "rate_limited" ? (
          <div className="login-error" role="alert">失败次数过多，请稍后再试。</div>
        ) : null}

        <form action="/api/auth/login" method="post" className="login-form">
          <input type="hidden" name="next" value={nextPath} />
          <label>
            <span>用户名</span>
            <input name="username" autoComplete="username" required autoFocus />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">登录</button>
        </form>

        <Link href="/" className="login-back">← 返回个人主页</Link>
      </section>
    </main>
  );
}
