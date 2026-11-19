require('dotenv').config();

// ---------------------------------------------------------------------------
// Fractions experiment server.
// Based on Grace Liu's app_fractions.js (graliuce/ai_assistance_experiments).
// Additions for the metacognitive-message study:
//   * /assign            balanced, sticky assignment to experimental cells
//   * /trial-data        per-trial saving (so dropouts are not lost)
//   * /experiment-data   end-of-session save (unchanged format, plus metadata)
//   * /finish            debrief + redirect to Prolific or UCI SONA
//   * local JSONL fallback when no MongoDB connection string is set
// ---------------------------------------------------------------------------

var express = require('express'),
    mongoose = require('mongoose'),
    body_parser = require('body-parser'),
    axios = require('axios'),
    fs = require('fs'),
    path = require('path');

var app = express();

// --- STUDY CONFIGURATION (all overridable from environment variables) -------
const ALL_CELLS = {
  ai:              { cell: 'ai',              no_ai_condition: false, metacog: false },
  ai_metacog:      { cell: 'ai_metacog',      no_ai_condition: false, metacog: true  },
  control:         { cell: 'control',         no_ai_condition: true,  metacog: false },
  control_metacog: { cell: 'control_metacog', no_ai_condition: true,  metacog: true  }
};

const CELLS = (process.env.ARMS || 'ai,ai_metacog,control,control_metacog')
  .split(',').map(s => s.trim()).filter(s => ALL_CELLS[s]);
if (CELLS.length === 0) throw new Error('ARMS must list at least one of: ' + Object.keys(ALL_CELLS).join(', '));

const STUDY_CONFIG = {
  arms: CELLS,
  study_version: process.env.STUDY_VERSION || 'metacog_v1',
  // Which phases show the metacognitive message: any of pretest, initial, final
  metacog_phases: (process.env.METACOG_PHASES || 'initial').split(',').map(s => s.trim()),
  metacog_title: process.env.METACOG_TITLE || 'Before you start this problem',
  metacog_text: process.env.METACOG_TEXT ||
    'This problem is a chance to practice and learn something. ' +
    'We really care about your learning, not only about whether you get the right answer.',
  metacog_min_ms: parseInt(process.env.METACOG_MIN_MS || '2500', 10),
  block_copy_paste: (process.env.BLOCK_COPY_PASTE || 'true') === 'true',
  // In Grace's released code the chat widget never sent the problem to the model
  // (chat.js looked for getReadingChatContext, which the fractions page does not define),
  // even though the greeting says "I can already see the problem". true = fixed behaviour.
  ai_sees_problem: (process.env.AI_SEES_PROBLEM || 'true') === 'true',
  // Show a content-free "Start problem" screen in the no-message cells, so the only
  // difference between message and no-message cells is the message itself.
  neutral_start_screen: (process.env.NEUTRAL_START_SCREEN || 'false') === 'true'
};

// --- STORAGE: MongoDB if configured, otherwise local JSONL files -----------
const connectionString = process.env.CONNECTION || process.env.MONGODB_URI;
const USE_MONGO = !!connectionString;
const LOCAL_DIR = path.join(__dirname, 'local_data');

var Entry, Trial, Assignment;
if (USE_MONGO) {
  mongoose.connect(connectionString);
  var db = mongoose.connection;
  db.on('error', console.error.bind(console, 'connection error'));
  db.once('open', function callback() { console.log('database opened'); });
  var emptySchema = () => new mongoose.Schema({}, { strict: false });
  Entry = mongoose.model('Entry', emptySchema());          // same collection as Grace's ("entries")
  Trial = mongoose.model('Trial', emptySchema());          // per-trial backups ("trials")
  Assignment = mongoose.model('Assignment', new mongoose.Schema({
    participant_key: { type: String, unique: true, index: true },
    cell: String, source: String, study_version: String,
    created_at: Date, starts: { type: Number, default: 1 }
  }));
} else {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  console.warn('No CONNECTION/MONGODB_URI set: saving to ' + LOCAL_DIR + ' (testing only).');
}

function appendLocal(file, obj) {
  fs.appendFileSync(path.join(LOCAL_DIR, file), JSON.stringify(obj) + '\n');
}
function readLocal(file) {
  const f = path.join(LOCAL_DIR, file);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// --- MIDDLEWARE AND VIEWS ---------------------------------------------------
app.use(express.static(__dirname + '/public'));
app.use(body_parser.json({ limit: '5mb' }));
app.set('views', __dirname + '/public/views');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.get('/', function(request, response) {
    response.render('fractions_experiment.html', { studyConfig: JSON.stringify(STUDY_CONFIG) });
});

// --- ASSIGNMENT -------------------------------------------------------------
// Sticky: the same participant id always gets the same cell (refreshing the
// page cannot re-roll the condition). Balanced: a new participant goes to the
// cell with the fewest assignments so far, ties broken at random.
function pickCell(counts) {
  const min = Math.min(...CELLS.map(c => counts[c] || 0));
  const candidates = CELLS.filter(c => (counts[c] || 0) === min);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

let assignLock = Promise.resolve();
app.post('/assign', function(req, res) {
  const { participant_key, source } = req.body || {};
  if (!participant_key) return res.status(400).json({ error: 'participant_key required' });
  // serialise assignments so two simultaneous arrivals cannot both see the same counts
  assignLock = assignLock.then(async () => {
    try {
      let existing, counts = {};
      if (USE_MONGO) {
        existing = await Assignment.findOne({ participant_key });
        if (existing) {
          existing.starts += 1; await existing.save();
        } else {
          const agg = await Assignment.aggregate([
            { $match: { study_version: STUDY_CONFIG.study_version } },
            { $group: { _id: '$cell', n: { $sum: 1 } } }]);
          agg.forEach(a => counts[a._id] = a.n);
          existing = await Assignment.create({ participant_key, source, cell: pickCell(counts),
            study_version: STUDY_CONFIG.study_version, created_at: new Date(), starts: 1 });
        }
        existing = existing.toObject();
      } else {
        const all = readLocal('assignments.jsonl');
        existing = all.filter(a => a.participant_key === participant_key).pop();
        if (existing) {
          existing.starts = all.filter(a => a.participant_key === participant_key).length + 1;
          appendLocal('assignments.jsonl', existing);
        } else {
          const seen = {};
          all.forEach(a => { if (!seen[a.participant_key]) { seen[a.participant_key] = 1; counts[a.cell] = (counts[a.cell] || 0) + 1; } });
          existing = { participant_key, source, cell: pickCell(counts),
            study_version: STUDY_CONFIG.study_version, created_at: new Date(), starts: 1 };
          appendLocal('assignments.jsonl', existing);
        }
      }
      // If ARMS changed since this person was assigned, fall back to their stored cell anyway
      const cellInfo = ALL_CELLS[existing.cell];
      res.json(Object.assign({}, cellInfo, { starts: existing.starts }));
    } catch (e) {
      console.error('assign error', e);
      // never block a participant: random fallback, flagged in the data
      const c = CELLS[Math.floor(Math.random() * CELLS.length)];
      res.json(Object.assign({}, ALL_CELLS[c], { starts: null, assignment_fallback: true }));
    }
  });
});

// --- DATA -------------------------------------------------------------------
app.post('/trial-data', async function(req, res) {
  const doc = Object.assign({ received_at: new Date() }, req.body);
  try {
    if (USE_MONGO) await Trial.create(doc); else appendLocal('trials.jsonl', doc);
  } catch (e) { console.error('trial save error', e); }
  res.end();
});

app.post('/experiment-data', async function(request, response){
  try {
    if (USE_MONGO) await Entry.create({ "data": request.body, received_at: new Date() });
    else appendLocal('entries.jsonl', { data: request.body, received_at: new Date() });
    response.end();
  } catch (e) {
    console.error('entry save error', e);
    response.status(500).end();
  }
});

// --- FINISH / REDIRECTS -----------------------------------------------------
// Prolific:  https://app.prolific.com/submissions/complete?cc=<PROLIFIC_COMPLETION_CODE>
// SONA:      https://uci.sona-systems.com/webstudy_credit.aspx?experiment_id=..&credit_token=..&survey_code=<id>
app.get('/finish', function(request, response) {
  const source = request.query.source || '';
  let redirectUrl = null, label = null;
  if (source === 'prolific' && process.env.PROLIFIC_COMPLETION_CODE) {
    redirectUrl = 'https://app.prolific.com/submissions/complete?cc=' +
      encodeURIComponent(process.env.PROLIFIC_COMPLETION_CODE);
    label = 'Return to Prolific to complete your submission';
  } else if (source === 'sona' && process.env.SONA_EXPERIMENT_ID && process.env.SONA_CREDIT_TOKEN) {
    const base = process.env.SONA_BASE_URL || 'https://uci.sona-systems.com';
    redirectUrl = base + '/webstudy_credit.aspx?experiment_id=' + encodeURIComponent(process.env.SONA_EXPERIMENT_ID) +
      '&credit_token=' + encodeURIComponent(process.env.SONA_CREDIT_TOKEN) +
      '&survey_code=' + encodeURIComponent(request.query.sona_id || '');
    label = 'Return to SONA to receive your credit';
  }
  response.render('finish_fractions.html', { redirectUrl, label, source });
});

// --- CHAT ENDPOINT (unchanged from Grace's version except model is configurable)
app.post('/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], puzzleContext = null } = req.body;

    const messages = [
      {
        role: "system",
        content: (
          function(){
            const basePrompt = "You are a helpful assistant working with the user to solve a fractions problem. Keep your responses concise (a few sentences max).";
            if (!puzzleContext || !puzzleContext.problem) return basePrompt;
            try {
              let systemPrompt = basePrompt + "\n\n";
              systemPrompt += "Here is the problem:\n" + puzzleContext.problem + "\n\n";
              if (puzzleContext.units) {
                systemPrompt += "Answer format: " + puzzleContext.units + "\n\n";
              }
              return systemPrompt;
            } catch (e) {
              return basePrompt;
            }
          }
        )()
      },
      ...conversationHistory,
      { role: "user", content: message }
    ];

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.OPENAI_MODEL || "gpt-5-chat-latest",
      messages: messages,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const assistantMessage = response.data.choices[0].message.content;

    console.log('Chat interaction:', { timestamp: new Date(), message: message, response: assistantMessage });

    res.json({
      success: true,
      message: assistantMessage,
      conversationHistory: [
        ...conversationHistory,
        { role: "user", content: message },
        { role: "assistant", content: assistantMessage }
      ]
    });

  } catch (error) {
    console.error('Chat API error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to get chat response' });
  }
});

// --- START THE SERVER
var server = app.listen(process.env.PORT || 3000, function(){
    console.log("Listening on port %d | cells: %s | metacog phases: %s",
      server.address().port, CELLS.join(', '), STUDY_CONFIG.metacog_phases.join(', '));
});
