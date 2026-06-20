// Vercel serverless function: the "grill me" coach for lessons/phase-1-grill-me.html.
//
// It proxies to an OpenAI-compatible chat API so the key never reaches the browser.
// Defaults to OpenRouter with a FREE model — start free, upgrade later by changing
// env vars only (no code change). See .env.example.
//
//   GRILL_API_KEY   provider key (OpenRouter: sk-or-...). Also reads OPENROUTER_API_KEY.
//   GRILL_BASE_URL  default https://openrouter.ai/api/v1
//   GRILL_MODEL     default meta-llama/llama-3.3-70b-instruct:free
//
// To move to paid Claude later: keep this code, set
//   GRILL_MODEL=anthropic/claude-sonnet-4-6   (still via OpenRouter, OpenAI-compatible)
//
// POST body:
//   { mode: "grill" | "summary",
//     context: { name: string, qa: [{ q: string, a: string }] },
//     messages: [{ role: "user" | "assistant", content: string }] }
// Response: { text: string }  (or { error: string } with a non-200 status)
//
// AUTH: this endpoint is gated. The caller must have a valid Better Auth
// session (an allow-listed Crew member signed in via magic link). Unauthenticated
// requests get 401 so the lesson page can bounce them to /login.

import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth.js';

const MAX_MESSAGES = 60;   // keep the transcript bounded
const MAX_CHARS = 6000;    // per message

const API_KEY = process.env.GRILL_API_KEY || process.env.OPENROUTER_API_KEY;
const BASE_URL = (process.env.GRILL_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.GRILL_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

function buildContextBlock(context) {
  const name = String(context?.name || '').slice(0, 80).trim();
  const qa = Array.isArray(context?.qa) ? context.qa : [];
  const lines = [];
  if (name) lines.push(`The young game designer's name is ${name}.`);
  const answered = qa.filter((p) => p && String(p.a || '').trim());
  if (answered.length) {
    lines.push("Here is what they wrote during the question-card session. This is your raw material — refer to it, quote it back, and build your questions from it:");
    for (const { q, a } of answered) {
      const qq = String(q || '').slice(0, 300).trim();
      const aa = String(a || '').slice(0, 1000).trim();
      lines.push(`• Q: ${qq}\n  A: ${aa}`);
    }
  } else {
    lines.push("They haven't shared specific card answers yet, so begin by asking them to describe their game idea in their own words, then grill from there.");
  }
  return lines.join('\n');
}

const grillSystem = (ctx) => `You are a friendly but sharp game-design coach running a "grill me" session for a young person (roughly 8 to 14 years old) at a small code club in Wales. They have already brainstormed a game idea using a deck of question cards. Your job is to interview them relentlessly — but kindly — until their game design is clear, focused, and small enough to actually build.

${ctx}

HOW TO GRILL:
- Ask exactly ONE question at a time, then stop and wait for their answer. Never ask two questions in one message.
- Walk down the decision tree: each answer opens the next question. Finish one branch before jumping to another topic.
- When an answer is vague ("a fun game", "lots of stuff", "it's cool"), push for specifics — what exactly, how, what happens when...?
- For every question, also offer YOUR recommended answer so they have something to react to. Phrase it like: "If it were me, I'd ___ — what do you reckon?"
- Steer relentlessly toward making the game SMALLER and more BUILDABLE: the core loop (the thing you do over and over), the one main action/button, how you win or lose, and the smallest version they could finish.
- Be kid-friendly: short sentences, no technical jargon, warm and encouraging. Use their game's own words.
- If they say "I don't know" or go quiet, offer 2 or 3 concrete options for them to pick from.
- Never lecture. One short reaction plus one question per turn — a few sentences at most. No long paragraphs, no bullet lists in your replies.

Start now: greet them by name, reflect the gist of their game back in one sentence so they know you've read their cards, then ask your first sharp question. Keep your whole message short.`;

const summarySystem = (ctx) => `You are turning a young game designer's "grill me" session into a structured game plan. The designer is roughly 8 to 14 years old, at a code club. Base every field ONLY on what they actually said (their card answers + the conversation) — do not invent features they never mentioned. Keep the language simple, concrete, and exciting for a kid.

${ctx}

Respond with ONLY a single JSON object — no prose, no Markdown, no code fences. Use exactly these keys:
{
  "gameName": "a short, punchy name for the game (invent one from their idea if they didn't give one)",
  "tagline": "one short, exciting sentence that sells the game",
  "bigIdea": "1-2 sentences: what the game is",
  "coreLoop": "the main thing the player does over and over",
  "mainAction": "the single most important button or move",
  "howYouWin": "how you win, or that it's endless and what keeps you playing",
  "v1": "the smallest playable version to build first - be concrete",
  "notInV1": ["3 to 5 cool things to leave out of the first build"],
  "nextStep": "one specific thing to do next to start building",
  "hypeLine": "one short, high-energy cheer to get them excited to build it"
}

All values are plain strings except notInV1, which is an array of short strings. Output the JSON object and nothing else.`;

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Gate: require a signed-in, allow-listed Crew member.
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) {
      res.status(401).json({ error: 'Please sign in to use the coach.', code: 'UNAUTHENTICATED' });
      return;
    }
  } catch (err) {
    console.error('grill auth check failed:', err);
    res.status(401).json({ error: 'Please sign in to use the coach.', code: 'UNAUTHENTICATED' });
    return;
  }

  if (!API_KEY) {
    res.status(503).json({ error: 'The grilling coach is not switched on yet (no API key configured).' });
    return;
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const mode = body.mode === 'summary' ? 'summary' : 'grill';
    const context = body.context || {};
    let convo = sanitizeMessages(body.messages);
    const ctxBlock = buildContextBlock(context);
    const system = mode === 'summary' ? summarySystem(ctxBlock) : grillSystem(ctxBlock);

    if (mode === 'grill') {
      // The coach speaks first, so seed an invisible kickoff turn if needed.
      if (convo.length === 0 || convo[0].role !== 'user') {
        convo = [{ role: 'user', content: "Hi! I'm ready — start grilling me about my game." }, ...convo];
      }
    } else {
      if (convo.length === 0) {
        convo = [{ role: 'user', content: 'Here is my game idea — please write up my plan.' }];
      }
      convo = [...convo, { role: 'user', content: 'We are done grilling. Write up my final game plan now, following your instructions exactly.' }];
    }

    // OpenAI-compatible chat-completions shape: system prompt is the first message.
    const messages = [{ role: 'system', content: system }, ...convo];

    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        // Optional OpenRouter attribution headers (ignored by other providers):
        'HTTP-Referer': 'https://codeclub.wales',
        'X-Title': 'Code Club Wales Grill Me',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: mode === 'summary' ? 1800 : 700,
        temperature: mode === 'summary' ? 0.6 : 0.8,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('grill upstream error', upstream.status, detail.slice(0, 500));
      res.status(502).json({ error: 'The coach had a hiccup. Give it a moment and try again.' });
      return;
    }

    const data = await upstream.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      console.error('grill empty response', JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: 'The coach went quiet. Try sending that again.' });
      return;
    }

    res.status(200).json({ text });
  } catch (err) {
    console.error('grill error:', err);
    res.status(500).json({ error: 'The coach had a hiccup. Give it a moment and try again.' });
  }
};
