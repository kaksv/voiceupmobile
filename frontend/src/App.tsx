import { useEffect, useState } from "react";

const TOKEN_KEY = "momo_admin_token";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [health, setHealth] = useState<string>("");
  const [question, setQuestion] = useState(
    "Summarize pilot activity and call out anything worth investigating."
  );
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/health")
      .then((r) => r.json())
      .then((j) => setHealth(JSON.stringify(j, null, 2)))
      .catch(() => setHealth("(could not reach /health — start API on :3000 or use dev proxy)"));
  }, []);

  function persistToken(t: string) {
    setToken(t);
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function askAi() {
    setError("");
    setAnswer("");
    const t = token.trim();
    if (!t) {
      setError("Paste your admin token first.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai/insights", {
        method: "POST",
        headers: authHeaders(t),
        body: JSON.stringify({ message: question }),
      });
      const data = (await res.json()) as {
        answer?: string;
        error?: string;
        detail?: string;
        model?: string;
      };
      if (!res.ok) {
        setError(data.detail ?? data.error ?? res.statusText);
        return;
      }
      setAnswer(data.answer ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-6">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-400/90">
            MoMo voice pilot
          </p>
          <h1 className="text-2xl font-semibold text-white">Operator dashboard</h1>
          <p className="text-sm text-slate-400">
            AI uses <span className="text-slate-300">aggregated Postgres context</span> only — no API
            keys in the browser. Classic tables:{" "}
            <a
              href="/admin"
              className="text-emerald-400 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-300"
            >
              /admin
            </a>
            .
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-sm font-medium text-slate-300">API health</h2>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
            {health || "…"}
          </pre>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <label className="block text-sm font-medium text-slate-300">
            Admin token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => persistToken(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="Same as ADMIN_TOKEN on the server"
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">
            Stored only in this browser (localStorage). Sent as{" "}
            <code className="rounded bg-slate-950 px-1 text-slate-400">Authorization: Bearer</code>.
          </p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-sm font-medium text-slate-300">Ask OpenAI (ops)</h2>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => void askAi()}
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? "Thinking…" : "Get insights"}
          </button>
          {error ? (
            <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}
          {answer ? (
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs font-medium uppercase text-slate-500">Response</p>
              <div className="prose prose-invert mt-2 max-w-none whitespace-pre-wrap text-sm text-slate-200">
                {answer}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
