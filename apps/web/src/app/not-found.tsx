export default function NotFound() {
  return (
    <main className="empty-page">
      <span className="eyebrow">如文工作室</span>
      <h1>这一页不在这里。</h1>
      <p>资源不存在，或当前账户没有访问权限。</p>
      <a className="button" href="/projects">
        回到我的项目
      </a>
    </main>
  );
}
