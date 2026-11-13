// n8n Code node – "Parse & guardrails" (Run Once for Each Item)
// Az LLM válaszát nem vakon bízzuk meg: parse-oljuk, sémát ellenőrzünk, és guardrail-eket futtatunk.
// Ha bármelyik guardrail beavatkozik, a ticket "manual_triage" sorba kerül.

const src = $('Normalize email').item.json;
const resp = $input.item.json;

const CATEGORIES = ['order_delivery', 'refund_return', 'product_quality', 'billing_payment',
                    'account_app', 'store_feedback', 'other'];
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const QUEUE_BY_CATEGORY = {
  order_delivery: 'logistics',
  refund_return: 'customer_care',
  product_quality: 'quality_assurance',
  billing_payment: 'finance',
  account_app: 'digital',
  store_feedback: 'store_ops',
  other: 'customer_care'
};
const MIN_CONFIDENCE = 0.6;

const reasons = [];
let c = null;

// 1) Parse
try {
  const content = resp?.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty');
  c = JSON.parse(content);
} catch (e) {
  reasons.push('llm_invalid_json');
}

// 2) Séma / értékkészlet ellenőrzés (strict schema mellett is – nem minden provider tartja be)
if (c) {
  if (!CATEGORIES.includes(c.category)) reasons.push('invalid_category');
  if (!PRIORITIES.includes(c.priority)) reasons.push('invalid_priority');
  if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) reasons.push('invalid_confidence');
  else if (c.confidence < MIN_CONFIDENCE) reasons.push('low_confidence');
  if (c.injection_suspected === true) reasons.push('llm_flagged_injection');
}

// 3) Determinisztikus prompt-injection heurisztika (nem csak az LLM-re hagyatkozunk)
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /felejtsd el (az )?(eddigi |korábbi )?utasítás/i,
  /hagyd figyelmen kívül (az )?(eddigi |korábbi )?utasítás/i,
  /ignoriere (alle )?(vorherigen )?anweisungen/i,
  /you are now/i,
  /system prompt/i
];
if (INJECTION_PATTERNS.some(r => r.test(`${src.subject}\n${src.body}`))) reasons.push('regex_injection_pattern');

// 4) Biztonsági felülírás: egészségügyi kulcsszavak → legalább P1 felülvizsgálat
const SAFETY_PATTERNS = /allerg|anaphyla|kórház|hospital|krankenhaus|üvegszilánk|glass|fémdarab|metal piece|mérgez|poison/i;
if (c && SAFETY_PATTERNS.test(src.body) && c.priority !== 'P1') {
  reasons.push('safety_keyword_priority_override');
  c.priority = 'P1';
}

// Guardrail döntés: a priority override nem küld manuális sorba, csak naplózzuk
const blocking = reasons.filter(r => r !== 'safety_keyword_priority_override');
const triggered = reasons.length > 0;
const manual = blocking.length > 0 || !c;

const ticket = {
  message_id: src.message_id,
  from_email: src.from_email,
  subject: src.subject,
  body: src.body,
  language: c?.language ?? null,
  category: manual && !c ? 'other' : (CATEGORIES.includes(c?.category) ? c.category : 'other'),
  priority: PRIORITIES.includes(c?.priority) ? c.priority : 'P3',
  sentiment: c?.sentiment ?? null,
  summary: c?.summary ?? null,
  confidence: typeof c?.confidence === 'number' ? c.confidence : null,
  queue: manual ? 'manual_triage' : QUEUE_BY_CATEGORY[c.category],
  status: 'open',
  guardrail_triggered: triggered,
  guardrail_reasons: reasons,
  llm_model: resp?.model ?? null,
  llm_latency_ms: Date.now() - src.received_at_ms,
  prompt_tokens: resp?.usage?.prompt_tokens ?? null,
  completion_tokens: resp?.usage?.completion_tokens ?? null
};

return { json: { ticket } };
