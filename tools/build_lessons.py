#!/usr/bin/env python3
"""One-time trusted-source migration. Never run this against unreviewed uploads.
The generated public pages contain teaching content/simulations, no answer keys.
New runtime uploads use science-lesson/v1 JSON and never modify these assets.
"""
import argparse, json, re, subprocess, hashlib, uuid
from pathlib import Path
P=argparse.ArgumentParser(); P.add_argument('--source',type=Path,default=Path('upload')); P.add_argument('--site',type=Path,default=Path('test-work/site')); P.add_argument('--private',type=Path,default=Path('test-work/private/lesson-packs')); A=P.parse_args()
AS=A.site/'assets'; AS.mkdir(parents=True,exist_ok=True); A.private.mkdir(parents=True,exist_ok=True)
SCRIPT=re.compile(r'<script\b([^>]*)>([\s\S]*?)</script>',re.I)
STYLE=re.compile(r'<style\b([^>]*)>([\s\S]*?)</style>',re.I)

def balanced(s,start):
    # Paired braces, with JavaScript strings and comments treated atomically.
    assert s[start]=='{'; i=start+1; depth=1
    while i<len(s):
        if s[i:i+2]=='//':
            j=s.find('\n',i+2); i=len(s) if j<0 else j+1; continue
        if s[i:i+2]=='/*':
            i=s.index('*/',i+2)+2; continue
        if s[i] in "\"'`":
            q=s[i]; i+=1
            while i<len(s):
                if s[i]=='\\': i+=2
                elif s[i]==q:i+=1;break
                else:i+=1
            continue
        if s[i]=='{':depth+=1
        elif s[i]=='}':
            depth-=1
            if depth==0:return i+1
        i+=1
    raise ValueError('unbalanced source')

def fnspan(s,name):
    m=re.search(r'(?:async\s+)?function '+name+r'\s*\(',s); assert m,name
    b=s.index('{',m.end());return m.start(),balanced(s,b)

def replacefn(s,name,new):
    a,b=fnspan(s,name);return s[:a]+new+s[b:]

def jsvalue(s,name):
    m=re.search(r'const\s+'+name+r'\s*=\s*',s); assert m,name
    start=s.index('{',m.end()); end=balanced(s,start)
    raw=s[start:end]
    result=subprocess.run(['node','-e',"let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(require('node:vm').runInNewContext('('+s+')',{}, {timeout:100}))));"],input=raw,text=True,capture_output=True,check=True)
    return json.loads(result.stdout),m.start(),end+(1 if s[end:end+1]==';' else 0)

def namespaced(s):
    s=re.sub(r'(?<![\w.])sessionStorage\b','window.platformSessionStorage',s)
    s=re.sub(r'(?<![\w.])localStorage\b','window.platformLocalStorage',s)
    return s.replace('https://chemtea.github.io/Curr.2022-Science-2/','https://chemtea.github.io/Curr.2022-Science-2-Server-Test/')

files=sorted(p for p in A.source.glob('*.html') if not p.name.startswith('index'))
assert len(files)==15,f'Expected supplied 15 lessons, got {len(files)}'
base=(A.source/'01_light_reflection.html').read_text()
base_main=next(m[2] for m in SCRIPT.finditer(base) if 'function submitQuizResults' in m[2])
shared=base_main[:base_main.index('        const LESSON_NAME')]
shared=re.sub(r'const THIS_LESSON_KEY = [^;]+;', 'const THIS_LESSON_KEY = window.LESSON_CONFIG.lessonKey;',shared)
shared=re.sub(r'if \(stepNum === [23]\) drawSim[23]\(\);','',shared)
shared=shared.replace("window.scrollTo({ top: 0, behavior: 'smooth' });","window.dispatchEvent(new CustomEvent('lesson-step-change',{detail:stepNum}));\n            window.scrollTo({ top: 0, behavior: 'smooth' });")
# No third-party IP collection; the server determines audit context itself.
ip_a=shared.index('        // 로컬 파일로 직접 열 때');ip_b=shared.index('        function checkAndApplyStudentAuth',ip_a)
shared=shared[:ip_a]+shared[ip_b:]
shared=shared.replace('2: true,\n            3: true,\n            4: true', '2: window.LESSON_CONFIG.trustedBuiltin === true,\n            3: window.LESSON_CONFIG.trustedBuiltin === true,\n            4: window.LESSON_CONFIG.trustedBuiltin === true')
(AS/'lesson-core.js').write_text(namespaced(shared))
lock=next(m[2] for m in SCRIPT.finditer(base) if 'function enforceLessonLock' in m[2])
lock=re.sub(r'const THIS_UNIT_KEY = [^;]+;', 'const THIS_UNIT_KEY = window.LESSON_CONFIG.unitKey;',lock)
lock=re.sub(r'const THIS_LESSON_ID = [^;]+;', 'const THIS_LESSON_ID = window.LESSON_CONFIG.lessonKey;',lock)
(AS/'lesson-locks.js').write_text(namespaced(lock))
ctw_css=next(m[2] for m in STYLE.finditer(base) if 'ctw-style' in m[1]); (AS/'lesson-worksheet.css').write_text(ctw_css)
ctw=next(m[2] for m in SCRIPT.finditer(base) if 'ctw-script' in m[1])
ctw=ctw.replace("const defaultURL = defaultPath ? new URL(defaultPath, location.protocol === 'file:' ? publishedBase : location.href).href : '';","const defaultURL = 'content-api:worksheet:' + window.LESSON_CONFIG.lessonKey;")
needle='    persist(); finishStroke(); cancelText();\n    loading = true; controls();'
replacement="""    if (!file) {
      try { file = await window.LessonContent.worksheet(window.LESSON_CONFIG.lessonKey); }
      catch (error) { loading = false; $('empty-message').textContent = error.message; status(error.message); controls(); return; }
    }
"""+needle
assert needle in ctw;ctw=ctw.replace(needle,replacement,1)
# Per-test, per-account notes prevent cross-user notes on a shared classroom machine.
ctw=ctw.replace("noteKey = 'ctw:notes:v1:' + root.dataset.lesson", "noteKey = 'ctw:notes:v2:' + window.LessonContent.noteOwner() + ':' + root.dataset.lesson")
# Leaf patches preserve simultaneous edits in the latest platform API.
a=ctw.index("        const locks = await requestWorksheetLocks({action:'get_locks'});")
b=ctw.index("        if (result.success",a)
ctw=ctw[:a]+"        const result = await requestWorksheetLocks({action:'save_locks',adminKey,patches:[{path,value:value === true}]});\n"+ctw[b:]
ctw=ctw.replace("아이디별 아님, 자동 만료 없음", "계정별 구분, 자동 만료 없음")
ctw=ctw.replace("  function worksheetLockState() {", "  let serverWorksheetAllowed = false;\n  function worksheetLockState() {")
ctw=ctw.replace("    const state = worksheetLockState();\n    return !!worksheetAdminKey()", "    const state = worksheetLockState();\n    if (!window.LESSON_CONFIG.trustedBuiltin) return serverWorksheetAllowed;\n    return !!worksheetAdminKey()")
ctw=ctw.replace("        const data = await requestWorksheetLocks({action:'get_locks'});\n        if (!live()) return false;", "        const [data, published] = await Promise.all([requestWorksheetLocks({action:'get_locks'}), window.LessonContent.worksheetAvailable(window.LESSON_CONFIG.lessonKey)]);\n        serverWorksheetAllowed = published;\n        if (!live()) return false;")
ctw=ctw.replace("      const button = $(id);\n      button.textContent", "      const button = $(id);\n      button.hidden = !worksheetUnit;\n      button.textContent")
ctw=ctw.replace("    $('lock-status').textContent = message;", "    if (!window.LESSON_CONFIG.trustedBuiltin) message = serverWorksheetAllowed ? '서버에 공개된 학습지' : '공개된 연결 학습지가 없습니다. 자료 관리에서 연결해 주세요.';\n    $('lock-status').textContent = message;")
(AS/'lesson-worksheet.js').write_text(namespaced(ctw))
# CSS rules shared verbatim by all lessons become one common file; preserve distinct rules.
styles=[]
for p in files:
    s=p.read_text();styles.append(next(m[2] for m in STYLE.finditer(s) if 'ctw-style' not in m[1] and 'body' in m[2] and len(m[2])>5000))
def cssblocks(s):
    out=[];i=0
    while i<len(s):
        b=s.find('{',i)
        if b<0:break
        e=balanced(s,b);out.append(s[i:e]);i=e
    return out
blocks=[cssblocks(s) for s in styles]; common=set(blocks[0])
for bs in blocks[1:]:common.intersection_update(bs)
common_css='\n'.join(b for b in blocks[0] if b in common)
(AS/'lesson-base.css').write_text(common_css)
manifest={};report=[]
for p,css in zip(files,styles):
    s=p.read_text();original=s;mainmatch=next(m for m in SCRIPT.finditer(s) if 'function submitQuizResults' in m[2]);main=mainmatch[2]
    master=None
    mm=re.search(r'/\* ML:EDIT:CONFIG:START \*/([\s\S]*?)/\* ML:EDIT:CONFIG:END \*/',s)
    if mm:master=json.loads(mm[1])
    lesson=master['lessonKey'] if master else re.search(r'const THIS_LESSON_KEY\s*=\s*"([^"]+)"',main)[1]
    title=master['lessonName'] if master else re.search(r'const LESSON_NAME\s*=\s*"([^"]+)"',main)[1]
    config=master or {'lessonKey':lesson,'unitKey':'unit'+lesson.split('_')[0][1:],'lessonName':title,'templateMode':False,'pageTitle':re.search(r'<title>(.*?)</title>',s)[1],'worksheetPath':re.search(r'data-pdf="([^"]+)"',s)[1]}
    config['trustedBuiltin']=True
    filename=p.name.replace('(1)','');manifest[lesson]=filename
    quiz,qa,qb=jsvalue(main,'quizData')
    private_quiz=[{'correct':int(quiz[str(i)]['correct']),'explanation':quiz[str(i)].get('correctExpl',''),'choices':4} for i in range(1,len(quiz)+1)]
    (A.private/(lesson+'.json')).write_text(json.dumps({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'science-platform-test:lesson:'+lesson)),'title':title,'kind':'lesson','format':'lesson-pack','unit_id':config['unitKey'],'lesson_id':lesson,'student_access':True,'published':True,'content':{'schema':'science-lesson/v1','builtin_id':lesson},'quiz_data':private_quiz},ensure_ascii=False,indent=2))
    sa,sb=fnspan(main,'switchStep');sw=main[sa:sb]
    hook_start=sw.index("document.querySelectorAll('.step-content')")
    hook_start=sw.index('});',hook_start)+3;hook_end=sw.index('window.scrollTo',hook_start)
    hook=sw[hook_start:hook_end]
    # Preserve the exact lesson-specific simulation startup and step refresh hooks.
    working=main
    for a,b in sorted([(qa,qb),fnspan(main,'handleQuiz'),fnspan(main,'submitQuizResults')],reverse=True):working=working[:a]+working[b:]
    prefix_end=working.index('        const LESSON_NAME')
    working=working[prefix_end:]
    working=re.sub(r'const LESSON_NAME\s*=\s*[^;]+;','',working)
    working=re.sub(r'const TOTAL_QUESTIONS\s*=\s*[^;]+;','',working)
    working=re.sub(r'const userQuizState\s*=\s*\{[^}]+\};','',working)
    working=re.sub(r'let isSubmitted\s*=\s*false;','',working)
    working="window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;"+hook+"\n});\n"+working
    (AS/('lesson-sim-'+lesson+'.js')).write_text(namespaced(working))
    s=s[:mainmatch.start()]+'<script src="./assets/lesson-core.js"></script>\n<script src="./assets/content-client.js"></script>\n<script src="./assets/lesson-content.js"></script>\n<script src="./assets/lesson-quiz.js"></script>\n<script src="./assets/lesson-sim-'+lesson+'.js"></script>'+s[mainmatch.end():]
    s=re.sub(r'handleQuiz\((\d+),\s*this,\s*(true|false),\s*(\d+)\)',r'handleQuiz(\1,this,\3)',s)
    def scripts(m):
        attr,body=m[1],m[2]
        if 'function enforceLessonLock' in body:return '<script src="./assets/lesson-locks.js"></script>'
        if 'ctw-script' in attr:return '<script src="./assets/lesson-worksheet.js"></script>'
        if 'ml-config' in attr:return ''
        if 'ml-runtime' in attr:return ''
        if 'ml-shared-ui-loader' in attr:return '<script src="./admin-quick-points.js"></script>'
        return m[0]
    s=SCRIPT.sub(scripts,s)
    s=s.replace('<head>','<head>\n<script src="./platform-config.js"></script>\n<script src="./lock-realtime-client.js"></script>\n<script>window.LESSON_CONFIG=Object.freeze('+json.dumps(config,ensure_ascii=False).replace('</','<\\/')+');window.MASTER_LESSON_CONFIG=window.LESSON_CONFIG;</script>\n<script src="./assets/lesson-master.js"></script>',1)
    # Remove duplicate parser-blocking platform scripts introduced above.
    for src in ['./platform-config.js','./lock-realtime-client.js']:
        token='<script src="'+src+'"></script>'; first=s.index(token);s=s[:first+len(token)]+s[first+len(token):].replace(token,'')
    def stylesub(m):
        if 'ctw-style' in m[1]:return '<link rel="stylesheet" href="./assets/lesson-worksheet.css">'
        if m[2]==css:
            unique=''.join(b for b in cssblocks(css) if b not in common)
            (AS/('lesson-style-'+lesson+'.css')).write_text(unique)
            return '<link rel="stylesheet" href="./assets/lesson-base.css">\n<link rel="stylesheet" href="./assets/lesson-style-'+lesson+'.css">'
        return m[0]
    s=STYLE.sub(stylesub,s)
    # All standard examples are formative lessons. Their former inline answers are private.
    assert 'const quizData' not in s and not re.search(r'handleQuiz\([^)]*,\s*(true|false)',s)
    assert 'jypvtvvozxmsposxllri' not in s
    (A.site/filename).write_text(s)
    report.append({'id':lesson,'file':filename,'source_bytes':len(original.encode()),'page_bytes':len(s.encode()),'simulation_bytes':len(working.encode()),'questions':len(quiz),'source_sha256':hashlib.sha256(original.encode()).hexdigest()})
(AS/'lesson-builtins.json').write_text(json.dumps(manifest,indent=2))
(A.site/'tools'/'lesson-migration-report.json').write_text(json.dumps({'lessons':report,'shared_css_bytes':len(common_css.encode()),'shared_worksheet_js_bytes':len(ctw.encode())},ensure_ascii=False,indent=2))
print(json.dumps({'lessons':len(report),'common_css_bytes':len(common_css.encode()),'private_questions':sum(r['questions'] for r in report)},ensure_ascii=False))
# The content-only renderer uses the same trusted shell and shared functionality.
from html.parser import HTMLParser
class Sections(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=False);self.text=text;self.offsets=[0];self.depth=0;self.active=None;self.spans={}
        for m in re.finditer('\n',text):self.offsets.append(m.end())
    def pos(self):
        line,col=self.getpos();return self.offsets[line-1]+col
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='div':
            if attrs.get('id') in ('step1','step2','step3','step4'):self.active=(attrs['id'],self.depth,self.pos()+len(self.get_starttag_text()))
            self.depth+=1
    def handle_endtag(self,tag):
        if tag=='div':
            self.depth-=1
            if self.active and self.depth==self.active[1]:self.spans[self.active[0]]=(self.active[2],self.pos());self.active=None
shell=re.search(r'<body[^>]*>([\s\S]*?)</body>',(A.site/'01_light_reflection.html').read_text())[1]
parser=Sections(shell);parser.feed(shell);assert len(parser.spans)==4
for start,end in sorted(parser.spans.values(),reverse=True):shell=shell[:start]+shell[end:]
shell=SCRIPT.sub('',shell);shell=re.sub(r'<link\b[^>]+>','',shell)
shell=shell.replace('<h1>','<h1 id="lesson-title">',1)
shell=re.sub(r'<footer>[\s\S]*?</footer>','<footer><a href="index.html">과학 플랫폼으로 돌아가기</a></footer>',shell)
(AS/'lesson-shell.html').write_text(shell)
(AS/'lesson-generic.css').write_text(next(m[2] for m in STYLE.finditer(base) if 'ctw-style' not in m[1] and 'body' in m[2] and len(m[2])>5000))
