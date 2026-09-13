/** Test-only assessment service. Authentication uses the existing app_sessions contract.
 * No Supabase JWT user claims, browser roles, client scores, or public file URLs are trusted.
 * Dependency-free Web APIs keep deployment reproducible. See schema/assessment-submissions.sql.
 */
declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };
type Row = Record<string, any>;
type Role = 'anonymous' | 'student' | 'admin';
type Context = { role: Role; user?: Row; session?: Row; tokenHash?: string };
const PROJECT = 'rerykeslgwhamreoskgx';
const BUCKET = 'science-assessment-private';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_BODY = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const BUILTIN = /^(u3_l[1235678]|u7_l[1-8])$/;
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

const SUBMISSION_COLUMNS = 'id,content_id,account_id,slot,revision,content_version,canonical_code,student_name,filename,byte_size,created_at';
export function submissionMetadata(row: Row): Row {
  return Object.fromEntries(SUBMISSION_COLUMNS.split(',').map(key => [key, row[key] ?? null]));
}
export function validatePayload(value: unknown): Row {
  if (!object(value)) throw new HttpError('제출할 활동 내용이 없습니다.');
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > 512 * 1024) throw new HttpError('실험 데이터는 512KB 이내여야 합니다.', 413);
  function walk(v: unknown, depth = 0): void {
    if (depth > 16) throw new HttpError('실험 데이터 구조가 너무 깊습니다.');
    if (typeof v === 'number' && !Number.isFinite(v)) throw new HttpError('실험 데이터 수치가 올바르지 않습니다.');
    if (Array.isArray(v)) { if (v.length > 5000) throw new HttpError('실험 데이터 개수가 너무 많습니다.'); v.forEach(x => walk(x, depth + 1)); }
    else if (object(v)) for (const [key, next] of Object.entries(v)) {
      if (RESERVED_IDS.has(key) || /token|password|secret/i.test(key)) throw new HttpError('허용되지 않은 제출 항목입니다.');
      walk(next, depth + 1);
    }
  }
  walk(value); return value;
}
export class RestStore {
  url: string; key: string; transport: typeof fetch;
  constructor(url: string, key: string, transport: typeof fetch = fetch) { this.url = url; this.key = key; this.transport = transport; }
  async request(path: string, query: Row = {}, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    const url = new URL('/rest/v1/' + path, this.url);
    Object.entries(query).forEach(([k,v]) => url.searchParams.set(k,String(v)));
    const res = await this.transport(url,{method,headers:{apikey:this.key,Authorization:'Bearer '+this.key,'Content-Type':'application/json',Prefer:'return=representation'+(query.on_conflict?',resolution=merge-duplicates':'')},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data = await res.json().catch(()=>null);
    if (!res.ok) {
      const errors: Record<string,[number,string]> = {
        ASSESSMENT_ALREADY_SUBMITTED:[409,'이미 제출했습니다. 교사가 재제출을 허용해야 합니다.'],
        ASSESSMENT_RETRY_CONFLICT:[409,'같은 요청 번호로 다른 답안을 제출할 수 없습니다.'],
        ASSESSMENT_VERSION_CONFLICT:[409,'평가 내용이 변경되었습니다. 다시 열어 확인해 주세요.'],
        ASSESSMENT_FORBIDDEN:[403,'사용 가능한 학생 계정이 필요합니다.'],
        ASSESSMENT_LOCKED:[403,'수행평가가 잠겼거나 비공개 상태입니다.'],
        ASSESSMENT_NOT_FOUND:[404,'제출 기록을 찾을 수 없습니다.']
      };
      const known = errors[data?.message];
      if (known) throw new HttpError(known[1],known[0],data.message);
      throw new HttpError('수행평가 서버에 연결하지 못했습니다.',503,'BACKEND_UNAVAILABLE');
    }
    return data;
  }
  async one(table: string, query: Row): Promise<Row|null> { return (await this.request(table,{...query,limit:1}))?.[0] ?? null; }
  async storage(path: string, bytes?: Uint8Array): Promise<Uint8Array|void> {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(path)) throw new HttpError('잘못된 저장 경로입니다.',500);
    const response = await this.transport(`${this.url}/storage/v1/object/${bytes?'':'authenticated/'}${BUCKET}/${path}`,{
      method:bytes?'POST':'GET',headers:{apikey:this.key,Authorization:'Bearer '+this.key,...(bytes?{'Content-Type':'application/pdf','x-upsert':'false'}:{})},...(bytes?{body:bytes}:{})
    });
    if (!response.ok) throw new HttpError('비공개 제출 파일 저장소를 사용할 수 없습니다.',503,'STORAGE_UNAVAILABLE');
    if (!bytes) { const result = new Uint8Array(await response.arrayBuffer()); if(result.length>MAX_FILE) throw new HttpError('파일 용량이 너무 큽니다.',413); return result; }
  }
  async remove(path: string): Promise<void> {
    await this.transport(`${this.url}/storage/v1/object/${BUCKET}`,{method:'DELETE',headers:{apikey:this.key,Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})}).catch(()=>null);
  }
}
function uuid(value: unknown): string { if(typeof value!=='string'||!UUID.test(value)) throw new HttpError('자료 번호가 올바르지 않습니다.'); return value; }
export function createHandler(deps: {env?:(key:string)=>string|undefined;fetch?:typeof fetch;now?:()=>number;store?:RestStore} = {}) {
  const env = deps.env ?? ((key:string)=>Deno.env.get(key));
  return async (req:Request):Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowed = new Set(['https://chemtea.github.io',...(env('CONTENT_ALLOWED_ORIGINS')??'').split(',').map(x=>x.trim()).filter(Boolean)]);
    const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Origin':origin&&allowed.has(origin)?origin:'https://chemtea.github.io','Access-Control-Allow-Headers':'content-type,apikey,authorization,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
    const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&!allowed.has(origin)) return json({success:false,message:'허용되지 않은 사이트입니다.'},403);
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(req.method!=='POST') return json({success:false,message:'POST 요청이 필요합니다.'},405);
    try {
      const body = await readBody(req), url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
      if(url!==`https://${PROJECT}.supabase.co`||!key) throw new HttpError('지정한 테스트 서버 설정이 필요합니다.',503);
      const db=deps.store??new RestStore(url,key,deps.fetch);
      if(body.action==='health') { await db.request('assessment_submissions',{select:'id',limit:1}); return json({success:true,project:PROJECT,submissionsEnabled:true}); }
      if(!['status','submit','list_submissions','get_submission','set_resubmit','set_runtime_state'].includes(body.action)) throw new HttpError('지원하지 않는 요청입니다.');
      const context=await authenticate(body,db,(deps.now??Date.now)());
      if(context.role==='anonymous') throw new HttpError('로그인이 필요합니다.',401,'SESSION_EXPIRED');
      if(['list_submissions','set_resubmit','set_runtime_state'].includes(body.action)&&context.role!=='admin') throw new HttpError('교사 관리자 권한이 필요합니다.',403);
      if(body.action==='get_submission') {
        const submission=await db.one('assessment_submissions',{select:'*',id:'eq.'+uuid(body.submission_id)});
        if(!submission || (context.role!=='admin'&&submission.account_id!==context.user?.id)) throw new HttpError('제출 기록을 찾을 수 없습니다.',404);
        // Own submission is independent of the current publication state, and never returns assignment/answer text.
        return json({success:true,submission:submissionMetadata(submission),...(submission.slot==='pdf'?{file_base64:encode(await db.storage(submission.storage_path) as Uint8Array),mime:'application/pdf'}:{payload:submission.payload})});
      }
      const id=uuid(body.id), item=await db.one('content_items',{select:'*',id:'eq.'+id});
      if(!item||item.kind!=='assessment') throw new HttpError('수행평가를 찾을 수 없습니다.',404);
      if(body.action==='set_runtime_state') {
        if(typeof body.soundMuted!=='boolean') throw new HttpError('소리 설정이 올바르지 않습니다.');
        await db.request('assessment_runtime_settings',{on_conflict:'content_id'}, {content_id:id,sound_muted:body.soundMuted,changed_by:'admin:'+context.tokenHash,updated_at:new Date((deps.now??Date.now)()).toISOString()});
        return json({success:true,soundMuted:body.soundMuted});
      }
      if(body.action==='list_submissions') {
        const offset=Number.isInteger(body.offset)&&body.offset>=0?body.offset:0;
        const rows=await db.request('assessment_submissions',{select:SUBMISSION_COLUMNS,content_id:'eq.'+id,order:'canonical_code.asc,slot.asc,revision.desc',limit:200,offset});
        const permissions=await db.request('assessment_resubmit_permissions',{select:'account_id,slot,allowed',content_id:'eq.'+id,limit:2000});
        const sound=await db.one('assessment_runtime_settings',{select:'sound_muted',content_id:'eq.'+id});
        return json({success:true,role:'admin',submissions:rows.map(submissionMetadata),permissions,next_offset:rows.length===200?offset+200:null,soundMuted:sound?.sound_muted!==false});
      }
      if(body.action==='set_resubmit') {
        if(!['data','pdf'].includes(body.slot)||typeof body.allowed!=='boolean') throw new HttpError('재제출 설정이 올바르지 않습니다.');
        const result=await db.request('rpc/assessment_set_resubmit',{}, {p_content_id:id,p_account_id:uuid(body.account_id),p_slot:body.slot,p_allowed:body.allowed,p_actor:'admin:'+context.tokenHash});
        return json({success:true,...result});
      }
      const locks=(await db.one('app_settings',{select:'setting_value',setting_key:'eq.lock_states'}))?.setting_value;
      if(!canRead(item,context.role,locks)) throw new HttpError('수행평가가 잠겼거나 비공개 상태입니다.',403,'ASSESSMENT_LOCKED');
      const account=context.user?.id;
      if(body.action==='status') {
        const submissions=context.role==='admin'?[]:await db.request('assessment_submissions',{select:SUBMISSION_COLUMNS,account_id:'eq.'+account,content_id:'eq.'+id,order:'revision.desc',limit:100});
        const permissions=context.role==='admin'?[]:await db.request('assessment_resubmit_permissions',{select:'slot,allowed',account_id:'eq.'+account,content_id:'eq.'+id});
        const sound=await db.one('assessment_runtime_settings',{select:'sound_muted',content_id:'eq.'+id});
        return json({success:true,role:context.role,submissions:submissions.map(submissionMetadata),permissions,soundMuted:sound?.sound_muted!==false,student:context.role==='student'?{id:account,studentId:String(context.user?.login_id??'').replace(/^([1-3])0([1-9][0-9]{2})$/,'$1$2'),name:context.user?.name??'',schoolYear:context.user?.school_year??null}:null});
      }
      if(context.role!=='student'||!['student','external'].includes(String(context.user?.account_type))) throw new HttpError('학생 계정으로만 제출할 수 있습니다.',403);
      const requestId=uuid(body.request_id);
      if(!['data','pdf'].includes(body.slot)||!Number.isInteger(body.content_version)||body.content_version<1) throw new HttpError('제출 요청 형식이 올바르지 않습니다.');
      const payload=body.slot==='data'?validatePayload(body.payload):null;
      const bytes=body.slot==='pdf'?decodePdf(body.file_base64):new TextEncoder().encode(JSON.stringify(payload));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      const old=await db.one('assessment_submissions',{select:'*',account_id:'eq.'+account,request_id:'eq.'+requestId});
      if(old) {
        if(old.content_id!==id||old.slot!==body.slot||old.payload_hash!==digest) throw new HttpError('같은 요청 번호로 다른 답안을 제출할 수 없습니다.',409,'ASSESSMENT_RETRY_CONFLICT');
        return json({success:true,submission:{...submissionMetadata(old),duplicate:true}});
      }
      if(item.version!==body.content_version) throw new HttpError('평가 내용이 변경되었습니다. 다시 확인해 주세요.',409,'ASSESSMENT_VERSION_CONFLICT');
      const path=body.slot==='pdf'?`${id}/${crypto.randomUUID()}.pdf`:null;
      if(path) await db.storage(path,bytes);
      try {
        const result=await db.request('rpc/assessment_submit_atomic',{}, {p_submission:{content_id:id,account_id:account,slot:body.slot,request_id:requestId,content_version:body.content_version,payload,storage_path:path,payload_hash:digest,byte_size:bytes.length}});
        if(path&&result.duplicate) await db.remove(path);
        return json({success:true,submission:result});
      } catch(error) {
        // A transport failure may follow a committed transaction. Keep the immutable file until an administrator reconciles it.
        if(path&&error instanceof HttpError&&error.status<500) await db.remove(path);
        throw error;
      }
    } catch(error) { const e=error instanceof HttpError?error:new HttpError('수행평가 요청을 처리하지 못했습니다.',503); return json({success:false,message:e.message,code:e.code},e.status); }
  };
}
if(typeof Deno!=='undefined') Deno.serve(createHandler());
