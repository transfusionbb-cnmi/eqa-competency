// CNMI EQA v2.4.2 - Provider-form question import + case-study context
// Deploy name: generate-competency
// Required secret: OPENAI_API_KEY
// Optional secret: OPENAI_MODEL (default: gpt-4o-mini)

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXTRACTION_SCHEMA_VERSION = 'v2.4.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function isExtractionSchemaCompatible(doc: any) {
  const version = asText(doc?.ai_extraction?.schema_version);
  if (version === EXTRACTION_SCHEMA_VERSION) return true;
  if (version !== 'v2.3.2') return false;
  const category = asText(doc?.category);
  // v2.4.2 adds provider_questions and case_studies only to form/instruction extraction.
  // Keep previous extraction for images, panels, evaluations and summaries to avoid token use.
  return !['source_document', 'instruction'].includes(category);
}

type ProgramProfile = {
  code: string;
  label: string;
  formStrategy: 'cap_j_je' | 'document_driven';
  answerStrategy: 'official_then_majority';
  summaryStrategy: 'cap_j_je_matrix' | 'generic_matrix';
  testHints: string[];
};

const PROGRAM_PROFILES: ProgramProfile[] = [
  {
    code: 'CAP_J_JE',
    label: 'CAP Comprehensive Transfusion Medicine J/JE',
    formStrategy: 'cap_j_je',
    answerStrategy: 'official_then_majority',
    summaryStrategy: 'cap_j_je_matrix',
    testHints: ['ABO Group','Rh Type','Unexpected Antibody Detection','Antibody Identification','Crossmatch/Compatibility Testing','Antigen typing'],
  },
  {
    code: 'CAP_ELU',
    label: 'CAP Elution / Eluate Antibody Identification',
    formStrategy: 'document_driven',
    answerStrategy: 'official_then_majority',
    summaryStrategy: 'generic_matrix',
    testHints: ['DAT','Elution','Eluate Antibody Identification','Antibody Identification'],
  },
  {
    code: 'CAP_TRC',
    label: 'CAP Transfusion Reaction',
    formStrategy: 'document_driven',
    answerStrategy: 'official_then_majority',
    summaryStrategy: 'generic_matrix',
    testHints: ['DAT','Hemolysis','CBC','WBC Count','Transfusion Reaction Interpretation'],
  },
  {
    code: 'CAP_AABT',
    label: 'CAP Antibody Titer',
    formStrategy: 'document_driven',
    answerStrategy: 'official_then_majority',
    summaryStrategy: 'generic_matrix',
    testHints: ['Antibody Titer','Titer Endpoint','Method'],
  },
  {
    code: 'CAP_EXM',
    label: 'CAP Electronic Crossmatch',
    formStrategy: 'document_driven',
    answerStrategy: 'official_then_majority',
    summaryStrategy: 'generic_matrix',
    testHints: ['ABO Confirmation','Rh Confirmation','Electronic Crossmatch Eligibility','Electronic Crossmatch Result'],
  },
  {
    code: 'GENERIC_DOCUMENT_DRIVEN',
    label: 'EQA แบบกำหนดโครงสร้างจากฟอร์มผู้ให้บริการ',
    formStrategy: 'document_driven',
    answerStrategy: 'official_then_majority',
    summaryStrategy: 'generic_matrix',
    testHints: [],
  },
];

function resolveProgramProfile(round: any): ProgramProfile {
  const provider = asText(round?.provider).toUpperCase();
  const text = `${asText(round?.program_code)} ${asText(round?.round_code)} ${asText(round?.program_name)}`.toUpperCase();
  let code = 'GENERIC_DOCUMENT_DRIVEN';
  if (provider.includes('CAP') && ((/J\s*\/\s*JE/.test(text)) || (/\bJ[-\s]?A\b/.test(text) && /\bJE\b/.test(text)) || /COMPREHENSIVE TRANSFUSION/.test(text))) code = 'CAP_J_JE';
  else if (provider.includes('CAP') && /\bELU\b|ELUATE|ELUTION/.test(text)) code = 'CAP_ELU';
  else if (provider.includes('CAP') && /\bTRC\b|TRANSFUSION REACTION/.test(text)) code = 'CAP_TRC';
  else if (provider.includes('CAP') && /\bAABT\b|ANTIBODY TITER/.test(text)) code = 'CAP_AABT';
  else if (provider.includes('CAP') && /\bEXM\b|ELECTRONIC CROSSMATCH/.test(text)) code = 'CAP_EXM';
  return PROGRAM_PROFILES.find((profile) => profile.code === code) || PROGRAM_PROFILES[PROGRAM_PROFILES.length - 1];
}

function capJa2026ReferenceEntries(round: any) {
  const profile = resolveProgramProfile(round);
  const text = `${asText(round?.program_code)} ${asText(round?.round_code)} ${asText(round?.program_name)}`.toUpperCase();
  if (profile.code !== 'CAP_J_JE' || Number(round?.survey_year) !== 2026 || !/J(?:\s*\/\s*JE)?[-\s]?A/.test(text)) return [];
  const rows = [
    ['J-06R','C Type','Positive','99.5'],
    ['J-06R','E Type','Negative','99.9'],
    ['J-06R','c Type','Negative','98.9'],
    ['J-06R','e Type','Positive','99.7'],
    ['J-06R','Fya Type','Negative','58.3'],
    ['J-06R','Jka Type','Positive','100.0'],
    ['J-06R','K Type','Positive','99.0'],
    ['J-06R','N Type','Positive','100.0'],
    ['J-06R','S Type','Positive','87.5'],
    ['J-06R','s Type','Positive','98.0'],
    ['JE-07','ABO Group','Group O','100.0'],
    ['JE-07','Rh Type','Rh Positive','100.0'],
    ['JE-07','Unexpected Antibody Detection','Antibody Detected','100.0'],
    ['JE-07','Antibody Identification','115 │ Anti-E; 124 │ Anti-K','98.0'],
    ['JE-07','Crossmatch/Compatibility Testing','Positive','99.2'],
    ['JE-07','Crossmatch Strength of Reaction','+3 Reaction','53.3'],
    ['JE-07R','C Type','Positive','99.8'],
    ['JE-07R','E Type','Negative','100.0'],
    ['JE-07R','c Type','Negative','99.8'],
    ['JE-07R','e Type','Positive','100.0'],
    ['JE-07R','K Type','Negative','97.7'],
  ];
  return rows.map(([specimen, test_name, result, percent]) => ({
    specimen,
    test_key: canonicalTestKey(test_name, result),
    result,
    percent,
    confidence_note: 'CAP J-A 2026 Participant Summary peer-comparison table',
    source_file_name: 'CAP-JA-2026_ParticipantSummary_PeerComparison.pdf',
    priority: 100,
  }));
}

function responseOutputText(payload: any) {
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
      if (content?.type === 'refusal' && content.refusal) throw new Error(content.refusal);
    }
  }
  throw new Error('AI did not return structured output');
}

async function callOpenAI(apiKey: string, model: string, content: any[], schemaName: string, schema: Record<string, unknown>) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  return JSON.parse(responseOutputText(payload));
}

function normalizeName(value: unknown) {
  return asText(value).toLowerCase().replace(/\s+/g, ' ');
}

function compactDocumentName(value: unknown) {
  return asText(value)
    .toLowerCase()
    .replace(/\.(?:png|jpe?g|webp|pdf)$/i, '')
    .replace(/[^a-z0-9ก-๙]+/gi, '');
}

type ParsedEqaFilename = {
  original: string;
  providerRound: string;
  specimen: string;
  testType: string;
  role: string;
  panelId: string;
  cellStart: number | null;
  cellEnd: number | null;
  lot: string;
  donor: string;
  antigens: string[];
  qualifiers: string[];
  bundleKey: string;
  panelKey: string;
};

const FILE_TEST_ALIASES: Record<string, string> = {
  abo: 'abo', rh: 'rh', abscreen: 'antibody_screen', antibodyscreen: 'antibody_screen', screen: 'antibody_screen',
  abid: 'antibody_identification', antibodyid: 'antibody_identification', antibodyidentification: 'antibody_identification',
  crossmatch: 'crossmatch', xmatch: 'crossmatch', compatibility: 'crossmatch',
  agtyping: 'antigen_typing', antigentyping: 'antigen_typing', phenotype: 'antigen_typing',
  eluateabid: 'eluate_identification', eluateid: 'eluate_identification', dat: 'dat',
  cbc: 'cbc', wbccount: 'wbc_count', antibodytiter: 'antibody_titer', titer: 'antibody_titer',
  multitest: 'multi_test',
};

const FILE_ROLE_ALIASES: Record<string, string> = {
  rawresult: 'RawResult', antigram: 'Antigram', blankresultform: 'BlankResultForm',
  submittedresultform: 'SubmittedResultForm', officialevaluation: 'OfficialEvaluation',
  participantsummary: 'ParticipantSummary', kitinstruction: 'KitInstruction',
};


const FILE_TEST_CANONICAL_TOKEN: Record<string, string> = {
  abo: 'ABO',
  rh: 'Rh',
  antibody_screen: 'AbScreen',
  antibody_identification: 'AbID',
  crossmatch: 'Crossmatch',
  antigen_typing: 'AgTyping',
  eluate_identification: 'EluateAbID',
  dat: 'DAT',
  cbc: 'CBC',
  wbc_count: 'WBCCount',
  antibody_titer: 'AntibodyTiter',
  multi_test: 'MultiTest',
};

function compactFilenameToken(value: unknown) {
  return asText(value).replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function parseEqaFilename(value: unknown): ParsedEqaFilename {
  const original = asText(value);
  const stem = original.replace(/\.(?:png|jpe?g|webp|pdf)$/i, '');
  const parts = stem.split('_').map((part) => part.trim()).filter(Boolean);
  const roleIndex = parts.findLastIndex((part, index) => index > 0 && Boolean(FILE_ROLE_ALIASES[compactFilenameToken(part)]));
  const role = roleIndex >= 0 ? FILE_ROLE_ALIASES[compactFilenameToken(parts[roleIndex])] : '';
  const providerRound = parts[0] || '';
  const isWholeDocument = ['BlankResultForm','SubmittedResultForm','OfficialEvaluation','ParticipantSummary','KitInstruction'].includes(role);
  const documentParts = parts.slice(1).filter((_, index) => index + 1 !== roleIndex);
  const specimen = asText(isWholeDocument ? (documentParts[0] || 'ALL') : parts[1]).toUpperCase();
  const rawTest = isWholeDocument ? '' : (parts[2] || '');
  const testType = isWholeDocument ? '' : (FILE_TEST_ALIASES[compactFilenameToken(rawTest)] || '');
  const qualifiers = isWholeDocument
    ? documentParts.slice(1)
    : parts.slice(3).filter((_, index) => index + 3 !== roleIndex);
  let panelId = '';
  let cellStart: number | null = null;
  let cellEnd: number | null = null;
  let lot = '';
  let donor = '';
  const antigens: string[] = [];
  for (const qualifier of qualifiers) {
    let match = qualifier.match(/^Panel([A-Za-z]|\d{1,2})$/i);
    if (match) { panelId = /^\d+$/.test(match[1]) ? String(Number(match[1])).padStart(2, '0') : match[1].toUpperCase(); continue; }
    match = qualifier.match(/^Cell(\d{1,2})[-–](\d{1,2})$/i);
    if (match) { cellStart = Number(match[1]); cellEnd = Number(match[2]); continue; }
    match = qualifier.match(/^Lot(.+)$/i);
    if (match) { lot = match[1]; continue; }
    match = qualifier.match(/^Donor(.+)$/i);
    if (match) { donor = match[1].toUpperCase(); continue; }
  }
  if (testType === 'antigen_typing') {
    const token = qualifiers.find((item) => !/^Panel|^Cell|^Lot|^Donor|^ExtraCell|^(RT|IAT|IS|AHG|ENZYME)$/i.test(item));
    if (token && !/^SelectedAntigen$/i.test(token)) antigens.push(...token.split('-').map((item) => item.trim()).filter(Boolean));
  }
  if (testType === 'crossmatch' && !donor) {
    const token = qualifiers.find((item) => /^(?:JE|J)-?\d{1,2}R$/i.test(item));
    if (token) donor = token.toUpperCase();
  }
  const bundleKey = [providerRound, specimen, FILE_TEST_CANONICAL_TOKEN[testType] || testType, donor].filter(Boolean).join('|').toUpperCase();
  return {
    original, providerRound, specimen, testType, role, panelId, cellStart, cellEnd, lot, donor,
    antigens, qualifiers, bundleKey, panelKey: panelId ? `${bundleKey}|PANEL${panelId}` : '',
  };
}

function panelSortValue(panelId: string) {
  if (!panelId) return 999;
  if (/^\d+$/.test(panelId)) return Number(panelId);
  return 100 + panelId.toUpperCase().charCodeAt(0);
}

const CAP_ANTIBODY_CHOICES = [
  '184 │ Antibody identification not indicated (no antibody detected)',
  '200 │ Unable to complete testing / would refer for testing',
  '112 │ Anti-D', '113 │ Anti-C', '114 │ Anti-c', '115 │ Anti-E', '116 │ Anti-e',
  '124 │ Anti-K', '125 │ Anti-k', '126 │ Anti-Fya', '127 │ Anti-Fyb',
  '128 │ Anti-Jka', '129 │ Anti-Jkb', '131 │ Anti-Lea', '132 │ Anti-Leb',
  '133 │ Anti-P1', '134 │ Anti-M', '135 │ Anti-N', '136 │ Anti-S', '137 │ Anti-s',
  '147 │ Antibody to other (nonlisted) high incidence antigen',
  '148 │ Antibody to other (nonlisted) low incidence antigen',
  '149 │ Warm autoantibody, specificity unknown',
  '010 │ Other — specify on result form',
];

const STANDARD_QUESTION_CHOICES: Record<string, string[]> = {
  abo: [
    '188 │ Group A', '191 │ Group B', '192 │ Group AB', '195 │ Group O',
    '199 │ Cell/serum grouping do not agree — additional testing or sample required',
  ],
  rh: [
    'Rh(D) positive',
    'Weak D positive',
    'Partial D / D variant — refer for confirmation',
    'Rh(D) negative',
  ],
  antibody_screen: [
    '110 │ Unexpected antibody not detected (Negative)',
    '111 │ Unexpected antibody detected (Positive)',
  ],
  crossmatch: [
    '29 │ Negative (Compatible)',
    '30 │ Positive (Incompatible)',
    '20 │ Would refer for testing',
  ],
  antigen_typing: [
    '209 │ Negative', '210 │ Positive', '235 │ Reagent not available', '435 │ Test not indicated',
  ],
};

function standardQuestionSection(kind: string) {
  return {
    abo: 'ABO Group',
    rh: 'Rh(D) Type',
    antibody_screen: 'Antibody Screening',
    antibody_identification: 'Antibody Identification',
    crossmatch: 'Crossmatch',
    antigen_typing: 'Antigen Typing',
    other: 'การแปลผล EQA',
  }[kind] || 'การแปลผล EQA';
}

function interpretationQuestionPrompt(kind: string, specimen: string, antigen: string, fallback: string) {
  const sample = specimen ? `ของตัวอย่าง ${specimen}` : 'ของตัวอย่างนี้';
  if (kind === 'abo') return `ผลการแปลหมู่เลือด ABO ${sample} คือข้อใด`;
  if (kind === 'rh') return `ผลการแปล Rh(D) ${sample} คือข้อใด`;
  if (kind === 'antibody_screen') return `ผล Antibody screen ${sample} เป็น Positive หรือ Negative`;
  if (kind === 'antibody_identification') return `ผล Antibody Identification ${sample} คืออะไร (เลือกได้มากกว่า 1 รายการ)`;
  if (kind === 'crossmatch') return `ผล Crossmatch ${sample} กับ Donor J-06R คือข้อใด`;
  if (kind === 'antigen_typing') return `ผล Antigen ${antigen || 'ที่ระบุ'} ${sample} คือข้อใด`;
  return fallback;
}

function isCapJJeRoundData(round: any) {
  const provider = asText(round?.provider).toUpperCase();
  const code = `${asText(round?.program_code)} ${asText(round?.round_code)} ${asText(round?.program_name)}`.toUpperCase();
  return provider.includes('CAP') && (
    code.includes('J/JE')
    || code.includes('J / JE')
    || code.includes('J-JE')
    || (code.includes('J-A') && code.includes('JE'))
  );
}

function normalizeSpecimen(value: unknown, preserveSuffix = false) {
  const raw = asText(value).toUpperCase().replace(/_/g, '-').replace(/\s+/g, '');
  const match = raw.match(/(JE|J)-?0?(\d{1,2})([RS])?/);
  if (!match) return '';
  const base = `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
  return preserveSuffix && match[3] ? `${base}${match[3]}` : base;
}

function documentText(doc: any) {
  const extraction = doc?.ai_extraction || {};
  return [
    doc?.file_name,
    doc?.title,
    extraction?.summary_th,
    ...(Array.isArray(extraction?.test_groups) ? extraction.test_groups.map((item: any) => item?.name) : []),
    ...(Array.isArray(extraction?.raw_observations) ? extraction.raw_observations : []),
  ].filter(Boolean).join(' ');
}

function specimensFromDocument(doc: any, preserveSuffix = false) {
  const values: string[] = [];
  const parsed = parseEqaFilename(doc?.file_name || doc?.title);
  if (parsed.specimen) values.push(normalizeSpecimen(parsed.specimen, preserveSuffix));
  const directText = documentText(doc);
  const regex = /(JE|J)[-_ ]?0?\d{1,2}[RS]?/gi;
  for (const match of directText.matchAll(regex)) values.push(normalizeSpecimen(match[0], preserveSuffix));
  const extracted = Array.isArray(doc?.ai_extraction?.specimens) ? doc.ai_extraction.specimens : [];
  for (const item of extracted) values.push(normalizeSpecimen(item?.id || item?.label, preserveSuffix));
  return [...new Set(values.filter(Boolean))];
}

function inferredKindsForDocument(doc: any) {
  const parsed = parseEqaFilename(doc?.file_name || doc?.title);
  if (['abo','rh','antibody_screen','antibody_identification','crossmatch','antigen_typing'].includes(parsed.testType)) return [parsed.testType];
  const name = `${doc?.file_name || ''} ${doc?.title || ''}`.toLowerCase();
  if (/ab\s*id|antibody[\s_-]*id|antibody[\s_-]*identification|panel[\s_-]*[a-z0-9-]*[\s_-]*cell/.test(name)) return ['antibody_identification'];
  if (/ag\s*typing|antigen[\s_-]*typing|red[\s_-]*cell[\s_-]*antigen|phenotyp/.test(name)) return ['antigen_typing'];
  if (/ab\s*screen|antibody[\s_-]*screen|unexpected[\s_-]*antibody/.test(name)) return ['antibody_screen'];
  if (/crossmatch|compatib/.test(name)) return ['crossmatch'];
  if (/(^|[^a-z])abo([^a-z]|$)/.test(name)) return ['abo'];
  if (/rh[\s_-]*\(?(d)?\)?|rh[\s_-]*type|anti[\s_-]*d/.test(name)) return ['rh'];

  const text = documentText(doc).toLowerCase();
  const result: string[] = [];
  if (/(^|[^a-z])abo([^a-z]|$)|cell grouping|serum grouping|forward grouping|reverse grouping/.test(text)) result.push('abo');
  if (/ab\s*screen|antibody\s*screen|unexpected antibody detection/.test(text)) result.push('antibody_screen');
  if (/ab\s*id|antibody\s*identification|panel\s*[a-z0-9-]*\s*cell|antigram/.test(text)) result.push('antibody_identification');
  if (/crossmatch|compatibility testing|cross match/.test(text)) result.push('crossmatch');
  if (/ag\s*typing|antigen\s*typing|red cell antigen|phenotyp/.test(text) && !result.includes('antibody_identification')) result.push('antigen_typing');
  if (
    /rh\s*\(?d\)?|rh\s*type|anti[-_ ]?d/.test(text)
    && !result.includes('antibody_identification')
    && !result.includes('antigen_typing')
  ) result.push('rh');
  return [...new Set(result)];
}

function antigensFromDocument(doc: any) {
  const text = documentText(doc);
  const compact = compactDocumentName(text);
  const parsed = parseEqaFilename(doc?.file_name || doc?.title);
  const found: string[] = [...parsed.antigens];
  const add = (value: string) => { if (!found.includes(value)) found.push(value); };
  if (/agtyping.*c.*c.*e.*e.*k/i.test(text) || /cc ee k/i.test(text.replace(/[-_]/g, ' '))) {
    ['C','c','E','e','K'].forEach(add);
  }
  const extractionRows = [
    ...(Array.isArray(doc?.ai_extraction?.raw_observations) ? doc.ai_extraction.raw_observations : []),
    ...(Array.isArray(doc?.ai_extraction?.evaluation_rows) ? doc.ai_extraction.evaluation_rows.map((row: any) => `${row?.test_name || ''} ${row?.result || ''}`) : []),
  ].join(' ');
  for (const antigen of ['C','c','E','e','K','D','Fya','Fyb','Jka','Jkb','S','s']) {
    const escaped = antigen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = `${text} ${extractionRows}`;
    if (new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`).test(source)) add(antigen);
  }
  if (!found.length && compact.includes('cc eek'.replace(/ /g, ''))) ['C','c','E','e','K'].forEach(add);
  return found;
}

function questionKey(item: any) {
  return `${asText(item?.question_kind)}|${asText(item?.specimen).toUpperCase()}|${asText(item?.antigen_name)}`;
}

function sortQuestionSourceDocuments(documents: any[]) {
  return [...documents].sort((a, b) => {
    const aParsed = parseEqaFilename(a?.file_name || a?.title);
    const bParsed = parseEqaFilename(b?.file_name || b?.title);
    const aPanelDoc = a.category === 'antibody_panel' || aParsed.role === 'Antigram' || /antigram/i.test(`${a.file_name || ''} ${a.title || ''}`) ? 1 : 0;
    const bPanelDoc = b.category === 'antibody_panel' || bParsed.role === 'Antigram' || /antigram/i.test(`${b.file_name || ''} ${b.title || ''}`) ? 1 : 0;
    const panelDifference = panelSortValue(aParsed.panelId) - panelSortValue(bParsed.panelId);
    if (panelDifference) return panelDifference;
    if (aPanelDoc !== bPanelDoc) return aPanelDoc - bPanelDoc;
    return (aParsed.cellStart ?? 999) - (bParsed.cellStart ?? 999)
      || asText(a.file_name).localeCompare(asText(b.file_name));
  });
}

function familyKey(doc: any) {
  const compact = compactDocumentName(`${doc?.file_name || ''} ${doc?.title || ''}`);
  if (compact.includes('capjea') || compact.includes('capje')) return 'capje';
  if (compact.includes('capja') || compact.includes('capj')) return 'capj';
  return '';
}

function relatedAntibodyPanelDocuments(specimen: string, rawDocuments: any[], allDocuments: any[]) {
  const panelDocs = allDocuments.filter((doc: any) => doc.category === 'antibody_panel' || parseEqaFilename(doc.file_name || doc.title).role === 'Antigram' || /antigram/i.test(`${doc.file_name || ''} ${doc.title || ''}`));
  if (!panelDocs.length) return [];
  const normalizedSpecimen = normalizeSpecimen(specimen, false);
  const rawFamilies = new Set(rawDocuments.map(familyKey).filter(Boolean));
  const direct = panelDocs.filter((doc: any) => normalizeSpecimen(parseEqaFilename(doc.file_name || doc.title).specimen, false) === normalizedSpecimen);
  if (direct.length) return sortQuestionSourceDocuments(direct);
  const specimenCompact = compactDocumentName(specimen);
  const legacyDirect = panelDocs.filter((doc: any) => compactDocumentName(`${doc.file_name} ${doc.title}`).includes(specimenCompact));
  if (legacyDirect.length) return sortQuestionSourceDocuments(legacyDirect);
  const sameFamily = panelDocs.filter((doc: any) => rawFamilies.has(familyKey(doc)));
  if (sameFamily.length) return sortQuestionSourceDocuments(sameFamily);
  return panelDocs.length === 1 ? panelDocs : [];
}

function buildCapQuestionBlueprint(primaryDocuments: any[], allDocuments: any[]) {
  const rawPrimary = primaryDocuments.filter((doc: any) => doc.category === 'raw_result_image');
  const items: any[] = [];
  const add = (item: any) => {
    const key = questionKey(item);
    if (!items.some((existing) => questionKey(existing) === key)) items.push(item);
  };

  for (const doc of rawPrimary) {
    const kinds = inferredKindsForDocument(doc);
    const baseSpecimens = specimensFromDocument(doc, false);
    const suffixSpecimens = specimensFromDocument(doc, true);
    const sourceName = asText(doc.file_name || doc.title);
    for (const kind of kinds) {
      if (kind === 'antibody_identification') continue;
      if (kind === 'antigen_typing') {
        const antigens = antigensFromDocument(doc);
        const targets = (suffixSpecimens.length ? suffixSpecimens : baseSpecimens).map((item) => /[RS]$/.test(item) ? item : `${item}R`);
        for (const specimen of targets) {
          for (const antigen of antigens) {
            add({
              question_kind: kind,
              specimen,
              antigen_name: antigen,
              prompt: '',
              source_file_names: [sourceName],
              choices: [],
              is_critical: true,
              points: 1,
            });
          }
        }
        continue;
      }
      const targetSpecimens = kind === 'crossmatch'
        ? (() => {
            const patientSamples = suffixSpecimens.filter((item) => /S$/.test(item)).map((item) => normalizeSpecimen(item, false));
            if (patientSamples.length) return [...new Set(patientSamples)];
            const withoutDonor = baseSpecimens.filter((item) => !/^J-06$/.test(item));
            return withoutDonor.length ? withoutDonor : baseSpecimens.slice(0, 1);
          })()
        : baseSpecimens;
      for (const specimen of targetSpecimens) {
        add({
          question_kind: kind,
          specimen,
          antigen_name: '',
          prompt: '',
          source_file_names: [sourceName],
          choices: [],
          is_critical: ['abo','rh','antibody_screen','crossmatch'].includes(kind),
          points: 1,
        });
      }
    }
  }

  const abIdGroups = new Map<string, any[]>();
  for (const doc of rawPrimary.filter((item: any) => inferredKindsForDocument(item).includes('antibody_identification'))) {
    const specimens = specimensFromDocument(doc, false);
    for (const specimen of specimens) {
      if (!abIdGroups.has(specimen)) abIdGroups.set(specimen, []);
      abIdGroups.get(specimen)!.push(doc);
    }
  }
  for (const [specimen, rawDocs] of abIdGroups) {
    const sources = sortQuestionSourceDocuments([
      ...rawDocs,
      ...relatedAntibodyPanelDocuments(specimen, rawDocs, allDocuments),
    ]);
    add({
      question_kind: 'antibody_identification',
      specimen,
      antigen_name: '',
      prompt: '',
      source_file_names: sources.map((doc: any) => asText(doc.file_name || doc.title)).filter(Boolean),
      choices: [],
      is_critical: true,
      points: 1,
    });
  }
  return items;
}



function canonicalSpecimenId(...values: unknown[]) {
  const text = values.map(asText).filter(Boolean).join(' ').toUpperCase();
  const match = text.match(/\b(JE|J)[-_\s]?0?(\d{1,2})([RS])?\b/);
  if (!match) return asText(values.find((value) => asText(value))).toUpperCase();
  const prefix = match[1];
  const number = String(Number(match[2])).padStart(2, '0');
  return `${prefix}-${number}${match[3] || ''}`;
}

function summarySpecimenId(...values: unknown[]) {
  const specimen = canonicalSpecimenId(...values);
  if (/^J-0[1-5][RS]$/.test(specimen)) return specimen.slice(0, -1);
  if (/^JE-07S$/.test(specimen)) return 'JE-07';
  return specimen;
}

function normalizeTestText(value: unknown) {
  return asText(value).toLowerCase().replace(/[–—]/g, '-').replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
}

function antigenFromText(value: unknown) {
  const source = asText(value);
  const explicit = source.match(/(?:antigen\s+typing\s*\(|\b)(C|c|E|e|K|k|Fya|Fyb|Jka|Jkb|S|s|M|N)\s*(?:\)|type\b)/i);
  if (explicit) return explicit[1];
  const anti = source.match(/Anti-(C|c|E|e|K|k|Fya|Fyb|Jka|Jkb|S|s|M|N)\b/);
  if (anti) return anti[1];
  const standalone = source.trim().match(/^(C|c|E|e|K|k|Fya|Fyb|Jka|Jkb|S|s|M|N)(?:\s+(?:positive|negative))?$/i);
  return standalone?.[1] || '';
}

function canonicalTestKey(value: unknown, resultValue: unknown = '') {
  const text = normalizeTestText(value);
  if (/crossmatch|compatibility/.test(text)) {
    if (/strength/.test(text)) return 'crossmatch_strength';
    return 'crossmatch';
  }
  if (/antibody identification|antibody id|\bab\s*id\b/.test(text)) return 'antibody_identification';
  if (/unexpected antibody detection|antibody detection|antibody screen|\bscreen\b/.test(text)) return 'antibody_screen';
  if (/\babo\b/.test(text)) return 'abo';
  if (/\brh(?:\(d\))?\b/.test(text)) return 'rh';
  const antigen = antigenFromText(`${asText(value)} ${asText(resultValue)}`);
  if (antigen) return `antigen:${antigen}`;
  if (/other red cell antigen|other antigens|antigen typing|identification of other red cell antigen/.test(text)) return 'antigen:other';
  return text.replace(/[^a-z0-9ก-๙]+/g, '_').replace(/^_+|_+$/g, '');
}

function canonicalTestLabel(value: unknown, resultValue: unknown = '') {
  const key = canonicalTestKey(value, resultValue);
  if (key === 'abo') return 'ABO Group';
  if (key === 'rh') return 'Rh Type';
  if (key === 'antibody_screen') return 'Unexpected Antibody Detection';
  if (key === 'antibody_identification') return 'Antibody Identification';
  if (key === 'crossmatch') return 'Crossmatch/Compatibility Testing';
  if (key === 'crossmatch_strength') return 'Crossmatch Strength of Reaction';
  if (key.startsWith('antigen:')) {
    const antigen = key.slice('antigen:'.length);
    return antigen === 'other' ? 'Other Red Cell Antigen' : `${antigen} Type`;
  }
  return asText(value);
}

function percentNumber(value: unknown) {
  const match = asText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

const CAP_ANTIBODY_BY_CODE = new Map<string, string>(
  CAP_ANTIBODY_CHOICES
    .map((item): [string, string] => [item.match(/^(\d{3})/)?.[1] || '', item])
    .filter(([code]) => Boolean(code)),
);

function capAntibodyLabelsFromText(value: unknown) {
  const text = asText(value);
  const found = new Map<string, string>();
  for (const code of [...text.matchAll(/(?:^|\D)(\d{3})(?=\D|$)/g)].map((match) => match[1])) {
    const item = CAP_ANTIBODY_BY_CODE.get(code);
    if (item && !['184','200','010'].includes(code)) found.set(code, item);
  }
  for (const match of text.matchAll(/Anti-(C|c|D|E|e|K|k|Fya|Fyb|Jka|Jkb|Lea|Leb|P1|M|N|S|s)\b/g)) {
    const token = `Anti-${match[1]}`;
    const item = CAP_ANTIBODY_CHOICES.find((choice) => choice.endsWith(token));
    const code = item?.match(/^(\d{3})/)?.[1] || token;
    if (item) found.set(code, item);
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}

function canonicalAntibodyAnswerText(value: unknown) {
  const labels = capAntibodyLabelsFromText(value);
  return labels.length ? labels.join('; ') : asText(value);
}

function antibodySetKey(value: unknown) {
  const labels = capAntibodyLabelsFromText(value);
  if (labels.length) return labels.map((item) => item.match(/^(\d{3})/)?.[1] || item).sort().join(';');
  return '';
}

function canonicalResultKey(value: unknown, testKey = '') {
  const raw = asText(value);
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (testKey === 'abo') {
    const simpleGroup = upper.match(/^(?:GROUP\s+)?(AB|A|B|O)$/);
    if (simpleGroup) return `abo:${simpleGroup[1]}`;
  }
  if (testKey === 'rh') {
    if (/^(?:RH(?:\(D\))?\s*)?NEGATIVE$/.test(upper)) return 'rh:negative';
    if (/^(?:RH(?:\(D\))?\s*)?POSITIVE$/.test(upper)) return 'rh:positive';
  }
  if (testKey === 'antibody_screen') {
    if (/^(?:ANTIBODY\s+)?NOT\s+DETECTED$/.test(upper)) return 'screen:not-detected';
    if (/^(?:ANTIBODY\s+)?DETECTED$/.test(upper)) return 'screen:detected';
  }
  if (testKey === 'antibody_identification') {
    const antibodies = antibodySetKey(raw);
    if (antibodies) return `antibodies:${antibodies}`;
    if (/NOT\s+INDIC|NOT\s+IDENTIF|NO\s+ANTIBODY/.test(upper)) return 'antibodies:none';
  }
  if (/ANTIBODY\s+NOT\s+DETECTED/.test(upper)) return 'screen:not-detected';
  if (/ANTIBODY\s+DETECTED/.test(upper)) return 'screen:detected';
  const group = upper.match(/GROUP\s+(AB|A|B|O)\b/);
  if (group) return `abo:${group[1]}`;
  if (/RH(?:\(D\))?\s+NEGATIVE/.test(upper)) return 'rh:negative';
  if (/RH(?:\(D\))?\s+POSITIVE/.test(upper)) return 'rh:positive';
  if (testKey === 'crossmatch' || /CROSSMATCH|COMPATIBIL/.test(upper)) {
    if (/NEGATIVE|COMPATIBLE/.test(upper)) return 'crossmatch:negative';
    if (/POSITIVE|INCOMPATIBLE/.test(upper)) return 'crossmatch:positive';
  }
  const strength = upper.match(/(?:MICROSCOPIC|\+[1-4])\s*(?:REACTION)?/);
  if (strength) return `strength:${strength[0].replace(/\s+/g, '')}`;
  if (/\bNEGATIVE\b/.test(upper) && !/POSITIVE/.test(upper)) return 'result:negative';
  if (/\bPOSITIVE\b/.test(upper) && !/NEGATIVE/.test(upper)) return 'result:positive';
  return upper.replace(/\d+(?:\.\d+)?%/g, '').replace(/[^A-Z0-9+]+/g, '');
}

function questionSpecimenId(question: any) {
  return canonicalSpecimenId(question?.prompt, question?.section);
}

function questionTestKey(question: any) {
  return canonicalTestKey(`${asText(question?.section)} ${asText(question?.prompt)}`);
}

function participantConsensusEntries(evaluationManifest: any[], round: any = null) {
  const entries: any[] = [...capJa2026ReferenceEntries(round)];
  for (const doc of evaluationManifest.filter((item: any) => item.category === 'participant_summary')) {
    const extraction = doc.extraction ?? {};
    for (const row of extraction.educational_consensus ?? []) {
      entries.push({
        specimen: canonicalSpecimenId(row.specimen_id, row.test_name),
        test_key: canonicalTestKey(row.test_name, row.consensus_result),
        result: asText(row.consensus_result),
        percent: asText(row.percent),
        confidence_note: asText(row.confidence_note),
        source_file_name: asText(doc.file_name || doc.title),
        priority: 0,
      });
    }
    for (const row of extraction.participant_comparisons ?? []) {
      entries.push({
        specimen: canonicalSpecimenId(row.specimen_id, row.test_name),
        test_key: canonicalTestKey(row.test_name, row.result),
        result: asText(row.result),
        percent: asText(row.percent),
        confidence_note: asText(row.context),
        source_file_name: asText(doc.file_name || doc.title),
        priority: 0,
      });
    }
  }
  return entries.filter((entry) => entry.specimen && entry.test_key && entry.result);
}

function consensusMatches(entry: any, specimen: string, testKey: string) {
  const entrySummary = summarySpecimenId(entry.specimen);
  const wantedSummary = summarySpecimenId(specimen);
  if (entry.specimen !== specimen && entrySummary !== wantedSummary) return false;
  if (entry.test_key === testKey) return true;
  if (testKey === 'crossmatch_strength') return entry.test_key === 'crossmatch_strength' || /\+[1-4]|microscopic/i.test(entry.result);
  if (testKey.startsWith('antigen:') && entry.test_key === 'antigen:other') {
    return canonicalTestKey('', entry.result) === testKey;
  }
  return false;
}

function deriveParticipantConsensus(questionOrRow: any, evaluationManifest: any[], round: any = null) {
  const specimen = questionOrRow?.specimen
    ? canonicalSpecimenId(questionOrRow.specimen, questionOrRow.test_name)
    : questionSpecimenId(questionOrRow);
  const testKey = questionOrRow?.test_name
    ? canonicalTestKey(questionOrRow.test_name, questionOrRow.lab_result)
    : questionTestKey(questionOrRow);
  const matches = participantConsensusEntries(evaluationManifest, round)
    .filter((entry) => consensusMatches(entry, specimen, testKey))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || (percentNumber(b.percent) || -1) - (percentNumber(a.percent) || -1));
  if (!matches.length) return null;
  if (testKey === 'antibody_identification') {
    const topPriority = Number(matches[0].priority || 0);
    const priorityMatches = matches.filter((entry) => Number(entry.priority || 0) === topPriority);
    const topPercent = percentNumber(priorityMatches[0]?.percent);
    const candidateRows = priorityMatches.filter((entry) => {
      const p = percentNumber(entry.percent);
      return Number.isFinite(p) && (p >= 50 || (Number.isFinite(topPercent) && Math.abs(p - topPercent) < 0.01));
    });
    const labels = new Map<string, string>();
    for (const entry of candidateRows.length ? candidateRows : priorityMatches.slice(0, 1)) {
      for (const label of capAntibodyLabelsFromText(entry.result)) {
        labels.set(label.match(/^(\d{3})/)?.[1] || label, label);
      }
    }
    const result = labels.size
      ? [...labels.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, label]) => label).join('; ')
      : canonicalAntibodyAnswerText(matches[0].result);
    return {
      result,
      percent: matches[0].percent,
      source_file_names: [...new Set(priorityMatches.map((entry) => entry.source_file_name).filter(Boolean))],
      note: matches[0].confidence_note,
    };
  }
  return {
    result: matches[0].result,
    percent: matches[0].percent,
    source_file_names: [...new Set(matches.map((entry) => entry.source_file_name).filter(Boolean))],
    note: matches[0].confidence_note,
  };
}

function submittedEvaluationRows(evaluationManifest: any[]) {
  const rows: any[] = [];
  for (const doc of evaluationManifest.filter((item: any) => item.category === 'submission_form')) {
    for (const sourceRow of doc.extraction?.evaluation_rows ?? []) {
      const specimen = summarySpecimenId(sourceRow.specimen_id, sourceRow.test_name);
      rows.push({
        program: specimen.startsWith('JE-') ? 'JE' : 'J',
        specimen,
        test_name: canonicalTestLabel(sourceRow.test_name, sourceRow.your_result),
        lab_result: asText(sourceRow.your_result || sourceRow.intended_response),
        intended_response: '',
        official_grade: '',
        peer_result: '',
        majority_percent: '',
        challenge_type: 'unknown',
        consensus_alignment: 'unclear',
        internal_review_status: 'pending',
        review_required: false,
        review_reason: '',
        assessment: 'pending',
        note: asText(sourceRow.note),
        _submission_source_file_name: asText(doc.file_name || doc.title),
      });
    }
  }
  return rows;
}


function antigenLabelFromSubmittedValue(value: unknown) {
  const text = asText(value);
  const catalogLabels = capAntibodyLabelsFromText(text);
  const catalogAnti = catalogLabels[0]?.match(/Anti-(C|c|E|e|K|k|Fya|Fyb|Jka|Jkb|Lea|Leb|P1|M|N|S|s)\b/);
  if (catalogAnti) return catalogAnti[1];
  const anti = text.match(/Anti-(C|c|E|e|K|k|Fya|Fyb|Jka|Jkb|Lea|Leb|P1|M|N|S|s)\b/);
  if (anti) return anti[1];
  const cleaned = text.replace(/^\s*\d{3}\s*[│|:]\s*/, '').replace(/^Anti-/i, '').trim();
  return cleaned || text;
}

function resultPayloadEvaluationRows(payload: any, round: any) {
  if (!payload || typeof payload !== 'object') return [];
  const rows: any[] = [];
  const add = (specimenValue: unknown, testName: unknown, result: unknown, note = '') => {
    const labResult = asText(result);
    if (!labResult) return;
    const specimen = summarySpecimenId(specimenValue, testName);
    rows.push({
      program: specimen.startsWith('JE-') ? 'JE' : asText(round?.program_code || round?.program_name || 'EQA'),
      specimen,
      test_name: canonicalTestLabel(testName, labResult),
      lab_result: labResult,
      intended_response: '',
      official_grade: '',
      peer_result: '',
      majority_percent: '',
      challenge_type: 'unknown',
      consensus_alignment: 'unclear',
      internal_review_status: 'pending',
      review_required: false,
      review_reason: '',
      assessment: 'pending',
      note: asText(note),
      _live_result_source: true,
    });
  };

  const profile = resolveProgramProfile(round);
  if (profile.code === 'CAP_J_JE' || asText(payload.schema).startsWith('cap-j-je')) {
    for (const [specimen, value] of Object.entries(payload.specimens ?? {})) {
      const item: any = value ?? {};
      add(specimen, 'ABO Group', item.abo);
      add(specimen, 'Rh Type', item.rh);
      add(specimen, 'Unexpected Antibody Detection', item.screen);
      const antibodies = [asText(item.antibody), asText(item.additional_antibodies)].filter(Boolean).join('; ');
      add(specimen, 'Antibody Identification', antibodies);
      add(specimen, 'Crossmatch/Compatibility Testing', item.crossmatch);
      add(specimen, 'Crossmatch Strength of Reaction', item.strength);
    }
    for (const [specimen, value] of Object.entries(payload.antigen_typing ?? {})) {
      const item: any = value ?? {};
      for (const antigen of ['C','E','c','e']) add(specimen, `${antigen} Type`, item[antigen]);
      const otherRows = Array.isArray(item.other_antigens) ? item.other_antigens : [];
      for (const other of otherRows) {
        const antigen = antigenLabelFromSubmittedValue(other?.antigen || other?.name || other?.antisera);
        if (antigen) add(specimen, `${antigen} Type`, other?.result, `รายงานจากช่อง Antigen อื่น: ${asText(other?.antigen || other?.name || other?.antisera)}`);
      }
    }
    return rows;
  }

  const schema = round?.generated_result_form_schema && typeof round.generated_result_form_schema === 'object'
    ? round.generated_result_form_schema
    : null;
  const programBySpecimen = new Map<string, any>();
  for (const program of schema?.programs ?? []) {
    for (const specimen of program?.specimens ?? []) programBySpecimen.set(asText(specimen?.id || specimen?.label), program);
  }
  for (const [specimen, value] of Object.entries(payload.specimens ?? {})) {
    const item: any = value ?? {};
    const program = programBySpecimen.get(specimen);
    const fieldMap = new Map<string, any>((program?.specimen_fields ?? []).map((field: any) => [asText(field?.key), field]));
    for (const [key, result] of Object.entries(item)) {
      if (key === 'notes' || typeof result === 'object') continue;
      const field = fieldMap.get(key);
      add(specimen, asText(field?.label || key), result);
    }
  }
  const antigenSectionMap = new Map<string, any>((schema?.antigen_sections ?? []).map((section: any) => [asText(section?.specimen_id), section]));
  for (const [specimen, value] of Object.entries(payload.antigen_typing ?? {})) {
    const item: any = value ?? {};
    const section = antigenSectionMap.get(specimen);
    const fieldMap = new Map<string, any>((section?.fields ?? []).map((field: any) => [asText(field?.key), field]));
    for (const [key, result] of Object.entries(item)) {
      if (key === 'notes' || typeof result === 'object') continue;
      const field = fieldMap.get(key);
      add(specimen, asText(field?.label || key), result);
    }
  }
  return rows;
}

function officialEvaluationRows(evaluationManifest: any[]) {
  const rows: any[] = [];
  for (const doc of evaluationManifest.filter((item: any) => item.category === 'official_result')) {
    for (const sourceRow of doc.extraction?.evaluation_rows ?? []) {
      const specimen = summarySpecimenId(sourceRow.specimen_id, sourceRow.test_name);
      const testName = canonicalTestLabel(sourceRow.test_name, sourceRow.your_result);
      const challengeText = `${asText(sourceRow.challenge_type)} ${asText(sourceRow.grade)} ${asText(sourceRow.note)}`;
      const educational = /educational|see\s*note\s*\[?26\]?|not\s*graded/i.test(challengeText)
        || (!asText(sourceRow.intended_response) && /26/.test(challengeText));
      const grade = asText(sourceRow.grade);
      const assessment = educational ? 'educational'
        : /good|satisfactory|successful|pass/i.test(grade) ? 'pass'
        : /unsatisfactory|unacceptable|fail/i.test(grade) ? 'fail'
        : 'pending';
      rows.push({
        program: specimen.startsWith('JE-') ? 'JE' : 'J',
        specimen,
        test_name: testName,
        lab_result: asText(sourceRow.your_result),
        intended_response: asText(sourceRow.intended_response),
        official_grade: grade,
        peer_result: '',
        majority_percent: '',
        challenge_type: educational ? 'educational' : 'graded',
        consensus_alignment: educational ? 'unclear' : 'not_applicable',
        internal_review_status: educational ? 'pending' : 'not_applicable',
        review_required: educational,
        review_reason: educational ? 'รอเทียบกับคำตอบส่วนใหญ่จาก Participant Summary' : '',
        assessment,
        note: asText(sourceRow.note),
        _source_file_name: asText(doc.file_name || doc.title),
      });
    }
  }
  return rows;
}

function splitSummaryRow(row: any) {
  const specimen = summarySpecimenId(row?.specimen, row?.test_name);
  const sourceTest = asText(row?.test_name);
  const definitions = [
    ['abo', 'ABO Group', /\babo\b/i],
    ['rh', 'Rh Type', /\brh(?:\(d\))?\s*(?:type|typing)?\b/i],
    ['antibody_screen', 'Unexpected Antibody Detection', /unexpected\s+antibody\s+detection|antibody\s+(?:screen|detection)/i],
    ['antibody_identification', 'Antibody Identification', /antibody\s+identification|\bab\s*id\b/i],
    ['crossmatch', 'Crossmatch\/Compatibility Testing', /crossmatch|compatibility\s+testing/i],
  ] as const;
  const matched = definitions.filter(([, , regex]) => regex.test(sourceTest));
  if (!/^J-0[1-5]$/.test(specimen) || matched.length <= 1) {
    return [{ ...row, specimen, test_name: canonicalTestLabel(row?.test_name, row?.lab_result) }];
  }
  const fields = ['lab_result','intended_response','official_grade','peer_result','majority_percent'];
  const segmented: Record<string, string[]> = {};
  for (const field of fields) {
    const raw = asText(row?.[field]).replace(/<br\s*\/?\s*>/gi, '\n');
    segmented[field] = raw.split(/\s*(?:;|\n|\r|\u2022|\|\|)\s*/).map((item) => item.trim()).filter(Boolean);
  }
  return matched.map(([, label], index) => {
    const next: any = { ...row, specimen, test_name: label };
    for (const field of fields) {
      const parts = segmented[field];
      next[field] = parts.length === matched.length ? (parts[index] || '') : (parts[index] || (parts.length === 1 ? parts[0] : ''));
    }
    return next;
  });
}

function normalizeOfficialSpecimenSummaries(generatedRows: any[], evaluationManifest: any[], round: any = null, liveRows: any[] = []) {
  const candidates = [
    ...(Array.isArray(generatedRows) ? generatedRows.flatMap(splitSummaryRow) : []),
    ...submittedEvaluationRows(evaluationManifest),
    ...officialEvaluationRows(evaluationManifest),
    ...(Array.isArray(liveRows) ? liveRows : []),
  ];
  const byKey = new Map<string, any>();
  for (const raw of candidates) {
    const specimen = summarySpecimenId(raw?.specimen, raw?.test_name);
    const testKey = canonicalTestKey(raw?.test_name, raw?.lab_result);
    if (!specimen || !testKey) continue;
    const key = `${specimen}|${testKey}`;
    const previous = byKey.get(key) ?? {};
    const officialSource = Boolean(raw?._source_file_name);
    const liveSource = Boolean(raw?._live_result_source);
    byKey.set(key, {
      ...previous,
      ...raw,
      program: asText(raw?.program) || asText(previous.program) || (specimen.startsWith('JE-') ? 'JE' : 'J'),
      specimen,
      test_name: canonicalTestLabel(raw?.test_name || previous.test_name, raw?.lab_result || previous.lab_result),
      lab_result: liveSource
        ? (asText(raw?.lab_result) || asText(previous.lab_result))
        : officialSource
          ? (asText(raw?.lab_result) || asText(previous.lab_result))
          : (asText(previous.lab_result) || asText(raw?.lab_result)),
      intended_response: officialSource ? (asText(raw?.intended_response) || asText(previous.intended_response)) : (asText(previous.intended_response) || asText(raw?.intended_response)),
      official_grade: officialSource ? (asText(raw?.official_grade) || asText(previous.official_grade)) : (asText(previous.official_grade) || asText(raw?.official_grade)),
      note: [asText(previous.note), asText(raw?.note)].filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).join(' · '),
    });
  }
  const normalized = [...byKey.values()].map((row) => {
    const testKey = canonicalTestKey(row.test_name, row.lab_result);
    const consensus = deriveParticipantConsensus(row, evaluationManifest, round);
    const challengeText = `${asText(row.challenge_type)} ${asText(row.official_grade)} ${asText(row.note)}`;
    const educational = /educational|see\s*note\s*\[?26\]?|not[_\s-]*graded/i.test(challengeText)
      || asText(row.challenge_type).toLowerCase() === 'educational'
      || (Boolean(consensus) && (summarySpecimenId(row.specimen) === 'J-06R' || summarySpecimenId(row.specimen) === 'JE-07' || summarySpecimenId(row.specimen) === 'JE-07R'));
    const peerResult = consensus?.result || asText(row.peer_result);
    const majorityPercent = consensus?.percent || asText(row.majority_percent);
    if (!educational) {
      const grade = asText(row.official_grade);
      const assessment = /good|satisfactory|successful|pass/i.test(grade) ? 'pass'
        : /unsatisfactory|unacceptable|fail/i.test(grade) ? 'fail'
        : (['pass','fail'].includes(asText(row.assessment)) ? asText(row.assessment) : 'pending');
      return {
        ...row,
        challenge_type: 'graded',
        peer_result: peerResult,
        majority_percent: majorityPercent,
        consensus_alignment: 'not_applicable',
        internal_review_status: 'not_applicable',
        review_required: false,
        review_reason: '',
        assessment,
      };
    }
    const labKey = canonicalResultKey(row.lab_result, testKey);
    const peerKey = canonicalResultKey(peerResult, testKey);
    if (labKey && peerKey && labKey === peerKey) {
      return {
        ...row,
        challenge_type: 'educational',
        intended_response: asText(row.intended_response) || peerResult,
        peer_result: peerResult,
        majority_percent: majorityPercent,
        consensus_alignment: 'aligned',
        internal_review_status: 'acceptable',
        review_required: false,
        review_reason: 'ผลที่ห้องรายงานตรงกับคำตอบส่วนใหญ่ของผู้เข้าร่วม',
        assessment: 'educational',
      };
    }
    if (!labKey || !peerKey) {
      return {
        ...row,
        challenge_type: 'educational',
        peer_result: peerResult,
        majority_percent: majorityPercent,
        consensus_alignment: 'unclear',
        internal_review_status: 'pending',
        review_required: true,
        review_reason: 'ข้อมูลผลของห้องหรือ Participant Summary ยังไม่ครบ กรุณาตรวจเอกสารต้นทาง',
        assessment: 'pending',
      };
    }
    return {
      ...row,
      challenge_type: 'educational',
      intended_response: asText(row.intended_response) || peerResult,
      peer_result: peerResult,
      majority_percent: majorityPercent,
      consensus_alignment: 'minority',
      internal_review_status: 'needs_explanation',
      review_required: true,
      review_reason: 'ผลที่ห้องรายงานต่างจากคำตอบส่วนใหญ่ของผู้เข้าร่วม กรุณาทบทวนและชี้แจงเหตุผล',
      assessment: 'educational',
    };
  });
  const rank = (row: any) => {
    const specimen = summarySpecimenId(row.specimen);
    const specimenNumber = Number(specimen.match(/(\d{2})/)?.[1] || 99);
    const programRank = specimen.startsWith('JE-') ? 100 : 0;
    const testOrder: Record<string, number> = { abo:10, rh:20, antibody_screen:30, antibody_identification:40, crossmatch:50, crossmatch_strength:55 };
    const antigenOrder: Record<string, number> = { 'antigen:C':60, 'antigen:E':61, 'antigen:c':62, 'antigen:e':63, 'antigen:K':64 };
    const testKey = canonicalTestKey(row.test_name, row.lab_result);
    const antigenRank = testKey.startsWith('antigen:') ? (antigenOrder[testKey] ?? 70) : 90;
    return programRank + specimenNumber * 10 + (testOrder[testKey] ?? antigenRank);
  };
  return normalized.sort((a, b) => rank(a) - rank(b) || asText(a.test_name).localeCompare(asText(b.test_name)));
}


function buildDeterministicOfficialSummary(round: any, evaluationManifest: any[], liveRows: any[]) {
  const specimenSummaries = normalizeOfficialSpecimenSummaries([], evaluationManifest, round, liveRows);
  const graded = specimenSummaries.filter((row: any) => row.challenge_type === 'graded');
  const educational = specimenSummaries.filter((row: any) => row.challenge_type === 'educational');
  const passCount = graded.filter((row: any) => row.assessment === 'pass').length;
  const failCount = graded.filter((row: any) => row.assessment === 'fail').length;
  const pendingGraded = graded.filter((row: any) => !['pass','fail'].includes(asText(row.assessment))).length;
  const alignedCount = educational.filter((row: any) => row.consensus_alignment === 'aligned').length;
  const minorityCount = educational.filter((row: any) => row.consensus_alignment === 'minority').length;
  const pendingEducational = educational.filter((row: any) => row.consensus_alignment === 'unclear').length;
  const scoreTexts = evaluationManifest
    .filter((doc: any) => doc.category === 'official_result')
    .flatMap((doc: any) => Array.isArray(doc.extraction?.score_summaries) ? doc.extraction.score_summaries : [])
    .map(asText)
    .filter(Boolean);
  const evaluationMode = graded.length && educational.length ? 'mixed'
    : graded.length ? 'graded'
    : educational.length ? 'educational'
    : 'insufficient';
  const outcome = failCount > 0 ? 'fail'
    : graded.length && pendingGraded === 0 ? 'pass'
    : graded.length ? 'partial'
    : 'pending';
  const reviewTopics = specimenSummaries
    .filter((row: any) => row.review_required)
    .map((row: any) => `${asText(row.specimen)} ${asText(row.test_name)}: ${asText(row.review_reason)}`)
    .filter(Boolean);
  return {
    evaluation_mode: evaluationMode,
    score_text: scoreTexts.join(' · '),
    score_source: scoreTexts.length ? 'official_evaluation' : 'not_available',
    outcome,
    lab_result_summary: `สรุปผล ${specimenSummaries.length} รายการจากผลที่ห้องบันทึกและรายงานผู้ให้บริการ`,
    intended_response_summary: graded.length ? `รายการให้คะแนน ${graded.length} รายการ: ผ่าน ${passCount}, ไม่ผ่าน ${failCount}, รอตรวจ ${pendingGraded}` : 'ไม่มีรายการที่มี Grade ทางการ',
    grade_summary: graded.length ? `ผลประเมินทางการ: ผ่าน ${passCount}/${graded.length}${failCount ? `, ไม่ผ่าน ${failCount}` : ''}` : 'Educational / Not formally evaluated',
    peer_comparison_summary: educational.length ? `Educational ${educational.length} รายการ: สอดคล้องกลุ่มส่วนใหญ่ ${alignedCount}, คำตอบส่วนน้อย ${minorityCount}, รอตรวจ ${pendingEducational}` : 'ไม่มี Educational Challenge',
    review_topics: [...new Set(reviewTopics)],
    specimen_summaries: specimenSummaries,
    round_summary: `${resolveProgramProfile(round).label}: ใช้ Intended Response/Grade สำหรับรายการ graded และใช้คำตอบส่วนใหญ่จาก Participant Summary สำหรับ Educational Challenge`,
  };
}

function resolveChoiceIndexFromAnswer(question: any, answerText: unknown) {
  const expected = canonicalResultKey(answerText, questionTestKey(question));
  if (!expected) return 0;
  const choices = (question?.ec_question_choices ?? []).slice().sort((a: any, b: any) => Number(a.choice_order || 0) - Number(b.choice_order || 0));
  const index = choices.findIndex((choice: any) => canonicalResultKey(choice.choice_text, questionTestKey(question)) === expected);
  return index >= 0 ? index + 1 : 0;
}


function deterministicAnswerForQuestion(question: any, evaluationManifest: any[], round: any) {
  const specimen = summarySpecimenId(questionSpecimenId(question), question?.prompt);
  const testKey = questionTestKey(question);
  if (!specimen || !testKey) return null;
  const officialRows = officialEvaluationRows(evaluationManifest).flatMap(splitSummaryRow);
  const official = officialRows.find((row: any) => summarySpecimenId(row.specimen, row.test_name) === specimen && canonicalTestKey(row.test_name, row.lab_result) === testKey);
  const consensusTestName = testKey.startsWith('antigen:') ? `${testKey.slice('antigen:'.length)} Type` : canonicalTestLabel(testKey);
  const consensus = deriveParticipantConsensus({ specimen, test_name: consensusTestName, lab_result: '' }, evaluationManifest, round);
  const challengeText = `${asText(official?.challenge_type)} ${asText(official?.official_grade)} ${asText(official?.note)}`;
  const educational = /educational|see\s*note\s*\[?26\]?|not[_\s-]*graded/i.test(challengeText)
    || Boolean(consensus && (specimen === 'J-06R' || specimen === 'JE-07' || specimen === 'JE-07R'));
  if (educational && consensus?.result) {
    return {
      _deterministic: true,
      challenge_type: 'educational',
      answer_basis: 'participant_consensus',
      correct_choice_index: 0,
      correct_answer_text: testKey === 'antibody_identification' ? canonicalAntibodyAnswerText(consensus.result) : consensus.result,
      consensus_result: testKey === 'antibody_identification' ? canonicalAntibodyAnswerText(consensus.result) : consensus.result,
      consensus_percent: consensus.percent,
      comparison_note: 'คำตอบส่วนใหญ่ของผู้เข้าร่วมจาก Participant Summary; รายการนี้ไม่มี Grade ทางการ',
      explanation: `สร้างจากข้อมูลอ้างอิงที่บันทึกไว้${consensus.note ? `: ${consensus.note}` : ''}`,
      confidence: 'high',
      evidence_file_names: consensus.source_file_names,
    };
  }
  if (official && asText(official.intended_response)) {
    return {
      _deterministic: true,
      challenge_type: 'graded',
      answer_basis: 'official_intended_response',
      correct_choice_index: 0,
      correct_answer_text: testKey === 'antibody_identification' ? canonicalAntibodyAnswerText(official.intended_response) : asText(official.intended_response),
      consensus_result: '',
      consensus_percent: '',
      comparison_note: 'Intended Response จาก Official Evaluation',
      explanation: `อ้างอิง ${asText(official._source_file_name || 'Official Evaluation')}`,
      confidence: 'high',
      evidence_file_names: [asText(official._source_file_name)].filter(Boolean),
    };
  }
  return null;
}

function enrichGeneratedAnswer(question: any, answer: any, evaluationManifest: any[], hasParticipantSummary: boolean, round: any = null) {
  const enriched = { ...answer };
  const testKey = questionTestKey(question);
  const specimen = questionSpecimenId(question);
  if (testKey === 'antibody_identification') {
    enriched.correct_answer_text = canonicalAntibodyAnswerText(enriched.correct_answer_text || enriched.consensus_result);
    enriched.consensus_result = canonicalAntibodyAnswerText(enriched.consensus_result || enriched.correct_answer_text);
  }

  const challengeType = asText(enriched.challenge_type).toLowerCase();
  const answerBasis = asText(enriched.answer_basis).toLowerCase();
  const educationalSpecimen = /^(?:J-06R?|JE-07R?)$/.test(specimen);
  const invalidEducational = challengeType === 'educational'
    && (answerBasis !== 'participant_consensus' || !asText(enriched.correct_answer_text || enriched.consensus_result));
  const mustUseParticipantConsensus = challengeType === 'educational'
    || answerBasis === 'participant_consensus'
    || answerBasis === 'insufficient'
    || challengeType === 'unknown'
    || educationalSpecimen;

  // Participant Summary is the deterministic source for Educational Challenge keys.
  // Always replace an AI-proposed educational answer with the actual majority result when available.
  if (hasParticipantSummary && (mustUseParticipantConsensus || invalidEducational)) {
    const consensus = deriveParticipantConsensus(question, evaluationManifest, round);
    if (consensus?.result) {
      enriched.challenge_type = 'educational';
      enriched.answer_basis = 'participant_consensus';
      enriched.correct_choice_index = 0;
      enriched.correct_answer_text = testKey === 'antibody_identification' ? canonicalAntibodyAnswerText(consensus.result) : consensus.result;
      enriched.consensus_result = enriched.correct_answer_text;
      enriched.consensus_percent = consensus.percent;
      enriched.comparison_note = 'คำตอบส่วนใหญ่ของผู้เข้าร่วมจาก Participant Summary; รายการนี้ไม่มี Grade ทางการ';
      enriched.explanation = `อ้างอิง Participant Summary${consensus.note ? `: ${consensus.note}` : ''}`;
      enriched.confidence = 'high';
      enriched.evidence_file_names = consensus.source_file_names;
    }
  }
  return enriched;
}

const EXTRACTABLE_CATEGORIES = new Set([
  'source_document',
  'instruction',
  'raw_result_image',
  'antibody_panel',
  'submission_form',
  'official_result',
  'participant_summary',
]);

function extractionSchema() {
  const simpleTextArray = { type: 'array', items: { type: 'string' } };
  const codeItem = {
    type: 'object',
    additionalProperties: false,
    required: ['context', 'code', 'label'],
    properties: {
      context: { type: 'string' },
      code: { type: 'string' },
      label: { type: 'string' },
    },
  };
  const antigenItem = {
    type: 'object',
    additionalProperties: false,
    required: ['antigen', 'result'],
    properties: {
      antigen: { type: 'string' },
      result: { type: 'string' },
    },
  };
  const cellItem = {
    type: 'object',
    additionalProperties: false,
    required: ['cell_no', 'phenotype', 'donor_number', 'antigens', 'special_notes'],
    properties: {
      cell_no: { type: 'string' },
      phenotype: { type: 'string' },
      donor_number: { type: 'string' },
      antigens: { type: 'array', items: antigenItem },
      special_notes: { type: 'string' },
    },
  };
  const providerChoiceItem = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'label'],
    properties: {
      code: { type: 'string' },
      label: { type: 'string' },
    },
  };
  const providerQuestionItem = {
    type: 'object',
    additionalProperties: false,
    required: ['question_number', 'section_title', 'case_reference', 'prompt', 'question_type', 'choices', 'source_location'],
    properties: {
      question_number: { type: 'string' },
      section_title: { type: 'string' },
      case_reference: { type: 'string' },
      prompt: { type: 'string' },
      question_type: { type: 'string', enum: ['single_choice', 'multiple_choice', 'short_answer', 'text'] },
      choices: { type: 'array', items: providerChoiceItem },
      source_location: { type: 'string' },
    },
  };
  const caseStudyItem = {
    type: 'object',
    additionalProperties: false,
    required: ['case_id', 'title', 'narrative', 'findings', 'source_location'],
    properties: {
      case_id: { type: 'string' },
      title: { type: 'string' },
      narrative: { type: 'string' },
      findings: simpleTextArray,
      source_location: { type: 'string' },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'schema_version',
      'summary_th',
      'document_role',
      'specimens',
      'test_groups',
      'instructions',
      'master_list_entries',
      'raw_observations',
      'panel_metadata',
      'screening_cells',
      'panel_cells',
      'evaluation_rows',
      'score_summaries',
      'participant_comparisons',
      'educational_consensus',
      'provider_questions',
      'case_studies',
      'warnings',
    ],
    properties: {
      schema_version: { type: 'string', enum: [EXTRACTION_SCHEMA_VERSION] },
      summary_th: { type: 'string' },
      document_role: { type: 'string' },
      specimens: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
          },
        },
      },
      test_groups: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'specimen_ids', 'fields', 'methods', 'units_and_precision', 'notes'],
          properties: {
            name: { type: 'string' },
            specimen_ids: simpleTextArray,
            fields: simpleTextArray,
            methods: simpleTextArray,
            units_and_precision: simpleTextArray,
            notes: { type: 'string' },
          },
        },
      },
      instructions: simpleTextArray,
      master_list_entries: { type: 'array', items: codeItem },
      raw_observations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['specimen_id', 'test_name', 'phase_or_cell', 'observation', 'source_location'],
          properties: {
            specimen_id: { type: 'string' },
            test_name: { type: 'string' },
            phase_or_cell: { type: 'string' },
            observation: { type: 'string' },
            source_location: { type: 'string' },
          },
        },
      },
      panel_metadata: {
        type: 'object',
        additionalProperties: false,
        required: ['manufacturer', 'product_name', 'panel_name', 'lot', 'expiration', 'method_notes'],
        properties: {
          manufacturer: { type: 'string' },
          product_name: { type: 'string' },
          panel_name: { type: 'string' },
          lot: { type: 'string' },
          expiration: { type: 'string' },
          method_notes: { type: 'string' },
        },
      },
      screening_cells: { type: 'array', items: cellItem },
      panel_cells: { type: 'array', items: cellItem },
      evaluation_rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['test_name', 'specimen_id', 'your_result', 'intended_response', 'grade', 'challenge_type', 'note'],
          properties: {
            test_name: { type: 'string' },
            specimen_id: { type: 'string' },
            your_result: { type: 'string' },
            intended_response: { type: 'string' },
            grade: { type: 'string' },
            challenge_type: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
      score_summaries: simpleTextArray,
      participant_comparisons: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['test_name', 'specimen_id', 'result', 'frequency', 'percent', 'context'],
          properties: {
            test_name: { type: 'string' },
            specimen_id: { type: 'string' },
            result: { type: 'string' },
            frequency: { type: 'string' },
            percent: { type: 'string' },
            context: { type: 'string' },
          },
        },
      },
      educational_consensus: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['test_name', 'specimen_id', 'consensus_result', 'percent', 'confidence_note'],
          properties: {
            test_name: { type: 'string' },
            specimen_id: { type: 'string' },
            consensus_result: { type: 'string' },
            percent: { type: 'string' },
            confidence_note: { type: 'string' },
          },
        },
      },
      provider_questions: { type: 'array', items: providerQuestionItem },
      case_studies: { type: 'array', items: caseStudyItem },
      warnings: simpleTextArray,
    },
  };
}

function extractionPrompt(round: any, doc: any) {
  const profile = resolveProgramProfile(round);
  const parsedFile = parseEqaFilename(doc.file_name);
  const roleHint = parsedFile.role || asText(doc.category);
  const focusedInstruction = parsedFile.role === 'BlankResultForm'
    ? 'ไฟล์นี้เป็น Blank Result Form: ตรวจทุกหน้าและทุกคอลัมน์ หาเลขข้อ คำถาม และวงกลมตัวเลือกทั้งหมดตามลำดับจริง โดยเฉพาะ Dry Challenge/Educational Challenge ห้ามเปลี่ยนเป็นคำถามทั่วไป'
    : parsedFile.role === 'KitInstruction'
      ? 'ไฟล์นี้เป็น Kit Instruction: หา Case Study/Dry Challenge พร้อมข้อมูลผู้ป่วย ผล ABO/Rh, screen, DAT, eluate และ additional studies ให้ครบ เพื่อเชื่อมกับ case_reference เดียวกัน'
      : 'ยึดบทบาทเอกสารและเนื้อหาจริงเป็นหลัก';
  return `
คุณเป็นนักเทคนิคการแพทย์และผู้จัดการคุณภาพด้านเวชศาสตร์บริการโลหิต
ให้อ่านเอกสารเพียงไฟล์เดียวอย่างละเอียด เพื่อสร้างข้อมูลสกัดที่ระบบจะนำไปใช้ต่อ โดยห้ามเดาข้อมูลที่ไม่ปรากฏ

รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
โปรแกรม: ${round.program_name}
รูปแบบระบบ: ${profile.label} (${profile.code})
กลุ่มการทดสอบที่มักพบ: ${profile.testHints.join(', ') || 'ยึดตามฟอร์มผู้ให้บริการ'}
ชื่อไฟล์: ${doc.file_name}
ชื่อรายการ: ${doc.title}
ประเภทเอกสาร: ${doc.category}
บทบาทจากชื่อไฟล์: ${roleHint}
คำสั่งเฉพาะไฟล์: ${focusedInstruction}
schema_version ที่ต้องส่งกลับ: ${EXTRACTION_SCHEMA_VERSION}

กติกาตามประเภท:
- source_document: เก็บรายการตัวอย่าง กลุ่มการทดสอบ ช่องกรอก ตัวเลือก รหัส หน่วย จำนวนทศนิยม และโครงสร้างฟอร์ม หากเอกสารมีโจทย์ข้อสอบจริงพร้อมตัวเลือก ให้ถอดลง provider_questions ตามต้นฉบับทุกข้อ ห้ามแต่งโจทย์ใหม่หรือสรุปทิ้ง
- instruction: เก็บวิธีปฏิบัติ ข้อควรระวัง เงื่อนไขรายงาน Master List และรหัสพร้อมชื่อ ห้ามถือเป็นเฉลยทางการ หากมี Case Study/Dry Challenge ให้ถอดข้อมูลกรณีศึกษาและผลตรวจลง case_studies เพื่อใช้ประกอบโจทย์จากแบบฟอร์ม
- raw_result_image: เก็บผลปฏิกิริยาที่มองเห็นจริง แยกตัวอย่าง การทดสอบ phase/cell และค่าที่อ่านได้ ห้ามสรุปผลสุดท้ายถ้าหลักฐานไม่พอ
- antibody_panel: เก็บข้อมูล Antigram/Panel cell โดยเฉพาะผู้ผลิต ชื่อผลิตภัณฑ์ panel, lot, วันหมดอายุ, screening cells และ panel cells ทุก cell พร้อม antigen profile; ใช้เป็นข้อมูลอ้างอิงสำหรับ Antibody Identification แต่ไม่ใช่ผลของตัวอย่าง
- submission_form: เก็บเฉพาะสิ่งที่ห้องปฏิบัติการกรอกส่งจริง ห้ามแปลงเป็นเฉลย
- official_result: เก็บ Test, Specimen, Your Result, Intended Response, Grade, คะแนน และแยก graded/educational จากข้อความจริง
- participant_summary: เก็บสถิติผู้เข้าร่วม ความถี่ ร้อยละ และ consensus โดยเฉพาะ Educational Challenge; ห้ามนำร้อยละมาเป็นคะแนนของห้อง

กติกาชื่อไฟล์ที่ต้องใช้ประกอบการแยกข้อมูล:
- รูปแบบภาพผล: Provider-Round_Specimen_Test_Qualifier_FileRole.ext เช่น CAP-JA-2026_J-01_ABO_RawResult.png
- AbID หลายภาพ/หลาย Panel: ใช้ PanelA, PanelB, PanelC; ภาพผลใช้ Cell01-06/Cell07-11 และ Antigram ใช้ Lot... เช่น CAP-JA-2026_J-01_AbID_PanelA_Lot8RA453_Antigram.png
- จับคู่ AbID ด้วย Provider-Round + Specimen + Test; จับคู่ภาพผลกับ Antigram ราย Panel ด้วย Panel ID และเรียง Cell ตามเลขเริ่มต้น
- Test token มาตรฐาน: ABO, Rh, AbScreen, AbID, Crossmatch, AgTyping, EluateAbID, DAT, CBC, WBCCount, AntibodyTiter, MultiTest
- FileRole มาตรฐาน: RawResult, Antigram, BlankResultForm, SubmittedResultForm, OfficialEvaluation, ParticipantSummary, KitInstruction
- หากชื่อไฟล์ขัดกับเนื้อหา ให้ยึดเนื้อหาและเพิ่มคำเตือนใน warnings ห้ามเดา

ข้อกำหนด:
1) specimen id, test name, code, lot และค่าปฏิกิริยาต้องคงตามเอกสาร
2) ถ้าเป็น Antibody panel ให้ถอด screening cells และ panel cells ให้ครบเท่าที่อ่านได้ โดยเก็บ antigen เป็นรายการ antigen/result เช่น D=+, C=0
3) ถ้าตารางหรือข้อความอ่านไม่ชัด ให้ใส่คำเตือนใน warnings ไม่สร้างค่าเอง
4) ไม่เก็บชื่อผู้ป่วย HN วันเกิด หรือข้อมูลส่วนบุคคล
5) summary_th และ notes เป็นภาษาไทย กระชับ แต่ข้อมูลตารางต้องละเอียดพอให้ระบบสร้างแบบกรอก ข้อสอบ และเฉลยต่อได้
6) ต้องส่ง schema_version = ${EXTRACTION_SCHEMA_VERSION} ตรงตามที่กำหนด
7) participant_summary ต้องสร้าง educational_consensus แยกตาม specimen_id + test_name และเลือกผลที่มีร้อยละสูงสุดจริงจากตาราง
8) Antibody Identification ที่ผลส่วนใหญ่มีหลาย antibody ให้รวมอยู่ใน consensus_result เดียว เช่น “115 │ Anti-E; 124 │ Anti-K” ห้ามแยกจนทำให้ดูเหมือนมีเพียง antibody เดียว
9) Antigen typing C, c, E, e, K และ antigen อื่น ต้องแยก test_name ต่อ antigen พร้อมผล Positive/Negative และร้อยละของแต่ละ antigen
10) Strength of Reaction ให้เก็บระดับที่มีความถี่สูงสุดเป็น educational_consensus แยกจากผล Positive/Negative ของ Crossmatch
11) ถ้าพบข้อสอบที่ผู้ให้บริการพิมพ์มาแล้ว ให้เก็บ provider_questions ครบทุกข้อ โดยคงเลขข้อ ข้อความโจทย์ รหัสตัวเลือก และข้อความตัวเลือกตามเอกสาร ห้ามเปลี่ยนเป็นคำถาม ABO/Rh/Screen แบบทั่วไป
12) question_type ใช้ single_choice เมื่อเลือกได้คำตอบเดียว, multiple_choice เมื่อเลือกได้มากกว่า 1 คำตอบ, short_answer/text เมื่อไม่มีตัวเลือก
13) case_reference ต้องใช้รหัสที่เชื่อมโจทย์กับกรณีศึกษา เช่น JE-14; ถ้าไม่ระบุในเอกสารให้ใช้หัวข้อ Dry Challenge/Case Study ที่ใกล้ที่สุด
14) case_studies ให้สรุป narrative และ findings เป็นภาษาไทยโดยคงตัวเลข หน่วย ชื่อวิธี และผลปฏิกิริยาตามต้นฉบับ พร้อมระบุ source_location เช่น page 4-5
15) provider_questions ไม่ใช่เฉลย ห้ามระบุคำตอบที่ถูกต้องจนกว่าจะมี Official Evaluation หรือ Participant Summary
`;
}

function compactExtraction(doc: any) {
  const source = doc.ai_extraction ?? {};
  const extraction = {
    schema_version: asText(source.schema_version),
    summary_th: asText(source.summary_th),
    document_role: asText(source.document_role),
    specimens: Array.isArray(source.specimens) ? source.specimens.slice(0, 100) : [],
    test_groups: Array.isArray(source.test_groups) ? source.test_groups.slice(0, 80) : [],
    instructions: Array.isArray(source.instructions) ? source.instructions.slice(0, 120) : [],
    master_list_entries: Array.isArray(source.master_list_entries) ? source.master_list_entries.slice(0, 350) : [],
    raw_observations: Array.isArray(source.raw_observations) ? source.raw_observations.slice(0, 250) : [],
    panel_metadata: source.panel_metadata ?? {},
    screening_cells: Array.isArray(source.screening_cells) ? source.screening_cells.slice(0, 10) : [],
    panel_cells: Array.isArray(source.panel_cells) ? source.panel_cells.slice(0, 30) : [],
    evaluation_rows: Array.isArray(source.evaluation_rows) ? source.evaluation_rows.slice(0, 250) : [],
    score_summaries: Array.isArray(source.score_summaries) ? source.score_summaries.slice(0, 80) : [],
    participant_comparisons: Array.isArray(source.participant_comparisons) ? source.participant_comparisons.slice(0, 300) : [],
    educational_consensus: Array.isArray(source.educational_consensus) ? source.educational_consensus.slice(0, 120) : [],
    provider_questions: Array.isArray(source.provider_questions) ? source.provider_questions.slice(0, 100) : [],
    case_studies: Array.isArray(source.case_studies) ? source.case_studies.slice(0, 40) : [],
    warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 80) : [],
  };
  return {
    id: doc.id,
    category: doc.category,
    title: doc.title,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
    extraction,
  };
}

function compactFormExtraction(doc: any) {
  const source = doc.ai_extraction ?? {};
  const isForm = asText(doc.category) === 'source_document';
  return {
    id: doc.id,
    category: doc.category,
    title: doc.title,
    file_name: doc.file_name,
    extraction: isForm ? {
      summary_th: asText(source.summary_th),
      specimens: Array.isArray(source.specimens) ? source.specimens.slice(0, 100) : [],
      test_groups: Array.isArray(source.test_groups) ? source.test_groups.slice(0, 100) : [],
      raw_observations: Array.isArray(source.raw_observations) ? source.raw_observations.slice(0, 180) : [],
      master_list_entries: Array.isArray(source.master_list_entries) ? source.master_list_entries.slice(0, 250) : [],
      warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 40) : [],
    } : {
      summary_th: asText(source.summary_th),
      master_list_entries: Array.isArray(source.master_list_entries) ? source.master_list_entries.slice(0, 350) : [],
      warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 30) : [],
    },
  };
}

function compactInstructionExtraction(doc: any) {
  const source = doc.ai_extraction ?? {};
  return {
    id: doc.id,
    category: doc.category,
    title: doc.title,
    file_name: doc.file_name,
    extraction: {
      summary_th: asText(source.summary_th),
      instructions: Array.isArray(source.instructions) ? source.instructions.slice(0, 140) : [],
      master_list_entries: Array.isArray(source.master_list_entries) ? source.master_list_entries.slice(0, 300) : [],
      warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 40) : [],
    },
  };
}

function compactQuestionExtraction(doc: any) {
  const source = doc.ai_extraction ?? {};
  const category = asText(doc.category);
  const extraction: Record<string, unknown> = {
    summary_th: asText(source.summary_th),
    specimens: Array.isArray(source.specimens) ? source.specimens.slice(0, 50) : [],
    test_groups: Array.isArray(source.test_groups) ? source.test_groups.slice(0, 50) : [],
    warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 20) : [],
  };
  if (category === 'raw_result_image') {
    extraction.raw_observations = Array.isArray(source.raw_observations) ? source.raw_observations.slice(0, 100) : [];
  } else if (category === 'antibody_panel') {
    extraction.panel_metadata = source.panel_metadata ?? {};
    extraction.screening_cells = Array.isArray(source.screening_cells) ? source.screening_cells.slice(0, 10) : [];
    extraction.panel_cells = Array.isArray(source.panel_cells) ? source.panel_cells.slice(0, 30) : [];
  } else if (category === 'instruction') {
    extraction.instructions = Array.isArray(source.instructions) ? source.instructions.slice(0, 35) : [];
    extraction.master_list_entries = Array.isArray(source.master_list_entries) ? source.master_list_entries.slice(0, 120) : [];
    extraction.provider_questions = Array.isArray(source.provider_questions) ? source.provider_questions.slice(0, 100) : [];
    extraction.case_studies = Array.isArray(source.case_studies) ? source.case_studies.slice(0, 40) : [];
  } else if (category === 'source_document') {
    extraction.raw_observations = Array.isArray(source.raw_observations) ? source.raw_observations.slice(0, 45) : [];
    extraction.master_list_entries = Array.isArray(source.master_list_entries) ? source.master_list_entries.slice(0, 100) : [];
    extraction.provider_questions = Array.isArray(source.provider_questions) ? source.provider_questions.slice(0, 100) : [];
    extraction.case_studies = Array.isArray(source.case_studies) ? source.case_studies.slice(0, 40) : [];
  }
  return { id: doc.id, category, title: doc.title, file_name: doc.file_name, mime_type: doc.mime_type, extraction };
}

function normalizeCaseKey(value: unknown) {
  return asText(value).toUpperCase().replace(/[^A-Z0-9ก-๙]+/g, '');
}

function truncateText(value: unknown, maxLength = 1200) {
  const text = asText(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function providerChoiceLabel(choice: any) {
  const code = asText(choice?.code);
  const label = asText(choice?.label);
  if (code && label) return `${code} │ ${label}`;
  return label || code;
}

function buildProviderQuestionBlueprint(documents: any[]) {
  const caseStudies: any[] = [];
  for (const doc of documents) {
    for (const item of Array.isArray(doc.ai_extraction?.case_studies) ? doc.ai_extraction.case_studies : []) {
      const caseId = asText(item?.case_id);
      const title = asText(item?.title);
      const key = normalizeCaseKey(caseId || title);
      caseStudies.push({ ...item, _doc: doc, _key: key });
    }
  }

  const findCase = (question: any) => {
    const target = normalizeCaseKey(question?.case_reference || question?.section_title);
    if (target) {
      const exact = caseStudies.find((item) => item._key === target);
      if (exact) return exact;
      const partial = caseStudies.find((item) => item._key && (item._key.includes(target) || target.includes(item._key)));
      if (partial) return partial;
    }
    return caseStudies.length === 1 ? caseStudies[0] : null;
  };

  const caseContext = (item: any) => {
    if (!item) return '';
    const title = asText(item.title || item.case_id);
    const narrative = truncateText(item.narrative, 1100);
    const findings = (Array.isArray(item.findings) ? item.findings : [])
      .map((row: any) => truncateText(row, 260))
      .filter(Boolean)
      .slice(0, 12);
    return [
      title ? `ข้อมูลกรณีศึกษา ${title}` : 'ข้อมูลกรณีศึกษา',
      narrative,
      findings.length ? `ผลตรวจและข้อมูลสำคัญ: ${findings.join('; ')}` : '',
    ].filter(Boolean).join(' — ');
  };

  const results: any[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    const questions = Array.isArray(doc.ai_extraction?.provider_questions) ? doc.ai_extraction.provider_questions : [];
    for (const item of questions) {
      const prompt = asText(item?.prompt);
      if (!prompt) continue;
      const questionType = asText(item?.question_type) || 'single_choice';
      const choices = (Array.isArray(item?.choices) ? item.choices : [])
        .map(providerChoiceLabel)
        .filter(Boolean)
        .slice(0, 20);
      if (questionType === 'single_choice' && choices.length < 2) continue;
      const duplicateKey = `${normalizeCaseKey(item?.case_reference)}|${asText(item?.question_number)}|${normalizeCaseKey(prompt)}`;
      if (seen.has(duplicateKey)) continue;
      seen.add(duplicateKey);

      const matchedCase = findCase(item);
      const context = caseContext(matchedCase);
      const number = asText(item?.question_number);
      const finalPrompt = [context, `${number ? `ข้อ ${number}: ` : ''}${prompt}`].filter(Boolean).join('\n\n');
      const sourceNames = [asText(doc.file_name), asText(matchedCase?._doc?.file_name)].filter(Boolean);
      results.push({
        question_kind: 'provider_form_question',
        question_type: questionType,
        specimen: asText(item?.case_reference),
        antigen_name: '',
        section_title: asText(item?.section_title) || asText(matchedCase?.title) || 'ข้อสอบจากแบบฟอร์มผู้ให้บริการ',
        prompt: finalPrompt,
        source_file_names: [...new Set(sourceNames)],
        choices,
        is_critical: false,
        points: 1,
      });
    }
  }
  return results.slice(0, 100);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let runId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
    const privateBucket = Deno.env.get('PRIVATE_BUCKET') || 'eqa-competency-private';
    if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase server configuration missing' }, 500);

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Missing authentication token' }, 401);

    admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !callerData.user) return json({ error: 'Invalid session' }, 401);
    const callerId = callerData.user.id;

    const { data: roles, error: roleError } = await admin
      .from('ec_user_roles')
      .select('role')
      .eq('profile_id', callerId)
      .in('role', ['admin', 'qm']);
    if (roleError || !roles?.length) return json({ error: 'ต้องใช้บทบาทผู้ดูแลระบบหรือผู้จัดการคุณภาพ' }, 403);

    const body = await req.json();
    const action = asText(body.action);
    const roundId = asText(body.round_id);
    if (!roundId) return json({ error: 'Missing round_id' }, 400);
    if (!['extract_document', 'generate_form_instructions', 'generate_form_schema', 'generate_instruction_summary', 'generate_questions', 'generate_questions_batch', 'generate_answer_keys_batch', 'generate_official_summary', 'generate_answers'].includes(action)) return json({ error: 'Unknown action' }, 400);
    if (!openaiKey && action !== 'generate_official_summary') return json({ error: 'ยังไม่ได้ตั้งค่า OPENAI_API_KEY ใน Supabase Edge Function Secrets' }, 500);

    const { data: round, error: roundError } = await admin
      .from('ec_eqa_rounds')
      .select('*')
      .eq('id', roundId)
      .is('archived_at', null)
      .single();
    if (roundError || !round) return json({ error: 'ไม่พบรอบ EQA' }, 404);

    // Edge Runtime อาจหยุดงานด้วย 546 ก่อนเข้า catch จึงปิด run เก่าที่ค้างทุกครั้งก่อนเริ่มงานใหม่
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await admin.from('ec_ai_generation_runs').update({
      status: 'failed',
      error_message: 'งานใช้เวลานานเกินขีดจำกัดและถูกยุติ กรุณาเริ่มเฉพาะขั้นตอนที่ยังไม่สำเร็จ',
      completed_at: new Date().toISOString(),
    }).eq('round_id', roundId).eq('status', 'processing').lt('created_at', staleCutoff);

    if (action === 'extract_document') {
      const documentId = asText(body.document_id);
      if (!documentId) return json({ error: 'Missing document_id' }, 400);

      const { data: doc, error: docError } = await admin
        .from('ec_round_documents')
        .select('*')
        .eq('id', documentId)
        .eq('round_id', roundId)
        .is('archived_at', null)
        .single();
      if (docError || !doc) return json({ error: 'ไม่พบเอกสารที่ต้องการอ่าน' }, 404);
      if (!EXTRACTABLE_CATEGORIES.has(asText(doc.category))) {
        return json({ error: 'เอกสารประเภทนี้ไม่จำเป็นต้องส่งให้ AI อ่าน' }, 400);
      }
      if (!(doc.mime_type === 'application/pdf' || String(doc.mime_type ?? '').startsWith('image/'))) {
        return json({ error: 'รองรับการอ่านด้วย AI เฉพาะ PDF, JPG, PNG และ WebP' }, 400);
      }

      const cacheValid = body.force !== true
        && doc.ai_extraction_status === 'completed'
        && doc.ai_extraction
        && isExtractionSchemaCompatible(doc)
        && Number(doc.ai_extraction_file_size || 0) === Number(doc.file_size || 0);
      if (cacheValid) {
        return json({
          ok: true,
          skipped: true,
          document_id: doc.id,
          file_name: doc.file_name,
          summary: asText(doc.ai_extraction?.summary_th),
        });
      }

      const { data: run, error: runError } = await admin.from('ec_ai_generation_runs').insert({
        round_id: roundId,
        generation_type: 'document_extract',
        status: 'processing',
        source_document_ids: [doc.id],
        model,
        created_by: callerId,
        progress_current: 0,
        progress_total: 1,
        progress_message: `กำลังอ่าน ${doc.file_name}`,
      }).select().single();
      if (runError) throw runError;
      runId = run.id;

      await admin.from('ec_round_documents').update({
        ai_extraction_status: 'processing',
        ai_extraction_error: null,
      }).eq('id', doc.id);

      try {
        const { data: signed, error: signedError } = await admin.storage
          .from(privateBucket)
          .createSignedUrl(doc.storage_path, 3600);
        if (signedError || !signed?.signedUrl) throw new Error(`เปิดไฟล์ ${doc.file_name} ไม่สำเร็จ`);

        const fileInput = doc.mime_type === 'application/pdf'
          ? { type: 'input_file', file_url: signed.signedUrl }
          : { type: 'input_image', image_url: signed.signedUrl, detail: 'high' };

        const extracted = await callOpenAI(openaiKey as string, model, [
          { type: 'input_text', text: extractionPrompt(round, doc) },
          fileInput,
        ], 'cnmi_document_extraction_v242', extractionSchema());

        const now = new Date().toISOString();
        const { error: saveExtractionError } = await admin.from('ec_round_documents').update({
          ai_extraction: extracted,
          ai_extraction_status: 'completed',
          ai_extracted_at: now,
          ai_extraction_model: model,
          ai_extraction_file_size: Number(doc.file_size || 0),
          ai_extraction_error: null,
        }).eq('id', doc.id);
        if (saveExtractionError) throw saveExtractionError;

        await admin.from('ec_ai_generation_runs').update({
          status: 'completed',
          generated_summary: asText(extracted.summary_th),
          generated_count: 1,
          progress_current: 1,
          progress_total: 1,
          progress_message: `อ่าน ${doc.file_name} เสร็จแล้ว`,
          completed_at: now,
        }).eq('id', runId);

        return json({
          ok: true,
          skipped: false,
          document_id: doc.id,
          file_name: doc.file_name,
          summary: asText(extracted.summary_th),
          run_id: runId,
        });
      } catch (extractError) {
        const message = extractError instanceof Error ? extractError.message : String(extractError);
        await admin.from('ec_round_documents').update({
          ai_extraction_status: 'failed',
          ai_extraction_error: message,
        }).eq('id', doc.id);
        throw extractError;
      }
    }

    const sourceCategories = ['source_document', 'instruction', 'raw_result_image', 'antibody_panel'];
    const answerKeyCategories = ['official_result', 'participant_summary'];
    const evaluationCategories = ['official_result', 'participant_summary', 'submission_form'];
    const isFormAction = action === 'generate_form_instructions' || action === 'generate_form_schema';
    const isInstructionAction = action === 'generate_instruction_summary';
    const isQuestionAction = action === 'generate_questions' || action === 'generate_questions_batch';
    const isAnswerKeyAction = action === 'generate_answer_keys_batch';
    const isOfficialSummaryAction = action === 'generate_official_summary';
    const isLegacyAnswerAction = action === 'generate_answers';
    const categories = isFormAction
      ? ['source_document', 'instruction']
      : isInstructionAction
        ? ['instruction']
        : isQuestionAction
          ? sourceCategories
          : isAnswerKeyAction
            ? answerKeyCategories
            : (isOfficialSummaryAction || isLegacyAnswerAction)
              ? evaluationCategories
              : evaluationCategories;

    const { data: documents, error: documentError } = await admin
      .from('ec_round_documents')
      .select('*')
      .eq('round_id', roundId)
      .is('archived_at', null)
      .in('category', categories)
      .order('created_at', { ascending: true });
    if (documentError) throw documentError;

    const usableDocuments = (documents ?? []).filter((doc: any) =>
      doc.mime_type === 'application/pdf' || String(doc.mime_type ?? '').startsWith('image/'));
    const requiredDocs = isFormAction
      ? usableDocuments.filter((doc: any) => doc.category === 'source_document')
      : isInstructionAction
        ? usableDocuments.filter((doc: any) => doc.category === 'instruction')
        : isQuestionAction
          ? usableDocuments.filter((doc: any) => sourceCategories.includes(doc.category))
          : usableDocuments.filter((doc: any) => doc.category === 'official_result');
    if (!requiredDocs.length) {
      return json({
        error: isFormAction
          ? 'ยังไม่มีเอกสารต้นฉบับจากผู้ให้บริการ'
          : isInstructionAction
            ? 'ยังไม่มีไฟล์ประเภท “คู่มือหรือคำแนะนำ”'
            : isQuestionAction
              ? 'ยังไม่มีไฟล์ประเภท ภาพผลทดสอบดิบ คู่มือหรือคำแนะนำ หรือเอกสารต้นฉบับจากผู้ให้บริการ'
              : 'ยังไม่มีไฟล์ประเภท “รายงานผลประเมินอย่างเป็นทางการ (Official Evaluation)”',
      }, 400);
    }
    if (action === 'generate_form_instructions') {
      const hasSourceDocument = usableDocuments.some((doc: any) => doc.category === 'source_document');
      const hasInstruction = usableDocuments.some((doc: any) => doc.category === 'instruction');
      if (!hasSourceDocument || !hasInstruction) {
        return json({ error: 'กรุณาอัปโหลดให้ครบทั้ง “เอกสารต้นฉบับจากผู้ให้บริการ” และ “คู่มือหรือคำแนะนำ” ก่อนสร้างแบบกรอก' }, 400);
      }
    }

    const totalBytes = usableDocuments.reduce((sum: number, doc: any) => sum + Number(doc.file_size || 0), 0);
    if (usableDocuments.length > 60 || totalBytes > 80 * 1024 * 1024) {
      return json({ error: 'ไฟล์สำหรับวิเคราะห์มากเกินขีดจำกัด กรุณาลดเหลือไม่เกิน 60 ไฟล์ และรวมไม่เกินประมาณ 80 MB' }, 400);
    }

    const missingExtraction = usableDocuments.filter((doc: any) =>
      doc.ai_extraction_status !== 'completed'
      || !doc.ai_extraction
      || !isExtractionSchemaCompatible(doc)
      || Number(doc.ai_extraction_file_size || 0) !== Number(doc.file_size || 0));
    if (missingExtraction.length) {
      return json({
        error: `ยังมีเอกสารที่ AI อ่านไม่เสร็จ ${missingExtraction.length} ไฟล์ กรุณากดสร้างใหม่ ระบบจะอ่านต่อเฉพาะไฟล์ที่ยังไม่เสร็จ`,
        code: 'DOCUMENT_EXTRACTION_REQUIRED',
        pending_documents: missingExtraction.map((doc: any) => ({ id: doc.id, file_name: doc.file_name, category: doc.category })),
      }, 409);
    }

    const generationType = isFormAction || isInstructionAction
      ? 'form_instructions'
      : isQuestionAction
        ? 'questions'
        : 'answers_summary';
    const { data: run, error: runError } = await admin.from('ec_ai_generation_runs').insert({
      round_id: roundId,
      generation_type: generationType,
      status: 'processing',
      source_document_ids: usableDocuments.map((doc: any) => doc.id),
      model,
      created_by: callerId,
    }).select().single();
    if (runError) throw runError;
    runId = run.id;

    const manifest = usableDocuments.map((doc: any) => compactExtraction(doc));

    if (action === 'generate_form_schema') {
      const requestedDocumentId = asText(body.document_id);
      const sourceDoc = requestedDocumentId
        ? usableDocuments.find((doc: any) => doc.category === 'source_document' && doc.id === requestedDocumentId)
        : usableDocuments.find((doc: any) => doc.category === 'source_document');
      if (!sourceDoc) return json({ error: 'ไม่พบฟอร์มเปล่าที่ต้องการสร้าง' }, 404);
      const codeReferences = usableDocuments.filter((doc: any) => doc.category === 'instruction');
      const formManifest = [compactFormExtraction(sourceDoc), ...codeReferences.map((doc: any) => compactFormExtraction(doc))];
      const programProfile = resolveProgramProfile(round);
      const prompt = `
คุณเป็นนักเทคนิคการแพทย์และผู้จัดการคุณภาพด้านเวชศาสตร์บริการโลหิต
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
โปรแกรม: ${round.program_name}
รูปแบบระบบ: ${programProfile.label} (${programProfile.code})
แนวกลุ่มการทดสอบ: ${programProfile.testHints.join(', ') || 'อ่านจากฟอร์มเปล่าทีละฉบับ'}
กำลังสร้างแบบกรอกจากฟอร์มเปล่าเพียงหนึ่งฉบับ: ${sourceDoc.file_name}
ข้อมูลฟอร์มและ Master List อ้างอิง: ${JSON.stringify(formManifest)}

กฎสำคัญ:
1) โครงสร้างแบบกรอกต้องมาจาก source_document ฉบับนี้เท่านั้น: รายการตัวอย่าง รายการทดสอบ จำนวนช่อง หน่วย ทศนิยม และช่องที่เป็น fixed/selected antigen
2) instruction ใช้เฉพาะช่วยแปลชื่อและจับคู่รหัส Master List ห้ามใช้เพิ่มตัวอย่างหรือเพิ่มการทดสอบที่ไม่มีในฟอร์มเปล่า
3) หนึ่งตัวอย่างมีหลายการทดสอบได้ ให้แยกเป็น programs ตามกลุ่มการทดสอบ และใส่เฉพาะตัวอย่างที่ฟอร์มกำหนด
4) Other Red Cell Antigens ให้สร้างคู่ช่อง “ชื่อ antigen/antisera” กับ “ผล” ตามจำนวนตำแหน่งในฟอร์มจริง เว้นช่องที่ไม่ได้ใช้ได้ และห้ามใส่ชื่อ antigen จากผลที่ห้องส่งหรือเฉลย
5) ห้ามเดาผลหรือเฉลย ห้ามสร้าง code เอง หากไม่ชัดให้ระบุใน source_summary
6) antigen_sections ให้เป็น [] และสร้าง Antigen typing เป็น program ปกติ
7) general_fields ใช้ key ได้เฉพาะ reagents, instrument, overall_note
8) key เป็นภาษาอังกฤษ snake_case และไม่ซ้ำภายในผลลัพธ์ฉบับนี้
`;
      const fieldSchema = {
        type: 'object', additionalProperties: false,
        required: ['key', 'label', 'input_type', 'required', 'placeholder', 'options'],
        properties: {
          key: { type: 'string' }, label: { type: 'string' },
          input_type: { type: 'string', enum: ['select', 'text', 'textarea', 'number'] },
          required: { type: 'boolean' }, placeholder: { type: 'string' },
          options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value','label','code'], properties: { value: { type:'string' }, label: { type:'string' }, code: { type:'string' } } } },
        },
      };
      const schema = {
        type: 'object', additionalProperties: false, required: ['source_summary','form_schema'],
        properties: {
          source_summary: { type: 'string' },
          form_schema: { type: 'object', additionalProperties: false, required: ['schema_version','title','programs','antigen_sections','general_fields'], properties: {
            schema_version: { type:'string' }, title: { type:'string' },
            programs: { type:'array', items: { type:'object', additionalProperties:false, required:['key','title','description','specimens','specimen_fields','method_fields'], properties: {
              key:{type:'string'}, title:{type:'string'}, description:{type:'string'},
              specimens:{type:'array',items:{type:'object',additionalProperties:false,required:['id','label'],properties:{id:{type:'string'},label:{type:'string'}}}},
              specimen_fields:{type:'array',items:fieldSchema}, method_fields:{type:'array',items:fieldSchema},
            } } },
            antigen_sections:{type:'array',items:{type:'object',additionalProperties:false,required:['specimen_id','title','fields'],properties:{specimen_id:{type:'string'},title:{type:'string'},fields:{type:'array',items:fieldSchema}}}},
            general_fields:{type:'array',items:fieldSchema},
          } },
        },
      };
      const generated = await callOpenAI(openaiKey as string, model, [{ type:'input_text', text:prompt }], 'cnmi_provider_form_single_v227', schema);
      const sanitizeField = (field: any) => {
        const key = asText(field?.key); if (!key) return null;
        return { key, label: asText(field?.label) || key, input_type: ['select','text','textarea','number'].includes(asText(field?.input_type)) ? asText(field.input_type) : 'text', required: Boolean(field?.required), placeholder: asText(field?.placeholder), options: Array.isArray(field?.options) ? field.options.slice(0,80).map((option:any)=>({ value:asText(option?.value || option?.code || option?.label), label:asText(option?.label || option?.value || option?.code), code:asText(option?.code) })).filter((option:any)=>option.value && option.label) : [] };
      };
      const formSchema = generated.form_schema || {};
      const partial = {
        schema_version: asText(formSchema.schema_version) || `provider-${Date.now()}`,
        title: asText(formSchema.title) || `${round.provider} ${round.round_code} — แบบกรอกผล`,
        programs: (Array.isArray(formSchema.programs) ? formSchema.programs : []).slice(0,30).map((program:any,index:number)=>({
          key: asText(program?.key) || `PROGRAM_${index+1}`, title: asText(program?.title) || `โปรแกรม ${index+1}`, description: asText(program?.description),
          specimens: (Array.isArray(program?.specimens) ? program.specimens : []).slice(0,60).map((specimen:any)=>({id:asText(specimen?.id || specimen?.label),label:asText(specimen?.label || specimen?.id)})).filter((specimen:any)=>specimen.id),
          specimen_fields: (Array.isArray(program?.specimen_fields) ? program.specimen_fields : []).slice(0,80).map(sanitizeField).filter(Boolean),
          method_fields: (Array.isArray(program?.method_fields) ? program.method_fields : []).slice(0,40).map(sanitizeField).filter(Boolean),
        })).filter((program:any)=>program.specimens.length && program.specimen_fields.length),
        antigen_sections: [],
        general_fields: (Array.isArray(formSchema.general_fields) ? formSchema.general_fields : []).map(sanitizeField).filter((field:any)=>['reagents','instrument','overall_note'].includes(field.key)),
        source_summary: asText(generated.source_summary),
      };
      if (!partial.programs.length) throw new Error(`AI ยังแยกช่องกรอกจากฟอร์ม ${sourceDoc.file_name} ไม่ได้`);
      const reset = body.reset_form_schema === true;
      const existing = !reset && round.generated_result_form_schema && typeof round.generated_result_form_schema === 'object' ? round.generated_result_form_schema : null;
      const mergedPrograms: any[] = [];
      const usedKeys = new Set<string>();
      for (const program of [...(Array.isArray(existing?.programs) ? existing.programs : []), ...partial.programs]) {
        let key = asText(program.key) || `PROGRAM_${mergedPrograms.length+1}`;
        const base = key; let suffix = 2;
        while (usedKeys.has(key)) key = `${base}_${suffix++}`;
        usedKeys.add(key); mergedPrograms.push({ ...program, key });
      }
      const generalByKey = new Map<string, any>();
      for (const field of [...(Array.isArray(existing?.general_fields) ? existing.general_fields : []), ...partial.general_fields]) generalByKey.set(asText(field.key), field);
      const merged = { schema_version:`provider-${Date.now()}`, title: existing?.title || partial.title, programs:mergedPrograms, antigen_sections:[], general_fields:[...generalByKey.values()], source_summary:[asText(existing?.source_summary),asText(partial.source_summary)].filter(Boolean).join('\n') };
      const previousIds = !reset && Array.isArray(round.generated_form_source_document_ids) ? round.generated_form_source_document_ids : [];
      const sourceIds = [...new Set([...previousIds, sourceDoc.id])];
      const { error:updateRoundError } = await admin.from('ec_eqa_rounds').update({ generated_result_form_schema:merged, generated_form_source_document_ids:sourceIds, generated_form_generated_at:new Date().toISOString(), generated_form_generated_by:callerId, updated_by:callerId }).eq('id',roundId);
      if (updateRoundError) throw updateRoundError;
      const fieldCount = merged.programs.reduce((sum:number,program:any)=>sum + program.specimens.length * program.specimen_fields.length + program.method_fields.length,0) + merged.general_fields.length;
      await admin.from('ec_ai_generation_runs').update({ status:'completed', generated_summary:asText(generated.source_summary), generated_count:fieldCount, completed_at:new Date().toISOString() }).eq('id',runId);
      return json({ok:true,generated_count:fieldCount,program_count:merged.programs.length,summary:generated.source_summary,document_id:sourceDoc.id,run_id:runId});
    }

    if (action === 'generate_instruction_summary') {
      const instructionDocs = usableDocuments.filter((doc:any)=>doc.category === 'instruction');
      const instructionManifest = instructionDocs.map((doc:any)=>compactInstructionExtraction(doc));
      const formOutline = Array.isArray(round.generated_result_form_schema?.programs) ? round.generated_result_form_schema.programs.map((program:any)=>({key:program.key,title:program.title,specimens:program.specimens})).slice(0,40) : [];
      const prompt = `
คุณเป็นนักเทคนิคการแพทย์ด้านเวชศาสตร์บริการโลหิต สรุปคำแนะนำภาษาไทยจากคู่มือผู้ให้บริการเท่านั้น
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
หัวข้อแบบกรอกที่สร้างแล้ว: ${JSON.stringify(formOutline)}
ข้อมูลคู่มือ: ${JSON.stringify(instructionManifest)}

ให้สร้างคำแนะนำที่เจ้าหน้าที่เปิดอ่านก่อนกรอกผล แบ่งเป็นหัวข้อสั้น ใช้งานจริง ครอบคลุมการเก็บรักษา การทดสอบ การรายงาน ข้อควรระวัง รหัส/Master List และเงื่อนไขเฉพาะแต่ละโปรแกรม
ห้ามเดาเฉลย ห้ามนำ Your Result หรือผลที่ห้องส่งมาเป็นคำแนะนำ และไม่ต้องคัดลอกคู่มือยาวทั้งฉบับ
`;
      const schema = { type:'object', additionalProperties:false, required:['instruction_summary_th','source_summary'], properties:{ instruction_summary_th:{type:'string'}, source_summary:{type:'string'} } };
      const generated = await callOpenAI(openaiKey as string, model, [{type:'input_text',text:prompt}], 'cnmi_instruction_summary_v227', schema);
      const { error:updateRoundError } = await admin.from('ec_eqa_rounds').update({ generated_instruction_th:asText(generated.instruction_summary_th), updated_by:callerId }).eq('id',roundId);
      if (updateRoundError) throw updateRoundError;
      await admin.from('ec_ai_generation_runs').update({status:'completed',generated_summary:asText(generated.source_summary),generated_count:1,completed_at:new Date().toISOString()}).eq('id',runId);
      return json({ok:true,generated_count:1,instruction_summary_th:generated.instruction_summary_th,summary:generated.source_summary,run_id:runId});
    }

    if (action === 'generate_form_instructions') {
      const prompt = `
คุณเป็นนักเทคนิคการแพทย์และผู้จัดการคุณภาพด้านเวชศาสตร์บริการโลหิต
ให้ใช้ “ประเภทเอกสาร” เป็นหลัก และใช้ชื่อไฟล์ช่วยจับคู่เท่านั้น
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
โปรแกรม: ${round.program_name}
รายการไฟล์: ${JSON.stringify(manifest)}

งานที่ต้องทำ:
1) ใช้เอกสารประเภท source_document เป็นหลักเพื่อระบุรายการตัวอย่าง รายการทดสอบ ช่องกรอก หน่วย จำนวนทศนิยม และโครงสร้างตามฟอร์มจริงของผู้ให้บริการ
2) ใช้เอกสารประเภท instruction เพื่อแปลและสรุปวิธีปฏิบัติ ข้อควรระวัง เงื่อนไขการรายงาน และเติมตารางรหัส/ชื่อคำตอบที่ฟอร์มอ้างถึง เช่น CAP code กับชื่อด้านหลัง
3) เมื่อฟอร์มต้นฉบับแสดงเพียงเลขตำแหน่ง แต่คู่มือหรือ Master List ระบุ code และชื่อ ให้รวมข้อมูลทั้งสองเอกสารเพื่อสร้างตัวเลือกแบบ “CAP code │ ชื่อคำตอบ” ห้ามสร้าง code เอง
4) คู่มืออาจมีโจทย์แบบแห้งหรือ Educational challenge ให้สรุปเนื้อหาส่วนนั้นไว้ในคำแนะนำเพื่อใช้สร้างข้อสอบภายหลัง แต่ห้ามถือเป็นเฉลยทางการ
5) ห้ามเดาผลที่ถูกต้องของตัวอย่าง เฉลยทางการต้องมาจาก official_result หรือการยืนยันของผู้จัดการคุณภาพ
6) หนึ่งตัวอย่างอาจมีหลายการทดสอบ เช่น ABO, Rh, Antibody screen, Antibody identification, Eluate identification, Crossmatch, DAT, CBC, WBC count, Titer และ Antigen typing ให้สร้างแยกเป็นหลายรายการใน programs โดยแต่ละรายการแทน “กลุ่มการทดสอบ” และระบุเฉพาะตัวอย่างที่ต้องทำการทดสอบนั้น ตัวอย่างเดียวกันสามารถปรากฏซ้ำในหลาย programs ได้
7) ห้ามนำช่องกรอกของการทดสอบหนึ่งไปใส่ให้ทุกตัวอย่าง หากฟอร์มกำหนดคนละรายการทดสอบ ให้แยก programs ตามชุดตัวอย่างที่ใช้ช่องกรอกเหมือนกัน
8) specimen_fields ใช้ key ภาษาอังกฤษแบบ snake_case ที่สื่อความหมายและไม่ซ้ำกันทั้งรอบ โดยใส่คำนำหน้าตามการทดสอบเมื่อจำเป็น เช่น abo_group, rh_d_result, screen_result, abid_primary_antibody, eluate_antibody, cbc_wbc, residual_wbc_count, titer_endpoint, antigen_1_name, antigen_1_result
9) กรณี Antigen typing ที่ฟอร์มให้เลือกชนิด antigen ให้สร้างช่องเลือกชื่อ antigen และช่องผลเป็นคู่ตามจำนวนตำแหน่งที่ฟอร์มมี ห้ามสมมติว่าเป็น C, c, E, e หรือ K เสมอ หากฟอร์มระบุ antigen คงที่จึงสร้างช่องตามชื่อที่ระบุ
10) กรณีผลเชิงตัวเลข เช่น CBC, WBC count หรือ Titer ให้คงหน่วย ช่วงค่า และจำนวนทศนิยมตามฟอร์ม หากไม่มีข้อมูลให้ใช้ช่องข้อความและแจ้งข้อจำกัดใน source_summary
11) ภาพ Antibody screen ที่รวม RT และ IAT ใช้สร้าง Competency แบบสรุป Positive/Negative ได้ แต่โครงสร้างแบบกรอกผล EQA ต้องยึดช่องใน source_document เป็นหลัก
12) ให้ตั้ง antigen_sections เป็น [] และสร้าง Antigen typing ทุกกรณีเป็น program กลุ่มการทดสอบตามข้อ 6 เพื่อรองรับ antigen หลายชนิดและกรณีเลือก antigen ตามโจทย์
13) general_fields ใช้ key ได้เฉพาะ: reagents, instrument, overall_note
14) ตัวเลือกทุกข้อให้ใส่ value, label และ code; value เป็นค่าคงที่สำหรับเปรียบเทียบผล, label เป็นชื่อที่ผู้ใช้เข้าใจ, code เป็นรหัสที่ต้องกรอกในระบบผู้ให้บริการ
15) key ของแต่ละ program ต้องไม่ซ้ำกันทั้งรอบ และ method_fields ใช้ key ภาษาอังกฤษแบบ snake_case ที่ไม่ซ้ำภายใน program พร้อมใส่ label ตามฟอร์ม
16) หากหลักฐานไม่ชัด ห้ามสร้างช่อง รหัส หน่วย หรือรายการทดสอบขึ้นเอง ให้ใส่คำเตือนไว้ใน source_summary
17) instruction_summary_th ต้องเป็นภาษาไทย ใช้งานได้จริง กระชับ แบ่งหัวข้อตามโปรแกรม ตัวอย่าง และการทดสอบ โดยไม่เปิดเผยข้อมูลส่วนบุคคล
`;

      const fieldSchema = {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'input_type', 'required', 'placeholder', 'options'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          input_type: { type: 'string', enum: ['select', 'text', 'textarea', 'number'] },
          required: { type: 'boolean' },
          placeholder: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['value', 'label', 'code'],
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
                code: { type: 'string' },
              },
            },
          },
        },
      };

      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['source_summary', 'instruction_summary_th', 'form_schema'],
        properties: {
          source_summary: { type: 'string' },
          instruction_summary_th: { type: 'string' },
          form_schema: {
            type: 'object',
            additionalProperties: false,
            required: ['schema_version', 'title', 'programs', 'antigen_sections', 'general_fields'],
            properties: {
              schema_version: { type: 'string' },
              title: { type: 'string' },
              programs: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['key', 'title', 'description', 'specimens', 'specimen_fields', 'method_fields'],
                  properties: {
                    key: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    specimens: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['id', 'label'],
                        properties: { id: { type: 'string' }, label: { type: 'string' } },
                      },
                    },
                    specimen_fields: { type: 'array', items: fieldSchema },
                    method_fields: { type: 'array', items: fieldSchema },
                  },
                },
              },
              antigen_sections: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['specimen_id', 'title', 'fields'],
                  properties: {
                    specimen_id: { type: 'string' },
                    title: { type: 'string' },
                    fields: { type: 'array', items: fieldSchema },
                  },
                },
              },
              general_fields: { type: 'array', items: fieldSchema },
            },
          },
        },
      };

      const generated = await callOpenAI(openaiKey as string, model, [
        { type: 'input_text', text: prompt },
      ], 'cnmi_provider_result_form_v224', schema);

            const allowedAntigenFields = new Set(['C','E','c','e','other_antigen','other_result']);
      const allowedGeneralFields = new Set(['reagents','instrument','overall_note']);
      const sanitizeField = (field: any, allowed: Set<string> | null = null) => {
        const key = asText(field?.key);
        if (!key || (allowed && !allowed.has(key))) return null;
        return {
          key,
          label: asText(field?.label) || key,
          input_type: ['select','text','textarea','number'].includes(asText(field?.input_type)) ? asText(field.input_type) : 'text',
          required: Boolean(field?.required),
          placeholder: asText(field?.placeholder),
          options: Array.isArray(field?.options) ? field.options.slice(0, 80).map((option: any) => ({
            value: asText(option?.value || option?.code || option?.label),
            label: asText(option?.label || option?.value || option?.code),
            code: asText(option?.code),
          })).filter((option: any) => option.value && option.label) : [],
        };
      };

      const formSchema = generated.form_schema || {};
      const sanitizedSchema = {
        schema_version: asText(formSchema.schema_version) || `provider-${Date.now()}`,
        title: asText(formSchema.title) || `${round.provider} ${round.round_code} — แบบกรอกผล`,
        programs: (Array.isArray(formSchema.programs) ? formSchema.programs : []).slice(0, 30).map((program: any, programIndex: number) => ({
          key: asText(program?.key) || `PROGRAM_${programIndex + 1}`,
          title: asText(program?.title) || asText(program?.key) || `โปรแกรม ${programIndex + 1}`,
          description: asText(program?.description),
          specimens: (Array.isArray(program?.specimens) ? program.specimens : []).slice(0, 60).map((specimen: any) => ({
            id: asText(specimen?.id || specimen?.label),
            label: asText(specimen?.label || specimen?.id),
          })).filter((specimen: any) => specimen.id),
          specimen_fields: (Array.isArray(program?.specimen_fields) ? program.specimen_fields : []).slice(0, 80).map((field: any) => sanitizeField(field, null)).filter(Boolean),
          method_fields: (Array.isArray(program?.method_fields) ? program.method_fields : []).slice(0, 40).map((field: any) => sanitizeField(field, null)).filter(Boolean),
        })).filter((program: any) => program.specimens.length && program.specimen_fields.length),
        antigen_sections: (Array.isArray(formSchema.antigen_sections) ? formSchema.antigen_sections : []).slice(0, 20).map((section: any) => ({
          specimen_id: asText(section?.specimen_id),
          title: asText(section?.title) || `การตรวจแอนติเจน — ${asText(section?.specimen_id)}`,
          fields: (Array.isArray(section?.fields) ? section.fields : []).map((field: any) => sanitizeField(field, allowedAntigenFields)).filter(Boolean),
        })).filter((section: any) => section.specimen_id && section.fields.length),
        general_fields: (Array.isArray(formSchema.general_fields) ? formSchema.general_fields : []).map((field: any) => sanitizeField(field, allowedGeneralFields)).filter(Boolean),
        source_summary: asText(generated.source_summary),
      };

      if (!sanitizedSchema.programs.length) throw new Error('AI ยังแยกรายการตัวอย่างและช่องกรอกจากฟอร์มต้นฉบับไม่ได้ กรุณาตรวจประเภทเอกสารหรือไฟล์ที่อัปโหลด');

      const { error: updateRoundError } = await admin.from('ec_eqa_rounds').update({
        generated_result_form_schema: sanitizedSchema,
        generated_instruction_th: asText(generated.instruction_summary_th),
        generated_form_source_document_ids: usableDocuments.map((doc: any) => doc.id),
        generated_form_generated_at: new Date().toISOString(),
        generated_form_generated_by: callerId,
        updated_by: callerId,
      }).eq('id', roundId);
      if (updateRoundError) throw updateRoundError;

      const fieldCount = sanitizedSchema.programs.reduce((sum: number, program: any) => sum + program.specimens.length * program.specimen_fields.length + program.method_fields.length, 0)
        + sanitizedSchema.antigen_sections.reduce((sum: number, section: any) => sum + section.fields.length, 0)
        + sanitizedSchema.general_fields.length;

      await admin.from('ec_ai_generation_runs').update({
        status: 'completed',
        generated_summary: asText(generated.source_summary),
        generated_count: fieldCount,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);

      return json({
        ok: true,
        generated_count: fieldCount,
        program_count: sanitizedSchema.programs.length,
        instruction_summary_th: generated.instruction_summary_th,
        summary: generated.source_summary,
        run_id: runId,
      });
    }

    if (action === 'generate_questions' || action === 'generate_questions_batch') {
      const requestedCount = action === 'generate_questions_batch'
        ? Math.max(1, Math.min(5, Number(body.question_count || 3)))
        : Math.max(3, Math.min(25, Number(body.question_count || 12)));
      let questionDocuments = usableDocuments;
      let primaryQuestionFileNames: string[] = [];
      let primaryQuestionDocuments: any[] = [];
      if (action === 'generate_questions_batch') {
        const requestedIds = new Set((Array.isArray(body.document_ids) ? body.document_ids : []).map(asText).filter(Boolean));
        const primary = usableDocuments.filter((doc: any) => requestedIds.has(doc.id));
        primaryQuestionDocuments = primary;
        primaryQuestionFileNames = primary.map((doc: any) => asText(doc.file_name)).filter(Boolean);
        const context = usableDocuments.filter((doc: any) => ['source_document','instruction'].includes(doc.category));
        const panelDocs = usableDocuments.filter((doc: any) => doc.category === 'antibody_panel' || /antigram/i.test(`${doc.file_name || ''} ${doc.title || ''}`));
        const includePanels = primary.some((doc: any) => /abid|antibody.?id|panel/i.test(`${doc.file_name} ${doc.title}`));
        const byId = new Map<string, any>();
        for (const doc of [...primary, ...context, ...(includePanels ? panelDocs : [])]) byId.set(doc.id, doc);
        questionDocuments = [...byId.values()];
        if (!primary.length && body.knowledge_batch !== true) return json({ error: 'ไม่พบไฟล์หลักของชุดข้อสอบนี้' }, 400);
      }
      const questionManifest = questionDocuments.map((doc: any) => compactQuestionExtraction(doc));
      const prompt = `
คุณเป็นนักเทคนิคการแพทย์ด้านเวชศาสตร์บริการโลหิต ทำหน้าที่จัดทำแบบประเมิน Competency จากเอกสาร EQA เท่านั้น
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
โปรแกรม: ${round.program_name}
รายการไฟล์ของชุดย่อยนี้: ${JSON.stringify(questionManifest)}
ไฟล์หลักที่ต้องใช้ตั้งคำถามในชุดนี้: ${JSON.stringify(primaryQuestionFileNames)}
โหมดคำถามจากคู่มือ/ฟอร์ม: ${body.knowledge_batch === true ? 'ใช่' : 'ไม่ใช่'}

เป้าหมายหลัก:
1) สร้างคำถามประมาณ ${requestedCount} ข้อ โดยเน้นคำถาม “แปลผลสุดท้าย” จากภาพแบบเดียวกับ Google Form เดิม ห้ามแตกเป็นคำถามค่าปฏิกิริยารายหลุม ราย phase หรือราย cell ถ้าคำถามสุดท้ายควรเป็น ABO, Rh, Screen, Ab ID, Crossmatch หรือ Antigen typing
2) ABO: ใช้ผล forward และ reverse รวมกัน แล้วถามหมู่เลือด ABO เพียงหนึ่งข้อต่อตัวอย่าง ห้ามถาม Anti-A, Anti-B หรือ A1 cell แยกข้อ
3) Rh(D): ถามผลการแปล Rh(D) สุดท้าย ไม่ถามว่า phase RT/37°C/IAT ให้ปฏิกิริยาเท่าใด โดยตัวเลือกมาตรฐานจะถูกระบบใส่เองเป็น Rh(D) positive, Weak D positive, Partial D/D variant และ Rh(D) negative
4) Antibody screen: ถามเพียง Positive หรือ Negative หนึ่งข้อต่อตัวอย่าง ไม่แยก O1/O2/O3 หรือ phase
5) Antibody Identification: ถามชนิด antibody จากภาพผล + Antigram และระบุ question_kind = antibody_identification ระบบจะแสดง CAP Master List แบบค้นหาและเลือกได้มากกว่า 1 รายการ ห้ามสร้างตัวเลือกหลอกเอง
6) Crossmatch: ถามผลสรุป Negative/Compatible, Positive/Incompatible หรือ Would refer ไม่ถามความแรงปฏิกิริยาเป็นโจทย์หลัก
7) Antigen typing: สร้างหนึ่งคำถามต่อหนึ่ง antigen ที่ระบุจริง เช่น C, c, E, e, K แล้วถามผล Positive/Negative ห้ามถามว่า “ตำแหน่งใดมีแถบลอยค้างในเจล”
8) question_kind ต้องเป็น abo, rh, antibody_screen, antibody_identification, crossmatch, antigen_typing หรือ other ให้ตรงกับโจทย์ ระบบจะสร้างตัวเลือกมาตรฐานเองสำหรับทุก kind ยกเว้น other
9) specimen ต้องเป็นรหัสตัวอย่าง เช่น J-01, J-05, J-06R, JE-07 หรือ JE-07R และ antigen_name ใช้เฉพาะคำถาม antigen_typing
10) source_file_names ต้องเป็นรายชื่อไฟล์ภาพทั้งหมดที่ผู้ทำข้อสอบต้องเห็น สำหรับคำถามทั่วไปใส่ภาพผลดิบที่ตรงกับโจทย์; สำหรับ AbID ให้รวมภาพ Cell ทุกช่วงและ Antigram ของ PanelA/PanelB/PanelC ในตัวอย่างเดียวกัน โดยเรียง Panel แล้วเรียง Cell
11) สำหรับ Antibody Identification ต้องใส่ภาพผลดิบทุกช่วง cell ของตัวอย่างเดียวกันต่อกันก่อน แล้วใส่ Antigram/Panel ที่ใช้ plot ต่อท้าย ห้ามตัดเหลือเพียงภาพเดียว
12) สำหรับ CBC, WBC count, Titer หรือการทดสอบอื่น ให้ใช้ question_kind = other และสร้าง choices 2-4 ข้อจากค่าที่เห็นจริงเท่านั้น ห้ามแต่งตัวเลข
13) ยังไม่สร้างเฉลยและห้ามเดาคำตอบสุดท้าย เพราะเฉลยจะอิง Official Evaluation ภายหลัง
14) prompt ต้องสั้น ตรงประเด็น ไม่มีชื่อไฟล์ path นามสกุลไฟล์ คำว่า source หรือคำสั่งเชิงระบบ
15) ห้ามสร้างข้อมูลผู้ป่วย ชื่อบุคคล HN หรือข้อมูลระบุตัวตน
16) source_summary ให้สรุปว่าแต่ละภาพถูกนำไปสร้างคำถามชนิดใดและตัวอย่างใด เพื่อให้ผู้จัดการคุณภาพตรวจทาน
`;

      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['source_summary', 'questions'],
        properties: {
          source_summary: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['question_kind', 'specimen', 'antigen_name', 'prompt', 'source_file_names', 'choices', 'is_critical', 'points'],
              properties: {
                question_kind: { type: 'string', enum: ['abo','rh','antibody_screen','antibody_identification','crossmatch','antigen_typing','other'] },
                specimen: { type: 'string' },
                antigen_name: { type: 'string' },
                prompt: { type: 'string' },
                source_file_names: { type: 'array', items: { type: 'string' } },
                choices: { type: 'array', items: { type: 'string' } },
                is_critical: { type: 'boolean' },
                points: { type: 'number' },
              },
            },
          },
        },
      };

      const providerBlueprint = body.knowledge_batch === true
        ? buildProviderQuestionBlueprint(questionDocuments)
        : [];
      if (body.provider_import_expected === true && !providerBlueprint.length) {
        throw new Error('ระบบยังถอดโจทย์และตัวเลือกจาก Blank Result Form ไม่สำเร็จ จึงหยุดก่อนสร้างคำถามทั่วไป กรุณาตรวจว่าประเภทเอกสารและชื่อไฟล์ถูกต้อง แล้วกดอ่าน/สร้างข้อสอบใหม่');
      }
      const capBlueprint = isCapJJeRoundData(round) && action === 'generate_questions_batch'
        ? buildCapQuestionBlueprint(primaryQuestionDocuments, questionDocuments)
        : [];
      const generated = providerBlueprint.length
        ? {
            source_summary: `นำเข้าข้อสอบต้นฉบับจากแบบฟอร์มผู้ให้บริการ ${providerBlueprint.length} ข้อ และเชื่อมข้อมูล Case Study จากคู่มือโดยไม่เรียก AI รอบสร้างคำถามซ้ำ`,
            questions: providerBlueprint,
          }
        : capBlueprint.length
          ? {
              source_summary: `สร้างคำถามแบบแปลผลตามโครงสร้าง CAP J/JE จากภาพผลดิบ ${primaryQuestionDocuments.length} ไฟล์ โดยรวมภาพ Ab ID ที่เป็น cell ต่อเนื่องและ Antigram ไว้ในข้อเดียว`,
              questions: capBlueprint,
            }
          : await callOpenAI(openaiKey as string, model, [
            { type: 'input_text', text: prompt },
          ], action === 'generate_questions_batch' ? 'cnmi_competency_questions_batch_v230' : 'cnmi_competency_questions_v230', schema);

      if (body.replace_ai_drafts !== false) {
        const { data: oldDrafts } = await admin
          .from('ec_questions')
          .select('id')
          .eq('round_id', roundId)
          .eq('generated_by_ai', true)
          .eq('published', false)
          .is('archived_at', null);
        const oldIds = (oldDrafts ?? []).map((row: any) => row.id);
        if (oldIds.length) {
          const { count } = await admin.from('ec_competency_answers').select('id', { count: 'exact', head: true }).in('question_id', oldIds);
          if (!count) await admin.from('ec_questions').delete().in('id', oldIds);
        }
      }

      const { data: existingQuestions } = await admin
        .from('ec_questions')
        .select('question_order')
        .eq('round_id', roundId)
        .is('archived_at', null)
        .order('question_order', { ascending: false })
        .limit(1);
      let order = Number(existingQuestions?.[0]?.question_order || 0);
      let insertedCount = 0;
      const documentByName = new Map<string, any>();
      const mediaDocuments = questionDocuments.filter((doc: any) => String(doc.mime_type || '').startsWith('image/') || doc.mime_type === 'application/pdf');
      for (const doc of questionDocuments) {
        for (const name of [doc.file_name, doc.title]) {
          documentByName.set(normalizeName(name), doc);
          documentByName.set(compactDocumentName(name), doc);
        }
      }
      const resolveSourceDocument = (value: unknown) => {
        const exact = documentByName.get(normalizeName(value)) || documentByName.get(compactDocumentName(value));
        if (exact && (String(exact.mime_type || '').startsWith('image/') || exact.mime_type === 'application/pdf')) return exact;
        const compact = compactDocumentName(value);
        if (compact) {
          const fuzzy = mediaDocuments.find((doc: any) => {
            const fileKey = compactDocumentName(doc.file_name);
            const titleKey = compactDocumentName(doc.title);
            return fileKey === compact || titleKey === compact || fileKey.includes(compact) || compact.includes(fileKey) || titleKey.includes(compact) || compact.includes(titleKey);
          });
          if (fuzzy) return fuzzy;
        }
        return null;
      };
      const resolveSourceDocuments = (values: unknown, kind: string) => {
        const names = Array.isArray(values) ? values : [values];
        const resolved = names.map(resolveSourceDocument).filter(Boolean);
        if (!resolved.length) {
          const primaryImages = primaryQuestionDocuments.filter((doc: any) => String(doc.mime_type || '').startsWith('image/'));
          if (primaryImages.length === 1) resolved.push(primaryImages[0]);
          else if (mediaDocuments.length === 1 && body.knowledge_batch !== true) resolved.push(mediaDocuments[0]);
        }
        const unique = [...new Map(resolved.map((doc: any) => [doc.id, doc])).values()];
        return kind === 'antibody_identification' ? sortQuestionSourceDocuments(unique) : unique;
      };

      for (const item of generated.questions ?? []) {
        const kind = asText(item.question_kind) || 'other';
        const specimen = asText(item.specimen);
        const antigenName = asText(item.antigen_name);
        const isProviderQuestion = kind === 'provider_form_question';
        const providerType = asText(item.question_type) || 'single_choice';
        const questionType = isProviderQuestion
          ? (providerType === 'single_choice' ? 'single_choice' : 'text')
          : kind === 'antibody_identification'
            ? 'image_interpretation'
            : 'single_choice';
        const choices = isProviderQuestion
          ? (questionType === 'single_choice' && Array.isArray(item.choices) ? item.choices.map(asText).filter(Boolean).slice(0, 20) : [])
          : kind === 'antibody_identification'
            ? []
            : kind === 'other'
              ? (Array.isArray(item.choices) ? item.choices.map(asText).filter(Boolean).slice(0, 4) : [])
              : [...(STANDARD_QUESTION_CHOICES[kind] || [])];
        const promptText = isProviderQuestion
          ? asText(item.prompt)
          : interpretationQuestionPrompt(kind, specimen, antigenName, asText(item.prompt));
        if (!promptText || (questionType === 'single_choice' && choices.length < 2)) continue;
        order += 1;
        const sourceDocs = resolveSourceDocuments(item.source_file_names, kind);
        const primarySourceDoc = sourceDocs.find((doc: any) => doc.category === 'raw_result_image') || sourceDocs[0] || null;
        const imageDocumentId = primarySourceDoc?.id || null;
        const sourceIds = sourceDocs.map((doc: any) => doc.id);

        const { data: question, error: questionError } = await admin.from('ec_questions').insert({
          round_id: roundId,
          question_order: order,
          section: isProviderQuestion ? (asText(item.section_title) || 'ข้อสอบจากแบบฟอร์มผู้ให้บริการ') : standardQuestionSection(kind),
          question_type: questionType,
          prompt: promptText,
          image_document_id: imageDocumentId,
          points: Number(item.points || 1),
          is_critical: Boolean(item.is_critical),
          published: false,
          generated_by_ai: true,
          ai_source_document_ids: sourceIds,
          created_by: callerId,
          updated_by: callerId,
        }).select().single();
        if (questionError) throw questionError;

        if (choices.length) {
          const { error: choiceError } = await admin.from('ec_question_choices').insert(
            choices.map((choice: string, index: number) => ({
              question_id: question.id,
              choice_order: index + 1,
              choice_text: choice,
            })),
          );
          if (choiceError) throw choiceError;
        }

        if (sourceIds.length) {
          await admin.from('ec_round_documents').update({ visibility: 'staff' }).in('id', sourceIds);
        }
        insertedCount += 1;
      }

      await admin.from('ec_ai_generation_runs').update({
        status: 'completed',
        generated_summary: asText(generated.source_summary),
        generated_count: insertedCount,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);

      return json({ ok: true, generated_count: insertedCount, summary: generated.source_summary, run_id: runId });
    }

    const { data: questions, error: questionError } = await admin
      .from('ec_questions')
      .select('id,question_order,section,prompt,question_type,points,ec_question_choices(id,choice_order,choice_text)')
      .eq('round_id', roundId)
      .is('archived_at', null)
      .order('question_order');
    if (questionError) throw questionError;
    if (!questions?.length && !isOfficialSummaryAction) return json({ error: 'ยังไม่มีข้อสอบ กรุณาสร้างข้อสอบก่อนสร้างเฉลย' }, 400);

    const questionManifest = questions.map((question: any) => ({
      question_order: question.question_order,
      section: question.section,
      question_type: question.question_type,
      prompt: question.prompt,
      choices: (question.ec_question_choices ?? [])
        .sort((a: any, b: any) => a.choice_order - b.choice_order)
        .map((choice: any) => choice.choice_text),
    }));

    const hasParticipantSummary = usableDocuments.some((doc: any) => doc.category === 'participant_summary');
    const hasSubmittedResult = usableDocuments.some((doc: any) => doc.category === 'submission_form');
    const evaluationManifest = usableDocuments
      .filter((doc: any) => ['official_result','participant_summary','submission_form'].includes(doc.category))
      .map((doc: any) => compactExtraction(doc));


    const [{ data: liveConsensus }, { data: latestIndividual }] = await Promise.all([
      admin.from('ec_consensus_results').select('result_payload,status,updated_at').eq('round_id', roundId).maybeSingle(),
      admin.from('ec_individual_results').select('result_payload,status,submitted_at,updated_at').eq('round_id', roundId).in('status', ['submitted','resubmitted','locked']).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const liveResultPayload = liveConsensus?.result_payload || latestIndividual?.result_payload || null;
    const liveResultRows = resultPayloadEvaluationRows(liveResultPayload, round);

    const regradeRoundAssignments = async () => {
      const { data: roundAssignments } = await admin!
        .from('ec_competency_assignments')
        .select('id,status')
        .eq('round_id', roundId)
        .in('status', ['submitted', 'under_review', 'passed', 'needs_reflection', 'reflection_submitted', 'passed_after_review']);
      for (const assignment of roundAssignments ?? []) {
        const { data: submittedAnswers } = await admin!.from('ec_competency_answers').select('*').eq('assignment_id', assignment.id);
        let totalPoints = 0;
        let awardedPoints = 0;
        for (const submittedAnswer of submittedAnswers ?? []) {
          const question = questions.find((q: any) => q.id === submittedAnswer.question_id);
          if (!question) continue;
          const { data: key } = await admin!.from('ec_question_answer_keys').select('correct_choice_ids,answer_key_json').eq('question_id', question.id).maybeSingle();
          if (!key) continue;
          const educational = asText(key.answer_key_json?.challenge_type).toLowerCase() === 'educational';
          const selected = asText(submittedAnswer.answer_payload?.choice_id);
          const answerText = asText(submittedAnswer.answer_payload?.text);
          let correct: boolean | null = null;
          if (selected && key.correct_choice_ids?.length) {
            correct = key.correct_choice_ids.includes(selected);
          } else if (asText(key.answer_key_json?.auto_compare) === 'antibody_set' && answerText) {
            const expected = asText(key.answer_key_json?.text || key.answer_key_json?.consensus_result);
            const submittedKey = antibodySetKey(answerText);
            const expectedKey = antibodySetKey(expected);
            correct = Boolean(submittedKey && expectedKey && submittedKey === expectedKey);
          }
          if (correct === null) continue;
          const points = Number(question.points || 1);
          if (!educational) {
            totalPoints += points;
            if (correct) awardedPoints += points;
          }
          await admin!.from('ec_competency_answers').update({
            is_correct: correct,
            score_awarded: educational ? null : (correct ? points : 0),
          }).eq('id', submittedAnswer.id);
        }
        await admin!.from('ec_competency_assignments').update({
          score: totalPoints > 0 ? Math.round((awardedPoints / totalPoints) * 10000) / 100 : null,
        }).eq('id', assignment.id);
      }
    };

    if (isAnswerKeyAction) {
      const requestedIds = new Set((Array.isArray(body.question_ids) ? body.question_ids : []).map(asText).filter(Boolean));
      const targetQuestions = requestedIds.size
        ? questions.filter((question: any) => requestedIds.has(question.id))
        : questions.slice(0, 5);
      if (!targetQuestions.length) return json({ error: 'ไม่พบข้อสอบในชุดที่ต้องการสร้างเฉลย' }, 400);
      const deterministicById = new Map<string, any>();
      for (const question of targetQuestions) {
        const deterministic = deterministicAnswerForQuestion(question, evaluationManifest, round);
        if (deterministic) deterministicById.set(question.id, deterministic);
      }
      const aiTargetQuestions = targetQuestions.filter((question: any) => !deterministicById.has(question.id));
      const targetManifest = aiTargetQuestions.map((question: any) => ({
        question_id: question.id,
        question_order: question.question_order,
        section: question.section,
        question_type: question.question_type,
        prompt: question.prompt,
        choices: (question.ec_question_choices ?? [])
          .sort((a: any, b: any) => a.choice_order - b.choice_order)
          .map((choice: any) => choice.choice_text),
      }));
      const answerPrompt = `
คุณเป็นผู้จัดการคุณภาพห้องปฏิบัติการเวชศาสตร์บริการโลหิต
สร้าง “เฉลยข้อสอบชุดย่อย” เท่านั้น ห้ามสร้างรายงานสรุปในคำขอนี้
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
ข้อสอบชุดนี้: ${JSON.stringify(targetManifest)}
รายการไฟล์และข้อมูลที่อ่านแล้ว: ${JSON.stringify(evaluationManifest)}

กติกา:
1) graded ใช้ Intended Response จาก official_result เท่านั้น ห้ามใช้ Your Result หรือ submission_form เป็นเฉลย
2) Educational Challenge / See Note [26] ใช้ participant_summary consensus เท่านั้น ถ้าไม่มีหรือไม่ชัด ให้ answer_basis = insufficient
3) single_choice ให้ correct_choice_index ตามลำดับตัวเลือกจริง เริ่มนับ 1
4) Antibody Identification ให้ correct_answer_text เป็น CAP Master List เช่น “115 │ Anti-E; 124 │ Anti-K” และ correct_choice_index = 0
5) Multiple antibody ต้องตอบครบ
6) Educational ให้ใส่ consensus_result และ consensus_percent จาก Participant Summary เพื่อใช้เทียบว่าเป็นคำตอบกลุ่มส่วนมาก ไม่เรียกว่าเฉลยทางการ
7) comparison_note อธิบายสั้น ๆ ว่าเป็น “คำตอบส่วนใหญ่ของผู้เข้าร่วม” และไม่มีการให้ Grade ทางการ
8) explanation ระบุหลักฐานสั้น ๆ และ evidence_file_names
9) ตอบเฉพาะ question_id ที่ส่งมา ห้ามเพิ่มหรือลดข้อ
`;
      const answerSchema = {
        type: 'object',
        additionalProperties: false,
        required: ['answers'],
        properties: {
          answers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'question_id','question_order','challenge_type','answer_basis','correct_choice_index',
                'correct_answer_text','consensus_result','consensus_percent','comparison_note','explanation','confidence','evidence_file_names'
              ],
              properties: {
                question_id: { type: 'string' },
                question_order: { type: 'integer' },
                challenge_type: { type: 'string', enum: ['graded','educational','unknown'] },
                answer_basis: { type: 'string', enum: ['official_intended_response','participant_consensus','insufficient'] },
                correct_choice_index: { type: 'integer' },
                correct_answer_text: { type: 'string' },
                consensus_result: { type: 'string' },
                consensus_percent: { type: 'string' },
                comparison_note: { type: 'string' },
                explanation: { type: 'string' },
                confidence: { type: 'string', enum: ['high','medium','low'] },
                evidence_file_names: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      };
      const generatedKeys = aiTargetQuestions.length
        ? await callOpenAI(openaiKey as string, model, [
            { type: 'input_text', text: answerPrompt },
          ], 'cnmi_competency_answer_keys_batch_v240', answerSchema)
        : { answers: [] };
      const answerById = new Map<string, any>((generatedKeys.answers ?? []).map((answer: any) => [asText(answer.question_id), answer]));
      const answerByOrder = new Map<number, any>((generatedKeys.answers ?? []).map((answer: any) => [Number(answer.question_order), answer]));
      let keyedCount = 0;
      let manualReviewCount = 0;
      for (const question of targetQuestions) {
        const rawAnswer = deterministicById.get(question.id) || answerById.get(question.id) || answerByOrder.get(Number(question.question_order)) || {
          challenge_type: 'unknown',
          answer_basis: 'insufficient',
          correct_choice_index: 0,
          correct_answer_text: '',
          consensus_result: '',
          consensus_percent: '',
          comparison_note: '',
          explanation: 'ไม่พบหลักฐานเพียงพอสำหรับสร้างเฉลยอัตโนมัติ กรุณาให้ผู้จัดการคุณภาพตรวจและกำหนดเฉลยเอง',
          confidence: 'low',
          evidence_file_names: [],
        };
        const answer = enrichGeneratedAnswer(question, rawAnswer, evaluationManifest, hasParticipantSummary, round);
        const sortedChoices = (question.ec_question_choices ?? []).sort((a: any, b: any) => a.choice_order - b.choice_order);
        const challengeType = asText(answer.challenge_type) || 'unknown';
        const answerBasis = asText(answer.answer_basis) || 'insufficient';
        const isChoiceQuestion = question.question_type === 'single_choice';
        let index = Number(answer.correct_choice_index || 0);
        let correctAnswerText = asText(answer.correct_answer_text);
        if (isChoiceQuestion && !(index >= 1 && index <= sortedChoices.length)) {
          index = resolveChoiceIndexFromAnswer(question, correctAnswerText || answer.consensus_result);
        }
        const invalidBasis = answerBasis === 'insufficient'
          || (challengeType === 'graded' && answerBasis !== 'official_intended_response')
          || (challengeType === 'educational' && (answerBasis !== 'participant_consensus' || !hasParticipantSummary))
          || challengeType === 'unknown'
          || (answerBasis === 'participant_consensus' && !hasParticipantSummary);
        if (invalidBasis) {
          index = 0;
          correctAnswerText = '';
        }
        if (!isChoiceQuestion) index = 0;
        const correctChoice = isChoiceQuestion && index >= 1 && index <= sortedChoices.length ? sortedChoices[index - 1] : null;
        const hasTextKey = !isChoiceQuestion && Boolean(correctAnswerText);
        const { error: keyError } = await admin!.from('ec_question_answer_keys').upsert({
          question_id: question.id,
          correct_choice_ids: correctChoice ? [correctChoice.id] : [],
          answer_key_json: {
            generated_by_ai: !Boolean(rawAnswer?._deterministic),
            deterministic_generated: Boolean(rawAnswer?._deterministic),
            confidence: answer.confidence,
            challenge_type: challengeType,
            answer_basis: answerBasis,
            evidence_file_names: answer.evidence_file_names ?? [],
            consensus_result: asText(answer.consensus_result),
            consensus_percent: asText(answer.consensus_percent),
            comparison_note: asText(answer.comparison_note),
            text: hasTextKey ? correctAnswerText : '',
            allowed_antibody_catalog: question.question_type === 'image_interpretation' ? CAP_ANTIBODY_CHOICES : [],
            normalized_answers: questionTestKey(question) === 'antibody_identification' && hasTextKey ? capAntibodyLabelsFromText(correctAnswerText) : [],
            auto_compare: questionTestKey(question) === 'antibody_identification' && hasTextKey ? 'antibody_set' : null,
            safeguards: {
              submission_form_never_used_as_answer: true,
              educational_requires_participant_summary: true,
            },
            needs_manual_review: !(correctChoice || hasTextKey),
          },
          explanation: asText(answer.explanation) || null,
          updated_by: callerId,
        }, { onConflict: 'question_id' });
        if (keyError) throw keyError;
        if (correctChoice || hasTextKey) keyedCount += 1;
        else manualReviewCount += 1;
      }
      await regradeRoundAssignments();
      await admin!.from('ec_ai_generation_runs').update({
        status: 'completed',
        generated_summary: `สร้างเฉลย ${keyedCount}/${targetQuestions.length} ข้อ · ไม่เรียก AI ${deterministicById.size} ข้อ · เรียก AI ${aiTargetQuestions.length} ข้อ`,
        generated_count: keyedCount,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
      return json({
        ok: true,
        generated_count: keyedCount,
        question_count: targetQuestions.length,
        deterministic_count: deterministicById.size,
        ai_count: aiTargetQuestions.length,
        manual_review_count: manualReviewCount,
        run_id: runId,
      });
    }

    if (isOfficialSummaryAction) {
      const summaryPrompt = `
คุณเป็นผู้จัดการคุณภาพห้องปฏิบัติการเวชศาสตร์บริการโลหิต
สร้าง “สรุปผลอย่างเป็นทางการ” เท่านั้น ห้ามสร้างเฉลยรายข้อในคำขอนี้
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
รายการไฟล์และข้อมูลที่อ่านแล้ว: ${JSON.stringify(evaluationManifest)}

บทบาทเอกสาร:
- official_result ใช้ Intended Response, Grade และคะแนน
- submission_form ใช้สรุปว่าห้องส่งอะไร ห้ามใช้แทนเฉลย
- participant_summary ใช้ peer comparison และ Educational Challenge

ข้อกำหนด:
1) specimen_summaries หนึ่งแถวต่อ ตัวอย่าง + รายการทดสอบ
2) J-01 ถึง J-05 ต้องแยก ABO Group, Rh Type, Unexpected Antibody Detection, Antibody Identification และ Crossmatch/Compatibility Testing เป็นคนละแถว ห้ามรวมชื่อการทดสอบหรือผลไว้ในแถวเดียว; ถ้ามีครบทั้ง 5 ตัวอย่างและ 5 การทดสอบ ต้องได้ 25 แถว
3) J-06R และ JE-07R แยกหนึ่งแถวต่อ antigen เช่น C, c, E, e, K, D, Fya ตามเอกสาร
4) JE-07 แยก ABO Group, Rh Type, Antibody Detection, Antibody Identification, Crossmatch Serology
5) majority_percent ใช้ร้อยละจาก Participant Summary เท่านั้น
6) assessment ใช้ pass, fail, educational, not_graded หรือ pending; Educational ต้องใช้ assessment = educational เสมอเมื่อมี consensus และห้ามเปลี่ยนเป็น pass/fail เพราะไม่มี Grade ทางการ
7) ทุกแถวให้ระบุ challenge_type = graded, educational หรือ unknown
8) Educational ต้องเปรียบเทียบ lab_result จาก submission_form กับ participant consensus: ตรงกันให้ consensus_alignment = aligned, internal_review_status = acceptable, review_required = false; ต่างกันให้ consensus_alignment = minority, internal_review_status = needs_explanation, review_required = true และระบุ review_reason ว่าต้องอธิบายเหตุผลที่ห้องตอบต่างจากกลุ่มส่วนใหญ่
9) ถ้า Educational ไม่มี Participant Summary, consensus เสมอกัน หรือข้อมูลไม่ชัด ให้ consensus_alignment = unclear, internal_review_status = pending, review_required = true และ assessment = pending โดยห้ามเดา
10) review_topics ต้องมีหนึ่งหัวข้อต่อ Educational ที่เป็น minority หรือ unclear เพื่อให้ห้องปฏิบัติการทบทวนความเหมาะสม แม้ผู้ให้บริการไม่ให้คะแนน
11) แยกข้อความเป็น ผลของห้อง, ผลที่ควรเป็น/consensus, คะแนน/Grade, เปรียบเทียบผู้เข้าร่วม, หัวข้อทบทวน
12) ร้อยละผู้เข้าร่วมใช้เพื่ออธิบาย consensus เท่านั้น ไม่ใช่คะแนนของห้อง
`;
      const summarySchema = {
        type: 'object',
        additionalProperties: false,
        required: [
          'evaluation_mode','score_text','score_source','outcome','lab_result_summary',
          'intended_response_summary','grade_summary','peer_comparison_summary',
          'review_topics','specimen_summaries','round_summary'
        ],
        properties: {
          evaluation_mode: { type: 'string', enum: ['graded','educational','mixed','insufficient'] },
          score_text: { type: 'string' },
          score_source: { type: 'string', enum: ['official_evaluation','not_available'] },
          outcome: { type: 'string', enum: ['pass','fail','partial','pending'] },
          lab_result_summary: { type: 'string' },
          intended_response_summary: { type: 'string' },
          grade_summary: { type: 'string' },
          peer_comparison_summary: { type: 'string' },
          review_topics: { type: 'array', items: { type: 'string' } },
          specimen_summaries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['program','specimen','test_name','lab_result','intended_response','official_grade','peer_result','majority_percent','challenge_type','consensus_alignment','internal_review_status','review_required','review_reason','assessment','note'],
              properties: {
                program: { type: 'string' },
                specimen: { type: 'string' },
                test_name: { type: 'string' },
                lab_result: { type: 'string' },
                intended_response: { type: 'string' },
                official_grade: { type: 'string' },
                peer_result: { type: 'string' },
                majority_percent: { type: 'string' },
                challenge_type: { type: 'string', enum: ['graded','educational','unknown'] },
                consensus_alignment: { type: 'string', enum: ['aligned','minority','unclear','not_applicable'] },
                internal_review_status: { type: 'string', enum: ['acceptable','needs_explanation','pending','not_applicable'] },
                review_required: { type: 'boolean' },
                review_reason: { type: 'string' },
                assessment: { type: 'string', enum: ['pass','fail','educational','not_graded','pending'] },
                note: { type: 'string' },
              },
            },
          },
          round_summary: { type: 'string' },
        },
      };
      // v2.4.0: สร้างสรุปจากข้อมูลที่อ่านและผลที่บันทึกไว้แบบ deterministic
      // ไม่เรียก OpenAI ซ้ำในขั้นนี้ จึงไม่เสีย API usage จากการจัดตาราง/เทียบ consensus
      const generatedSummary = buildDeterministicOfficialSummary(round, evaluationManifest, liveResultRows);
      const normalizedSpecimenSummaries = generatedSummary.specimen_summaries;
      const { data: existingOfficial } = await admin!.from('ec_official_results').select('*').eq('round_id', roundId).maybeSingle();
      const evaluationMode = asText(generatedSummary.evaluation_mode) || 'insufficient';
      const scoreTextValue = asText(generatedSummary.score_text);
      const percentMatches = [...scoreTextValue.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];
      const numericScore = generatedSummary.score_source === 'official_evaluation' && percentMatches.length
        ? percentMatches[percentMatches.length - 1]?.[1]
        : undefined;
      const score = ['educational','insufficient'].includes(evaluationMode)
        ? null
        : (numericScore ? Number(numericScore) : existingOfficial?.score ?? null);
      const safeOutcome = ['educational','insufficient'].includes(evaluationMode)
        ? 'pending'
        : (generatedSummary.outcome || existingOfficial?.outcome || 'pending');
      const releaseAnswersAfterSubmit = Boolean(body.release_answers_after_submit);
      const keyRows = questions.length
        ? (await admin!.from('ec_question_answer_keys').select('answer_key_json').in('question_id', questions.map((question: any) => question.id))).data
        : [];
      const manualReviewCount = (keyRows ?? []).filter((row: any) => row?.answer_key_json?.needs_manual_review).length;
      const reviewTopics = [...new Set(normalizedSpecimenSummaries
        .filter((row: any) => row.review_required)
        .map((row: any) => `${asText(row.specimen)} ${asText(row.test_name)}: ${asText(row.review_reason)}`)
        .filter(Boolean))];
      const officialPayload = {
        ...(existingOfficial?.official_payload ?? {}),
        ai_generated: false,
        deterministic_generated: true,
        program_profile: resolveProgramProfile(round).code,
        ai_generation_run_id: runId,
        ai_generated_at: new Date().toISOString(),
        evaluation_mode: evaluationMode,
        score_source: generatedSummary.score_source,
        lab_result_summary: asText(generatedSummary.lab_result_summary),
        intended_response_summary: asText(generatedSummary.intended_response_summary),
        grade_summary: asText(generatedSummary.grade_summary),
        peer_comparison_summary: asText(generatedSummary.peer_comparison_summary),
        review_topics: reviewTopics,
        specimen_summaries: normalizedSpecimenSummaries,
        document_role_summary: {
          has_official_evaluation: true,
          has_submitted_result: hasSubmittedResult,
          has_participant_summary: hasParticipantSummary,
        },
        answer_key_manual_review_count: manualReviewCount,
        answer_release_mode: releaseAnswersAfterSubmit ? 'after_submit' : (existingOfficial?.official_payload?.answer_release_mode || 'manual'),
      };
      const { error: officialError } = await admin!.from('ec_official_results').upsert({
        round_id: roundId,
        official_payload: officialPayload,
        score,
        outcome: safeOutcome,
        summary: asText(generatedSummary.round_summary) || existingOfficial?.summary || null,
        published_to_staff: releaseAnswersAfterSubmit ? true : (existingOfficial?.published_to_staff ?? false),
        document_id: existingOfficial?.document_id ?? requiredDocs[0]?.id ?? null,
        recorded_by: callerId,
        received_at: existingOfficial?.received_at ?? new Date().toISOString(),
      }, { onConflict: 'round_id' });
      if (officialError) throw officialError;
      await admin!.from('ec_eqa_rounds').update({
        status: 'official_result_received',
        answer_released_at: releaseAnswersAfterSubmit ? new Date().toISOString() : round.answer_released_at,
        updated_by: callerId,
      }).eq('id', roundId);
      await admin!.from('ec_ai_generation_runs').update({
        status: 'completed',
        generated_summary: `สร้างสรุปแบบไม่เรียก AI · ${asText(generatedSummary.round_summary)}`,
        generated_count: normalizedSpecimenSummaries.length,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
      return json({
        ok: true,
        summary: generatedSummary.round_summary,
        outcome: safeOutcome,
        score,
        row_count: normalizedSpecimenSummaries.length,
        evaluation_mode: evaluationMode,
        run_id: runId,
      });
    }

    const prompt = `
คุณเป็นผู้จัดการคุณภาพห้องปฏิบัติการเวชศาสตร์บริการโลหิต
ให้สร้างเฉลยและสรุปผล EQA โดยแยกบทบาทของเอกสารอย่างเคร่งครัด
รอบ: ${round.provider} ${round.round_code} ปี ${round.survey_year}
ข้อสอบ: ${JSON.stringify(questionManifest)}
รายการไฟล์: ${JSON.stringify(manifest)}

บทบาทเอกสาร:
- official_result = Official Evaluation / Original Evaluation เป็นแหล่งหลักสำหรับ Intended Response, Grade และคะแนนอย่างเป็นทางการ
- submission_form = แบบฟอร์มผลที่ห้องปฏิบัติการกรอกส่ง ใช้สรุปว่า “ห้องส่งอะไร” เท่านั้น ห้ามใช้เป็นเฉลย
- participant_summary = Participant Summary / PSR ใช้สรุปสัดส่วนและ consensus ของผู้เข้าร่วม และใช้ประเมิน Educational Challenge
- source_document / instruction / raw_result_image / antibody_panel ใช้ทำความเข้าใจคำถาม โครงสร้าง ปฏิกิริยา และ antigen profile แต่ไม่แทนเฉลยอย่างเป็นทางการ

กติกาสำคัญ:
1) สำหรับข้อที่มีการให้คะแนน (graded) ต้องกำหนดเฉลยจาก Intended Response ใน official_result เท่านั้น ห้ามใช้ Your Result หรือผลที่กรอกส่งเป็นเฉลย
2) สำหรับ Educational Challenge, See Note [26], ungraded หรือ not formally evaluated: ห้ามใช้ Your Result เป็นเฉลย ให้ใช้ consensus เด่นจาก participant_summary เพื่อประเมินตนเองเท่านั้น
3) ข้อ single_choice ให้ใช้ correct_choice_index ตามลำดับตัวเลือกจริง ถ้าหลักฐานไม่พอให้เป็น 0
4) ข้อ question_type = image_interpretation หรือ text โดยเฉพาะ Antibody Identification ให้ใส่คำตอบเต็มใน correct_answer_text เช่น “115 │ Anti-E; 124 │ Anti-K” และ correct_choice_index = 0
5) Antibody Identification อาจมีมากกว่า 1 antibody ต้องระบุให้ครบตาม Intended Response/consensus ห้ามลดเหลือเพียง primary antibody
6) challenge_type ใช้ graded, educational หรือ unknown; answer_basis ใช้ official_intended_response, participant_consensus หรือ insufficient
7) explanation ระบุสั้น ๆ ว่าอ้างจาก Intended Response หรือ participant consensus พร้อมชื่อไฟล์ที่เกี่ยวข้อง
8) score_text ใส่เฉพาะคะแนนรวมของห้องที่ระบุชัดใน official_result หากไม่มีคะแนนรวมเดียวให้เว้นว่าง และ score_source = not_available
9) outcome ของรอบ Educational Challenge ล้วนให้เป็น pending ส่วนรอบ mixed ให้ตัดสินจากส่วน graded เท่านั้น
10) แยกสรุปเป็น 5 ส่วน: ผลของห้อง, ผลที่ควรเป็น, คะแนน/Grade, เปรียบเทียบผู้เข้าร่วม, หัวข้อทบทวน
11) specimen_summaries ต้องเป็นหนึ่งแถวต่อ “ตัวอย่าง + รายการทดสอบ” และใช้รหัสมาตรฐาน J-01, J-02, J-03, J-04, J-05, J-06R, JE-07, JE-07R
12) แต่ละแถวต้องมี program, specimen, test_name, lab_result, intended_response, official_grade, peer_result, majority_percent, assessment และ note
13) official_grade ใส่ Grade/ผลประเมินจาก Official Evaluation เช่น Good, Satisfactory, Unsatisfactory หรือเว้นว่างถ้าไม่มี
14) majority_percent ใส่ร้อยละจาก Participant Summary แบบสั้น เช่น 99.8% เท่านั้น หากไม่มีให้เว้นว่าง และ peer_result ใช้อธิบาย consensus เพิ่มเติม
15) สำหรับ J-01 ถึง J-05 ต้องสร้าง ABO Group, Rh Type, Unexpected Antibody Detection, Antibody Identification และ Crossmatch/Compatibility Testing เป็นคนละแถว ห้ามรวมชื่อหรือผล; ถ้ามีครบต้องได้ 25 แถว เพื่อให้ระบบจัดตารางแบบ FM-CNCPL-048
16) สำหรับ J-06R และ JE-07R ให้แยกหนึ่งแถวต่อ antigen เช่น C Type, E Type, c Type, e Type, K Type, D Type, Fya Type ตามเอกสารจริง
17) สำหรับ JE-07 ให้แยก ABO Group, Rh Type, Antibody Detection, Antibody Identification และ Crossmatch Serology
18) assessment ใช้ pass, fail, educational, not_graded หรือ pending เท่านั้น; แถว Educational ที่มี consensus ใช้ assessment = educational ไม่ใช้ pass/fail
19) ทุก specimen_summaries ต้องมี challenge_type, consensus_alignment, internal_review_status, review_required และ review_reason
20) Educational เปรียบเทียบ lab_result กับ participant consensus: ตรงกัน = aligned/acceptable/false; ต่างกัน = minority/needs_explanation/true และเพิ่ม review_topics ให้ชี้แจงเหตุผลที่ตอบต่างจากกลุ่มส่วนใหญ่
21) Educational ที่ consensus ไม่ชัดหรือไม่มี Participant Summary = unclear/pending/true และ assessment = pending ห้ามเดา
22) round_summary เป็นสรุปรวมภาษาไทยที่อ่านได้ในรายงาน โดยไม่สร้างข้อมูลผู้ป่วยหรือข้อมูลระบุตัวตน
23) หาก official_result ไม่มี Intended Response และมีเพียง Your Result + See Note [26] ต้องถือว่าเป็น Educational Challenge และห้ามนำ Your Result มาสร้างเฉลย
24) สำหรับคำถาม Educational ให้ใส่ consensus_result, consensus_percent และ comparison_note จาก Participant Summary เพื่อแสดงเป็นคำตอบกลุ่มส่วนมาก ไม่ใช่เฉลยหรือ Grade ทางการ

`;

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: [
        'evaluation_mode', 'score_text', 'score_source', 'outcome',
        'lab_result_summary', 'intended_response_summary', 'grade_summary',
        'peer_comparison_summary', 'review_topics', 'specimen_summaries', 'round_summary', 'answers'
      ],
      properties: {
        evaluation_mode: { type: 'string', enum: ['graded', 'educational', 'mixed', 'insufficient'] },
        score_text: { type: 'string' },
        score_source: { type: 'string', enum: ['official_evaluation', 'not_available'] },
        outcome: { type: 'string', enum: ['pass', 'fail', 'partial', 'pending'] },
        lab_result_summary: { type: 'string' },
        intended_response_summary: { type: 'string' },
        grade_summary: { type: 'string' },
        peer_comparison_summary: { type: 'string' },
        review_topics: { type: 'array', items: { type: 'string' } },
        specimen_summaries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['program','specimen','test_name','lab_result','intended_response','official_grade','peer_result','majority_percent','challenge_type','consensus_alignment','internal_review_status','review_required','review_reason','assessment','note'],
            properties: {
              program: { type: 'string' },
              specimen: { type: 'string' },
              test_name: { type: 'string' },
              lab_result: { type: 'string' },
              intended_response: { type: 'string' },
              official_grade: { type: 'string' },
              peer_result: { type: 'string' },
              majority_percent: { type: 'string' },
              challenge_type: { type: 'string', enum: ['graded','educational','unknown'] },
              consensus_alignment: { type: 'string', enum: ['aligned','minority','unclear','not_applicable'] },
              internal_review_status: { type: 'string', enum: ['acceptable','needs_explanation','pending','not_applicable'] },
              review_required: { type: 'boolean' },
              review_reason: { type: 'string' },
              assessment: { type: 'string', enum: ['pass','fail','educational','not_graded','pending'] },
              note: { type: 'string' }
            }
          }
        },
        round_summary: { type: 'string' },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'question_order', 'challenge_type', 'answer_basis', 'correct_choice_index', 'correct_answer_text',
              'consensus_result', 'consensus_percent', 'comparison_note', 'explanation', 'confidence', 'evidence_file_names'
            ],
            properties: {
              question_order: { type: 'integer' },
              challenge_type: { type: 'string', enum: ['graded', 'educational', 'unknown'] },
              answer_basis: { type: 'string', enum: ['official_intended_response', 'participant_consensus', 'insufficient'] },
              correct_choice_index: { type: 'integer' },
              correct_answer_text: { type: 'string' },
              consensus_result: { type: 'string' },
              consensus_percent: { type: 'string' },
              comparison_note: { type: 'string' },
              explanation: { type: 'string' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              evidence_file_names: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };

    const generated = await callOpenAI(openaiKey as string, model, [
      { type: 'input_text', text: prompt },
    ], 'cnmi_competency_answers_v232', schema);
    const normalizedSpecimenSummaries = normalizeOfficialSpecimenSummaries(generated.specimen_summaries, evaluationManifest, round, liveResultRows);

    let keyedCount = 0;
    let manualReviewCount = 0;
    const generatedAnswerByOrder = new Map<number, any>(
      (generated.answers ?? []).map((answer: any) => [Number(answer.question_order), answer]),
    );
    for (const question of questions) {
      const rawAnswer = generatedAnswerByOrder.get(Number(question.question_order)) ?? {
        challenge_type: 'unknown',
        answer_basis: 'insufficient',
        correct_choice_index: 0,
        correct_answer_text: '',
        consensus_result: '',
        consensus_percent: '',
        comparison_note: '',
        explanation: 'ไม่พบหลักฐานเพียงพอสำหรับสร้างเฉลยอัตโนมัติ กรุณาให้ผู้จัดการคุณภาพตรวจและกำหนดเฉลยเอง',
        confidence: 'low',
        evidence_file_names: [],
      };
      const answer = enrichGeneratedAnswer(question, rawAnswer, evaluationManifest, hasParticipantSummary, round);
      const sortedChoices = (question.ec_question_choices ?? []).sort((a: any, b: any) => a.choice_order - b.choice_order);
      const challengeType = asText(answer.challenge_type) || 'unknown';
      const answerBasis = asText(answer.answer_basis) || 'insufficient';
      const isChoiceQuestion = question.question_type === 'single_choice';
      let index = Number(answer.correct_choice_index || 0);
      let correctAnswerText = asText(answer.correct_answer_text);
      if (isChoiceQuestion && !(index >= 1 && index <= sortedChoices.length)) {
        index = resolveChoiceIndexFromAnswer(question, correctAnswerText || answer.consensus_result);
      }

      // Hard safeguards: submitted results and "Your Result" can never become the answer key.
      const invalidBasis = answerBasis === 'insufficient'
        || (challengeType === 'graded' && answerBasis !== 'official_intended_response')
        || (challengeType === 'educational' && (answerBasis !== 'participant_consensus' || !hasParticipantSummary))
        || challengeType === 'unknown'
        || (answerBasis === 'participant_consensus' && !hasParticipantSummary);
      if (invalidBasis) {
        index = 0;
        correctAnswerText = '';
      }
      if (!isChoiceQuestion) index = 0;

      const correctChoice = isChoiceQuestion && index >= 1 && index <= sortedChoices.length ? sortedChoices[index - 1] : null;
      const hasTextKey = !isChoiceQuestion && Boolean(correctAnswerText);
      const { error: keyError } = await admin.from('ec_question_answer_keys').upsert({
        question_id: question.id,
        correct_choice_ids: correctChoice ? [correctChoice.id] : [],
        answer_key_json: {
          generated_by_ai: true,
          confidence: answer.confidence,
          challenge_type: challengeType,
          answer_basis: answerBasis,
          evidence_file_names: answer.evidence_file_names ?? [],
          consensus_result: asText(answer.consensus_result),
          consensus_percent: asText(answer.consensus_percent),
          comparison_note: asText(answer.comparison_note),
          text: hasTextKey ? correctAnswerText : '',
          allowed_antibody_catalog: question.question_type === 'image_interpretation' ? CAP_ANTIBODY_CHOICES : [],
          normalized_answers: questionTestKey(question) === 'antibody_identification' && hasTextKey ? capAntibodyLabelsFromText(correctAnswerText) : [],
          auto_compare: questionTestKey(question) === 'antibody_identification' && hasTextKey ? 'antibody_set' : null,
          safeguards: {
            submission_form_never_used_as_answer: true,
            educational_requires_participant_summary: true,
          },
          needs_manual_review: !(correctChoice || hasTextKey),
        },
        explanation: asText(answer.explanation) || null,
        updated_by: callerId,
      }, { onConflict: 'question_id' });
      if (keyError) throw keyError;
      if (correctChoice || hasTextKey) keyedCount += 1;
      else manualReviewCount += 1;
    }

    const { data: existingOfficial } = await admin
      .from('ec_official_results')
      .select('*')
      .eq('round_id', roundId)
      .maybeSingle();
    const evaluationMode = asText(generated.evaluation_mode) || 'insufficient';
    const numericScore = generated.score_source === 'official_evaluation'
      ? asText(generated.score_text).match(/-?\d+(?:\.\d+)?/)?.[0]
      : undefined;
    const score = ['educational', 'insufficient'].includes(evaluationMode)
      ? null
      : (numericScore ? Number(numericScore) : existingOfficial?.score ?? null);
    const safeOutcome = ['educational', 'insufficient'].includes(evaluationMode)
      ? 'pending'
      : (generated.outcome || existingOfficial?.outcome || 'pending');
    const releaseAnswersAfterSubmit = Boolean(body.release_answers_after_submit);
    const reviewTopics = [...new Set(normalizedSpecimenSummaries
      .filter((row: any) => row.review_required)
      .map((row: any) => `${asText(row.specimen)} ${asText(row.test_name)}: ${asText(row.review_reason)}`)
      .filter(Boolean))];
    const officialPayload = {
      ...(existingOfficial?.official_payload ?? {}),
      ai_generated: true,
      ai_generation_run_id: runId,
      ai_generated_at: new Date().toISOString(),
      evaluation_mode: evaluationMode,
      score_source: generated.score_source,
      lab_result_summary: asText(generated.lab_result_summary),
      intended_response_summary: asText(generated.intended_response_summary),
      grade_summary: asText(generated.grade_summary),
      peer_comparison_summary: asText(generated.peer_comparison_summary),
      review_topics: reviewTopics,
      specimen_summaries: normalizedSpecimenSummaries,
      document_role_summary: {
        has_official_evaluation: true,
        has_submitted_result: hasSubmittedResult,
        has_participant_summary: hasParticipantSummary,
      },
      answer_key_manual_review_count: manualReviewCount,
      answer_release_mode: releaseAnswersAfterSubmit ? 'after_submit' : (existingOfficial?.official_payload?.answer_release_mode || 'manual'),
    };
    const { error: officialError } = await admin.from('ec_official_results').upsert({
      round_id: roundId,
      official_payload: officialPayload,
      score,
      outcome: safeOutcome,
      summary: asText(generated.round_summary) || existingOfficial?.summary || null,
      published_to_staff: releaseAnswersAfterSubmit ? true : (existingOfficial?.published_to_staff ?? false),
      document_id: existingOfficial?.document_id ?? requiredDocs[0]?.id ?? null,
      recorded_by: callerId,
      received_at: existingOfficial?.received_at ?? new Date().toISOString(),
    }, { onConflict: 'round_id' });
    if (officialError) throw officialError;

    await admin.from('ec_eqa_rounds').update({
      status: 'official_result_received',
      answer_released_at: releaseAnswersAfterSubmit ? new Date().toISOString() : round.answer_released_at,
      updated_by: callerId,
    }).eq('id', roundId);

    // Re-grade both choice questions and Antibody Identification text answers.
    await regradeRoundAssignments();

    await admin.from('ec_ai_generation_runs').update({
      status: 'completed',
      generated_summary: asText(generated.round_summary),
      generated_count: keyedCount,
      completed_at: new Date().toISOString(),
    }).eq('id', runId);

    return json({
      ok: true,
      generated_count: keyedCount,
      question_count: questions.length,
      summary: generated.round_summary,
      outcome: safeOutcome,
      score,
      manual_review_count: manualReviewCount,
      evaluation_mode: evaluationMode,
      run_id: runId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (admin && runId) {
      await admin.from('ec_ai_generation_runs').update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    return json({ error: message }, 500);
  }
});
