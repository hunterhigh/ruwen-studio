import { notFoundCopy as copy } from "../copy/zh-CN.ts";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-paper" aria-labelledby="not-found-title">
        <h1 id="not-found-title">{copy.title}</h1>
        <p>{copy.description}</p>
        <a className="ui-btn ui-btn-primary" href="/projects">
          {copy.shelf}
        </a>
      </section>
    </main>
  );
}
