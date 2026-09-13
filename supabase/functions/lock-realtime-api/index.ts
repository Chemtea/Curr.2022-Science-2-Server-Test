/** Test v2 upgrade of the fetched v1: atomic path patches; never replace all locks.
 * Existing adminKey and managerSessionToken contracts and broadcast topic remain.
 */
declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };
type Row = Record<string, any>;
const URL_TEST = 'https://rerykeslgwhamreoskgx.supabase.co';
const ownObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
export function validatePatches(value: unknown): { path: string[]; value: boolean | string }[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 300) throw new Error('잠금 변경 항목은 1~300개여야 합니다.');
  return value.map(patch => {
    if (!ownObject(patch) || !Array.isArray(patch.path) || !patch.path.length || patch.path.length > 5) throw new Error('잠금 변경 경로가 올바르지 않습니다.');
    const p = patch.path;
    if (p.some(v => typeof v !== 'string' || ['__proto__','constructor','prototype'].includes(v))) throw new Error('허용되지 않은 잠금 경로입니다.');
    if (p.length === 1 && p[0] === 'evalHallVisibilityMode' && ['all','admin_only','hidden'].includes(patch.value)) return { path: [...p], value: patch.value };
    if (typeof patch.value !== 'boolean') throw new Error('잠금 상태는 참 또는 거짓이어야 합니다.');
    const unit = safeId(p[0]) && !['step_locks','worksheetCurriculum','evalHallVisibilityMode','evalHallVisible'].includes(p[0]);
    const wsUnit = typeof p[2] === 'string' && /^(?:[1-9][0-9]{0,2}|[A-Za-z][A-Za-z0-9_-]{0,63})$/.test(p[2]);
    const valid = (p.length === 1 && p[0] === 'evalHallVisible') ||
      (unit && p.length === 2 && p[1] === 'isLocked') ||
      (unit && p.length === 3 && p[1] === 'lessons' && safeId(p[2])) ||
      (p.length === 3 && p[0] === 'step_locks' && safeId(p[1]) && /^[1-4]$/.test(p[2])) ||
      (p.length === 2 && p[0] === 'worksheetCurriculum' && p[1] === 'isLocked') ||
      (p.length === 4 && p[0] === 'worksheetCurriculum' && p[1] === 'units' && wsUnit && p[3] === 'isLocked') ||
      (p.length === 5 && p[0] === 'worksheetCurriculum' && p[1] === 'units' && wsUnit && p[3] === 'items' && safeId(p[4]));
    if (!valid) throw new Error('지원하지 않는 잠금 경로입니다.');
    return { path: [...p], value: patch.value };
  });
}
export class LockStore {
  base: string; key: string; transport: typeof fetch;
  constructor(base: string, key: string, transport: typeof fetch = fetch) { this.base = base; this.key = key; this.transport = transport; }
  async request(path: string, query: Row = {}, body?: Row): Promise<any> {
    const url = new URL(`/rest/v1/${path}`, this.base);
    Object.entries(query).forEach(([k,v]) => url.searchParams.set(k,String(v)));
    const response = await this.transport(url, { method: body ? 'POST' : 'GET', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('잠금 저장 서버를 사용할 수 없습니다.');
    return response.json();
  }
  async one(table: string, query: Row): Promise<Row | null> { return (await this.request(table,{...query,limit:1}))?.[0] ?? null; }
  async broadcast(): Promise<boolean> {
    try {
      const response = await this.transport(`${this.base}/realtime/v1/api/broadcast/science-platform-locks/events/lock_changed`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ changedAt: new Date().toISOString() }) });
      return response.ok;
    } catch { return false; }
  }
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
function enabled(user: Row | null): boolean {
  return !!user && !user.revoked_at && !user.deleted_at && !user.disabled_at && user.is_active !== false && user.active !== false &&
    ['등록완료','승인','승인완료','active','approved','enabled'].includes(String(user.status ?? '').toLowerCase()) &&
    (user.approval_status == null || ['승인','승인완료','approved'].includes(String(user.approval_status).toLowerCase()));
}
export async function authorize(body: Row, db: LockStore, now: number): Promise<string | null> {
  const raw = body.adminKey || body.adminSessionToken || body.managerSessionToken || body.studentSessionToken;
  if (typeof raw !== 'string' || !/^(adm_|stu_)[0-9a-f]{96}$/.test(raw)) return null;
  const session = await db.one('app_sessions',{select:'*',token_hash:`eq.${await digest(raw)}`});
  const expiry = Date.parse(String(session?.expires_at ?? ''));
  if (!session || session.revoked_at || !Number.isFinite(expiry) || expiry <= now) return null;
  if (raw.startsWith('adm_') && session.session_type === 'admin' && session.account_type === 'admin' && session.login_id === 'admin') {
    if (session.account_id == null) {
      const setting = await db.one('app_settings',{select:'setting_value',setting_key:'eq.admin_password_hash'});
      return /^[0-9a-f]{64}$/i.test(String(setting?.setting_value?.hash ?? '')) ? 'admin' : null;
    }
    const user = await db.one('app_users',{select:'*',id:`eq.${session.account_id}`});
    return enabled(user) && String(user!.login_id).toLowerCase() === 'admin' ? String(user!.name ?? 'admin') : null;
  }
  if (!raw.startsWith('stu_') || session.session_type !== 'manager' || !session.account_id) return null;
  const user = await db.one('app_users',{select:'*',id:`eq.${session.account_id}`});
  return enabled(user) && String(user!.account_type).toLowerCase() === 'manager' && Array.isArray(user!.manager_permissions) && user!.manager_permissions.includes('curriculum_control') ? String(user!.name ?? session.display_name ?? 'manager') : null;
}
async function parse(req: Request): Promise<Row> {
  const reader = req.body?.getReader(); if (!reader) return {};
  let size = 0; const parts: Uint8Array[] = [];
  while (true) { const p = await reader.read(); if (p.done) break; size += p.value.length; if (size > 65536) { await reader.cancel(); throw new Error('잠금 요청 용량이 너무 큽니다.'); } parts.push(p.value); }
  const data = new Uint8Array(size); let offset = 0; for (const p of parts) { data.set(p,offset); offset+=p.length; }
  const body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
  if (!ownObject(body)) throw new Error('요청 형식이 올바르지 않습니다.'); return body;
}
export function createHandler(deps: { env?: (key:string)=>string|undefined; store?: LockStore; now?:()=>number } = {}) {
  const env = deps.env ?? (key => Deno.env.get(key));
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowed = new Set(['https://chemtea.github.io',...(env('CONTENT_ALLOWED_ORIGINS') ?? '').split(',').map(s=>s.trim()).filter(Boolean)]);
    const headers = {'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : 'https://chemtea.github.io', 'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
    const json = (data: unknown,status = 200) => new Response(JSON.stringify(data),{status,headers});
    if (origin && !allowed.has(origin)) return json({success:false,message:'허용되지 않은 사이트입니다.'},403);
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (!['GET','POST'].includes(req.method)) return json({success:false},405);
    try {
      const base = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
      if (base !== URL_TEST || !key) return json({success:false,message:'지정한 테스트 서버 설정이 필요합니다.'},503);
      const body = req.method === 'POST' ? await parse(req) : {};
      const action = body.action ?? new URL(req.url).searchParams.get('action') ?? 'health';
      const db = deps.store ?? new LockStore(base,key);
      if (action === 'health') return json({success:true,status:'ok',service:'science-platform-test-locks',version:2,patchesRequired:true});
      if (action === 'get_locks') return json((await db.one('app_settings',{select:'setting_value',setting_key:'eq.lock_states'}))?.setting_value ?? {});
      if (action !== 'save_locks') return json({success:false,message:'지원하지 않는 요청입니다.'},400);
      if (req.method !== 'POST') return json({success:false},405);
      const actor = await authorize(body,db,(deps.now ?? Date.now)());
      if (!actor) return json({success:false,permissionDenied:true,message:'교육과정 잠금 제어 권한이 필요합니다.'},403);
      if (!Array.isArray(body.patches) || Object.hasOwn(body,'locks')) return json({success:false,upgradeRequired:true,message:'페이지를 새로고침해 주세요. 전체 잠금 덮어쓰기는 지원하지 않습니다.'},400);
      const patches = validatePatches(body.patches);
      const locks = await db.request('rpc/apply_science_lock_patches',{}, {p_patches:patches,p_actor:actor});
      return json({success:true,status:'success',locks,realtimeSent:await db.broadcast(),savedAt:new Date((deps.now ?? Date.now)()).toISOString()});
    } catch (error) {
      return json({success:false,message:error instanceof Error?error.message:'잠금 저장에 실패했습니다.'},400);
    }
  };
}
if (typeof Deno !== 'undefined') Deno.serve(createHandler());
