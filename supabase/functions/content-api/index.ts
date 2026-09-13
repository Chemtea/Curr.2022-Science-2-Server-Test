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
const MAX_TEXT = MAX_FILE;
const MAX_BODY = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const BUILTIN = /^(u3_l[1235678]|u7_l[1-8])$/;
const metadataColumns = 'id,kind,title,description,unit_id,unit_title,lesson_id,format,published,student_access,version,updated_at,created_at,archived_at,has_quiz';
const appearanceColumns = 'unit_id,icon,color_start,color_end,mode,angle,version';
export const UNIT_APPEARANCE_ICONS = Object.freeze(['car', 'element', 'flask', 'galaxy', 'sun', 'earth', 'lightning', 'light', 'star', 'space', 'compound', 'matter', 'flower', 'animal', 'cell', 'leaf', 'tree', 'computer', 'book', 'magnet', 'wave']);
type BackendDiagnostic = { operation: string; kind: 'http' | 'network' | 'timeout' | 'invalid_response'; httpStatus: number; backendCode: string | null; retried: boolean };
export class HttpError extends Error {
  status: number; code: string; diagnostic?: BackendDiagnostic;
  constructor(message: string, status = 400, code = 'INVALID_REQUEST', diagnostic?: BackendDiagnostic) { super(message); this.status = status; this.code = code; this.diagnostic = diagnostic; }
}
export const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
export function regularUnitId(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value) && !RESERVED_IDS.has(value) && !/_eval$/i.test(value) && !/^eval/i.test(value);
}
/** Appearance is structured data, never administrator-supplied CSS or SVG. */
export function unitAppearance(value: unknown): Row {
  if (!object(value) || Object.keys(value).length !== 5 || Object.keys(value).some(key => !['icon', 'color_start', 'color_end', 'mode', 'angle'].includes(key))) throw new HttpError('배너 표시 항목을 확인해 주세요.');
  if (typeof value.icon !== 'string' || !UNIT_APPEARANCE_ICONS.includes(value.icon)) throw new HttpError('목록에서 배너 문양을 선택해 주세요.');
  for (const key of ['color_start', 'color_end']) if (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key])) throw new HttpError('색상은 #RRGGBB 형식으로 지정해 주세요.');
  if (!['solid', 'gradient'].includes(value.mode) || !Number.isInteger(value.angle) || value.angle < 0 || value.angle > 359) throw new HttpError('배너 색상 방식과 방향을 확인해 주세요.');
  return { icon: value.icon, color_start: value.color_start.toUpperCase(), color_end: value.color_end.toUpperCase(), mode: value.mode, angle: value.angle };
}
function appearanceMetadata(row: unknown): Row {
  if (!object(row) || !regularUnitId(row.unit_id) || !Number.isInteger(row.version) || row.version < 1) throw new HttpError('배너 설정의 서버 응답을 확인할 수 없습니다.', 503, 'BACKEND_UNAVAILABLE');
  const appearance = unitAppearance(Object.fromEntries(['icon', 'color_start', 'color_end', 'mode', 'angle'].map(key => [key, row[key]])));
  return { unit_id: row.unit_id, ...appearance, version: row.version };
}
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
  if (!object(locks)) return false;
  // Worksheet publication has a separate lock tree. A lesson can stay locked
  // while its worksheet is available in the library and worksheet-only panel.
  if (item.kind === 'worksheet') return worksheetOpen(item, locks);
  // A new uploaded lesson uses its publication controls. Existing explicit locks still win.
  const unit = locks[item.unit_id];
  const builtin = BUILTIN.test(String(item.lesson_id));
  if (builtin && (unit?.isLocked !== false || unit?.lessons?.[item.lesson_id] !== false)) return false;
  if (unit?.isLocked === true || unit?.lessons?.[item.lesson_id] === true) return false;
  return true;
}
export function worksheetOpen(item: Row, locks: unknown): boolean {
  if (!object(locks) || !item.lesson_id) return false;
  const ws = locks.worksheetCurriculum;
  const number = String(item.unit_id).replace(/^unit/, '');
  // Fail closed even for new uploads until the worksheet lock entry exists.
  return ws?.isLocked === false && ws?.units?.[number]?.isLocked === false &&
    ws?.units?.[number]?.items?.[`ws_${item.lesson_id}`] === false;
}
/** Catalog visibility is deliberately distinct from permission to fetch source. */
export function catalogVisible(item: Row, role: Role, locks: unknown): boolean {
  if (item.archived_at) return false;
  if (role === 'admin') return true;
  if (item.published !== true || item.student_access !== true || item.kind === 'answer') return false;
  if (item.kind === 'lesson' || item.kind === 'worksheet') return true;
  return role === 'student' && item.kind === 'assessment' && assessmentOpen(item, locks);
}
export function canReadWorksheetLesson(lesson: Row, worksheet: Row | null, role: Role, locks: unknown): boolean {
  if (role === 'admin') return canRead(lesson, role, locks);
  return role === 'student' && !lesson.archived_at && lesson.kind === 'lesson' && lesson.format === 'html' &&
    lesson.published === true && lesson.student_access === true && !!worksheet && worksheet.kind === 'worksheet' &&
    worksheet.format === 'pdf' && worksheet.unit_id === lesson.unit_id && worksheet.lesson_id === lesson.lesson_id &&
    canRead(worksheet, role, locks);
}
export function validateLessonIdentity(unit: string, lesson: string | null): void {
  const number = /^unit([1-9][0-9]{0,2})$/.exec(unit)?.[1];
  if (!number || !lesson || !new RegExp(`^u${number}_l[1-9][0-9]{0,2}$`).test(lesson))
    throw new HttpError('단원 번호와 차시 번호를 확인해 주세요. 예: unit8 / u8_l1', 400, 'CONTENT_IDENTITY_INVALID');
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
  private requestBudgetMs: number; private log: (diagnostic: BackendDiagnostic) => void;
  constructor(url: string, key: string, transport: typeof fetch = fetch, options: { requestBudgetMs?: number; log?: (diagnostic: BackendDiagnostic) => void } = {}) {
    this.url = url; this.key = key; this.transport = transport;
    this.requestBudgetMs = Math.max(10, Math.min(20000, Math.floor(options.requestBudgetMs ?? 20000)));
    this.log = options.log ?? (diagnostic => console.warn('[content-api.backend]', JSON.stringify(diagnostic)));
  }
  async request(path: string, query: Row = {}, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    const target = new URL(`/rest/v1/${path}`, this.url);
    Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, String(value)));
    // Retrying a read cannot repeat a submission, credit, publication or save.
    // Never retry RPCs or requests with a body, including a caller-supplied GET.
    const readOnly = method === 'GET' && body === undefined && !path.startsWith('rpc/');
    const operations: Record<string, string> = { app_settings: 'settings_read', app_sessions: 'sessions_read', app_users: 'accounts_read', content_items: 'content_read', content_versions: 'versions_read', unit_appearances: 'unit_appearances_read', 'rpc/unit_appearance_save_atomic': 'unit_appearance_save_rpc', 'rpc/content_save_atomic': 'content_save_rpc', 'rpc/content_restore_version': 'content_restore_rpc' };
    const operation = operations[path] ?? (readOnly ? 'rest_read' : 'rest_write');
    const deadline = Date.now() + this.requestBudgetMs;
    let response: Response | undefined, data: any, diagnostic: BackendDiagnostic | undefined;
    for (let attempt = 0; attempt < (readOnly ? 2 : 1); attempt++) {
      const remaining = Math.max(1, deadline - Date.now());
      const budget = readOnly && attempt === 0 ? Math.max(1, Math.floor(remaining / 2)) : remaining;
      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout>;
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('REST_DEADLINE')); }, budget); });
        const call = (async () => {
          const res = await this.transport(target, { method, signal: controller.signal, headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          let parsed: any; let validJson = true;
          try { parsed = await res.json(); } catch { validJson = false; parsed = null; }
          return { response: res, data: parsed, validJson };
        })();
        const outcome = await Promise.race([call, timeout]);
        response = outcome.response; data = outcome.data;
        const backendCode = typeof data?.code === 'string' && /^(?:PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(data.code) ? data.code : null;
        if (!response.ok || !outcome.validJson) {
          diagnostic = { operation, kind: response.ok ? 'invalid_response' : 'http', httpStatus: response.status, backendCode, retried: attempt > 0 };
          this.log(diagnostic);
          if (readOnly && attempt === 0 && [502, 503, 504].includes(response.status) && Date.now() < deadline) continue;
          if (response.ok) throw new HttpError('자료 서버의 응답을 확인할 수 없습니다. 다시 시도해 주세요.', 503, 'BACKEND_UNAVAILABLE', diagnostic);
        }
        break;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        // Never expose fetch exceptions, target URLs, response text, SQL detail,
        // account IDs, session hashes, headers, keys or submitted content.
        diagnostic = { operation, kind: timedOut ? 'timeout' : 'network', httpStatus: 0, backendCode: null, retried: attempt > 0 };
        this.log(diagnostic);
        if (readOnly && attempt === 0 && Date.now() < deadline) continue;
        throw new HttpError('자료 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503, 'BACKEND_UNAVAILABLE', diagnostic);
      } finally { clearTimeout(timer!); }
    }
    if (!response) throw new HttpError('자료 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503, 'BACKEND_UNAVAILABLE', diagnostic);
    if (!response.ok) {
      if (data?.message === 'CONTENT_VERSION_CONFLICT') throw new HttpError('다른 작업에서 수정되었습니다. 목록을 새로고침해 주세요.', 409, 'VERSION_CONFLICT');
      if (data?.message === 'CONTENT_IDENTITY_CONFLICT' || (data?.code === '23505' && String(data?.message).includes('content_active_lesson_identity'))) throw new HttpError('이 단원과 차시에 수업이 이미 있습니다. 기존 자료를 수정하거나 다른 차시 번호를 선택해 주세요.', 409, 'CONTENT_IDENTITY_CONFLICT');
      if (data?.message === 'CONTENT_IDENTITY_INVALID') throw new HttpError('단원 번호와 차시 번호가 일치해야 합니다.', 400, 'CONTENT_IDENTITY_INVALID');
      if (data?.message === 'UNIT_TITLE_CONFLICT') throw new HttpError('단원 이름이 다른 작업에서 변경되었습니다. 목록을 새로고침해 주세요.', 409, 'VERSION_CONFLICT');
      if (data?.message === 'UNIT_NOT_FOUND') throw new HttpError('등록된 단원을 선택해 주세요.', 404, 'UNIT_NOT_FOUND');
      if (data?.message === 'UNIT_APPEARANCE_VERSION_CONFLICT') throw new HttpError('다른 작업에서 배너가 수정되었습니다. 목록을 새로고침해 주세요.', 409, 'VERSION_CONFLICT');
      if (data?.message === 'UNIT_APPEARANCE_UNIT_NOT_FOUND') throw new HttpError('수업이 등록된 일반 단원을 선택해 주세요.', 404, 'UNIT_NOT_FOUND');
      if (data?.message === 'UNIT_APPEARANCE_INVALID') throw new HttpError('배너 표시 설정을 확인해 주세요.');
      if (data?.message === 'CONTENT_ARCHIVED') throw new HttpError('보관함에서 자료를 먼저 복원해 주세요.', 409, 'CONTENT_ARCHIVED');
      if (['CONTENT_VERSION_NOT_FOUND', 'CONTENT_NOT_FOUND'].includes(data?.message)) throw new HttpError('해당 자료 또는 내용 버전을 찾을 수 없습니다.', 404, 'VERSION_NOT_FOUND');
      if (data?.message === 'CONTENT_VERSION_INVALID') throw new HttpError('버전 번호를 확인해 주세요.');
      throw new HttpError('자료 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503, 'BACKEND_UNAVAILABLE', diagnostic);
    }
    return data;
  }
  async one(table: string, query: Row): Promise<Row | null> { return (await this.request(table, { ...query, limit: 1 }))?.[0] ?? null; }
  async storage(path: string, bytes?: Uint8Array): Promise<Uint8Array | void> {
    const uploadPath = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(path);
    const restoredPath = !bytes && /^production-reset-54d790f4\/[0-9a-f]{64}\.pdf$/.test(path);
    if (!uploadPath && !restoredPath) throw new HttpError('자료 경로가 올바르지 않습니다.', 500);
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
        return json({ success: true, service: 'science-platform-test-content', project: PROJECT, version: 11, mode: 'legacy-html-catalog', backendDiagnosticsVersion: 1, databaseReady: true, htmlUploadEnabled: true, privateWorksheetsEnabled: true, archiveRestoreEnabled: true, contentVersionsEnabled: true, unitAppearanceEnabled: true, maxFileBytes: MAX_FILE });
      }
      if (!['catalog', 'rename_unit', 'set_unit_appearance', 'list_archived', 'get_content', 'get_editable', 'list_versions', 'get_version', 'restore_version', 'save_content', 'set_publication', 'delete_content', 'restore_content'].includes(body.action)) throw new HttpError('지원하지 않는 요청입니다.');
      const context = await authenticate(body, db, (deps.now ?? Date.now)());
      const mutation = ['rename_unit', 'set_unit_appearance', 'save_content', 'set_publication', 'delete_content', 'restore_content', 'restore_version'].includes(body.action);
      const editorAction = ['get_editable', 'list_versions', 'get_version', 'restore_version'].includes(body.action);
      if ((mutation || editorAction || body.action === 'list_archived') && context.role !== 'admin') throw new HttpError('교사 관리자만 자료를 관리할 수 있습니다.', 403, 'PERMISSION_DENIED');
      if (body.action === 'rename_unit') {
        if (!/^unit[1-9][0-9]{0,2}$/.test(body.unit_id)) throw new HttpError('일반 수업 단원을 선택해 주세요.');
        const title = stringValue(body.unit_title, '단원 이름', 200);
        const expectedTitle = stringValue(body.expected_title, '기존 단원 이름', 200);
        const renamed = await db.request('rpc/content_rename_unit', {}, { p_unit_id: body.unit_id, p_unit_title: title, p_expected_title: expectedTitle, p_actor: String(context.user!.login_id) });
        return json({ success: true, ...renamed });
      }
      if (body.action === 'set_unit_appearance') {
        if (!regularUnitId(body.unit_id)) throw new HttpError('일반 수업 단원을 선택해 주세요.');
        const appearance = unitAppearance(body.appearance);
        if (!Number.isInteger(body.expected_version) || body.expected_version < 0 || body.expected_version > 2147483646) throw new HttpError('배너 버전 번호를 확인해 주세요.');
        if (!['unit3', 'unit7'].includes(body.unit_id)) {
          const lesson = await db.one('content_items', { select: 'id', unit_id: `eq.${body.unit_id}`, kind: 'eq.lesson', archived_at: 'is.null' });
          if (!lesson) throw new HttpError('수업이 등록된 일반 단원을 선택해 주세요.', 404, 'UNIT_NOT_FOUND');
        }
        const saved = await db.request('rpc/unit_appearance_save_atomic', {}, { p_unit_id: body.unit_id, p_appearance: appearance, p_expected_version: body.expected_version, p_actor: String(context.user!.login_id) });
        return json({ success: true, appearance: appearanceMetadata(saved) });
      }
      if (body.action === 'list_archived') {
        const rows = await db.request('content_items', { select: metadataColumns, archived_at: 'not.is.null', order: 'archived_at.desc,id.asc', limit: 1000 });
        return json({ success: true, role: 'admin', items: rows.filter((item: Row) => !!item.archived_at).map(metadata) });
      }
      const locksRow = mutation || editorAction ? null : await db.one('app_settings', { select: 'setting_value', setting_key: 'eq.lock_states' });
      const locks = locksRow?.setting_value;
      if (body.action === 'catalog') {
        const rows = await db.request('content_items', { select: metadataColumns, archived_at: 'is.null', order: 'unit_id.asc,lesson_id.asc,created_at.asc', limit: 1000, ...(context.role === 'admin' ? {} : { published: 'eq.true', student_access: 'eq.true', kind: context.role === 'anonymous' ? 'in.(lesson,worksheet)' : 'neq.answer' }) });
        const items = rows.filter((item: Row) => catalogVisible(item, context.role, locks)).map(metadata);
        const visibleUnits = new Set(items.filter((item: Row) => item.kind === 'lesson' && regularUnitId(item.unit_id)).map((item: Row) => item.unit_id));
        // Do not silently substitute defaults when schema, grants or the network
        // fail. Existing RestStore diagnostics identify a real read failure.
        const appearances = await db.request('unit_appearances', { select: appearanceColumns, order: 'unit_id.asc', limit: 1000 });
        if (!Array.isArray(appearances)) throw new HttpError('배너 설정의 서버 응답을 확인할 수 없습니다.', 503, 'BACKEND_UNAVAILABLE');
        return json({ success: true, role: context.role, items, unit_appearances: appearances.filter((appearance: Row) => visibleUnits.has(appearance.unit_id)).map(appearanceMetadata) });
      }
      if (!mutation && context.role === 'anonymous') throw new HttpError('자료를 열려면 로그인해 주세요.', 401, 'SESSION_EXPIRED');
      const id = body.action === 'save_content' && body.id == null ? crypto.randomUUID() : body.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError('자료 번호가 올바르지 않습니다.');
      const existing = await db.one('content_items', { select: '*', id: `eq.${id}` });
      if (body.action !== 'save_content' && !existing) throw new HttpError('자료를 찾을 수 없습니다.', 404);
      if (editorAction) {
        if (existing!.archived_at) throw new HttpError('보관함에서 자료를 먼저 복원해 주세요.', 409, 'CONTENT_ARCHIVED');
        if (body.action === 'get_editable') return json({ success: true, item: metadata(existing!), content: existing!.content, quiz_data: existing!.quiz_data });
        if (body.action === 'list_versions') {
          const versions = await db.request('content_versions', { select: 'version,created_at,snapshot', content_id: `eq.${id}`, order: 'version.desc', limit: 1000 });
          return json({ success: true, versions: versions.map((version: Row) => ({ version: version.version, created_at: version.created_at, title: version.snapshot?.title, kind: version.snapshot?.kind, format: version.snapshot?.format })) });
        }
        if (body.action === 'get_version') {
          if (!Number.isInteger(body.version) || body.version < 1) throw new HttpError('버전 번호를 확인해 주세요.');
          const version = await db.one('content_versions', { select: 'snapshot', content_id: `eq.${id}`, version: `eq.${body.version}` });
          if (!version) throw new HttpError('해당 내용 버전을 찾을 수 없습니다.', 404, 'VERSION_NOT_FOUND');
          return json({ success: true, item: metadata(existing!), snapshot: version.snapshot });
        }
        if (body.action === 'restore_version') {
          if (!Number.isInteger(body.expected_version) || body.expected_version < 1 || !Number.isInteger(body.target_version) || body.target_version < 1) throw new HttpError('버전 번호를 확인해 주세요.');
          if (body.expected_version !== existing!.version) throw new HttpError('자료 목록을 새로고침해 주세요.', 409, 'VERSION_CONFLICT');
          const restored = await db.request('rpc/content_restore_version', {}, { p_content_id: id, p_expected_version: body.expected_version, p_target_version: body.target_version, p_actor: String(context.user!.login_id) });
          return json({ success: true, item: metadata(restored) });
        }
      }
      if (body.action === 'get_content') {
        let readable = canRead(existing!, context.role, locks);
        if (body.worksheet_mode === true) {
          if (typeof body.worksheet_id !== 'string' || !UUID.test(body.worksheet_id)) throw new HttpError('연결된 학습지를 선택해 주세요.', 400, 'WORKSHEET_REQUIRED');
          const worksheet = await db.one('content_items', { select: '*', id: `eq.${body.worksheet_id}` });
          readable = canReadWorksheetLesson(existing!, worksheet, context.role, locks);
        }
        if (!readable) throw new HttpError('공개되지 않았거나 접근할 수 없는 자료입니다.', 403, 'CONTENT_LOCKED');
        if (existing!.format === 'pdf') return json({ success: true, item: metadata(existing!), file_base64: encode(await db.storage(existing!.storage_path) as Uint8Array), mime: 'application/pdf' });
        return json({ success: true, item: metadata(existing!), content: existing!.content, mime: existing!.format === 'html' ? 'text/html' : 'application/json' });
      }
      if (existing && body.expected_version !== existing.version) throw new HttpError('자료 목록을 새로고침한 뒤 다시 저장해 주세요.', 409, 'VERSION_CONFLICT');
      if (existing?.archived_at && body.action !== 'restore_content') throw new HttpError('보관함에서 자료를 먼저 복원해 주세요.', 409, 'CONTENT_ARCHIVED');
      if (body.action === 'restore_content' && !existing!.archived_at) throw new HttpError('이미 복원되었거나 보관 중인 자료가 아닙니다. 목록을 새로고침해 주세요.', 409, 'VERSION_CONFLICT');
      let item: Row; let newPath: string | null = null;
      if (body.action === 'save_content') {
        const kind = body.kind, format = body.format;
        if (!['lesson', 'worksheet', 'assessment', 'answer'].includes(kind) || !['html', 'pdf'].includes(format)) throw new HttpError('수업은 HTML, 학습지는 PDF 파일로 올려 주세요.');
        if ((kind === 'lesson' && format !== 'html') || (kind === 'worksheet' && format !== 'pdf')) throw new HttpError('수업은 HTML, 학습지는 PDF 파일로 올려 주세요.');
        const unit = stringValue(body.unit_id, '단원', 100);
        const lesson = body.lesson_id == null || body.lesson_id === '' ? null : stringValue(body.lesson_id, '차시', 100);
        if (!IDENTIFIER.test(unit) || RESERVED_IDS.has(unit) || (lesson && (!IDENTIFIER.test(lesson) || RESERVED_IDS.has(lesson))) || (kind === 'assessment' && (!lesson || !/_eval$/.test(unit)))) throw new HttpError('단원 또는 차시 식별자를 확인해 주세요.');
        if (kind === 'lesson' || kind === 'worksheet') validateLessonIdentity(unit, lesson);
        const quiz: Row[] = [];
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
          if (typeof body.content !== 'string' || !body.content.trim() || body.content.includes('\0')) throw new HttpError('수업 HTML 파일을 확인해 주세요.');
          if (new TextEncoder().encode(body.content).byteLength > MAX_TEXT) throw new HttpError('수업 HTML은 10MB 이내로 올려 주세요.', 413);
          item.content = body.content;
        }
      } else {
        item = { ...existing };
        if (body.action === 'delete_content') { item.archived_at = new Date((deps.now ?? Date.now)()).toISOString(); item.published = false; item.student_access = false; }
        else if (body.action === 'restore_content') {
          // Preserve the original identity, payload, PDF path and submission links.
          // Restoration never republishes to students, regardless of client flags.
          item.archived_at = null; item.published = true; item.student_access = false;
        }
        else {
          if (typeof body.published !== 'boolean' || typeof body.student_access !== 'boolean') throw new HttpError('공개 상태를 확인해 주세요.');
          if (item.kind === 'answer' && body.student_access) throw new HttpError('모범답안은 학생에게 공개할 수 없습니다.', 403);
          item.published = body.published; item.student_access = body.student_access;
        }
      }
      let saved: Row;
      try { saved = await db.request('rpc/content_save_atomic', {}, { p_item: item, p_actor: String(context.user!.login_id), p_expected_version: existing?.version ?? 0 }); }
      catch (error) {
        // A lost response does not prove that the transaction failed. Retain the
        // private object on uncertain errors; delete only a confirmed rollback.
        if (newPath && error instanceof HttpError && ['VERSION_CONFLICT', 'CONTENT_IDENTITY_CONFLICT'].includes(error.code)) await db.remove(newPath);
        throw error;
      }
      // Previous PDF objects remain private and are referenced by immutable
      // content_versions snapshots. Only uncommitted failed uploads are removed.
      return json({ success: true, item: metadata(saved) });
    } catch (error) {
      const e = error instanceof HttpError ? error : new HttpError('요청을 처리하지 못했습니다.', 500, 'INTERNAL_ERROR');
      return json({ success: false, message: e.message, code: e.code, sessionExpired: e.code === 'SESSION_EXPIRED', permissionDenied: e.status === 403, ...(e.diagnostic ? { diagnostic: e.diagnostic } : {}) }, e.status);
    }
  };
}
if (typeof Deno !== 'undefined') Deno.serve(createHandler());
