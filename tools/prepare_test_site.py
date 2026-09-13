#!/usr/bin/env python3
"""Isolate legacy browser storage for the named test site after lesson extraction."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
for path in [*ROOT.glob('*.html'), *ROOT.glob('*.js'), *ROOT.glob('assets/*.js')]:
    if path.name == 'platform-config.js':
        continue
    source = path.read_text()
    source = re.sub(r'\bsessionStorage\b', 'platformSessionStorage', source)
    source = re.sub(r'\blocalStorage\b', 'platformLocalStorage', source)
    path.write_text(source)

index = ROOT / 'index.html'
source = index.read_text()
source = re.sub(r'<title>.*?</title>', '<title>중2 과학 디지털 탐구 플랫폼 · 서버 구조 테스트</title>', source, count=1)
index.write_text(source)
print('Test storage wrappers applied. Production storage is not migrated.')
