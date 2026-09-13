/** Shared pure guards; every platform session lookup also reads its current server account. */
type Row=Record<string,any>;
const enabled=new Set(['등록완료','승인','승인완료','active','approved','enabled']);
const normalize=(value:unknown)=>String(value??'').trim().toLowerCase();
export function platformAccountSafe(user:Row|null):boolean {
  return !!user && !user.deleted_at && !user.disabled_at && user.is_active!==false && user.active!==false
    && (!user.guardian_consent_required || user.guardian_consent_verified===true)
    && (user.approval_status==null || ['approved','승인','승인완료'].includes(normalize(user.approval_status)));
}
export function platformStudentAllowed(user:Row|null):boolean {
  const type=normalize(user?.account_type)||'student';
  return platformAccountSafe(user) && normalize(user!.login_id)!=='admin' && enabled.has(normalize(user!.status))
    && ['student','external','manager','middle_manager','중간관리자'].includes(type);
}
export function platformAdminAllowed(user:Row|null,credentialConfigured:boolean):boolean {
  if(!credentialConfigured)return false;
  if(!user)return true; // Legacy admin credential can exist without a roster row.
  const structurallySafe=!user.deleted_at && !user.disabled_at && user.is_active!==false && user.active!==false
    && (!user.guardian_consent_required || user.guardian_consent_verified===true);
  if(!structurallySafe||normalize(user.login_id)!=='admin')return false;
  return normalize(user.status)==='등록대기' || platformAccountSafe(user)&&enabled.has(normalize(user.status));
}
export function platformSessionLive(session:Row|null,kind:'student'|'admin',now=Date.now()):boolean {
  if(!session||session.revoked_at)return false;
  const expires=Date.parse(String(session.expires_at??''));
  if(!Number.isFinite(expires)||expires<=now)return false;
  if(kind==='admin')return session.session_type==='admin'&&session.account_type==='admin'&&session.login_id==='admin';
  return ['student','manager'].includes(session.session_type)&&['student','external','manager'].includes(session.account_type)
    && normalize(session.login_id)!=='admin' && !!session.account_id;
}
export function platformStudentSessionMatches(session:Row,user:Row|null):boolean {
  if(!platformStudentAllowed(user)||String(session.account_id)!==String(user!.id))return false;
  const type=['middle_manager','중간관리자'].includes(normalize(user!.account_type))?'manager':normalize(user!.account_type)||'student';
  return session.account_type===type && session.session_type===(type==='manager'?'manager':'student')
    && normalize(session.login_id)===normalize(user!.login_id);
}
