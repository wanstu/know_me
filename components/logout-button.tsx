export function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action="/api/auth/logout" method="post" className={compact ? "logout-form logout-form--compact" : "logout-form"}>
      <button type="submit">{compact ? "退出" : "退出登录"}</button>
    </form>
  );
}
