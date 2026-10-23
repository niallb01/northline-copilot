/**
 * Plain home page for the local app shell. It confirms the Next.js server is
 * running. It does not look up accounts, list charges, queue refunds, or call
 * a model.
 */

export default function HomePage() {
  return (
    <main>
      <h1>Northline Copilot</h1>
      <p>The app shell is running.</p>
    </main>
  );
}
