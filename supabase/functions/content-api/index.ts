/** Test-only content service. Authentication uses the existing app_sessions contract.
 * No Supabase JWT user claims, browser roles, client scores, or public file URLs are trusted.
 * Dependency-free Web APIs keep deployment reproducible. See schema/content-platform.sql.
 */
declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };
type Row = Record<string, any>;
type Role = 'anonymous' | 'student' | 'admin';
type Context = { role: Role; user?: Row; session?: Row; tokenHash?: string };
const PROJECT = 'rerykeslgwhamreoskgx';
const BUCKET = 'science-content-private';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_BODY = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const BUILTIN = /^(u3_l[1235678]|u7_l[1-8])$/;
const metadataColumns = 'id,kind,title,description,unit_id,unit_title,lesson_id,format,published,student_access,version,updated_at,created_at,archived_at,has_quiz';
export class HttpError extends Error {
  status: number; code: string;
  constructor(message: string, status = 400, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
export const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function accountEnabled(user: Row | null): boolean {
  if (!user || user.deleted_at || user.disabled_at || user.is_active === false || user.active === false) return false;
  const approved = user.approval_status;
  if (approved != null && !['approved', '승인', '승인완료'].includes(String(approved).toLowerCase())) return false;
  return ['등록완료', '승인', '승인완료', 'active', 'approved', 'enabled'].includes(String(user.status ?? '').trim().toLowerCase());
}
export function validSession(session: Row | null, prefix: 'stu_' | 'adm_', now: number): boolean {
  if (!session || session.revoked_at) return false;
  const expiry = Date.parse(String(session.expires_at ?? ''));
  if (!Number.isFinite(expiry) || expiry <= now) return false;
  if (prefix === 'adm_') return session.session_type === 'admin' && session.account_type === 'admin' && session.login_id === 'admin';
  return ['student', 'manager'].includes(session.session_type) && session.account_type !== 'admin';
}
export function assessmentOpen(item: Row, locks: unknown): boolean {
  if (!object(locks) || !item.lesson_id) return false;
  const hall = locks.evalHallVisibilityMode === 'all' || (locks.evalHallVisibilityMode == null && locks.evalHallVisible === true);
  const unit = locks[item.unit_id];
  return hall && object(unit) && unit.isLocked === false && object(unit.lessons) && unit.lessons[item.lesson_id] === false;
}
export function canRead(item: Row, role: Role, locks: unknown): boolean {
  if (item.archived_at) return false;
  if (role === 'admin') return true;
  if (role !== 'student' || item.published !== true || item.student_access !== true || item.kind === 'answer') return false;
  if (item.kind === 'assessment') return assessmentOpen(item, locks);
  // A new uploaded lesson uses its publication controls. Existing explicit locks still win.
  if (!object(locks)) return false;
  const unit = locks[item.unit_id];
  const builtin = BUILTIN.test(String(item.lesson_id));
  if (builtin && (unit?.isLocked !== false || unit?.lessons?.[item.lesson_id] !== false)) return false;
  if (unit?.isLocked === true || unit?.lessons?.[item.lesson_id] === true) return false;
  if (item.kind === 'worksheet') {
    const ws = locks.worksheetCurriculum;
    const number = String(item.unit_id).replace(/^unit/, '');
    if (builtin && (ws?.isLocked !== false || ws?.units?.[number]?.isLocked !== false || ws?.units?.[number]?.items?.[`ws_${item.lesson_id}`] !== false)) return false;
    if (ws?.isLocked === true || ws?.units?.[number]?.isLocked === true || ws?.units?.[number]?.items?.[`ws_${item.lesson_id}`] === true) return false;
  }
  return true;
}
export function metadata(item: Row): Row {
  const safe: Row = { source: 'server' };
  for (const key of metadataColumns.split(',')) safe[key] = item[key] ?? null;
  return safe;
}
function stringValue(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new HttpError(`${label} 형식이 올바르지 않습니다.`);
  return value.trim();
}
export function quizData(value: unknown): Row[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) throw new HttpError('퀴즈는 최대 5문항입니다.');
  return value.map(q => {
    if (!object(q) || !Number.isInteger(q.correct) || !Number.isInteger(q.choices) || q.choices < 2 || q.choices > 10 || q.correct < 1 || q.correct > q.choices) throw new HttpError('퀴즈 정답 형식이 올바르지 않습니다.');
    if (typeof q.explanation !== 'string' || q.explanation.length > 10000) throw new HttpError('퀴즈 해설 형식이 올바르지 않습니다.');
    return { correct: q.correct, choices: q.choices, explanation: q.explanation };
  });
}
/** Public lesson payload has a strict schema; answer keys have a separate column. */
export function publicPack(value: unknown, questions: Row[], lessonId: string | null): Row {
  if (!object(value) || value.schema !== 'science-lesson/v1') throw new HttpError('수업 묶음 버전을 확인해 주세요.');
  const only = (row: Row, keys: string[]) => {
    if (Object.keys(row).some(key => !keys.includes(key))) throw new HttpError('수업 내용에 지원하지 않는 항목이 있습니다. 정답·해설은 별도 quiz_data에 넣어 주세요.');
  };
  if (value.builtin_id != null) {
    only(value, ['schema', 'builtin_id', 'title']);
    if (!BUILTIN.test(value.builtin_id) || value.builtin_id !== lessonId) throw new HttpError('기본 수업 식별자가 일치하지 않습니다.');
    return { schema: value.schema, builtin_id: value.builtin_id };
  }
  only(value, ['schema', 'title', 'steps', 'quiz']);
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 4 || !Array.isArray(value.quiz ?? [])) throw new HttpError('수업 단계는 1~4개로 작성해 주세요.');
  const steps = value.steps.map((step: unknown) => {
    if (!object(step)) throw new HttpError('수업 단계 형식을 확인해 주세요.');
    only(step, ['title', 'html']);
    if (typeof step.html !== 'string' || step.html.length > 400000) throw new HttpError('수업 단계 내용이 너무 큽니다.');
    return { title: stringValue(step.title, '단계 제목', 200), html: step.html };
  });
  const quiz = (value.quiz ?? []).map((q: unknown, index: number) => {
    if (!object(q)) throw new HttpError('공개 퀴즈 형식을 확인해 주세요.');
    only(q, ['question', 'choices']);
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6 || q.choices.length !== questions[index]?.choices) throw new HttpError('공개 선택지와 비공개 정답의 문항 수가 일치해야 합니다.');
    return { question: stringValue(q.question, '문항', 10000), choices: q.choices.map((choice: unknown) => stringValue(choice, '선택지', 4000)) };
  });
  if (quiz.length !== questions.length) throw new HttpError('공개 문항과 비공개 정답의 문항 수가 일치해야 합니다.');
  return { schema: value.schema, ...(typeof value.title === 'string' ? { title: value.title.slice(0, 300) } : {}), steps, quiz };
}
export function grade(questions: Row[], answers: unknown): Row {
  if (!questions.length || !Array.isArray(answers) || answers.length !== questions.length) throw new HttpError('모든 문항의 선택 번호를 제출해 주세요.');
  const feedback = questions.map((q, i) => {
    if (!Number.isInteger(answers[i]) || answers[i] < 1 || answers[i] > q.choices) throw new HttpError('선택 번호가 올바르지 않습니다.');
    return { question: i + 1, selected: answers[i], correct: answers[i] === q.correct, correctChoice: q.correct, explanation: q.explanation };
  });
  return { score: feedback.filter(q => q.correct).length, total: questions.length, feedback };
}
export function decodePdf(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_FILE / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new HttpError('PDF 파일은 10MB 이내로 올려 주세요.', 413);
  let raw: string;
  try { raw = atob(value); } catch { throw new HttpError('PDF 파일 인코딩이 올바르지 않습니다.'); }
  if (raw.length > MAX_FILE || !raw.startsWith('%PDF-')) throw new HttpError('올바른 PDF 파일만 올릴 수 있습니다.');
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}
function encode(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(raw);
}
export class RestStore {
  url: string; private key: string; private transport: typeof fetch;
  constructor(url: string, key: string, transport: typeof fetch = fetch) { this.url = url; this.key = key; this.transport = transport; }
  async request(path: string, query: Row = {}, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    const target = new URL(`/rest/v1/${path}`, this.url);
    Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, String(value)));
    const response = await this.transport(target, { method, headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (data?.message === 'CONTENT_VERSION_CONFLICT') throw new HttpError('다른 작업에서 수정되었습니다. 목록을 새로고침해 주세요.', 409, 'VERSION_CONFLICT');
      if (data?.message === 'QUIZ_RETRY_CONFLICT') throw new HttpError('같은 요청 번호로 다른 답안을 보낼 수 없습니다.', 409);
      throw new HttpError('자료 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503, 'BACKEND_UNAVAILABLE');
    }
    return data;
  }
  async one(table: string, query: Row): Promise<Row | null> { return (await this.request(table, { ...query, limit: 1 }))?.[0] ?? null; }
  async storage(path: string, bytes?: Uint8Array): Promise<Uint8Array | void> {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(path)) throw new HttpError('자료 경로가 올바르지 않습니다.', 500);
    const response = await this.transport(`${this.url}/storage/v1/object/${bytes ? '' : 'authenticated/'}${BUCKET}/${path}`, { method: bytes ? 'POST' : 'GET', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, ...(bytes ? { 'Content-Type': 'application/pdf', 'x-upsert': 'false' } : {}) }, ...(bytes ? { body: bytes } : {}) });
    if (!response.ok) throw new HttpError('파일 저장소를 사용할 수 없습니다.', 503, 'STORAGE_UNAVAILABLE');
    if (!bytes) {
      const size = Number(response.headers.get('content-length'));
      if (size > MAX_FILE) throw new HttpError('파일 크기 제한을 초과했습니다.', 413);
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length > MAX_FILE) throw new HttpError('파일 크기 제한을 초과했습니다.', 413);
      return data;
    }
  }
  async remove(path: string): Promise<void> {
    await this.transport(`${this.url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) }).catch(() => null);
  }
}
export async function authenticate(body: Row, db: RestStore, now: number): Promise<Context> {
  const raw = body.adminSessionToken || body.studentSessionToken;
  if (!raw) return { role: 'anonymous' };
  if (typeof raw !== 'string' || !/^(stu_|adm_)[0-9a-f]{96}$/.test(raw)) throw new HttpError('로그인 세션을 다시 확인해 주세요.', 401, 'SESSION_EXPIRED');
  const prefix = raw.startsWith('adm_') ? 'adm_' : 'stu_';
  const tokenHash = await hash(raw);
  const session = await db.one('app_sessions', { select: '*', token_hash: `eq.${tokenHash}` });
  if (!validSession(session, prefix, now)) throw new HttpError('로그인 세션이 만료되었습니다.', 401, 'SESSION_EXPIRED');
  // The existing platform issues admin sessions with account_id=null when the
  // admin credential exists in app_settings rather than an app_users row.
  // Validate that server-side credential still exists; never return its hash.
  if (prefix === 'adm_' && !session!.account_id) {
    const setting = await db.one('app_settings', { select: 'setting_value', setting_key: 'eq.admin_password_hash' });
    if (!/^[0-9a-f]{64}$/i.test(String(setting?.setting_value?.hash ?? ''))) throw new HttpError('교사 관리자 인증 설정을 확인해 주세요.', 403);
    return { role: 'admin', user: { login_id: 'admin' }, session: session!, tokenHash };
  }
  const user = await db.one('app_users', session!.account_id ? { select: '*', id: `eq.${session!.account_id}` } : { select: '*', login_id: 'eq.admin' });
  if (prefix === 'adm_') {
    if (!user || String(user.login_id).toLowerCase() !== 'admin') throw new HttpError('교사 관리자 권한이 필요합니다.', 403);
    // The verified test DB keeps its legacy admin roster row as 등록대기.
    // Admin authentication lives in app_settings; student enrollment status does not activate it.
    if (!accountEnabled(user)) {
      const legacy = user.status === '등록대기' && !user.deleted_at && !user.disabled_at && user.is_active !== false && user.active !== false;
      const setting = legacy ? await db.one('app_settings', { select: 'setting_value', setting_key: 'eq.admin_password_hash' }) : null;
      if (!legacy || !/^[0-9a-f]{64}$/i.test(String(setting?.setting_value?.hash ?? ''))) throw new HttpError('사용 가능한 교사 관리자 계정이 필요합니다.', 403, 'ACCOUNT_DISABLED');
    }
    return { role: 'admin', user: user!, session: session!, tokenHash };
  }
  if (!accountEnabled(user)) throw new HttpError('사용 가능한 승인 계정이 필요합니다.', 403, 'ACCOUNT_DISABLED');
  if (!['student', 'external', 'manager'].includes(String(user!.account_type ?? 'student').toLowerCase()) || String(user!.login_id).toLowerCase() === 'admin' || String(user!.id) !== String(session!.account_id)) throw new HttpError('학생 계정으로 로그인해 주세요.', 403);
  return { role: 'student', user: user!, session: session!, tokenHash };
}
async function readBody(req: Request): Promise<Row> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw new HttpError('요청 용량이 너무 큽니다.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError('요청 내용이 없습니다.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new HttpError('요청 용량이 너무 큽니다.', 413); }
    chunks.push(part.value);
  }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all)); } catch { throw new HttpError('JSON 요청 형식이 올바르지 않습니다.'); }
  if (!object(body)) throw new HttpError('요청 내용이 올바르지 않습니다.');
  return body;
}
export function createHandler(deps: { env?: (key: string) => string | undefined; fetch?: typeof fetch; now?: () => number; store?: RestStore } = {}) {
  const env = deps.env ?? ((key: string) => Deno.env.get(key));
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowed = new Set(['https://chemtea.github.io', ...(env('CONTENT_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)]);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', 'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : 'https://chemtea.github.io', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed.has(origin)) return json({ success: false, message: '허용되지 않은 사이트입니다.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ success: false, message: 'POST 요청을 사용해 주세요.' }, 405);
    try {
      const body = await readBody(req);
      const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
      if (url !== `https://${PROJECT}.supabase.co` || !key) throw new HttpError('지정한 테스트 서버의 환경 설정이 필요합니다.', 503, 'TEST_SERVER_NOT_CONFIGURED');
      const db = deps.store ?? new RestStore(url, key, deps.fetch);
      if (body.action === 'health') {
        await db.request('content_items', { select: 'id', limit: 1 });
        return json({ success: true, service: 'science-platform-test-content', project: PROJECT, version: 1, databaseReady: true, quizPointsEnabled: true });
      }
      if (!['catalog', 'get_content', 'save_content', 'set_publication', 'delete_content', 'submit_quiz'].includes(body.action)) throw new HttpError('지원하지 않는 요청입니다.');
      const context = await authenticate(body, db, (deps.now ?? Date.now)());
      const locksRow = await db.one('app_settings', { select: 'setting_value', setting_key: 'eq.lock_states' });
      const locks = locksRow?.setting_value;
      if (body.action === 'catalog') {
        const rows = await db.request('content_items', { select: metadataColumns, archived_at: 'is.null', order: 'unit_id.asc,lesson_id.asc,created_at.asc', limit: 1000, ...(context.role === 'admin' ? {} : { published: 'eq.true', student_access: 'eq.true', kind: context.role === 'anonymous' ? 'in.(lesson,worksheet)' : 'neq.answer' }) });
        return json({ success: true, role: context.role, items: rows.filter((item: Row) => context.role === 'anonymous' || canRead(item, context.role, locks)).map(metadata) });
      }
      const mutation = ['save_content', 'set_publication', 'delete_content'].includes(body.action);
      if (mutation && context.role !== 'admin') throw new HttpError('교사 관리자만 자료를 변경할 수 있습니다.', 403, 'PERMISSION_DENIED');
      if (!mutation && context.role === 'anonymous') throw new HttpError('자료를 열려면 로그인해 주세요.', 401, 'SESSION_EXPIRED');
      const id = body.action === 'save_content' && body.id == null ? crypto.randomUUID() : body.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError('자료 번호가 올바르지 않습니다.');
      const existing = await db.one('content_items', { select: '*', id: `eq.${id}` });
      if (body.action !== 'save_content' && !existing) throw new HttpError('자료를 찾을 수 없습니다.', 404);
      if (body.action === 'get_content') {
        if (!canRead(existing!, context.role, locks)) throw new HttpError('공개되지 않았거나 접근할 수 없는 자료입니다.', 403, 'CONTENT_LOCKED');
        if (existing!.format === 'pdf') return json({ success: true, item: metadata(existing!), file_base64: encode(await db.storage(existing!.storage_path) as Uint8Array), mime: 'application/pdf' });
        return json({ success: true, item: metadata(existing!), content: existing!.content, mime: existing!.format === 'html' ? 'text/html' : 'application/json' });
      }
      if (body.action === 'submit_quiz') {
        if (context.role !== 'student' || context.user?.account_type === 'manager' || existing!.kind !== 'lesson' || !canRead(existing!, context.role, locks)) throw new HttpError('학생에게 공개된 수업에서만 제출할 수 있습니다.', 403);
        const step4 = object(locks) ? locks.step_locks?.[existing!.lesson_id]?.['4'] : undefined;
        if (step4 === true || (BUILTIN.test(String(existing!.lesson_id)) && step4 !== false)) throw new HttpError('형성평가가 잠겨 있습니다.', 403);
        const questions = quizData(existing!.quiz_data);
        const graded = grade(questions, body.answers);
        const requestId = body.requestId ?? crypto.randomUUID();
        if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new HttpError('제출 요청 번호가 올바르지 않습니다.');
        const result = await db.request('rpc/content_record_quiz', {}, { p_content_id: id, p_account_id: context.user!.id, p_request_id: requestId, p_answers: body.answers, p_result: graded, p_content_version: existing!.version });
        return json({ success: true, ...result });
      }
      if (existing && body.expected_version !== existing.version) throw new HttpError('자료 목록을 새로고침한 뒤 다시 저장해 주세요.', 409, 'VERSION_CONFLICT');
      let item: Row; let newPath: string | null = null;
      if (body.action === 'save_content') {
        const kind = body.kind, format = body.format;
        if (!['lesson', 'worksheet', 'assessment', 'answer'].includes(kind) || !['lesson-pack', 'html', 'pdf'].includes(format)) throw new HttpError('자료 종류를 확인해 주세요.');
        if (format === 'lesson-pack' && kind !== 'lesson') throw new HttpError('수업 묶음 형식은 일반 수업에만 사용할 수 있습니다.');
        const unit = stringValue(body.unit_id, '단원', 100);
        const lesson = body.lesson_id == null || body.lesson_id === '' ? null : stringValue(body.lesson_id, '차시', 100);
        if (!IDENTIFIER.test(unit) || RESERVED_IDS.has(unit) || (lesson && (!IDENTIFIER.test(lesson) || RESERVED_IDS.has(lesson))) || (kind === 'assessment' && (!lesson || !/_eval$/.test(unit)))) throw new HttpError('단원 또는 차시 식별자를 확인해 주세요.');
        const quiz = quizData(body.quiz_data ?? existing?.quiz_data);
        if (quiz.length && kind !== 'lesson') throw new HttpError('일반 수업 이외에는 퀴즈 정답을 연결할 수 없습니다.');
        const protectedItem = kind === 'assessment' || kind === 'answer';
        item = { id, kind, format, title: stringValue(body.title, '제목'), description: String(body.description ?? '').slice(0, 2000), unit_id: unit, unit_title: String(body.unit_title ?? unit).slice(0, 200), lesson_id: lesson, published: body.published === true, student_access: kind === 'answer' ? false : body.student_access === true, quiz_data: quiz, has_quiz: quiz.length > 0, content: null, storage_path: null, archived_at: null };
        if (protectedItem && body.student_access == null) item.student_access = false;
        if (format === 'pdf') {
          if (body.mime != null && body.mime !== 'application/pdf') throw new HttpError('PDF 형식만 지원합니다.');
          if (body.file_base64 == null && existing?.format === 'pdf' && existing.storage_path) item.storage_path = existing.storage_path;
          else {
            const bytes = decodePdf(body.file_base64);
            newPath = `${id}/${crypto.randomUUID()}.pdf`;
            await db.storage(newPath, bytes); item.storage_path = newPath;
          }
        } else {
          if (format === 'html' ? typeof body.content !== 'string' : !object(body.content)) throw new HttpError('수업 내용 형식을 확인해 주세요.');
          if (new TextEncoder().encode(JSON.stringify(body.content)).byteLength > MAX_TEXT) throw new HttpError('수업 내용은 2MB 이내로 올려 주세요.', 413);
          item.content = format === 'lesson-pack' ? publicPack(body.content, quiz, lesson) : body.content;
        }
      } else {
        item = { ...existing };
        if (body.action === 'delete_content') { item.archived_at = new Date((deps.now ?? Date.now)()).toISOString(); item.published = false; item.student_access = false; }
        else {
          if (typeof body.published !== 'boolean' || typeof body.student_access !== 'boolean') throw new HttpError('공개 상태를 확인해 주세요.');
          if (item.kind === 'answer' && body.student_access) throw new HttpError('모범답안은 학생에게 공개할 수 없습니다.', 403);
          item.published = body.published; item.student_access = body.student_access;
        }
      }
      let saved: Row;
      try { saved = await db.request('rpc/content_save_atomic', {}, { p_item: item, p_actor: String(context.user!.login_id), p_expected_version: existing?.version ?? 0 }); }
      catch (error) { if (newPath) await db.remove(newPath); throw error; }
      if (existing?.storage_path && existing.storage_path !== saved.storage_path) await db.remove(existing.storage_path);
      return json({ success: true, item: metadata(saved) });
    } catch (error) {
      const e = error instanceof HttpError ? error : new HttpError('요청을 처리하지 못했습니다.', 500, 'INTERNAL_ERROR');
      return json({ success: false, message: e.message, code: e.code, sessionExpired: e.code === 'SESSION_EXPIRED', permissionDenied: e.status === 403 }, e.status);
    }
  };
}
if (typeof Deno !== 'undefined') Deno.serve(createHandler());
