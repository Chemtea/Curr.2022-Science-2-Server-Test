/** Test-only teacher-issued account activation. No credentials are logged or persisted in clear text. */
declare const Deno: { env: { get(key:string):string|undefined }; serve(handler:(req:Request)=>Promise<Response>):void };
const PROJECT = 'rerykeslgwhamreoskgx';
type Row = Record<string,any>;
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,apikey,authorization','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json = (data:Row,status=200) => new Response(JSON.stringify(data),{status,headers});
export async function sha256(value:string):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function activationCode():string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{8}/g)!.join('-');
}
export function normalizeCode(value:unknown):string { return String(value??'').replace(/[\s-]/g,'').toLowerCase(); }
export type Rpc = (name:string,body:Row)=>Promise<Row>;
export async function handle(req:Request,rpc:Rpc):Promise<Response> {
  if(req.method==='OPTIONS') return new Response('ok',{headers});
  if(req.method!=='POST') return json({success:false,message:'POST 요청을 사용해 주세요.'},405);
  try {
    if(Number(req.headers.get('content-length'))>16384) return json({success:false,message:'요청 용량이 너무 큽니다.'},413);
    // Bound actual body bytes even when Content-Length is absent or incorrect.
    const reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
    if(reader) { while(true) {const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();return json({success:false,message:'요청 용량이 너무 큽니다.'},413);}chunks.push(part.value);} }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let body:Row;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({success:false,message:'요청 형식을 확인해 주세요.'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return json({success:false,message:'요청 형식을 확인해 주세요.'},400);
    if(body.action==='health') return json({success:true,service:'science-platform-test',teacherIssuedActivation:true});
    if(body.action==='redeem') {
      const login=String(body.studentId??'').trim();const year=Number(body.schoolYear);const password=body.password;
      if(!/^[A-Za-z0-9_.@-]{1,80}$/.test(login)||!Number.isInteger(year)||year<2000||year>2100||typeof password!=='string'||password.length<8||password.length>128||password!==password.trim())return json({success:false,message:'학번·학년도와 8~128자리 비밀번호를 입력해 주세요. 비밀번호 앞뒤 공백은 사용할 수 없습니다.'},400);
      const code=normalizeCode(body.code);
      // Invalid code syntax also reaches the limiter; never reveal account identity.
      const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
      const data=await rpc('activation_redeem',{p_login_id:login,p_school_year:year,p_code_hash:await sha256(code),p_password_hash:await sha256(password),p_ip_hash:await sha256('activation-ip:'+ip)});
      return json(data,data.success?200:Number(data.status)||400);
    }
    if(['list','issue','revoke'].includes(body.action)) {
      const token=String(body.adminSessionToken??'');
      if(!/^adm_[0-9a-f]{96}$/.test(token))return json({success:false,message:'교사 관리자 로그인이 필요합니다.'},401);
      if(body.action!=='list'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.accountId??'')))return json({success:false,message:'계정을 선택해 주세요.'},400);
      const code=body.action==='issue'?activationCode():null;
      const data=await rpc('activation_admin',{p_admin_token_hash:await sha256(token),p_action:body.action,p_account_id:body.action==='list'?null:body.accountId,p_code_hash:code?await sha256(normalizeCode(code)):null});
      if(data.success&&code)data.code=code; // One-time display only after DB authentication and commit.
      return json(data,data.success?200:Number(data.status)||400);
    }
    return json({success:false,message:'지원하지 않는 작업입니다.'},400);
  } catch { return json({success:false,message:'활성화 서버 연결을 확인한 뒤 다시 시도해 주세요.'},503); }
}
if(typeof Deno!=='undefined')Deno.serve(async req=>{
  const url=Deno.env.get('SUPABASE_URL')||'';const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(url!==`https://${PROJECT}.supabase.co`||!key)return json({success:false,message:'테스트 서버 설정을 확인해 주세요.'},503);
  return handle(req,async(name,body)=>{
    const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error('BACKEND_UNAVAILABLE');return response.json();
  });
});
