# Metacognitive message × AI assistance: fractions study

Extension of Grace Liu's fractions experiment (this repo is a fork of `graliuce/ai_assistance_experiments` at commit `3a59afc`; entry point `app_fractions.js`). The task, items, block structure, AI and hints panels, and instructions are hers. What is new is a per-problem metacognitive message, crossed with her AI vs. control manipulation, plus measures for covert outside-AI use and the plumbing for UCI SONA and Prolific.

## 1. Design

**Procedure (unchanged from Grace).** Consent → 3 pretest problems (no help, solution shown after a wrong answer or skip) → condition instructions → 11 practice problems in three difficulty blocks (3 easy, 4 medium, 4 hard; order shuffled within block) with either a ChatGPT panel (AI) or a static fractions reference panel (control) → 3 test problems with no help for anyone, fixed order → attention check → AI-use question (AI cells only) → bot check.

**Manipulation.** 2 (assistance: AI vs. control) × 2 (message: present vs. absent), between subjects, balanced and sticky assignment (see §3). In message cells, every practice problem opens behind a full-screen card:

> **Before you start this problem**
> This problem is a chance to practice and learn something. We really care about your learning, not only about whether you get the right answer.

The Start button unlocks after 2.5 s so the card cannot be clicked through unread, and the problem timer starts when the card is dismissed, so `completion_time_ms` is comparable across cells. The text is identical in the AI and control cells and deliberately does not mention AI: the AI instructions still say "feel free to ask it for hints, answers, or solutions," so the manipulation targets goal orientation, not permission. That keeps the contrast clean (a message that said "try it yourself before asking the AI" would be an instruction, not a metacognitive prompt).

**Where the message appears.** Default `METACOG_PHASES=initial`: practice problems only, not the pretest (baseline must be pre-treatment) and not the 3 test problems. Showing it at test would mix "learned more during practice" with "tried harder at test because we just told them we care," which is exactly the ambiguity the test block exists to remove. If you want it literally before every problem, set `METACOG_PHASES=initial,final` and treat final-block differences as learning plus test-time effort.

**Optional tighter control.** `NEUTRAL_START_SCREEN=true` gives the no-message cells a content-free "Press Start when you are ready" card on the same problems, so the only difference between cells is the message content. Off by default to keep the no-message cells an exact replication.

**Outcomes.**
- Primary (learning/persistence): test-block accuracy and skip rate, per problem.
- Primary (mechanism, AI cells): how the chat is used on practice problems: share of problems where the first user message asks for the answer, latency to first chat message, number of turns, whether the participant entered an answer before opening the chat. All derivable from the timestamped `chat_logs`.
- Practice-block accuracy, skip rate, and time.
- Self-report: learning vs. "get it done" orientation (1–7), effort (1–7), manipulation check (what did the study say the researchers cared about), outside-tool use.
- Integrity per problem: `blur_count`, `hidden_count`, `hidden_ms` (tab switches), `copy_attempts`, `paste_attempts`, `contextmenu_attempts`.

**Hypotheses (suggested for pre-registration).**
- H1 (replication): AI < control on test accuracy.
- H2 (message within AI): `ai_metacog` > `ai` on test accuracy and < on test skips.
- H3 (mechanism): `ai_metacog` asks for direct answers on a smaller share of practice problems than `ai`.
- Exploratory: message effect in control; AI × message interaction; covert-AI indicators by cell.

**Power, from Grace's data** (`data/exp2`, the run that matches this code, N = 666). Participant-level test accuracy was 0.670 (AI, n = 348) vs. 0.734 (control, n = 318), pooled SD 0.365, d ≈ 0.17; skip rate 0.111 vs. 0.088, d ≈ 0.09. At α = .05, 80% power, two-sided, a pairwise contrast needs about 544 per cell for d = 0.17, 252 for d = 0.25, 175 for d = 0.30. An interaction the size of the whole AI–control gap needs roughly 1,000+ per cell, so do not make the interaction confirmatory. Make H2 and H3 the confirmatory tests, use pretest accuracy as a covariate (mixed-effects logistic: `solved ~ ai * metacog + pretest_acc + (1|participant) + (1|item)` on test items), and expect H3 (a behavioural shift in the chat) to be the best-powered test. If N is tight, run `ARMS=ai,ai_metacog,control` (drop `control_metacog`) or even `ai,ai_metacog`.

**Exclusions (suggested).** Failed bot check (≠ 6 fingers); attention check ≠ 10; `start_number` > 1 (reloaded and restarted; their assignment is unchanged but they saw items twice); non-desktop. Self-reported outside-AI use and high `hidden_ms` are post-treatment, so use them for sensitivity analyses rather than primary exclusions, and report by cell.

## 2. Changes relative to Grace's code (all deliberate)

| Change | Why |
|---|---|
| Message overlay, 2×2 cells | The manipulation. |
| **Chat now receives the problem** (`AI_SEES_PROBLEM=true`) | In the released code `chat.js` calls `window.getReadingChatContext()`, which the fractions page never defines, so the model got no problem context even though its greeting says "I can already see the problem." Her exp2 logs contain replies like "You'll need to type your math problems here so I can see them." **Ask Grace which behaviour her published fractions data had.** Set `AI_SEES_PROBLEM=false` to reproduce the released behaviour exactly. |
| Server-side balanced, sticky assignment | `Math.random()` on page load re-rolled the condition on refresh (participants could refresh into the AI arm) and gives unbalanced cells at modest N. |
| Per-trial saving (`/trial-data`) | Grace's code only saved at the very end, so dropouts vanished. Attrition by cell matters here (the message could change who quits). |
| Copy/cut/paste/right-click blocked on problem pages, MathJax menu off | Grace's suggestion; also, MathJax's right-click menu offers "Copy to clipboard → TeX," which bypasses copy blocking. Attempts are counted. Applies to all cells (`BLOCK_COPY_PASTE=false` to turn off). |
| Tab-switch logging per problem | Grace's "click_out" idea, which was not in the released code. |
| Post-test surveys (goal orientation, effort, manipulation check, outside-tool self-report) | Come after the test block, so they cannot affect the outcomes. |
| "Your payment **or course credit** does NOT depend…" | SONA participants are paid in credit. |
| UCI consent and debrief | Templates with `[BRACKETED]` fields to replace with the IRB-approved text. |
| `plugin-survey-html-form` pinned to `@1.0.3` | The unpinned unpkg URL now resolves to v2.x, which targets jsPsych 8, not the 7.3.2 the page loads. |
| Chat model `gpt-5.6-sol` instead of `gpt-5-chat-latest` | OpenAI shut down `gpt-5-chat-latest` (and every other `*-chat-latest` model) and lists `gpt-5.6-sol` as the replacement. Grace's AI arm therefore cannot be reproduced exactly; report this as a deviation. Set `OPENAI_MODEL` to change it. |
| Save retries; failure goes to the finish page instead of restarting the study at `/` | The original sent a participant back to the consent page on a failed save. |
| Prolific / SONA redirects on the finish page | §4. |

## 3. Running locally

```
npm install
cp .env.example .env      # fill in OPENAI_API_KEY; leave CONNECTION empty to save to ./local_data/*.jsonl
npm start
```

Open `http://localhost:3000/` (or `/?PROLIFIC_PID=test1`, `/?sona_id=test1`). Without an ID, a random local ID is kept in the browser, so reuse an incognito window to see a new assignment. To preview one cell, start with e.g. `ARMS=ai_metacog npm start`.

**Data.** MongoDB collections: `entries` (one document per completed session, same format as Grace's: `data.trials[]`), `trials` (one document per finished trial, including dropouts), `assignments` (participant key → cell, number of starts). Puzzle trials have `stimulus_type: 'fractions_puzzle'`; every trial carries `cell`, `no_ai_condition`, `metacog_condition`, `recruitment_source`, `participant_key`, `start_number`.

## 4. Deploying and recruiting

**MongoDB Atlas.** Create a free cluster, a database user, and allow network access from `0.0.0.0/0` (Render has no fixed IP). Copy the `mongodb+srv://…` string into `CONNECTION`.

**Render.** Push this folder to a private GitHub repo → Render → New Web Service → that repo. Build command `npm install`, start command `node app_fractions.js`, and add the variables from `.env.example` in the Environment tab. Free instances sleep when idle and take a while to wake, so use a paid instance while collecting data. Set a spending limit on the OpenAI key.

**Prolific.**
1. Study URL: `https://YOUR-APP.onrender.com/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}` and choose "I'll use URL parameters."
2. Completion path: redirect. Copy the completion code into `PROLIFIC_COMPLETION_CODE` and redeploy. The finish page shows the debrief and a "Return to Prolific" button, and redirects automatically after 60 s.
3. Device: desktop only. Screeners matching Grace's posting (US, fluent English).
4. Run a pilot of ~20, check `entries` and `trials`, then launch.

**UCI SONA** (`uci.sona-systems.com`, run by the UCI Human Subjects Lab; you need the IRB approval number to post).
1. Create an online external study. Study URL: `https://YOUR-APP.onrender.com/?sona_id=%SURVEY_CODE%`.
2. Save; SONA then shows a client-side completion URL like `https://uci.sona-systems.com/webstudy_credit.aspx?experiment_id=123&credit_token=abc…&survey_code=XXXX`. Put `experiment_id` in `SONA_EXPERIMENT_ID` and `credit_token` in `SONA_CREDIT_TOKEN`; the app fills in `survey_code`.
3. Use SONA's test link to confirm credit is granted automatically.

**Separate samples.** Run SONA and Prolific as separate waves with different `STUDY_VERSION` values (e.g. `metacog_sona_v1`, `metacog_prolific_v1`) so each sample is balanced across cells on its own, and analyse source as a factor.

**Before launch.** Replace every `[BRACKETED]` field in the consent (`public/views/fractions_experiment.html`, `consentPage`) and debrief (`public/views/finish.html`) with the IRB-approved text. The consent withholds the hypotheses and the debrief discloses them, so make sure the protocol covers incomplete disclosure.
