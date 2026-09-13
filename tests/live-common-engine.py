"""TEST-only HTTP integration for the common lesson import/quiz/points flow.
Secrets, fixtures and full server replies must stay in a private directory.
Run prepare, apply its setup.sql to the exact TEST project, then run verify.
The new demo content is retained for the teacher; synthetic accounts are removed
using cleanup.sql after server-side row counts have been verified.
"""
import argparse, hashlib, json, secrets, uuid, urllib.request, urllib.error
from pathlib import Path

PROJECT='rerykeslgwhamreoskgx'
BASE=f'https://{PROJECT}.supabase.co/functions/v1/'
MARKER='synthetic-common-engine-verification'

def write(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)); path.chmod(0o600)

def digest(value): return hashlib.sha256(value.encode()).hexdigest()

def prepare(folder):
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    if (folder/'credentials.json').exists(): raise RuntimeError('Fixture already exists')
    c={'project':PROJECT,'admin_token':'adm_'+secrets.token_hex(48),'content_id':str(uuid.uuid4())}
    for role in ('student','second'):
        c[role+'_id']=str(uuid.uuid4()); c[role+'_login']='common_test_'+secrets.token_hex(7); c[role+'_token']='stu_'+secrets.token_hex(48)
    write(folder/'credentials.json',c)
    rows=[]
    for role in ('student','second'):
        rows.append(f"""insert into public.app_users(id,login_id,name,school_year,status,account_type,password_hash,password_scheme)
values('{c[role+'_id']}','{c[role+'_login']}','Synthetic common engine verification',2026,'등록완료','student','{digest(secrets.token_hex(32))}','sha256_client');
insert into public.app_sessions(token_hash,account_id,session_type,login_id,display_name,account_type,school_year,permissions,expires_at,user_agent)
values('{digest(c[role+'_token'])}','{c[role+'_id']}','student','{c[role+'_login']}','Synthetic common engine verification','student',2026,array[]::text[],now()+interval '90 minutes','{MARKER}');""")
    rows.append(f"""insert into public.app_sessions(token_hash,account_id,session_type,login_id,display_name,account_type,school_year,permissions,expires_at,user_agent)
select '{digest(c['admin_token'])}',id,'admin','admin','Synthetic common engine verification','admin',null,array[]::text[],now()+interval '90 minutes','{MARKER}' from public.app_users where login_id='admin';""")
    (folder/'setup.sql').write_text('begin;\n'+'\n'.join(rows)+'\ncommit;'); (folder/'setup.sql').chmod(0o600)
    ids=','.join("'"+c[r+'_id']+"'" for r in ('student','second'))
    hashes=','.join("'"+digest(c[r+'_token'])+"'" for r in ('admin','student','second'))
    cleanup=f"begin;\ndelete from public.app_sessions where token_hash in ({hashes}) and user_agent='{MARKER}';\n"
    for table in ('content_quiz_sessions','content_quiz_attempts','point_ledger','learning_submissions','first_submissions','point_balances'):
        cleanup+=f'delete from public.{table} where account_id in ({ids});\n'
    cleanup+=f"delete from public.app_users where id in ({ids}) and name='Synthetic common engine verification';\ncommit;"
    (folder/'cleanup.sql').write_text(cleanup); (folder/'cleanup.sql').chmod(0o600)
    (folder/'verification.sql').write_text(f"select 'balance' as type,balance::text as value from public.point_balances where account_id='{c['student_id']}' union all select 'ledger',count(*)::text from public.point_ledger where account_id='{c['student_id']}' and type='LESSON_FIRST' union all select 'submission',count(*)::text from public.learning_submissions where account_id='{c['student_id']}' and lesson_key='demo_reflection_l1' union all select 'first',count(*)::text from public.first_submissions where account_id='{c['student_id']}' and lesson_key='demo_reflection_l1';")
    print('Prepared two synthetic learners and a short-lived TEST admin fixture. No remote changes.')

class Client:
    def __init__(self,folder):
        self.folder=folder; self.c=json.loads((folder/'credentials.json').read_text()); self.checks=[]
        assert self.c['project']==PROJECT
    def call(self,action,fields=None,role='admin',expected=200,service='content-api'):
        body=dict(fields or {},action=action)
        if role!='anonymous': body['adminSessionToken' if role=='admin' else 'studentSessionToken']=self.c[role+'_token']
        req=urllib.request.Request(BASE+service,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':'https://chemtea.github.io'},method='POST')
        try:
            with urllib.request.urlopen(req,timeout=45) as r: status,data=r.status,json.load(r)
        except urllib.error.HTTPError as e: status,data=e.code,json.loads(e.read())
        if status not in (expected if isinstance(expected,tuple) else (expected,)):
            write(self.folder/'unexpected-response.json',{'action':action,'status':status,'response':data})
            raise RuntimeError(f'{action}: HTTP {status}, code {data.get("code")}; expected {expected}')
        return data
    def passed(self,label):
        self.checks.append(label);write(self.folder/'results.json',{'project':PROJECT,'checks':self.checks});print('PASS:',label,flush=True)

def verify(folder):
    api=Client(folder); c=api.c; demo=json.loads((folder/'demo-converted.json').read_text())
    assert demo['content']['schema']=='science-lesson/v3'
    assert api.call('health',role='anonymous')['commonQuizEngineEnabled'] is True
    api.passed('Deployed TEST service advertises common engine')
    record=dict(demo['metadata'],id=c['content_id'],kind='lesson',format='lesson-pack',content=demo['content'],quiz_data=demo['quiz_data'],published=False,student_access=False,description='내용만 가져온 새 차시입니다. 형성평가 최초 제출과 기존 포인트를 시험해 보세요.')
    existing=[i for i in api.call('catalog')['items'] if i['id']==c['content_id']]
    if not existing:
        item=api.call('save_content',record)['item']
    else:
        item=existing[0]
        assert api.call('get_editable',{'id':item['id']})['content']==record['content']
    api.call('save_content',dict(record,id=str(uuid.uuid4())),role='student',expected=403)
    if not item['student_access']:
        api.call('get_content',{'id':item['id']},role='student',expected=403)
        item=api.call('set_publication',{'id':item['id'],'expected_version':item['version'],'published':True,'student_access':True})['item']
    write(folder/'demo-state.json',{'id':item['id'],'version':item['version'],'lesson_id':item['lesson_id']})
    api.passed('Imported exact source-only demo through save_content; teacher-only until publication; student upload denied')
    assert any(i['id']==item['id'] for i in api.call('catalog',role='student')['items'])
    delivered=api.call('get_content',{'id':item['id']},role='student')
    assert delivered['content']==demo['content']
    assert 'quiz_data' not in delivered and 'correctChoiceId' not in json.dumps(delivered,ensure_ascii=False)
    api.call('get_editable',{'id':item['id']},role='student',expected=403)
    api.call('get_content',{'id':item['id']},role='anonymous',expected=401)
    api.passed('New catalog lesson loads rich quiz/context and simulation without exposing private key document')
    base={'id':item['id'],'version':item['version']}
    attempt=api.call('begin_quiz',base,role='student')['attempt']
    assert not attempt['submitted'] and attempt['answers']==[None]*4
    assert attempt['feedback']==[None]*4
    base.update(attempt_id=attempt['id'],version=attempt['contentVersion'])
    choose=lambda question,choice:dict(base,question=question,choice=choice,request_id=str(uuid.uuid4()))
    first=api.call('answer_quiz',choose(1,1),role='student')
    assert first['feedback']['correct'] is False and first['feedback']['reasonHtml'] and 'correctChoice' not in first['feedback']
    retry=api.call('answer_quiz',choose(1,1),role='student')
    assert retry['attempt']['answers'][0]==1
    api.call('answer_quiz',choose(1,2),role='student',expected=409)
    api.call('submit_quiz',dict(base,request_id=str(uuid.uuid4())),role='student',expected=400)
    api.call('review_quiz',choose(1,2),role='student',expected=409)
    api.call('answer_quiz',choose(2,2),role='second',expected=409)
    resumed=api.call('begin_quiz',{'id':item['id'],'version':item['version']},role='student')['attempt']
    assert resumed['id']==attempt['id'] and resumed['answers'][0]==1
    api.passed('First choice locked across reload/retry; immediate wrong feedback; partial submit, early review and another account denied')
    for q,ch in [(2,2),(3,3),(4,3)]:
        answer=api.call('answer_quiz',choose(q,ch),role='student')
        assert answer['feedback']['correct'] and answer['feedback']['titleHtml'] and answer['feedback']['review']['stepId']
    result=api.call('submit_quiz',dict(base,request_id=str(uuid.uuid4()),score=4,answers=[2,2,3,3]),role='student')
    assert result['score']==3 and result['total']==4 and result['awardedPoints']==15 and result['currentPoints']==15
    api.passed('Server ignores forged perfect score; actual 3/4 final submission awards existing 15P')
    retry=api.call('submit_quiz',dict(base,request_id=str(uuid.uuid4())),role='student')
    assert retry['duplicate'] and retry['currentPoints']==15
    review=api.call('review_quiz',choose(1,2),role='student')
    assert review['feedback']['correct'] and review['attempt']['answers'][0]==1 and review['attempt']['result']['score']==3 and review['attempt']['result']['currentPoints']==15
    api.passed('Final-submit retry and post-submit free review preserve first score, answer and balance')
    summary=api.call('get_point_summary',role='student',service='point-api')
    write(folder/'points-response.json',summary)
    assert summary['success'] and summary['balance']==15
    history=api.call('get_point_history',role='student',service='point-api')
    write(folder/'history-response.json',history)
    historyrows=history.get('items',history.get('history',[]))
    assert any((r.get('delta')==15 or r.get('pointChange')==15) for r in historyrows)
    api.passed('Existing student point summary and history show the same 15P award')
    second=api.call('begin_quiz',{'id':item['id'],'version':item['version']},role='second')['attempt']
    secondbase={'id':item['id'],'version':second['contentVersion'],'attempt_id':second['id']}
    for q,ch in [(1,2),(2,2),(3,3),(4,3)]:api.call('answer_quiz',dict(secondbase,question=q,choice=ch,request_id=str(uuid.uuid4())),role='second')
    result2=api.call('submit_quiz',dict(secondbase,request_id=str(uuid.uuid4())),role='second')
    assert result2['score']==4 and result2['awardedPoints']==20 and result2['currentPoints']==20
    api.passed('Independent second learner receives 20P for 4/4; account data stays separate')
    write(folder/'results.json',{'project':PROJECT,'demo':{'id':item['id'],'version':item['version'],'lesson_id':item['lesson_id']},'checks':api.checks,'points':{'first':15,'second':20}})

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','verify']);p.add_argument('directory',type=Path);a=p.parse_args()
    {'prepare':prepare,'verify':verify}[a.action](a.directory)
