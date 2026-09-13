/** Test-only individual student creation. The student must redeem a teacher-issued activation code. */
declare const Deno: { env: { get(key:string):string|undefined }; serve(handler:(req:Request)=>Promise<Response>):void };
type Row = Record<string,any>;
const PROJECT = 'rerykeslgwhamreoskgx';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,apikey,authorization','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json = (data:Row,status=200) => new Response(JSON.stringify(data),{status,headers});
class ApiError extends Error { status:number; constructor(message:string,status=400){super(message);this.status=status;} }
async function hash(value:string):Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join(''); }
export type Database = { request(path:string,query?:Row,body?:Row):Promise<any> };
export async function verifyAdmin(raw:unknown,db:Database,now:number):Promise<void> {
  if(typeof raw!=='string'||!/^adm_[0-9a-f]{96}$/.test(raw)) throw new ApiError('최고관리자 로그인이 필요합니다.',401);
  const [session] = await db.request('app_sessions',{select:'*',token_hash:'eq.'+await hash(raw),limit:1});
  const expiry=Date.parse(String(session?.expires_at??''));
  if(!session||session.revoked_at||!Number.isFinite(expiry)||expiry<=now||session.session_type!=='admin'||session.account_type!=='admin'||session.login_id!=='admin') throw new ApiError('관리자 세션을 다시 확인해 주세요.',401);
  const [setting] = await db.request('app_settings',{select:'setting_value',setting_key:'eq.admin_password_hash',limit:1});
  const configured=/^[0-9a-f]{64}$/i.test(String(setting?.setting_value?.hash??''));
  if(!session.account_id){if(!configured)throw new ApiError('관리자 인증 설정을 확인해 주세요.',403);return;}
  const [user] = await db.request('app_users',{select:'*',id:'eq.'+session.account_id,limit:1});
  const status=String(user?.status??'').trim().toLowerCase();
  const active=['등록완료','승인','승인완료','active','approved','enabled'].includes(status);
  const legacy=status==='등록대기'&&configured;
  if(!user||String(user.login_id).toLowerCase()!=='admin'||user.deleted_at||user.disabled_at||user.is_active===false||user.active===false||(!active&&!legacy)) throw new ApiError('사용 가능한 최고관리자 계정이 필요합니다.',403);
  if(user.approval_status!=null&&!['approved','승인','승인완료'].includes(String(user.approval_status).toLowerCase())) throw new ApiError('사용 가능한 최고관리자 계정이 필요합니다.',403);
}
async function readBody(req:Request):Promise<Row> {
  if(Number(req.headers.get('content-length'))>16384)throw new ApiError('요청 용량이 너무 큽니다.',413);
  const reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();throw new ApiError('요청 용량이 너무 큽니다.',413);}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}catch{throw new ApiError('요청 형식을 확인해 주세요.');}
}
export async function handle(req:Request,db:Database,now=Date.now()):Promise<Response> {
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({success:false,message:'POST 요청을 사용해 주세요.'},405);
  try{
    const body=await readBody(req);
    if(body.action==='health')return json({success:true,service:'science-platform-test-admin-account',teacherIssuedActivation:true});
    await verifyAdmin(body.adminKey??body.adminSessionToken,db,now);
    if(body.action!=='admin_create_student_account')throw new ApiError('지원하지 않는 관리자 계정 작업입니다.');
    const studentId=String(body.studentId??'').trim(),name=String(body.name??'').trim();
    if(!/^\d{4}$/.test(studentId))throw new ApiError('학번은 숫자 4자리로 입력해 주세요.');
    if(!name||name.length>40||/[\u0000-\u001f\u007f]/.test(name))throw new ApiError('학생 이름은 제어문자 없이 1~40자로 입력해 주세요.');
    const year=Number(await db.request('rpc/get_current_school_year',{},{}));
    if(!Number.isInteger(year)||year<2000||year>2100)throw new ApiError('현재 학년도 설정을 확인해 주세요.',503);
    const existing=await db.request('app_users',{select:'id',school_year:'eq.'+year,login_id:'eq.'+studentId,limit:1});
    if(existing.length) return json({success:false,duplicate:true,message:'해당 학년도에 같은 학번 계정이 이미 있습니다.'},409);
    const rows=await db.request('app_users',{select:'id,login_id,name,school_year,status'},{login_id:studentId,name,password_hash:'',password_scheme:'sha256_client',status:'등록대기',account_type:'student',school_year:year,manager_permissions:[],updated_at:new Date(now).toISOString()});
    const created=rows?.[0];if(!created?.id)throw new ApiError('계정 생성 결과를 확인할 수 없습니다. 목록을 새로고침해 주세요.',503);
    return json({success:true,requiresActivationCode:true,message:'학생 계정을 생성했습니다. 계정 활성화 메뉴에서 일회용 코드를 발급해 학생에게 전달하세요.',account:{accountId:created.id,studentId:created.login_id,name:created.name,schoolYear:String(created.school_year),status:created.status}});
  }catch(error){
    if(error instanceof ApiError)return json({success:false,permissionDenied:error.status===401||error.status===403,message:error.message},error.status);
    return json({success:false,message:'계정 서버 연결을 확인해 주세요. 생성 결과가 불확실하면 목록을 확인한 뒤 다시 시도하세요.'},503);
  }
}
export function createHandler(env:(key:string)=>string|undefined,transport:typeof fetch=fetch){
  return async(req:Request):Promise<Response>=>{
    const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
    if(url!==`https://${PROJECT}.supabase.co`||!key)return json({success:false,message:'테스트 서버 설정을 확인해 주세요.'},503);
    const db:Database={async request(path,query={},body){
      const target=new URL('/rest/v1/'+path,url);for(const[k,v]of Object.entries(query))target.searchParams.set(k,String(v));
      const response=await transport(target,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const data=await response.json().catch(()=>null);
      if(!response.ok){if(data?.code==='23505')throw new ApiError('해당 학년도에 같은 학번 계정이 이미 있습니다.',409);throw new ApiError('계정 서버에 연결할 수 없습니다.',503);}
      return data;
    }};
    return handle(req,db);
  };
}
if(typeof Deno!=='undefined')Deno.serve(createHandler(key=>Deno.env.get(key)));
