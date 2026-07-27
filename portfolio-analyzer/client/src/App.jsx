import React, { useState, useCallback } from "react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer
} from "recharts";
import {
  Terminal, FileText, GitCommit, Rocket, Layers, CheckCircle2,
  XCircle, Loader2, ArrowRight, RotateCcw, Github, Star
} from "lucide-react";

// ---------- design tokens ----------
const T = {
  bg: "#0B0D10",
  panel: "#14171C",
  panelBorder: "#242830",
  text: "#E7E5DF",
  textDim: "#8B8F98",
  green: "#7EE081",
  red: "#FF6B5C",
  amber: "#F2B84B",
  wash: "#1B1E24",
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Inter:wght@400;500;600&display=swap');`;

const STEPS = [
  { key: "fetching-profile", label: "resolving user  ", verb: "GET /users/:login" },
  { key: "fetching-repos", label: "listing repos    ", verb: "GET /users/:login/repos" },
  { key: "reading-readmes", label: "reading READMEs  ", verb: "GET /repos/:r/readme" },
  { key: "scoring", label: "scoring signals  ", verb: "local analysis" },
  { key: "ai-feedback", label: "drafting review  ", verb: "claude-sonnet-4-6" },
];

function decodeBase64Utf8(b64) {
  try {
    const clean = b64.replace(/\n/g, "");
    return decodeURIComponent(
      atob(clean)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    try {
      return atob(b64.replace(/\n/g, ""));
    } catch {
      return "";
    }
  }
}

function scoreColor(v) {
  if (v >= 20) return T.green;
  if (v >= 12) return T.amber;
  return T.red;
}

function computeScores(originalRepos, repoDetails) {
  const n = Math.max(repoDetails.length, 1);

  // README quality
  const withReadme = repoDetails.filter((d) => d.readme && d.readme.length > 0);
  let qualityBonus = 0;
  withReadme.forEach((d) => {
    if (d.readme.length > 500) qualityBonus += 1;
    if (/!\[.*?\]\(.*?\)/.test(d.readme)) qualityBonus += 1;
    if (/```/.test(d.readme)) qualityBonus += 1;
  });
  const readmeScore = Math.round(
    (withReadme.length / n) * 15 + Math.min(qualityBonus / (n * 3), 1) * 10
  );

  // Activity
  const now = Date.now();
  let recentActive = 0;
  let totalCommitsSampled = 0;
  repoDetails.forEach((d) => {
    totalCommitsSampled += d.commits.length;
    const lastPush = new Date(d.repo.pushed_at).getTime();
    if (now - lastPush < 1000 * 60 * 60 * 24 * 90) recentActive++;
  });
  const activityScore = Math.round(
    Math.min(recentActive / n, 1) * 15 + Math.min(totalCommitsSampled / (n * 15), 1) * 10
  );

  // Live demo presence
  const demoKeywords = /vercel\.app|netlify\.app|github\.io|herokuapp\.com|render\.com|railway\.app|surge\.sh/i;
  let withDemo = 0;
  repoDetails.forEach((d) => {
    const hasHomepage = d.repo.homepage && d.repo.homepage.trim().length > 0;
    const readmeHasDemo = d.readme && demoKeywords.test(d.readme);
    if (hasHomepage || readmeHasDemo) withDemo++;
  });
  const demoScore = Math.round((withDemo / n) * 25);

  // Stack diversity
  const languages = [...new Set(originalRepos.map((r) => r.language).filter(Boolean))];
  const stackScore = Math.round(Math.min(languages.size / 6, 1) * 25);

  const total = Math.min(readmeScore, 25) + Math.min(activityScore, 25) + demoScore + stackScore;

  return {
    readmeScore: Math.min(readmeScore, 25),
    activityScore: Math.min(activityScore, 25),
    demoScore,
    stackScore,
    total: Math.min(total, 100),
    languages,
    repoCount: originalRepos.length,
    scannedCount: n,
    withReadmeCount: withReadme.length,
    withDemoCount: withDemo,
    recentActiveCount: recentActive,
  };
}

async function getAIFeedback(userData, scoreData, repoDetails) {
  // The Claude API key lives only on our own backend (server/index.js),
  // never in the browser. This calls our server, which calls Anthropic.
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userData, scoreData, repoDetails }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "The AI review service is unavailable right now.");
  }

  return response.json();
}

export default function PortfolioAnalyzer() {
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [step, setStep] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const runAnalysis = useCallback(async (login) => {
    const uname = login.trim();
    if (!uname) return;
    setStatus("loading");
    setError("");
    setResult(null);

    try {
      setStep("fetching-profile");
      const userRes = await fetch(`https://api.github.com/users/${uname}`);
      if (userRes.status === 404) throw new Error("No GitHub user found with that username.");
      if (!userRes.ok) throw new Error("GitHub API request failed. It may be rate-limited — try again shortly.");
      const userData = await userRes.json();

      setStep("fetching-repos");
      const reposRes = await fetch(`https://api.github.com/users/${uname}/repos?per_page=100&sort=updated`);
      if (!reposRes.ok) throw new Error("Could not fetch repositories.");
      const reposData = await reposRes.json();
      const original = reposData.filter((r) => !r.fork);
      if (original.length === 0) throw new Error("This profile has no public, non-fork repositories to analyze.");

      const topRepos = [...original]
        .sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.pushed_at) - new Date(a.pushed_at))
        .slice(0, 6);

      setStep("reading-readmes");
      const repoDetails = await Promise.all(
        topRepos.map(async (repo) => {
          let readme = null;
          try {
            const r = await fetch(`https://api.github.com/repos/${uname}/${repo.name}/readme`);
            if (r.ok) {
              const d = await r.json();
              readme = decodeBase64Utf8(d.content || "");
            }
          } catch {}

          let commits = [];
          try {
            const c = await fetch(`https://api.github.com/repos/${uname}/${repo.name}/commits?per_page=30`);
            if (c.ok) commits = await c.json();
          } catch {}

          return { repo, readme, commits: Array.isArray(commits) ? commits : [] };
        })
      );

      setStep("scoring");
      const scoreData = computeScores(original, repoDetails);

      setStep("ai-feedback");
      const aiFeedback = await getAIFeedback(userData, scoreData, repoDetails);

      setResult({ userData, scoreData, aiFeedback, repoDetails });
      setStatus("done");
    } catch (e) {
      setError(e.message || "Something went wrong during analysis.");
      setStatus("error");
    }
  }, []);

  return (
    <div
      style={{
        background: T.bg,
        color: T.text,
        minHeight: "100%",
        fontFamily: "'Inter', sans-serif",
        padding: "0",
      }}
    >
      <style>{`
        ${FONT_IMPORT}
        .mono { font-family: 'JetBrains Mono', monospace; }
        .pa-input:focus { outline: 2px solid ${T.green}; outline-offset: 2px; }
        .pa-btn:focus-visible { outline: 2px solid ${T.green}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .pa-spin { animation: none !important; }
        }
        .pa-spin { animation: pa-spin 1s linear infinite; }
        @keyframes pa-spin { to { transform: rotate(360deg); } }
        .pa-blink { animation: pa-blink 1.1s steps(2) infinite; }
        @keyframes pa-blink { 50% { opacity: 0; } }
      `}</style>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 20px 64px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <Terminal size={18} color={T.green} />
          <span className="mono" style={{ fontSize: 13, color: T.textDim, letterSpacing: 0.5 }}>
            portfolio-analyzer <span style={{ color: T.green }}>v1</span>
          </span>
        </div>

        {status === "idle" || status === "loading" || status === "error" ? (
          <div>
            <h1
              className="mono"
              style={{
                fontSize: "clamp(28px, 5vw, 42px)",
                fontWeight: 800,
                lineHeight: 1.15,
                margin: "0 0 12px",
              }}
            >
              What would a client<br />see in your repos?
            </h1>
            <p style={{ color: T.textDim, fontSize: 16, maxWidth: 520, margin: "0 0 28px" }}>
              Enter a GitHub username. We'll scan public repos for README quality, commit
              activity, live demo links, and stack range — then get a straight-talking
              review from Claude.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAnalysis(username);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                background: T.panel,
                border: `1px solid ${T.panelBorder}`,
                borderRadius: 8,
                padding: "4px 4px 4px 16px",
                gap: 8,
                maxWidth: 480,
              }}
            >
              <span className="mono" style={{ color: T.green, fontSize: 15 }}>$</span>
              <input
                className="pa-input mono"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="github-username"
                disabled={status === "loading"}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  color: T.text,
                  fontSize: 15,
                  padding: "10px 0",
                }}
              />
              <button
                type="submit"
                disabled={status === "loading" || !username.trim()}
                className="pa-btn mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: username.trim() ? T.green : T.wash,
                  color: username.trim() ? "#0B0D10" : T.textDim,
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 16px",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: username.trim() ? "pointer" : "default",
                  whiteSpace: "nowrap",
                }}
              >
                {status === "loading" ? (
                  <Loader2 size={14} className="pa-spin" />
                ) : (
                  <>run <ArrowRight size={14} /></>
                )}
              </button>
            </form>

            {status === "loading" && (
              <div
                className="mono"
                style={{
                  marginTop: 24,
                  background: T.panel,
                  border: `1px solid ${T.panelBorder}`,
                  borderRadius: 8,
                  padding: 18,
                  maxWidth: 480,
                  fontSize: 13,
                }}
              >
                {STEPS.map((s, i) => {
                  const currentIdx = STEPS.findIndex((x) => x.key === step);
                  const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
                  return (
                    <div
                      key={s.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "5px 0",
                        color: state === "pending" ? T.textDim : T.text,
                        opacity: state === "pending" ? 0.4 : 1,
                      }}
                    >
                      {state === "done" && <CheckCircle2 size={14} color={T.green} />}
                      {state === "active" && <Loader2 size={14} className="pa-spin" color={T.amber} />}
                      {state === "pending" && <span style={{ width: 14, textAlign: "center" }}>·</span>}
                      <span>{s.label}</span>
                      <span style={{ color: T.textDim, fontSize: 11 }}>{s.verb}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {status === "error" && (
              <div
                className="mono"
                style={{
                  marginTop: 20,
                  color: T.red,
                  background: "#1F1414",
                  border: `1px solid ${T.red}44`,
                  borderRadius: 8,
                  padding: "12px 16px",
                  maxWidth: 480,
                  fontSize: 13,
                }}
              >
                error: {error}
              </div>
            )}
          </div>
        ) : (
          <Results result={result} onReset={() => { setStatus("idle"); setResult(null); setUsername(""); }} />
        )}
      </div>
    </div>
  );
}

function Results({ result, onReset }) {
  const { userData, scoreData, aiFeedback, repoDetails } = result;
  const s = scoreData;

  const radarData = [
    { category: "README", value: s.readmeScore, full: 25 },
    { category: "Activity", value: s.activityScore, full: 25 },
    { category: "Live demo", value: s.demoScore, full: 25 },
    { category: "Stack range", value: s.stackScore, full: 25 },
  ];

  const strengths = radarData.filter((d) => d.value >= 18).length;
  const gaps = radarData.filter((d) => d.value < 12).length;

  return (
    <div>
      {/* Commit-style summary bar */}
      <div className="mono" style={{ fontSize: 12, color: T.textDim, marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 14 }}>
        <span>{userData.login}</span>
        <span>·</span>
        <span>{s.scannedCount} repos scanned</span>
        <span>·</span>
        <span style={{ color: T.green }}>+{strengths} strength{strengths === 1 ? "" : "s"}</span>
        <span style={{ color: T.red }}>-{gaps} gap{gaps === 1 ? "" : "s"}</span>
      </div>

      {/* Score header */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: scoreColor(Math.round(s.total / 4)) }}>
          {s.total}
        </span>
        <span className="mono" style={{ fontSize: 16, color: T.textDim, paddingBottom: 8 }}>/ 100</span>
      </div>
      <p style={{ color: T.textDim, fontSize: 15, maxWidth: 560, marginBottom: 28 }}>
        {aiFeedback.summary}
      </p>

      {/* Radar + categories */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 24, marginBottom: 32 }}>
        <div style={{ background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: 10, padding: 16, height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="70%">
              <PolarGrid stroke={T.panelBorder} />
              <PolarAngleAxis dataKey="category" tick={{ fill: T.textDim, fontSize: 12, fontFamily: "JetBrains Mono" }} />
              <PolarRadiusAxis domain={[0, 25]} tick={false} axisLine={false} />
              <Radar dataKey="value" stroke={T.green} fill={T.green} fillOpacity={0.25} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <CategoryCard icon={<FileText size={15} />} label="README quality" value={s.readmeScore} note={aiFeedback.categoryNotes?.readme} />
          <CategoryCard icon={<GitCommit size={15} />} label="Commit activity" value={s.activityScore} note={aiFeedback.categoryNotes?.activity} />
          <CategoryCard icon={<Rocket size={15} />} label="Live demo presence" value={s.demoScore} note={aiFeedback.categoryNotes?.demo} />
          <CategoryCard icon={<Layers size={15} />} label="Stack range" value={s.stackScore} note={aiFeedback.categoryNotes?.stack} />
        </div>
      </div>

      {/* Quick wins as diff */}
      {aiFeedback.quickWins && aiFeedback.quickWins.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <SectionLabel>quick wins</SectionLabel>
          <div style={{ background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: 10, overflow: "hidden" }}>
            {aiFeedback.quickWins.map((w, i) => (
              <div
                key={i}
                className="mono"
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "12px 16px",
                  fontSize: 13.5,
                  borderTop: i > 0 ? `1px solid ${T.panelBorder}` : "none",
                  background: i % 2 === 0 ? "transparent" : T.wash,
                }}
              >
                <span style={{ color: T.green, fontWeight: 700 }}>+</span>
                <span style={{ color: T.text }}>{w}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repo breakdown */}
      <div style={{ marginBottom: 8 }}>
        <SectionLabel>repos scanned</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {repoDetails.map((d) => {
            const hasReadme = !!(d.readme && d.readme.length > 0);
            const hasDemo = !!(d.repo.homepage && d.repo.homepage.trim());
            return (
              <div
                key={d.repo.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                  background: T.panel,
                  border: `1px solid ${T.panelBorder}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Github size={14} color={T.textDim} style={{ flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{d.repo.name}</span>
                  {d.repo.language && (
                    <span className="mono" style={{ fontSize: 11, color: T.textDim }}>{d.repo.language}</span>
                  )}
                  {d.repo.stargazers_count > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 3, color: T.amber, fontSize: 11 }}>
                      <Star size={11} fill={T.amber} /> {d.repo.stargazers_count}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 14 }}>
                  <MiniFlag ok={hasReadme} label="README" />
                  <MiniFlag ok={hasDemo} label="demo link" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={onReset}
        className="pa-btn mono"
        style={{
          marginTop: 28,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          color: T.textDim,
          border: `1px solid ${T.panelBorder}`,
          borderRadius: 6,
          padding: "9px 14px",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        <RotateCcw size={13} /> analyze another profile
      </button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="mono" style={{ fontSize: 11, color: T.textDim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
      {children}
    </div>
  );
}

function CategoryCard({ icon, label, value, note }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: T.textDim }}>
          {icon}
          <span style={{ fontSize: 12.5 }}>{label}</span>
        </div>
        <span className="mono" style={{ fontWeight: 700, fontSize: 15, color: scoreColor(value) }}>
          {value}<span style={{ color: T.textDim, fontWeight: 400, fontSize: 11 }}>/25</span>
        </span>
      </div>
      <div style={{ height: 4, background: T.wash, borderRadius: 2, overflow: "hidden", marginBottom: note ? 8 : 0 }}>
        <div style={{ width: `${(value / 25) * 100}%`, height: "100%", background: scoreColor(value) }} />
      </div>
      {note && <p style={{ fontSize: 12, color: T.textDim, margin: 0, lineHeight: 1.4 }}>{note}</p>}
    </div>
  );
}

function MiniFlag({ ok, label }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: ok ? T.green : T.red }}>
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {label}
    </span>
  );
}
