require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const MODEL = "claude-sonnet-5";

function buildPrompt(userData, scoreData, repoDetails) {
  const repoSummaries = (repoDetails || []).map((d) => ({
    name: d.repo.name,
    description: d.repo.description,
    language: d.repo.language,
    hasReadme: !!(d.readme && d.readme.length > 0),
    hasHomepage: !!(d.repo.homepage && d.repo.homepage.trim()),
    stars: d.repo.stargazers_count,
    lastPushed: d.repo.pushed_at,
    commitsSampled: (d.commits || []).length,
  }));

  return `You are reviewing a developer's public GitHub profile the way a hiring manager or freelance client would, in 15 seconds of skimming. Be direct, specific, and concrete. Never invent facts not present in the data below.

Profile: ${userData.login}, ${userData.public_repos} public repos, bio: "${userData.bio || "none"}"

Deterministic scores (already computed, do not change them):
- README quality: ${scoreData.readmeScore}/25
- Commit activity: ${scoreData.activityScore}/25
- Live demo presence: ${scoreData.demoScore}/25
- Tech stack diversity: ${scoreData.stackScore}/25 (languages: ${scoreData.languages.join(", ") || "none detected"})
- Total: ${scoreData.total}/100

Top repos analyzed:
${JSON.stringify(repoSummaries, null, 2)}

Return ONLY valid JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "summary": "one or two sentences, direct, like a reviewer's first impression",
  "quickWins": ["specific action 1", "specific action 2", "specific action 3"],
  "categoryNotes": {
    "readme": "one short sentence",
    "activity": "one short sentence",
    "demo": "one short sentence",
    "stack": "one short sentence"
  }
}`;
}

app.post("/api/feedback", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
    }
    const { userData, scoreData, repoDetails } = req.body;
    if (!userData || !scoreData) {
      return res.status(400).json({ error: "Missing userData or scoreData in request body." });
    }

    const prompt = buildPrompt(userData, scoreData, repoDetails);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(502).json({ error: "The AI review service returned an error." });
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const cleaned = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        summary: "The reviewer's notes came back in an unexpected format.",
        quickWins: [],
        categoryNotes: {},
        raw: text,
      };
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate AI feedback." });
  }
});

// Serve the built React app in production
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
