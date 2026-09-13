#!/usr/bin/env python3
"""One-time test imports. Routine uploads use the teacher panel in index.html.
Supply a short-lived TEST admin session in a private local file, never a service key.
Existing IDs are skipped. No import is silently applied to another project.
"""
import argparse
import json
import pathlib
import urllib.request
import urllib.error

API = 'https://rerykeslgwhamreoskgx.supabase.co/functions/v1/content-api'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('records', type=pathlib.Path, help='Directory of private record JSON files')
    parser.add_argument('--admin-token-file', type=pathlib.Path, required=True)
    args = parser.parse_args()
    token = args.admin_token_file.read_text().strip()
    if not token.startswith('adm_'):
        raise SystemExit('A short-lived TEST administrator session is required.')

    def call(action, values=None):
        payload = dict(values or {}, action=action, adminSessionToken=token)
        req = urllib.request.Request(API, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Content API HTTP {error.code}; import stopped.') from None
        if not data.get('success'):
            raise RuntimeError('Server rejected the import; no local success is assumed.')
        return data

    health = call('health')
    if health.get('project') != 'rerykeslgwhamreoskgx' or not health.get('databaseReady'):
        raise SystemExit('The exact test database is not ready.')
    catalog = call('catalog')
    if catalog.get('role') != 'admin':
        raise SystemExit('Teacher administrator access is required.')
    existing = {item['id'] for item in catalog['items']}
    count = 0
    for path in sorted(args.records.glob('*.json')):
        parsed = json.loads(path.read_text())
        records = parsed if isinstance(parsed, list) else [parsed]
        for record in records:
            if 'kind' not in record or 'format' not in record:
                raise SystemExit(f'{path.name}: not a content record.')
            if record.get('id') in existing:
                print(f'{path.name}: existing record skipped')
                continue
            if record.get('kind') in ('answer', 'assessment'):
                record.update(published=False, student_access=False)
            result = call('save_content', record)
            existing.add(result['item']['id'])
            count += 1
            print(f'{path.name}: imported')
    print(f'{count} test records imported; quiz point rewards remain disabled.')

if __name__ == '__main__':
    main()
