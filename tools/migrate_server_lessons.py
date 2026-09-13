#!/usr/bin/env python3
"""Migrate the explicitly supplied 15 trusted source lessons to private v2 records.

This utility does not publish or call an API. Answer-bearing output belongs outside
the public site. Run with --redirect only after the corresponding records are live.
"""
import argparse
import html
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path


def balanced(source, start):
    depth = 1
    i = start + 1
    while i < len(source):
        if source[i:i + 2] == '//':
            end = source.find('\n', i + 2)
            i = len(source) if end < 0 else end + 1
            continue
        if source[i:i + 2] == '/*':
            i = source.index('*/', i + 2) + 2
            continue
        if source[i] in "\"'`":
            quote = source[i]
            i += 1
            while i < len(source):
                if source[i] == '\\':
                    i += 2
                elif source[i] == quote:
                    i += 1
                    break
                else:
                    i += 1
            continue
        if source[i] == '{':
            depth += 1
        elif source[i] == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError('Unbalanced source')


def fnspan(source, name):
    match = re.search(r'(?:async\s+)?function ' + name + r'\s*\(', source)
    if not match:
        raise ValueError('Missing function ' + name)
    return match.start(), balanced(source, source.index('{', match.end()))


class Elements(HTMLParser):
    """Source ranges and text for specifically requested elements, without repair."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.offsets = [0] + [m.end() for m in re.finditer('\n', source)]
        self.stack = []
        self.nodes = []
        self.feed(source)

    def source_offset(self):
        line, col = self.getpos()
        return self.offsets[line - 1] + col

    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'attrs': dict(attrs), 'start': self.source_offset(), 'inner': self.source_offset() + len(self.get_starttag_text()), 'text': ''}
        self.nodes.append(node)
        if tag not in self.VOID:
            self.stack.append(node)
        else:
            node['end'] = node['inner']
            node['close'] = node['inner']

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]['tag'] == tag:
                for node in self.stack[i:]:
                    node['end'] = self.source_offset()
                    node['close'] = self.source.find('>', self.source_offset()) + 1
                del self.stack[i:]
                break

    def handle_data(self, data):
        for node in self.stack:
            node['text'] += data

    def by_id(self, name):
        return next(n for n in self.nodes if n['attrs'].get('id') == name)

    def inner(self, node):
        return self.source[node['inner']:node['end']]

    def class_nodes(self, name):
        return [n for n in self.nodes if name in n['attrs'].get('class', '').split()]


def clean_text(value):
    return re.sub(r'\s+', ' ', value).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('upload'))
    parser.add_argument('--site', type=Path, default=Path('test-work/site'))
    parser.add_argument('--private', type=Path, default=Path('test-work/private'))
    parser.add_argument('--redirect', action='store_true')
    args = parser.parse_args()
    out = args.private / 'server-lessons'
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((args.site / 'assets/lesson-builtins.json').read_text())
    report = []
    sql = ['-- PRIVATE DATA MIGRATION. Exact test project: rerykeslgwhamreoskgx. Never publish seed answers.', 'begin;']
    for key, filename in manifest.items():
        original = args.source / filename
        if not original.exists():
            original = args.source / filename.replace('.html', '(1).html')
        source = original.read_text()
        dom = Elements(source)
        record = json.loads((args.private / 'lesson-packs' / (key + '.json')).read_text())
        scripts = re.findall(r'<script\b[^>]*>([\s\S]*?)</script>', source, re.I)
        script = next(s for s in scripts if 'function submitQuizResults' in s)
        # Some originals declare LESSON_NAME after all simulations. The old
        # extraction boundary lost friction and the two 3D engines; use the end
        # of the shared admin block, then remove only named common quiz logic.
        sim = script[fnspan(script, 'exitAdminMode')[1]:]
        for name in ['handleQuiz', 'submitQuizResults']:
            a, b = fnspan(sim, name)
            sim = sim[:a] + sim[b:]
        quiz_start = re.search(r'const\s+quizData\s*=\s*', sim).start()
        quiz_end = balanced(sim, sim.index('{', quiz_start))
        sim = sim[:quiz_start] + sim[quiz_end:].lstrip(';')
        sim = re.sub(r'const (?:LESSON_NAME|TOTAL_QUESTIONS)\s*=\s*[^;]+;', '', sim)
        sim = re.sub(r'const userQuizState\s*=\s*\{[^}]+\};', '', sim)
        sim = re.sub(r'let isSubmitted\s*=\s*false;', '', sim)
        a, b = fnspan(script, 'switchStep')
        switch = script[a:b]
        hook_start = switch.index("document.querySelectorAll('.step-content')")
        hook_start = switch.index('});', hook_start) + 3
        hook_end = switch.index('window.scrollTo', hook_start)
        hook = switch[hook_start:hook_end]
        sim = "window.addEventListener('lesson-step-change', event => { const stepNum=event.detail;\n" + hook + '\n});\n' + sim
        # Remove stale authentication startup from the trusted source snapshot.
        sim = re.sub(r'\b(?:checkAndApplyStudentAuth|updateStepLockUI|ensureCurrentSchoolYear)\(\);', '', sim)
        sim = re.sub(r'if \(window\.MasterLessonRuntime\.preview\) stepLocks = \{1:false,2:false,3:false,4:false\};', '', sim)
        # Microphone access is held by the trusted common parent, never content.
        if key == 'u3_l8':
            a, b = fnspan(sim, 'sndStartMic')
            sim = sim[:a] + "function sndStartMic(){sndMicStatus('마이크는 수업 화면 위의 공통 마이크 버튼으로 켜 주세요.');}" + sim[b:]
            a, b = fnspan(sim, 'sndStopMic')
            stop = sim[a:b]
            stop = stop.replace('++sndMic.epoch;', "window.dispatchEvent(new Event('science-stop-microphone'));++sndMic.epoch;")
            sim = sim[:a] + stop + sim[b:]
            sim += """
window.addEventListener('science-microphone-samples', event => {
  if(!sndActive(3))return;
  const {samples,rate}=event.detail;
  const values=new Float32Array(samples);
  sndAxes('snd-mic-svg','지금 내 목소리',1/sndMic.zoom);
  const count=Math.round(rate*.02),start=Math.max(0,values.length-count);
  sndPlot('snd-mic-svg',x=>values[Math.min(values.length-1,start+Math.round(x*(count-1)))],1/sndMic.zoom);
  sndShowMetrics(sndMicMetrics(values,rate));
  sndMicStatus('공통 마이크의 입력을 표시하고 있습니다. 녹음하거나 서버로 전송하지 않습니다.');
});
"""
        assert not re.search(r'\b(?:fetch|sessionStorage|localStorage|platformSessionStorage|getUserMedia|submitQuizResults|quizData)\b', sim), key
        subprocess.run(['node', '--check'], input=sim, text=True, check=True)
        steps = []
        for number in range(1, 5):
            node = dom.by_id('step' + str(number))
            title = clean_text(dom.by_id('tabBtn' + str(number))['text']).replace('🔒', '').strip()
            title = re.sub(r'^\d단계\s*[:：]\s*', '', title)
            fragment = dom.inner(node) if number < 4 else '<p>각 문항의 답을 고르고 제출해 주세요. 채점과 제출 기록은 공통 수업 기능에서 처리합니다.</p>'
            if key == 'u3_l8' and number == 3:
                # Actual stream permission and stop button now belong to the
                # common shell. Keep demo controls inside editable content.
                fragment = re.sub(r'<button\b[^>]*id="snd-mic-(?:start|stop)"[^>]*>[\s\S]*?</button>', '', fragment)
            steps.append({'title': title, 'html': fragment})
        quiz = []
        for index, block in enumerate(dom.class_nodes('quiz-item')):
            inner = Elements(dom.inner(block))
            question = clean_text(inner.class_nodes('quiz-q')[0]['text'])
            choices = [re.sub(r'^[①②③④⑤⑥1-6]\s*[.)．]?\s*', '', clean_text(n['text'])) for n in inner.class_nodes('quiz-opt')]
            answer = record['quiz_data'][index]
            assert 2 <= len(choices) <= 6 and 1 <= answer['correct'] <= len(choices), (key, index, len(choices))
            quiz.append({'question': re.sub(r'^\d+\.\s*', '', question), 'choices': choices, 'correct': answer['correct'], 'explanation': answer['explanation']})
        assert len(quiz) == len(record['quiz_data']), key
        styles = [s for a, s in re.findall(r'<style\b([^>]*)>([\s\S]*?)</style>', source, re.I) if 'ctw-style' not in a]
        style = '\n'.join(styles)
        record['content'] = {'schema': 'science-lesson/v2', 'originalLessonId': key, 'title': record['title'], 'steps': steps, 'quiz': quiz, 'simulation': {'html': '', 'css': style, 'js': sim, 'dependencies': [], 'microphone': key == 'u3_l8'}}
        record.pop('quiz_data', None)
        (out / (key + '.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2))
        safe_content = json.loads(json.dumps(record['content']))
        for question in safe_content['quiz']:
            question.pop('correct', None)
            question.pop('explanation', None)
        payload = json.dumps(safe_content, ensure_ascii=False)
        assert '$science_payload$' not in payload
        sql.append("""do $migration$
declare
  v_content jsonb := $science_payload$""" + payload + """$science_payload$::jsonb;
  v_item public.content_items%rowtype;
begin
  select * into strict v_item from public.content_items where id='""" + record['id'] + """'::uuid for update;
  if v_item.kind <> 'lesson' or v_item.lesson_id <> '""" + key + """' then raise exception 'Unexpected lesson identity'; end if;
  if v_item.content->>'schema' = 'science-lesson/v1' and v_item.content->>'builtin_id' = '""" + key + """' then
    if jsonb_array_length(v_item.quiz_data) <> jsonb_array_length(v_content->'quiz') then raise exception 'Private quiz count changed; review before migration'; end if;
    update public.content_items set content=v_content,
      quiz_data=(select jsonb_agg(jsonb_set(q.value,'{choices}',to_jsonb(jsonb_array_length(v_content->'quiz'->((q.ordinality-1)::integer)->'choices'))) order by q.ordinality) from jsonb_array_elements(v_item.quiz_data) with ordinality as q(value,ordinality)),
      version=v_item.version+1, updated_at=now()
      where id=v_item.id;
    insert into public.content_audit(content_id,actor,action,version,metadata)
      values(v_item.id,'server-lesson-migration','update',v_item.version+1,jsonb_build_object('migration','science-lesson/v2','sourceLessonId',v_item.lesson_id));
  elsif v_item.content->>'schema' <> 'science-lesson/v2' then
    raise exception 'Existing content changed; refusing to overwrite';
  end if;
end $migration$;""")
        report.append({'lesson': key, 'id': record['id'], 'steps': len(steps), 'quiz': len(quiz), 'javascript_bytes': len(sim.encode()), 'css_bytes': len(style.encode()), 'canvas_count': sum(len([n for n in Elements(s['html']).nodes if n['tag'] == 'canvas']) for s in steps), 'microphone': key == 'u3_l8', 'external_dependencies': 0})
        if args.redirect:
            target = 'lesson.html?id=' + record['id']
            stub = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + html.escape(record['title']) + '</title></head><body><p>서버 수업을 불러옵니다.</p><a href="' + target + '">수업 열기</a><script>const next=new URL(' + json.dumps(target) + ',location.href);if(new URLSearchParams(location.search).get("worksheet")==="1")next.searchParams.set("worksheet","1");location.replace(next.href);</script></body></html>\n'
            (args.site / filename).write_text(stub)
    (args.site / 'tools/server-lesson-migration-report.json').write_text(json.dumps({'lessons': report, 'physical_device_verified': False, 'source': 'explicitly supplied trusted 15 lesson files'}, ensure_ascii=False, indent=2))
    sql.append('commit;')
    (out / 'migrate-existing-server-lessons.sql').write_text('\n'.join(sql))
    print(json.dumps({'lessons': len(report), 'questions': sum(r['quiz'] for r in report), 'redirects': args.redirect}))


if __name__ == '__main__':
    main()
